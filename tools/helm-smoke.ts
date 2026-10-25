/**
 * Helm / navigation smoke: distance math, Captain warp, non-Captain deny, arrival at 20 km, motion state.
 *
 * Run: npm run smoke:helm
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {
  APPROACH_DISTANCE_KM,
  defaultNavigation,
  formatDistanceKm,
  parseDistanceKm,
  warpDurationMs,
  distanceNeedsTransit,
} from '../shared/navigation';
import { pickScanDistanceLabel, SCAN_STATIONS } from '../shared/scanning';
import { applyHelmStart, finishDueTransits } from '../server/src/navigation';
import type { ShipRecord } from '../server/src/store';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 47850 + Math.floor(Math.random() * 400);
const WS = `ws://localhost:${PORT}/ws`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-helm-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

assert(parseDistanceKm('<20 km')! < APPROACH_DISTANCE_KM, '<20 km parse');
assert(distanceNeedsTransit('142 km'), '142 km needs transit');
assert(!distanceNeedsTransit('<20 km'), '<20 km no transit');
assert(pickScanDistanceLabel(0.9).includes('LY'), 'high roll yields LY');
assert(warpDurationMs(1_000_000, 'warp') === 120_000, '2 min per LY');

const ship: ShipRecord = {
  code: 'TESTSHIP',
  hostId: 'host',
  createdAt: 0,
  members: {},
  scanResults: [
    {
      id: 's1',
      outcome: 'debris',
      distanceLabel: '500 km',
      foundAt: 0,
      foundBy: 'X',
      loot: [],
    },
  ],
  navigation: { motion: 'still', transit: { scanId: 's1', mode: 'f-warp', startedAt: Date.now() - 10, endsAt: Date.now() - 1 } },
};
const done = finishDueTransits(ship, Date.now());
assert(done.length === 1 && ship.scanResults![0].distanceLabel.startsWith('<'), 'finish transit sets 20 km hold');

const denyShip: ShipRecord = {
  code: 'DENY',
  hostId: 'h',
  createdAt: 0,
  members: {
    e1: {
      id: 'e1',
      ownerId: 'e1',
      tube: 1,
      character: {
        sex: 'female',
        face: 'neutral',
        hairStyle: 'buzzed',
        facialHair: 'none',
        hairColor: '#1c1a1f',
        eyeColor: '#3a78c9',
        job: 'Engineer',
        firstName: 'E',
        lastName: 'E',
      },
      x: -38.2,
      z: 34.4,
      rot: 0,
      joinedAt: 0,
    },
  },
  scanResults: ship.scanResults,
  navigation: defaultNavigation(),
};
const denyRes = applyHelmStart(denyShip, denyShip.members.e1, 's1', 'warp', -38.2, 34.4);
assert(!denyRes.ok && denyRes.message.includes('Captain'), 'applyHelmStart denies non-captain');

let server: ChildProcess | null = null;

async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_FILE,
      SCAN_FORCE_OUTCOME: 'debris',
      SCAN_FORCE_ROLL: '0',
      SCAN_FORCE_DISTANCE: '800 km',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server timeout')), 15000);
    server!.stdout!.on('data', (b) => {
      if (String(b).includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
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

async function main() {
  await startServer();
  const capClient = 'helm-cap-' + Math.random().toString(36).slice(2);
  const cap = new Client();
  await cap.open();
  cap.send({ t: 'host', clientId: capClient });
  await cap.wait(is('characters'));
  cap.send({ t: 'newCharacter' });
  const welcome = await cap.wait(is('welcome'));
  assert(welcome.ship.navigation.motion === 'still', 'initial motion still');
  cap.send({ t: 'startGame' });
  await cap.wait((m) => m.t === 'shipState' && m.ship.gameStarted);
  cap.send({
    t: 'create',
    character: {
      sex: 'male',
      face: 'neutral',
      hairStyle: 'parted',
      facialHair: 'none',
      hairColor: '#1c1a1f',
      eyeColor: '#3a78c9',
      job: 'Captain',
      firstName: 'Cap',
      lastName: 'Test',
    },
  });
  await cap.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && !!m.player.character);
  const stand = SCAN_STATIONS[0].stand;
  cap.send({ t: 'scanStart', x: stand.x, z: stand.z });
  await cap.wait(is('scanProgress'));
  const scanDone = await cap.wait(is('scanComplete'), 12000);
  assert(scanDone.hit && scanDone.find, 'scan hit');
  assert(distanceNeedsTransit(scanDone.find!.distanceLabel), 'scan needs transit');
  const scanId = scanDone.find!.id;

  cap.send({ t: 'helmStart', scanId, mode: 'f-warp', x: -38.2, z: 34.4 });
  await cap.wait(is('helmProgress'));
  let motionWarp = false;
  let arrived = false;
  const km = parseDistanceKm(scanDone.find!.distanceLabel)!;
  const waitMs = warpDurationMs(km, 'f-warp') + 2500;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    for (const m of cap.inbox.splice(0)) {
      if (m.t === 'shipState' && m.ship.navigation.motion === 'f-warp') motionWarp = true;
      if (m.t === 'helmComplete') {
        const row = m.scanResults.find((r) => r.id === scanId);
        if (row?.distanceLabel.startsWith('<')) arrived = true;
      }
    }
    if (arrived) break;
    await sleep(20);
  }
  assert(motionWarp, 'motion was f-warp');
  assert(arrived, 'arrived at 20 km hold');

  cap.close();
  server?.kill('SIGTERM');
  await sleep(200);
  console.log('helm-smoke: ok');
}

main().catch((e) => {
  server?.kill();
  console.error(e);
  process.exit(1);
});
