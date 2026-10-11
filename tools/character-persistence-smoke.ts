/**
 * WebSocket smoke for character persistence: create → disconnect → (server restart) → reconnect → pick list → spawn
 * in quarters → take-over → delete → forming-clone cleanup → legacy adoption.
 *
 * Run: npm run smoke:characters
 * It starts its own server on a free port with a temp data file, restarts it half-way, and cleans up after itself.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { BERTHS, spaceAt } from '../shared/shipInterior';
import { homeSpawnFor, memoryStationFor, memoryStationId } from '../shared/bunks';
import type { Character, ClientMsg, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 47400 + Math.floor(Math.random() * 400);
const WS = `ws://localhost:${PORT}/ws`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-smoke-'));
const DATA_FILE = path.join(DATA_DIR, 'ships.json');

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- server lifecycle

let server: ChildProcess | null = null;

async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(PORT), DATA_FILE },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = new Promise<void>((resolve, reject) => {
    server!.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('listening')) resolve();
    });
    server!.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
  await ready;
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  const exited = new Promise<void>((resolve) => s.once('exit', () => resolve()));
  s.kill('SIGTERM');
  await exited;
}

// ---------------------------------------------------------------- ws helpers

class Client {
  ws: WebSocket;
  readonly inbox: ServerMsg[] = [];
  closed = false;

  constructor() {
    this.ws = new WebSocket(WS);
    this.ws.on('message', (raw) => this.inbox.push(JSON.parse(String(raw)) as ServerMsg));
    this.ws.on('close', () => (this.closed = true));
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

  /** Next message matching `pred`, consuming it (and anything before it that does not match stays). */
  async wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, ms = 6000): Promise<T>;
  async wait(pred: (m: ServerMsg) => boolean, ms?: number): Promise<ServerMsg>;
  async wait(pred: (m: ServerMsg) => boolean, ms = 6000): Promise<ServerMsg> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      await sleep(10);
    }
    throw new Error(`timeout waiting for message (inbox: ${this.inbox.map((m) => m.t).join(',') || 'empty'})`);
  }

  waitClosed(ms = 4000) {
    const deadline = Date.now() + ms;
    return (async () => {
      while (!this.closed && Date.now() < deadline) await sleep(10);
      assert(this.closed, 'socket was not closed');
    })();
  }

  close() {
    this.ws.close();
  }
}

const is =
  <K extends ServerMsg['t']>(t: K) =>
  (m: ServerMsg): m is Extract<ServerMsg, { t: K }> =>
    m.t === t;

async function connect(first: ClientMsg) {
  const c = new Client();
  await c.open();
  c.send(first);
  const chars = await c.wait(is('characters'));
  return { c, chars };
}

function character(job: Character['job'], firstName: string): Character {
  return { sex: 'female', face: 'calm', hairStyle: 'buns', facialHair: 'none', hairColor: '#8e3b1f', eyeColor: '#3f8a4f', job, firstName, lastName: 'Smoke' };
}

async function createNew(c: Client, job: Character['job'], name: string, startVoyage = false) {
  c.send({ t: 'newCharacter' });
  const w = await c.wait(is('welcome'));
  if (startVoyage) {
    c.send({ t: 'startGame' });
    await c.wait((m) => m.t === 'shipState' && m.ship.gameStarted);
  }
  c.send({ t: 'create', character: character(job, name) });
  const u = await c.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && m.player.id === w.you && !!m.player.character);
  return { you: w.you, code: w.code, player: u.player };
}

const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) < 0.01;

// ---------------------------------------------------------------- scenario

const HOST = `smoke-host-${crypto.randomUUID()}`;
const CREW = `smoke-crew-${crypto.randomUUID()}`;
const STRANGER = `smoke-stranger-${crypto.randomUUID()}`;
const LEGACY_TAB = `legacy-tab-${crypto.randomUUID()}`;
const LEGACY_BROWSER = `smoke-legacy-${crypto.randomUUID()}`;

function seedLegacyShip() {
  const legacy = {
    code: 'LEGACY',
    hostId: LEGACY_TAB,
    createdAt: Date.now() - 86_400_000,
    gameStarted: true,
    members: {
      [LEGACY_TAB]: { id: LEGACY_TAB, tube: 0, character: character('Doctor', 'Old'), x: -10, z: 4, rot: 0, joinedAt: Date.now() - 86_400_000, questStep: 'done' },
    },
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify({ ships: [legacy] }, null, 2));
}

async function main() {
  seedLegacyShip();
  await startServer();

  // -- 1. Host creates a Captain, crew creates an Engineer who claims Bunk 2.
  const { c: host, chars: hostChars } = await connect({ t: 'host', clientId: HOST });
  assert(hostChars.characters.length === 0 && hostChars.crewCount === 0, 'fresh ship has no saved characters');
  const cap = await createNew(host, 'Captain', 'Cap', true);
  const code = cap.code;
  assert(cap.player.isHost, 'host character carries isHost');
  assert(cap.player.questStep === 'captain-set-code', `captain starts at captain-set-code (${cap.player.questStep})`);

  const { c: crew, chars: crewChars } = await connect({ t: 'join', clientId: CREW, code });
  assert(crewChars.characters.length === 0 && crewChars.crewCount === 1, 'new browser sees no characters but the captain in the crew count');
  const eng = await createNew(crew, 'Engineer', 'Eng');
  assert(!eng.player.isHost, 'crew character is not host');

  const station = memoryStationFor(2)!;
  crew.send({ t: 'interact', id: memoryStationId(2), x: station.stand.x, z: station.stand.z });
  const up = await crew.wait(is('memoryUpload'));
  assert(up.berth === 2 && up.claimed, 'engineer claimed Bunk 2');
  const engBefore = (await crew.wait((m): m is Extract<ServerMsg, { t: 'playerUpdated' }> => m.t === 'playerUpdated' && m.player.id === eng.you && m.player.berth === 2)).player;

  // Walk the captain off the spawn so "spawn in cabin" is a real reset later.
  for (let i = 0; i < 6; i++) {
    host.send({ t: 'move', x: cap.player.x, z: cap.player.z + 0.2 * (i + 1), rot: 1, moving: true });
    await sleep(70);
  }
  host.send({ t: 'move', x: cap.player.x, z: cap.player.z + 1.2, rot: 1, moving: false });
  await sleep(150);

  // -- 2. Both leave; the other side sees them go offline (not removed).
  host.close();
  crew.close();
  await sleep(300);

  // -- 3. Reconnect before a restart: the pick list is there and nobody is online.
  {
    const { c, chars } = await connect({ t: 'join', clientId: HOST, code });
    assert(chars.characters.length === 1, `host sees exactly one saved character (${chars.characters.length})`);
    const s = chars.characters[0];
    assert(s.id === cap.you && s.character.job === 'Captain' && s.character.firstName === 'Cap', 'saved captain matches');
    assert(!s.online, 'captain not online after disconnect');
    assert(Date.now() - s.lastPlayedAt < 5000, 'lastPlayedAt updated on disconnect');
    assert(s.uniform === 'crew' && s.berth === null && s.questStep === 'captain-set-code', 'saved captain fields');
    assert(chars.crewCount === 2, `crew count 2 (${chars.crewCount})`);
    c.close();
  }

  // -- 4. Restart the server: everything must come back from disk.
  await stopServer();
  const onDisk = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { ships: { code: string; members: Record<string, { ownerId: string; character: Character | null }> }[] };
  const shipOnDisk = onDisk.ships.find((s) => s.code === code)!;
  assert(shipOnDisk, 'ship written to disk');
  assert(Object.values(shipOnDisk.members).every((m) => m.character && m.ownerId), 'members on disk have characters and owners');
  await startServer();

  // -- 5. Captain picks: welcome, spawned in the cabin, quest step intact.
  const host2 = await connect({ t: 'join', clientId: HOST, code });
  assert(host2.chars.characters.length === 1 && host2.chars.characters[0].id === cap.you, 'pick list survives restart');
  host2.c.send({ t: 'pickCharacter', characterId: cap.you });
  const w2 = await host2.c.wait(is('welcome'));
  assert(w2.you === cap.you, 'picked character keeps its id');
  const me2 = w2.players.find((p) => p.id === cap.you)!;
  assert(me2.character?.job === 'Captain', 'captain character restored');
  assert(near(me2, homeSpawnFor('Captain', null)), `captain spawns at the cabin spot (${me2.x}, ${me2.z})`);
  assert(spaceAt(me2.x, me2.z)?.id === 'cabin', 'captain is inside the cabin');
  assert(me2.questStep === 'captain-set-code' && !me2.hasPad, 'captain quest state resumed, no wake replay');
  assert(me2.isHost, 'isHost survives restart');
  const engState = w2.players.find((p) => p.id === eng.you)!;
  assert(engState && !engState.connected && engState.berth === 2, 'offline engineer still on the crew with Bunk 2');

  // -- 6. Engineer picks: spawns at their own bunk, quest step and berth intact.
  const crew2 = await connect({ t: 'join', clientId: CREW, code });
  assert(crew2.chars.characters.length === 1 && crew2.chars.characters[0].berth === 2, 'engineer pick list shows Bunk 2');
  crew2.c.send({ t: 'pickCharacter', characterId: eng.you });
  const w3 = await crew2.c.wait(is('welcome'));
  const me3 = w3.players.find((p) => p.id === eng.you)!;
  const bunk2 = BERTHS.find((b) => b.index === 2)!;
  assert(near(me3, bunk2) && near(me3, homeSpawnFor('Engineer', 2)), `engineer spawns at Bunk 2 (${me3.x}, ${me3.z})`);
  assert(spaceAt(me3.x, me3.z)?.id === 'bunks', 'engineer is in the bunk room');
  assert(me3.questStep === engBefore.questStep && me3.berth === 2 && me3.lastUploadAt === engBefore.lastUploadAt, 'engineer state resumed');
  // The captain saw the engineer come back online.
  await host2.c.wait((m) => m.t === 'playerUpdated' && m.player.id === eng.you && m.player.connected);

  // -- 7. Server is authoritative about ownership: a stranger cannot pick or delete someone else's character.
  {
    const { c, chars } = await connect({ t: 'join', clientId: STRANGER, code });
    assert(chars.characters.length === 0, 'stranger sees no characters');
    c.send({ t: 'pickCharacter', characterId: cap.you });
    const e1 = await c.wait(is('error'));
    assert(!e1.fatal && /not yours/.test(e1.message), `stranger pick refused (${e1.message})`);
    c.send({ t: 'deleteCharacter', characterId: cap.you });
    const e2 = await c.wait(is('error'));
    assert(!e2.fatal && /not yours/.test(e2.message), `stranger delete refused (${e2.message})`);
    c.close();
  }

  // -- 8. Same browser, second window picks the captain: the list flags "in play" and the first window is kicked.
  {
    const { c, chars } = await connect({ t: 'join', clientId: HOST, code });
    assert(chars.characters[0].online, 'in-play character is flagged online');
    c.send({ t: 'pickCharacter', characterId: cap.you });
    await c.wait(is('welcome'));
    const kicked = await host2.c.wait((m) => m.t === 'error' && !!m.fatal);
    assert(/another window/.test((kicked as { message: string }).message), 'first window told about the take-over');
    await host2.c.waitClosed();
    c.close();
    await sleep(200);
  }

  // -- 9. Delete from the pick list while the character is in play: the playing window is kicked, everyone else
  //       gets playerLeft, and the crew slot frees up.
  const host3 = await connect({ t: 'join', clientId: HOST, code });
  host3.c.send({ t: 'pickCharacter', characterId: cap.you });
  await host3.c.wait(is('welcome'));
  {
    const { c, chars } = await connect({ t: 'join', clientId: CREW, code });
    assert(chars.characters.length === 1 && chars.characters[0].online, 'engineer listed as in play');
    c.send({ t: 'deleteCharacter', characterId: eng.you });
    const after = await c.wait(is('characters'));
    assert(after.characters.length === 0 && after.crewCount === 1, `engineer gone from the list and the crew (${after.crewCount})`);
    const kicked = await crew2.c.wait((m) => m.t === 'error' && !!m.fatal);
    assert(/deleted/.test((kicked as { message: string }).message), 'playing window told about the delete');
    await crew2.c.waitClosed();
    const left = await host3.c.wait(is('playerLeft'));
    assert(left.id === eng.you, 'captain told the engineer left');
    c.close();
  }

  // -- 10. A forming clone that never clicks Create is dropped when its window closes.
  {
    const { c } = await connect({ t: 'join', clientId: STRANGER, code });
    c.send({ t: 'newCharacter' });
    const w = await c.wait(is('welcome'));
    await host3.c.wait((m) => m.t === 'playerUpdated' && m.player.id === w.you);
    c.close();
    const left = await host3.c.wait(is('playerLeft'));
    assert(left.id === w.you, 'forming clone removed on disconnect');
  }

  // -- 11. A character made by an older client (per-tab id) is adopted by the first browser presenting that id.
  {
    const { c, chars } = await connect({ t: 'join', clientId: LEGACY_BROWSER, code: 'LEGACY', legacyPlayerId: LEGACY_TAB });
    assert(chars.characters.length === 1 && chars.characters[0].character.firstName === 'Old', 'legacy character adopted');
    c.close();
    const again = await connect({ t: 'join', clientId: LEGACY_BROWSER, code: 'LEGACY' });
    assert(again.chars.characters.length === 1, 'adoption persists without the legacy id');
    again.c.close();
    const other = await connect({ t: 'join', clientId: STRANGER, code: 'LEGACY', legacyPlayerId: LEGACY_TAB });
    assert(other.chars.characters.length === 0, 'a second browser cannot adopt the same legacy character');
    other.c.close();
  }

  host3.c.close();
  await sleep(300);
  await stopServer();

  const final = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { ships: { code: string; members: Record<string, { id: string; ownerId: string; character: Character | null }> }[] };
  const ship = final.ships.find((s) => s.code === code)!;
  const ids = Object.keys(ship.members);
  assert(ids.length === 1 && ids[0] === cap.you && ship.members[cap.you].ownerId === HOST, `only the captain remains on disk (${ids.length})`);

  console.log('character-persistence-smoke ok');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
