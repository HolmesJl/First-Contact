/**
 * WebSocket smoke for items, inventories, closets, stock stations and the scavenger hunt quest.
 *
 * Run: npm run smoke:items
 * Starts its own server on a free port with a temp data file, drives an Engineer through the opening quest, then:
 * Eatery Fruit (take → use → count/message → put back) · Science Lab File (unique by name, open → data pad) ·
 * materials data pad · Cargo Hold armor (take → equip → unequip → closet → put back; never deleted) · quest tasks in
 * order · server restart persistence of inventory, closet, stock, pad files and quest progress.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { memoryStationFor, memoryStationId } from '../shared/bunks';
import { CARRY_SLOTS, CLOSET_SLOTS, MATERIALS_PAD_INTERACT_ID, STARTING_STOCK, closetFor, stockPanelById, worldFileById, type Inventory, type Slots } from '../shared/items';
import { REPORT_IN_INTERACT_ID, positionForInteract } from '../shared/opening';
import { SCAVENGER_FILE_NAME, SCAVENGER_INTRO, isOnBridge, type ScavengerTaskId } from '../shared/scavenger';
import { clampToShip, spaceAt } from '../shared/shipInterior';
import { SHIP_LAYOUT } from '../shared/shipLayout';
import type { Character, ClientMsg, InventoryAction, PlayerState, ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 47800 + Math.floor(Math.random() * 400);
const WS = `ws://localhost:${PORT}/ws`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-items-smoke-'));
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
  const exited = new Promise<void>((resolve) => s.once('exit', () => resolve()));
  s.kill('SIGTERM');
  await exited;
}

// ---------------------------------------------------------------- ws helpers

type Msg<K extends ServerMsg['t']> = Extract<ServerMsg, { t: K }>;

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

  async wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, ms?: number): Promise<T>;
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

  close() {
    this.ws.close();
  }
}

const is =
  <K extends ServerMsg['t']>(t: K) =>
  (m: ServerMsg): m is Msg<K> =>
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
  const u = await c.wait((m): m is Msg<'playerUpdated'> => m.t === 'playerUpdated' && m.player.id === w.you && !!m.player.character);
  return { you: w.you, code: w.code, player: u.player };
}

/** Test shortcut: the interact handler syncs the sender's position before its range check, so a no-op interact places us. */
async function placeAt(me: Me, p: { x: number; z: number }) {
  me.pos = p;
  me.c.send({ t: 'interact', id: 'smoke-noop', x: p.x, z: p.z });
  await me.c.wait((m) => m.t === 'error' && !m.fatal);
}

const FAR = { x: -38.2, z: -38 }; // the pass-through corridor: nowhere near any station

// ---------------------------------------------------------------- scenario

const HOST = `smoke-host-${crypto.randomUUID()}`;
const CREW = `smoke-crew-${crypto.randomUUID()}`;

interface Me {
  c: Client;
  id: string;
  /** Where the server last put us (placeAt); inventory actions are sent from here. */
  pos: { x: number; z: number };
  state: PlayerState;
  closet: Slots;
  stock: Record<string, number>;
}

/** Send an inventory action from where we stand and collect the result plus the echoed state. */
async function act(me: Me, action: InventoryAction, at?: { x: number; z: number }) {
  const pos = at ?? me.pos;
  me.c.send({ t: 'inv', action, x: pos.x, z: pos.z });
  const res = await me.c.wait(is('invResult'));
  if (res.ok) await syncAfterOk(me);
  return res;
}

async function syncAfterOk(me: Me) {
  const u = await me.c.wait((m): m is Msg<'playerUpdated'> => m.t === 'playerUpdated' && m.player.id === me.id);
  me.state = u.player;
  // Optional follow-ups arrive right behind the update; give them a moment and drain (the newest state wins).
  await sleep(60);
  for (let i = me.c.inbox.length - 1; i >= 0; i--) {
    const m = me.c.inbox[i];
    if (m.t === 'playerUpdated' && m.player.id === me.id) {
      if (i === me.c.inbox.findLastIndex((x) => x.t === 'playerUpdated' && x.player.id === me.id)) me.state = m.player;
      me.c.inbox.splice(i, 1);
    } else if (m.t === 'closet') {
      me.closet = m.slots;
      me.c.inbox.splice(i, 1);
    } else if (m.t === 'shipState') {
      me.stock = m.ship.stock;
      me.c.inbox.splice(i, 1);
    }
  }
}

const carried = (inv: Inventory) => inv.carry.filter(Boolean);
const taskDone = (p: PlayerState, id: ScavengerTaskId) => p.scavenger?.done[id] !== undefined;

/** A point in the Bridge doorway just inside the door line: `spaceAt` is null there (door thresholds are no space). */
function bridgeDoorwayPoint() {
  const d = SHIP_LAYOUT.doors.find((x) => x.id === 'bridge-in')!;
  // The Bridge lies on the +z side of this door (its corridor runs in from the fore node).
  return { x: d.x, z: d.z + 0.3 };
}

async function takeNotice(me: Me, re: RegExp, what: string) {
  const n = await me.c.wait((m) => m.t === 'notice' && re.test(m.message), 2000).catch(() => null);
  assert(n, `${what}: expected a notice matching ${re}`);
}

async function main() {
  await startServer();

  // -- 0. A Captain hosts and starts the voyage; an Engineer joins and runs the opening quest to `done`.
  const { c: host } = await connect({ t: 'host', clientId: HOST });
  const cap = await createNew(host, 'Captain', 'Cap', true);
  const { c: crew } = await connect({ t: 'join', clientId: CREW, code: cap.code });
  const eng = await createNew(crew, 'Engineer', 'Eng');
  const me: Me = { c: crew, id: eng.you, pos: { x: eng.player.x, z: eng.player.z }, state: eng.player, closet: [], stock: {} };
  me.closet = (await crew.wait(is('closet'))).slots;

  assert(me.state.inventory.equipped.suit?.item === 'jumpsuit', 'everyone starts wearing the jumpsuit');
  assert(me.state.inventory.carry.length === CARRY_SLOTS && carried(me.state.inventory).length === 0, 'six empty carry slots at start');
  assert(me.closet.length === CLOSET_SLOTS && me.closet.every((s) => s === null), 'twenty empty closet slots at start');
  assert(me.state.padFiles.length === 0 && me.state.scavenger === null, 'no pad files and no quest 2 at start');

  const step = async (id: string, want: string) => {
    const p = positionForInteract(id)!;
    crew.send({ t: 'interact', id, x: p.x, z: p.z });
    const u = await crew.wait((m): m is Msg<'playerUpdated'> | Msg<'error'> => m.t === 'error' || (m.t === 'playerUpdated' && m.player.id === eng.you && m.player.questStep === want));
    assert(u.t === 'playerUpdated', `opening step ${id}: ${u.t === 'error' ? u.message : ''}`);
    me.state = u.player;
  };
  // Joining after the voyage started makes the Engineer a clone: Medical check-in comes first.
  if (me.state.questStep === 'clone-doctor') await step('lab-bench', 'pick-pad');
  await step('bunk-desk-pad', 'upload-memories');
  {
    const s = memoryStationFor(2)!;
    crew.send({ t: 'interact', id: memoryStationId(2), x: s.stand.x, z: s.stand.z });
    await crew.wait(is('memoryUpload'));
    const u = await crew.wait((m): m is Msg<'playerUpdated'> => m.t === 'playerUpdated' && m.player.id === eng.you && m.player.berth === 2);
    me.state = u.player;
  }
  await step('teleporter-pad', 'report');
  await step(REPORT_IN_INTERACT_ID, 'done');
  assert(me.state.questStep === 'done' && me.state.hasPad && me.state.berth === 2, 'engineer finished the opening with a pad and Bunk 2');
  crew.inbox.length = 0;

  // -- 1. The scavenger hunt is handed out by the pad on the Bridge only.
  const comms = positionForInteract(REPORT_IN_INTERACT_ID)!;
  await placeAt(me, FAR);
  crew.send({ t: 'scavengerIssue', x: FAR.x, z: FAR.z });
  const offBridge = await crew.wait(is('error'));
  assert(/Bridge/.test(offBridge.message), `quest refused off the Bridge (${offBridge.message})`);
  // The Bridge check tolerates its door thresholds (spaceAt is null there) and the first step outside.
  {
    const door = bridgeDoorwayPoint();
    const c = clampToShip(door.x, door.z, 0);
    assert(Math.hypot(c.x - door.x, c.z - door.z) < 1e-6 && spaceAt(door.x, door.z) === null, 'the Bridge doorway is walkable and belongs to no space');
    assert(isOnBridge(door.x, door.z), 'standing in the Bridge doorway counts as on the Bridge');
    assert(!isOnBridge(door.x, door.z - 1.2), 'the corridor side of the door does not');
    assert(!isOnBridge(FAR.x, FAR.z), 'the pass-through corridor is not the Bridge');
  }
  // The request carries the player's position, like `interact`: the server's last `move` position (still FAR here)
  // must not refuse a player whose client is standing at the comms console.
  crew.send({ t: 'scavengerIssue', x: comms.x, z: comms.z });
  {
    const u = await crew.wait((m): m is Msg<'playerUpdated'> => m.t === 'playerUpdated' && m.player.id === eng.you && !!m.player.scavenger);
    me.state = u.player;
    me.pos = comms;
    await takeNotice(me, new RegExp(SCAVENGER_INTRO.slice(0, 20)), 'quest issue');
    crew.send({ t: 'scavengerIssue', x: comms.x, z: comms.z });
    const again = await crew.wait(is('error'));
    assert(/already/.test(again.message), 'quest is issued once');
  }

  // -- 2. Task 1: Fruit from the Eatery panel: range, count, use message, deletion at 0, put back.
  const eatery = stockPanelById('eatery-panel')!;
  {
    const far = await act(me, { k: 'take', station: 'eatery-panel', item: 'fruit' }, FAR);
    assert(!far.ok && /closer/i.test(far.message ?? ''), 'taking Fruit from across the ship is refused');
    await placeAt(me, eatery.stand);
    const r1 = await act(me, { k: 'take', station: 'eatery-panel', item: 'fruit' });
    assert(r1.ok && r1.gained?.item === 'fruit', 'took one Fruit (gained reported so the client opens the inventory)');
    assert(/Took 1 Fruit \(24 left\)/.test(r1.message ?? ''), `take message (${r1.message})`);
    assert(me.stock.fruit === STARTING_STOCK.fruit - 1, `eatery stock dropped to ${STARTING_STOCK.fruit - 1} (${me.stock.fruit})`);
    const r2 = await act(me, { k: 'take', station: 'eatery-panel', item: 'fruit' });
    assert(r2.ok, 'second Fruit');
    const slot = me.state.inventory.carry.findIndex((s) => s?.item === 'fruit');
    assert(slot >= 0 && me.state.inventory.carry[slot]!.qty === 2 && carried(me.state.inventory).length === 1, 'Fruit stacks in one slot');
    const empty = await act(me, { k: 'take', station: 'eatery-panel', item: 'vegetables' });
    assert(!empty.ok && /out of stock/i.test(empty.message ?? ''), 'Vegetables (0 in stock) cannot be taken');
    assert(!taskDone(me.state, 'eat-fruit'), 'task 1 is not complete before eating');

    const use = await act(me, { k: 'use', loc: { c: 'carry', i: slot } });
    assert(use.ok && use.message === 'The apple tastes good', `use message (${use.message})`);
    assert(me.state.inventory.carry[slot]?.qty === 1, `stack decremented (${JSON.stringify(me.state.inventory.carry)} inbox ${me.c.inbox.map((m) => m.t).join(",")})`);
    assert(taskDone(me.state, 'eat-fruit'), 'task 1 complete after eating an apple');
    await takeNotice(me, /Task 1 complete/, 'task 1');
    const use2 = await act(me, { k: 'use', loc: { c: 'carry', i: slot } });
    assert(use2.ok && me.state.inventory.carry[slot] === null, 'stack deleted at 0');

    const r3 = await act(me, { k: 'take', station: 'eatery-panel', item: 'fruit' });
    assert(r3.ok, 'third Fruit');
    const s3 = me.state.inventory.carry.findIndex((s) => s?.item === 'fruit');
    const farPut = await act(me, { k: 'putBack', loc: { c: 'carry', i: s3 } }, FAR);
    assert(!farPut.ok && /Eatery control panel/.test(farPut.message ?? ''), `put back away from the Eatery is refused (${farPut.message})`);
    await placeAt(me, eatery.stand);
    const put = await act(me, { k: 'putBack', loc: { c: 'carry', i: s3 } });
    assert(put.ok && me.stock.fruit === STARTING_STOCK.fruit - 2 && carried(me.state.inventory).length === 0, `Fruit back in stock (${me.stock.fruit})`);
  }

  // -- 3. Task 2: the Science Lab Read Me: pick up, unique by name, open → text + data pad.
  const readMe = worldFileById('file-module-replicator')!;
  assert(readMe.name === SCAVENGER_FILE_NAME, 'the Science Lab File is the quest Read Me');
  {
    crew.send({ t: 'interact', id: readMe.interactId, x: FAR.x, z: FAR.z });
    const far = await crew.wait(is('invResult'));
    assert(!far.ok, 'picking up a File from afar is refused');
    crew.send({ t: 'interact', id: readMe.interactId, x: readMe.stand.x, z: readMe.stand.z });
    const got = await crew.wait(is('invResult'));
    assert(got.ok && got.gained?.item === 'file' && got.gained.name === readMe.name, 'picked up the File (gained reported)');
    await syncAfterOk(me);
    crew.send({ t: 'interact', id: readMe.interactId, x: readMe.stand.x, z: readMe.stand.z });
    const dup = await crew.wait(is('invResult'));
    assert(!dup.ok && /already carry the File/.test(dup.message ?? ''), `second copy refused (${dup.message})`);
    const other = worldFileById('file-transit-log')!;
    crew.send({ t: 'interact', id: other.interactId, x: other.stand.x, z: other.stand.z });
    const got2 = await crew.wait(is('invResult'));
    assert(got2.ok, 'a File of another name is fine');
    await syncAfterOk(me);
    assert(!taskDone(me.state, 'read-me'), 'task 2 waits for the File to be opened');

    const slot = me.state.inventory.carry.findIndex((s) => s?.item === 'file' && s.name === readMe.name);
    const open = await act(me, { k: 'open', loc: { c: 'carry', i: slot } }, FAR);
    assert(open.ok && open.file?.name === readMe.name && open.file.text === readMe.text, 'opening returns the Read Me text (anywhere)');
    assert(me.state.inventory.carry[slot]?.name === readMe.name, 'the File stays in the inventory');
    assert(me.state.padFiles.length === 1 && me.state.padFiles[0].name === readMe.name && me.state.padFiles[0].text === readMe.text, 'Read Me saved to the data pad');
    assert(Math.abs(me.state.padFiles[0].at - Date.now()) < 5000, 'pad entry carries a fresh timestamp');
    assert(taskDone(me.state, 'read-me'), 'task 2 complete on open');
    await takeNotice(me, /Task 2 complete/, 'task 2');
    const otherSlot = me.state.inventory.carry.findIndex((s) => s?.item === 'file' && s.name === other.name);
    await act(me, { k: 'open', loc: { c: 'carry', i: otherSlot } });
    assert(me.state.padFiles.length === 2 && me.state.padFiles[0].name === other.name, 'pad lists files newest first');
    await act(me, { k: 'open', loc: { c: 'carry', i: slot } });
    assert(me.state.padFiles.length === 2 && me.state.padFiles[0].name === readMe.name, 're-opening refreshes the entry instead of duplicating it');
    const del = await act(me, { k: 'delete', loc: { c: 'carry', i: otherSlot } });
    assert(del.ok && me.state.inventory.carry[otherSlot] === null, 'Files can be deleted');
  }

  // -- 4. Tasks run in order: equipping armor before the materials check does not complete task 4.
  const shelves = stockPanelById('hold-shelves')!;
  await placeAt(me, shelves.stand);
  {
    const r = await act(me, { k: 'take', station: 'hold-shelves', item: 'lite-body-armor' });
    assert(r.ok && r.gained?.item === 'lite-body-armor' && me.stock['lite-body-armor'] === 5, 'took armor from the shelves (5 left)');
    const slot = me.state.inventory.carry.findIndex((s) => s?.item === 'lite-body-armor');
    const eq = await act(me, { k: 'use', loc: { c: 'carry', i: slot } });
    assert(eq.ok && me.state.inventory.equipped.armor?.item === 'lite-body-armor' && me.state.inventory.carry[slot] === null, 'armor equipped, slot freed');
    assert(!taskDone(me.state, 'first-gear') && !taskDone(me.state, 'check-materials'), 'task 4 does not complete while task 3 is pending');
  }

  // -- 5. Task 3: the materials data pad on the Cargo Hold wall (range-checked click).
  {
    const pad = stockPanelById(MATERIALS_PAD_INTERACT_ID)!;
    crew.send({ t: 'interact', id: pad.interactId, x: FAR.x, z: FAR.z });
    const far = await crew.wait(is('invResult'));
    assert(!far.ok, 'materials pad from afar is refused');
    crew.send({ t: 'interact', id: pad.interactId, x: pad.stand.x, z: pad.stand.z });
    const ok = await crew.wait(is('invResult'));
    assert(ok.ok, 'materials pad click accepted');
    await syncAfterOk(me);
    assert(taskDone(me.state, 'check-materials'), 'task 3 complete');
    await takeNotice(me, /Task 3 complete/, 'task 3');
    assert(me.stock.paneling === 15 && me.stock.lithium === 20, 'Ship Materials 15 each, Raw Materials 20 each');
  }

  // -- 6. Task 4: equip (again) completes the quest. Armor rules: several sets allowed, never deleted, put back only
  //       at the shelves; the jumpsuit never comes off.
  await placeAt(me, shelves.stand);
  {
    const off = await act(me, { k: 'unequip', slot: 'armor' });
    assert(off.ok && !me.state.inventory.equipped.armor && carried(me.state.inventory).some((s) => s!.item === 'lite-body-armor'), 'armor taken off into a carry slot');
    const slot = me.state.inventory.carry.findIndex((s) => s?.item === 'lite-body-armor');
    const eq = await act(me, { k: 'use', loc: { c: 'carry', i: slot } });
    assert(eq.ok && taskDone(me.state, 'first-gear'), 'task 4 complete on equip');
    assert(me.state.scavenger?.completedAt, 'quest complete once all four tasks are done');
    await takeNotice(me, /Scavenger hunt complete/, 'quest done');

    const second = await act(me, { k: 'take', station: 'hold-shelves', item: 'lite-body-armor' });
    assert(second.ok && me.stock['lite-body-armor'] === 4, 'a second set may be collected while one is worn');
    const spare = me.state.inventory.carry.findIndex((s) => s?.item === 'lite-body-armor');
    const del = await act(me, { k: 'delete', loc: { c: 'carry', i: spare } });
    assert(!del.ok && /cannot be deleted/.test(del.message ?? ''), `armor cannot be deleted (${del.message})`);
    const suit = await act(me, { k: 'unequip', slot: 'suit' });
    assert(!suit.ok && /jumpsuit/.test(suit.message ?? ''), 'the jumpsuit cannot be taken off');
    const swap = await act(me, { k: 'use', loc: { c: 'carry', i: spare } });
    assert(swap.ok && /Swapped/.test(swap.message ?? '') && me.state.inventory.carry[spare]?.item === 'lite-body-armor', 'equipping a spare swaps the worn set into its slot');
    const farPut = await act(me, { k: 'putBack', loc: { c: 'carry', i: spare } }, FAR);
    assert(!farPut.ok && /shelves/i.test(farPut.message ?? ''), 'put back only at the shelves');
  }

  // -- 7. Closet: locked to the claimed berth's closet and its stand point; both directions; unequip straight in.
  const closet = closetFor(2)!;
  {
    const spare = me.state.inventory.carry.findIndex((s) => s?.item === 'lite-body-armor');
    const away = await act(me, { k: 'move', from: { c: 'carry', i: spare }, to: { c: 'closet', i: 0 } }, FAR);
    assert(!away.ok && /closet/i.test(away.message ?? ''), `closet refused away from it (${away.message})`);
    await placeAt(me, closet.stand);
    const mv = await act(me, { k: 'move', from: { c: 'carry', i: spare }, to: { c: 'closet', i: 0 } });
    assert(mv.ok && me.closet[0]?.item === 'lite-body-armor' && me.state.inventory.carry[spare] === null, 'spare armor stowed in the closet');
    const off = await act(me, { k: 'unequip', slot: 'armor', to: { c: 'closet', i: 5 } });
    assert(off.ok && me.closet[5]?.item === 'lite-body-armor' && !me.state.inventory.equipped.armor, 'worn armor unequipped straight into the closet');
    const back = await act(me, { k: 'move', from: { c: 'closet', i: 5 }, to: { c: 'carry', i: 1 } });
    assert(back.ok && me.state.inventory.carry[1]?.item === 'lite-body-armor' && me.closet[5] === null, 'armor back from the closet');
    const wear = await act(me, { k: 'use', loc: { c: 'carry', i: 1 } });
    assert(wear.ok && me.state.inventory.equipped.armor, 'wearing it again');
    await placeAt(me, shelves.stand);
    const take3 = await act(me, { k: 'take', station: 'hold-shelves', item: 'lite-body-armor' });
    assert(take3.ok, 'a third set for the put-back check');
    const s3 = me.state.inventory.carry.findIndex((s) => s?.item === 'lite-body-armor');
    const put = await act(me, { k: 'putBack', loc: { c: 'carry', i: s3 } });
    assert(put.ok && me.stock['lite-body-armor'] === 4, `armor back on the shelves (${me.stock['lite-body-armor']})`);
  }

  // The on-disk split the death rules will rely on: on-person and closet are separate keys on the member record.
  await sleep(300);
  {
    const disk = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { ships: { code: string; stock: Record<string, number>; members: Record<string, Record<string, unknown>> }[] };
    const ship = disk.ships.find((s) => s.code === cap.code)!;
    const m = ship.members[eng.you];
    assert(m && 'inventory' in m && 'closet' in m && 'padFiles' in m && 'scavenger' in m, 'member record holds inventory, closet, padFiles and scavenger');
    assert(ship.stock['lite-body-armor'] === 4 && ship.stock.fruit === STARTING_STOCK.fruit - 2, 'ship stock persisted');
  }

  // -- 8. Server restart: everything comes back.
  const before = { inv: me.state.inventory, closet: me.closet, pad: me.state.padFiles, quest: me.state.scavenger, stock: me.stock };
  crew.close();
  host.close();
  await sleep(200);
  await stopServer();
  await startServer();
  {
    const { c, chars } = await connect({ t: 'join', clientId: CREW, code: cap.code });
    assert(chars.ship.stock['lite-body-armor'] === 4, 'stock restored after restart');
    c.send({ t: 'pickCharacter', characterId: eng.you });
    const w = await c.wait(is('welcome'));
    const p = w.players.find((x) => x.id === eng.you)!;
    assert(JSON.stringify(p.inventory) === JSON.stringify(before.inv), 'on-person inventory restored');
    assert(p.inventory.equipped.armor?.item === 'lite-body-armor', 'still wearing armor');
    assert(JSON.stringify(p.padFiles) === JSON.stringify(before.pad), 'data pad files restored');
    assert(JSON.stringify(p.scavenger) === JSON.stringify(before.quest), 'quest progress restored');
    const cl = await c.wait(is('closet'));
    assert(JSON.stringify(cl.slots) === JSON.stringify(before.closet) && cl.slots[0]?.item === 'lite-body-armor', 'closet restored');
    c.close();
  }
  await sleep(200);
  await stopServer();

  // -- 9. A character saved before items existed (no inventory / closet / padFiles / scavenger keys) whose opening is
  //       done: the Captain's record is rewritten that way on disk, and the hunt still issues on the Bridge.
  {
    const disk = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as { ships: { code: string; members: Record<string, Record<string, unknown>> }[] };
    const m = disk.ships.find((s) => s.code === cap.code)!.members[cap.you];
    assert(m && m.character && (m.character as { job: string }).job === 'Captain', 'captain record on disk');
    for (const k of ['inventory', 'closet', 'padFiles', 'scavenger']) delete m[k];
    m.questStep = 'done';
    m.hasPad = true;
    fs.writeFileSync(DATA_FILE, JSON.stringify(disk));
  }
  await startServer();
  {
    const { c } = await connect({ t: 'join', clientId: HOST, code: cap.code });
    c.send({ t: 'pickCharacter', characterId: cap.you });
    const w = await c.wait(is('welcome'));
    const p = w.players.find((x) => x.id === cap.you)!;
    assert(p.questStep === 'done' && p.hasPad && p.scavenger === null && p.padFiles.length === 0, 'legacy record normalised: done, pad, no quest 2 yet');
    assert(p.inventory.equipped.suit?.item === 'jumpsuit' && p.inventory.carry.length === CARRY_SLOTS, 'legacy record gets a starting inventory');
    c.send({ t: 'scavengerIssue', x: comms.x, z: comms.z });
    const u = await c.wait((m): m is Msg<'playerUpdated'> | Msg<'error'> => m.t === 'error' || (m.t === 'playerUpdated' && m.player.id === cap.you && !!m.player.scavenger));
    assert(u.t === 'playerUpdated', `legacy Captain receives the hunt on the Bridge (${u.t === 'error' ? u.message : ''})`);
    c.close();
  }
  await sleep(200);
  await stopServer();
  console.log('items-smoke ok');
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
