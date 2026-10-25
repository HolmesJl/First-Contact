/**
 * Datapad scan log + archive smoke.
 *
 * Run: npm run smoke:datapad
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { interactIdForProp, positionForInteract } from '../shared/opening';
import { LAB_TRANSPORTER_INTERACT_ID, LAB_TRANSPORTER_PROP_ID, TRANSPORTER_STATIONS } from '../shared/transporter';
import { SCAN_STATIONS } from '../shared/scanning';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
let PORT = 47890 + Math.floor(Math.random() * 200);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datapad-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

assert(interactIdForProp(LAB_TRANSPORTER_PROP_ID) === LAB_TRANSPORTER_INTERACT_ID, 'lab pad prop maps to lab-transporter');
const labStand = positionForInteract(LAB_TRANSPORTER_INTERACT_ID);
assert(labStand !== null, 'lab transporter stand');

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

async function main() {
  const WS = await startServer({
    SCAN_FORCE_ROLL: '0',
    SCAN_FORCE_OUTCOME: 'atmosphere',
    SCAN_FORCE_ANOMALY_ROLL: '0.99',
    TRANSPORT_FORCE_ROLL: '0',
  });
  const hostId = `dp-host-${crypto.randomUUID()}`;
  const c = new Client(WS);
  await c.open();
  c.send({ t: 'host', clientId: hostId });
  const chars = await c.wait(is('characters'));
  c.send({ t: 'newCharacter' });
  await c.wait(is('welcome'));
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
      firstName: 'Pad',
      lastName: 'Tester',
    },
  });
  const created = await c.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && !!m.player.character);
  const characterId = created.player.id;
  assert(created.player.padScanLogs.length === 0, 'no scan logs at start');

  const scanStand = SCAN_STATIONS[0].stand;
  c.send({ t: 'scanStart', x: scanStand.x, z: scanStand.z });
  await c.wait(is('scanProgress'));
  const done = await c.wait(is('scanComplete'), 12000);
  assert(done.hit && done.find, 'scan hit');
  const updated = await c.wait(
    (m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && m.player.id === characterId && m.player.padScanLogs.length === 1,
  );
  const log = updated.player.padScanLogs[0];
  assert(log.scanResultId === done.find!.id, 'log links to ship contact');
  assert(log.headline.includes('Planet') || log.headline.includes('·'), 'log headline');
  assert(log.summary.length > 0, 'log summary');

  const logId = log.id;
  c.send({ t: 'padArchive', kind: 'scan', id: logId });
  const archived = await c.wait(
    (m): m is Extract<ServerMsg, { t: 'playerUpdated' }> =>
      m.t === 'playerUpdated' && m.player.id === characterId && m.player.padScanLogs.length === 0 && m.player.padArchive.length === 1,
  );
  assert(archived.player.padArchive[0].kind === 'scan', 'archived scan');
  assert(archived.player.padArchive[0].title === log.headline, 'archive title');

  const labPad = TRANSPORTER_STATIONS.find((s) => s.interactId === LAB_TRANSPORTER_INTERACT_ID)!;
  const rawContact = done.scanResults.find((r) => r.loot.some((l) => l.remaining > 0));
  assert(rawContact, 'scan has beamable raw loot');
  c.send({
    t: 'transportStart',
    padId: LAB_TRANSPORTER_INTERACT_ID,
    scanId: rawContact!.id,
    materialId: rawContact!.loot[0].materialId,
    qty: 1,
    x: labPad.stand.x,
    z: labPad.stand.z,
  });
  await c.wait(is('transportProgress'));
  const transport = await c.wait(is('transportComplete'), 12000);
  assert(transport.ok, 'lab transport started');

  c.close();
  await stopServer();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('datapad smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
