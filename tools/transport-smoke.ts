/**
 * Transporter smoke: lab permission, beam to refinery/cargo, full storage message.
 *
 * Run: npm run smoke:transport
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { LV_427_DESIGNATION, PLANET_DESIGNATIONS_COMMON, SCAN_STATIONS, SURFACE_ANOMALY_LABEL } from '../shared/scanning';
import { beamableLootForPad, formatLootSummary } from '../shared/transporter';
import {
  CARGO_TRANSPORTER_INTERACT_ID,
  LAB_TRANSPORTER_INTERACT_ID,
  REFINERY_CAPACITY,
  REFINERY_FULL_MESSAGE,
  REFINERY_START_PER_RAW,
  TRANSPORTER_SKILL_DENIED,
  TRANSPORTER_SKILL_MISS_MESSAGE,
  TRANSPORTER_STATIONS,
  stockTotal,
} from '../shared/transporter';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
let PORT = 47850 + Math.floor(Math.random() * 400);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-transport-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const labPad = TRANSPORTER_STATIONS.find((s) => s.interactId === LAB_TRANSPORTER_INTERACT_ID)!;
const anomalyContact = {
  id: 'anomaly-smoke',
  outcome: 'atmosphere' as const,
  distanceLabel: '88 km',
  foundAt: 0,
  foundBy: 'Smoke',
  loot: [],
  awayMissionCapable: true,
};
assert(beamableLootForPad(labPad, anomalyContact).length === 0, 'surface anomaly not a lab beam material');
assert(formatLootSummary(anomalyContact) === SURFACE_ANOMALY_LABEL, 'surface anomaly contact summary');

const LAB_STAND = TRANSPORTER_STATIONS.find((s) => s.interactId === LAB_TRANSPORTER_INTERACT_ID)!.stand;
const CARGO_STAND = TRANSPORTER_STATIONS.find((s) => s.interactId === CARGO_TRANSPORTER_INTERACT_ID)!.stand;
const SCAN_STAND = SCAN_STATIONS[0].stand;

let server: ChildProcess | null = null;

async function startServer(extraEnv: Record<string, string> = {}) {
  PORT += 1;
  const WS = `ws://localhost:${PORT}/ws`;
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
  return WS;
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => {
    s.once('exit', () => resolve());
    s.kill('SIGTERM');
  });
  await sleep(150);
}

class Client {
  ws: WebSocket;
  readonly inbox: ServerMsg[] = [];

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
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

  async wait(pred: (m: ServerMsg) => boolean, ms = 12000): Promise<ServerMsg> {
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

const character = (job: 'Engineer' | 'Botanist', first: string, last: string) => ({
  sex: 'male' as const,
  face: 'neutral' as const,
  hairStyle: 'parted' as const,
  facialHair: 'none' as const,
  hairColor: '#1c1a1f',
  eyeColor: '#3a78c9',
  job,
  firstName: first,
  lastName: last,
});

async function main() {
  const hostId = `transport-host-${crypto.randomUUID()}`;
  let shipCode = '';
  let engineerId = '';

  const ws1 = await startServer({
    SCAN_FORCE_ROLL: '0',
    SCAN_FORCE_OUTCOME: 'atmosphere',
    SCAN_FORCE_ANOMALY_ROLL: '0.99',
    TRANSPORT_FORCE_ROLL: '0.99',
  });

  const bot = new Client(ws1);
  await bot.open();
  bot.send({ t: 'host', clientId: hostId });
  const hosted = await bot.wait(is('characters'));
  shipCode = hosted.code;
  bot.send({ t: 'newCharacter' });
  await bot.wait(is('welcome'));
  bot.send({ t: 'startGame' });
  await bot.wait((m) => m.t === 'shipState' && m.ship.gameStarted);
  bot.send({ t: 'create', character: character('Botanist', 'Bot', 'Anist') });
  await bot.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && !!m.player.character);
  bot.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: 'x',
    materialId: 'lithium_bilge',
    qty: 1,
    x: LAB_STAND.x,
    z: LAB_STAND.z,
  });
  const denied = await bot.wait(is('error'));
  assert(denied.message === TRANSPORTER_SKILL_DENIED, 'botanist lab denial');
  bot.close();

  const eng = new Client(ws1);
  await eng.open();
  eng.send({ t: 'join', clientId: hostId, code: shipCode });
  await eng.wait(is('characters'));
  eng.send({ t: 'newCharacter' });
  await eng.wait(is('welcome'));
  eng.send({ t: 'create', character: character('Engineer', 'Eng', 'Ineer') });
  const engCreated = await eng.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && !!m.player.character);
  engineerId = engCreated.player.id;

  eng.send({ t: 'scanStart', x: SCAN_STAND.x, z: SCAN_STAND.z });
  await eng.wait(is('scanProgress'));
  const scanned = await eng.wait(is('scanComplete'), 15000);
  assert(scanned.find?.outcome === 'atmosphere', 'atmosphere scan');
  const designation = scanned.find!.planetDesignation;
  assert(typeof designation === 'string' && designation.length > 0, 'planet designation on atmosphere find');
  assert(
    designation === LV_427_DESIGNATION || PLANET_DESIGNATIONS_COMMON.includes(designation),
    'designation from catalog',
  );
  const rawLine = scanned.find!.loot[0];
  assert(rawLine && rawLine.remaining > 0, 'loot on scan');

  eng.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: scanned.find!.id,
    materialId: rawLine.materialId,
    qty: 1,
    x: LAB_STAND.x,
    z: LAB_STAND.z,
  });
  const skillMiss = await eng.wait(is('error'));
  assert(skillMiss.message === TRANSPORTER_SKILL_MISS_MESSAGE, 'skill miss copy');
  eng.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: scanned.find!.id,
    materialId: rawLine.materialId,
    qty: 1,
    x: LAB_STAND.x,
    z: LAB_STAND.z,
  });
  const skillMiss2 = await eng.wait(is('error'));
  assert(skillMiss2.message === TRANSPORTER_SKILL_MISS_MESSAGE, 'second start after miss not stuck');
  eng.close();
  await stopServer();

  const ws1b = await startServer({
    SCAN_FORCE_ROLL: '0',
    SCAN_FORCE_OUTCOME: 'atmosphere',
    SCAN_FORCE_ANOMALY_ROLL: '0.99',
    TRANSPORT_FORCE_ROLL: '0',
  });
  const engBeam = new Client(ws1b);
  await engBeam.open();
  engBeam.send({ t: 'join', clientId: hostId, code: shipCode });
  await engBeam.wait(is('characters'));
  engBeam.send({ t: 'pickCharacter', characterId: engineerId });
  await engBeam.wait(is('welcome'));

  engBeam.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: scanned.find!.id,
    materialId: rawLine.materialId,
    qty: 1,
    x: LAB_STAND.x,
    z: LAB_STAND.z,
  });
  await engBeam.wait(is('transportProgress'));
  const beamed = await engBeam.wait(is('transportComplete'), 15000);
  assert(beamed.ok, 'engineer beam ok');
  const beamId = rawLine.materialId === 'lithium' ? 'lithium_bilge' : rawLine.materialId;
  assert(beamed.refineryUnrefined[beamId] === REFINERY_START_PER_RAW + 1, 'refinery unrefined gained one unit');
  engBeam.close();
  await stopServer();

  const ws2 = await startServer({
    SCAN_FORCE_ROLL: '0',
    SCAN_FORCE_OUTCOME: 'debris',
    SCAN_FORCE_ANOMALY_ROLL: '0.99',
    TRANSPORT_FORCE_ROLL: '0',
  });
  const eng2 = new Client(ws2);
  await eng2.open();
  eng2.send({ t: 'join', clientId: hostId, code: shipCode });
  await eng2.wait(is('characters'));
  eng2.send({ t: 'pickCharacter', characterId: engineerId });
  await eng2.wait(is('welcome'));
  eng2.send({ t: 'scanStart', x: SCAN_STAND.x, z: SCAN_STAND.z });
  await eng2.wait(is('scanProgress'));
  const debris = await eng2.wait(is('scanComplete'), 15000);
  assert(debris.find?.outcome === 'debris', 'debris scan');
  const shipLine = debris.find!.loot[0];
  eng2.send({
    t: 'transportStart',
    padId: CARGO_TRANSPORTER_INTERACT_ID,
    scanId: debris.find!.id,
    materialId: shipLine.materialId,
    qty: 1,
    x: CARGO_STAND.x,
    z: CARGO_STAND.z,
  });
  await eng2.wait(is('transportProgress'));
  const cargoDone = await eng2.wait(is('transportComplete'), 15000);
  assert(cargoDone.ok, 'cargo beam ok');
  assert((cargoDone.cargoHoldStock[shipLine.materialId] ?? 0) === 16, 'cargo hold gained one ship material');
  eng2.close();
  await stopServer();

  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as {
    ships: {
      refineryUnrefined: Record<string, number>;
      scanResults: { id: string; outcome: string; distanceLabel: string; foundAt: number; foundBy: string; loot: { materialId: string; qty: number; remaining: number }[] }[];
    }[];
  };
  const ship = raw.ships[0];
  const keys = Object.keys(ship.refineryUnrefined);
  const fill: Record<string, number> = {};
  let left = REFINERY_CAPACITY;
  for (const k of keys) {
    const n = Math.min(20, left);
    fill[k] = n;
    left -= n;
  }
  ship.refineryUnrefined = fill;
  ship.scanResults.push({
    id: 'smoke-find-full',
    outcome: 'atmosphere',
    distanceLabel: '50 km',
    foundAt: Date.now(),
    foundBy: 'Smoke',
    loot: [{ materialId: 'lithium_bilge', qty: 5, remaining: 5 }],
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(raw, null, 2));
  assert(stockTotal(ship.refineryUnrefined) === REFINERY_CAPACITY, 'refinery seeded to capacity');

  const ws3 = await startServer({ TRANSPORT_FORCE_ROLL: '0' });
  const eng3 = new Client(ws3);
  await eng3.open();
  eng3.send({ t: 'join', clientId: hostId, code: shipCode });
  await eng3.wait(is('characters'));
  eng3.send({ t: 'pickCharacter', characterId: engineerId });
  await eng3.wait(is('welcome'));
  eng3.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: 'smoke-find-full',
    materialId: 'lithium_bilge',
    qty: 1,
    x: LAB_STAND.x,
    z: LAB_STAND.z,
  });
  const full = await eng3.wait(is('error'));
  assert(full.message === REFINERY_FULL_MESSAGE, 'refinery full message');
  eng3.close();
  await stopServer();

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('transport smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
