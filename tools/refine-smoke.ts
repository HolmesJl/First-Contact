/**
 * Refinery + Printer smoke: skill miss/retry, copper ore refine, print alloys to cargo.
 *
 * Run: npm run smoke:refine
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { positionForInteract } from '../shared/opening';
import { REFINERY_SKILL_MISS_MESSAGE } from '../shared/refining';
import { REFINERY_START_PER_RAW } from '../shared/transporter';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
let PORT = 47950 + Math.floor(Math.random() * 400);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-refine-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REFINERY_STAND = positionForInteract('refinery-panel')!;
const PRINTER_STAND = positionForInteract('printer-panel')!;

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

  close() {
    this.ws.close();
  }

  wait(pred: (m: ServerMsg) => boolean, ms = 15000, label = 'wait') {
    return new Promise<ServerMsg>((resolve, reject) => {
      const deadline = Date.now() + ms;
      const tick = () => {
        const hit = this.inbox.find(pred);
        if (hit) {
          this.inbox.splice(this.inbox.indexOf(hit), 1);
          resolve(hit);
          return;
        }
        if (Date.now() > deadline) reject(new Error(`timeout: ${label}`));
        else setTimeout(tick, 20);
      };
      tick();
    });
  }
}

const is = <T extends ServerMsg['t']>(t: T) => (m: ServerMsg) => m.t === t;

function character(job: string, first: string, last: string) {
  return {
    sex: 'male' as const,
    face: 'neutral' as const,
    hairStyle: 'parted' as const,
    facialHair: 'none' as const,
    hairColor: '#1c1a1f',
    eyeColor: '#3a78c9',
    job,
    firstName: first,
    lastName: last,
  };
}

async function main() {
  const hostId = 'refine-smoke-host';
  const ws1 = await startServer({ REFINE_FORCE_ROLL: '0.99', REFINE_DURATION_MS: '200' });
  const eng = new Client(ws1);
  await eng.open();
  eng.send({ t: 'host', clientId: hostId });
  const hosted = await eng.wait(is('characters'), 15000, 'characters');
  const shipCode = hosted.code;
  eng.send({ t: 'newCharacter' });
  await eng.wait(is('welcome'), 15000, 'welcome');
  eng.send({ t: 'startGame' });
  const started = await eng.wait(
    (m): m is Extract<ServerMsg, { t: 'shipState' }> => m.t === 'shipState' && m.ship.gameStarted,
    15000,
    'gameStarted',
  );
  const startCopper = started.ship.refineryUnrefined.copper_ore ?? 0;
  eng.send({ t: 'create', character: character('Engineer', 'Ref', 'Iner') });
  const createdMsg = await eng.wait(
    (m) =>
      (m.t === 'playerUpdated' && !!(m as Extract<ServerMsg, { t: 'playerUpdated' }>).player.character) ||
      m.t === 'createError',
    15000,
    'playerCreated',
  );
  if (createdMsg.t === 'createError') throw new Error(`create failed: ${createdMsg.message}`);
  const created = createdMsg as Extract<ServerMsg, { t: 'playerUpdated' }>;
  const engineerId = created.player.id;
  assert(startCopper === REFINERY_START_PER_RAW, 'seeded copper ore');

  eng.send({ t: 'refineStart', materialId: 'copper_ore', mode: 'one', x: REFINERY_STAND.x, z: REFINERY_STAND.z });
  const first = await eng.wait((m) => m.t === 'refineProgress' || m.t === 'error', 15000, 'refineProgress');
  if (first.t === 'error') throw new Error(`refineStart failed: ${first.message}`);
  const miss = await eng.wait(is('refineComplete'), 15000, 'refineComplete-miss');
  assert(!miss.hit && miss.message === REFINERY_SKILL_MISS_MESSAGE, 'skill miss');
  assert(miss.continued && miss.endsAt, 'retry scheduled');
  assert(miss.refineryUnrefined.copper_ore === startCopper, 'miss does not consume ore');
  eng.close();
  await stopServer();
  await sleep(300);

  const ws2 = await startServer({ REFINE_FORCE_ROLL: '0', REFINE_DURATION_MS: '200' });
  const eng2 = new Client(ws2);
  await eng2.open();
  eng2.send({ t: 'join', clientId: hostId, code: shipCode });
  await eng2.wait(is('characters'), 15000, 'rejoin-characters');
  eng2.send({ t: 'pickCharacter', characterId: engineerId });
  await eng2.wait(is('welcome'), 15000, 'rejoin-welcome');

  eng2.send({ t: 'refineStart', materialId: 'copper_ore', mode: 'one', x: REFINERY_STAND.x, z: REFINERY_STAND.z });
  await eng2.wait(is('refineProgress'), 15000, 'refineProgress-hit');
  const hit = await eng2.wait(is('refineComplete'), 15000, 'refineComplete-hit');
  assert(hit.hit, 'refine success');
  assert(hit.refineryUnrefined.copper_ore === startCopper - 1, 'one ore consumed');
  assert((hit.refineryRefined.copper ?? 0) >= 1, 'one copper refined');

  for (const ore of ['tin_ore', 'iron_ore'] as const) {
    eng2.send({ t: 'refineStart', materialId: ore, mode: 'one', x: REFINERY_STAND.x, z: REFINERY_STAND.z });
    await eng2.wait(is('refineProgress'), 15000, `refineProgress-${ore}`);
    const row = await eng2.wait(is('refineComplete'), 15000, `refineComplete-${ore}`);
    assert(row.hit, `refined ${ore}`);
  }

  eng2.send({ t: 'printStart', materialId: 'alloys', x: PRINTER_STAND.x, z: PRINTER_STAND.z });
  const printed = await eng2.wait(
    (m) => m.t === 'printComplete' || m.t === 'error',
    15000,
    'printComplete',
  );
  if (printed.t === 'error') throw new Error(`print failed: ${printed.message}`);
  assert(printed.ok, 'print alloys');
  assert((printed.cargoHoldStock.alloys ?? 0) === 16, 'cargo gained one alloys');

  eng2.close();
  await stopServer();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('refine-smoke ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
