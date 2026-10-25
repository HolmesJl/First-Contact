/**
 * Scanning skill smoke: deterministic skill math, websocket scan flow, persistence, hit/miss, level-up.
 *
 * Run: npm run smoke:scan
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  SCAN_POSITIVES_FOR_LEVEL,
  SURFACE_ANOMALY_LABEL,
  applyPositiveScan,
  rollScanLoot,
  scanSucceeded,
  scanSuccessChance,
} from '../shared/scanning';
import { beamableLootForPad, formatLootSummary, TRANSPORTER_STATIONS } from '../shared/transporter';
import { SCAN_STATIONS } from '../shared/scanning';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 47800 + Math.floor(Math.random() * 400);
const WS = `ws://localhost:${PORT}/ws`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-scan-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- unit checks

assert(scanSuccessChance(1) === 0.2, 'level 1 chance');
assert(scanSuccessChance(5) === 1, 'level 5 chance');
assert(scanSucceeded(1, 0.1), 'low roll hits at level 1');
assert(!scanSucceeded(1, 0.95), 'high roll misses at level 1');
const up = applyPositiveScan({ level: 1, positiveScans: SCAN_POSITIVES_FOR_LEVEL - 1 });
assert(up.leveledUp && up.skill.level === 2 && up.skill.positiveScans === 0, '100th positive levels up');
const capped = applyPositiveScan({ level: 5, positiveScans: 50 });
assert(capped.skill.level === 5 && capped.skill.positiveScans === 50, 'max level does not increment');

const labPad = TRANSPORTER_STATIONS.find((s) => s.interactId === 'lab-transporter')!;
const anomalyOnly = rollScanLoot('atmosphere', [0.1, 0.2, 0.3, 0.4], 0);
assert(anomalyOnly.awayMissionCapable && anomalyOnly.loot.length === 0, 'surface anomaly uses a result slot');
const anomalyPlusMat = rollScanLoot('atmosphere', [0.9, 0.2, 0.3, 0.4], 0);
assert(anomalyPlusMat.awayMissionCapable && anomalyPlusMat.loot.length === 1, 'anomaly plus one material');
const noAnomaly = rollScanLoot('atmosphere', [0.9, 0.2, 0.3, 0.4], 0.5);
assert(!noAnomaly.awayMissionCapable && noAnomaly.loot.length >= 1, 'material-only atmosphere roll');
const anomalyEntry = {
  id: 'x',
  outcome: 'atmosphere' as const,
  distanceLabel: '12 km',
  foundAt: 0,
  foundBy: 'Test',
  loot: [],
  awayMissionCapable: true,
};
assert(formatLootSummary(anomalyEntry) === SURFACE_ANOMALY_LABEL, 'anomaly summary label');
assert(beamableLootForPad(labPad, anomalyEntry).length === 0, 'anomaly-only not lab beamable');

// ---------------------------------------------------------------- server

let server: ChildProcess | null = null;

async function startServer(extraEnv: Record<string, string> = {}) {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(PORT), DATA_FILE, ...extraEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    server!.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('listening')) resolve();
    });
    server!.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once('exit', () => resolve());
    s.kill('SIGTERM');
  });
}

class Client {
  ws: WebSocket;
  readonly inbox: ServerMsg[] = [];

  constructor() {
    this.ws = new WebSocket(WS);
    this.ws.on('message', (raw) => this.inbox.push(JSON.parse(String(raw)) as ServerMsg));
  }

  open() {
    return new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  async wait(pred: (m: ServerMsg) => boolean, ms = 8000): Promise<ServerMsg> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(10);
    }
    throw new Error(`timeout (inbox: ${this.inbox.map((m) => m.t).join(',') || 'empty'})`);
  }

  close() {
    this.ws.close();
  }
}

const is =
  <K extends ServerMsg['t']>(t: K) =>
  (m: ServerMsg): m is Extract<ServerMsg, { t: K }> =>
    m.t === t;

const STAND = SCAN_STATIONS[0].stand;

async function main() {
  await startServer({ SCAN_FORCE_ROLL: '0' });
  const hostId = `scan-host-${crypto.randomUUID()}`;
  const c = new Client();
  await c.open();
  c.send({ t: 'host', clientId: hostId });
  const chars = await c.wait(is('characters'));
  c.send({ t: 'newCharacter' });
  const welcome = await c.wait(is('welcome'));
  c.send({ t: 'startGame' });
  await c.wait((m) => m.t === 'shipState' && m.ship.gameStarted);
  c.send({
    t: 'create',
    character: {
      sex: 'male',
      face: 'neutral',
      hairStyle: 'parted',
      facialHair: 'none',
      hairColor: '#1c1a1f',
      eyeColor: '#3a78c9',
      job: 'Engineer',
      firstName: 'Scan',
      lastName: 'Tester',
    },
  });
  const created = await c.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && !!m.player.character);
  const characterId = created.player.id;
  assert(created.player.skills.scanning.level === 1 && created.player.skills.scanning.positiveScans === 0, 'default scanning skill');

  c.send({ t: 'scanStart', x: STAND.x, z: STAND.z });
  const prog = await c.wait(is('scanProgress'));
  assert(prog.endsAt > Date.now(), 'scan progress ends in the future');
  const done = await c.wait(is('scanComplete'), 12000);
  assert(done.hit, 'forced roll should hit');
  assert(done.skill.positiveScans === 1, 'hit increments positiveScans');
  assert(done.scanResults.length === 1, 'ship log has one entry');
  assert(done.find?.foundBy === 'Scan Tester', 'finder name on result');

  c.close();
  await sleep(200);
  await stopServer();

  // Level-up at 99 positives with a forced hit.
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { ships: { code: string; members: Record<string, { skills?: { scanning?: { level: number; positiveScans: number } } }> }[] };
  const ship = raw.ships[0];
  ship.members[characterId].skills = { scanning: { level: 1, positiveScans: 99 } };
  fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2));

  await startServer({ SCAN_FORCE_ROLL: '0' });
  const c2 = new Client();
  await c2.open();
  c2.send({ t: 'join', clientId: hostId, code: chars.code });
  await c2.wait(is('characters'));
  c2.send({ t: 'pickCharacter', characterId });
  const w2 = await c2.wait(is('welcome'));
  const me2 = w2.players.find((p) => p.id === characterId);
  assert(me2?.skills.scanning.positiveScans === 99, 'persisted 99 positives after reload');

  c2.send({ t: 'scanStart', x: STAND.x, z: STAND.z });
  await c2.wait(is('scanProgress'));
  const leveled = await c2.wait(is('scanComplete'), 12000);
  assert(leveled.leveledUp && leveled.skill.level === 2 && leveled.skill.positiveScans === 0, 'level-up at 100th hit');

  c2.close();
  await sleep(200);
  await stopServer();

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('scan smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
