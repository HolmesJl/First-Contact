import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ShipStore, type MemberRecord, type ShipRecord } from './store';
import {
  applyInteract,
  applyReportIn,
  assignCloneTank,
  normalizeMember,
  normalizeShip,
  maybeCompleteCaptain,
  onCharacterCreated,
  shipMeta,
  spawnAfterCreate,
  startGame,
} from './opening';
import {
  MAX_CREW,
  jobCheck,
  parseClientMsg,
  validateCharacter,
  type Character,
  type PlayerState,
  type ServerMsg,
  type SnapEntry,
} from '../../shared/protocol';
import { TUBE_COUNT, spawnFor } from '../../shared/lab';
import { CABIN_KEYPAD_INTERACT_ID } from '../../shared/cabinDoor';
import { clampMoveToShip } from '../../shared/shipInterior';
import {
  applyCabinKeypadChange,
  applyCabinKeypadEnter,
  applyCabinKeypadInteract,
  applyCabinKeypadSet,
  cabinDoorObstaclesForShip,
  cabinDoorPublic,
  tickCabinDoors,
  trackCabinDoorPass,
} from './cabinDoor';
import { MoveBudget } from '../../shared/movement';

const PORT = Number(process.env.PORT ?? 47322);
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(import.meta.dirname, '../data/ships.json');
const SNAP_MS = 66;

const store = new ShipStore(DATA_FILE);
/** ship code -> player id -> socket */
const online = new Map<string, Map<string, WebSocket>>();
const moving = new Map<string, boolean>();
/** Last move message time (ms) per player; used to clear stuck `moving` when input stops. */
const lastMoveMs = new Map<string, number>();
const MOVE_STALE_MS = 280;
/** Per-player movement cap (jog speed plus the stamina-limited sprint burst). */
const budgets = new Map<string, MoveBudget>();
const dirtyShips = new Set<string>();

const key = (code: string, id: string) => `${code}:${id}`;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(code: string, msg: ServerMsg, exceptId?: string) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of online.get(code) ?? []) {
    if (id !== exceptId && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function toState(ship: ShipRecord, m: MemberRecord): PlayerState {
  normalizeMember(m);
  return {
    id: m.id,
    tube: m.tube,
    character: m.character,
    x: m.x,
    z: m.z,
    rot: m.rot,
    moving: moving.get(key(ship.code, m.id)) ?? false,
    connected: online.get(ship.code)?.has(m.id) ?? false,
    isClone: m.isClone ?? false,
    hasPad: m.hasPad ?? false,
    reportedIn: m.reportedIn ?? false,
    questStep: m.questStep ?? 'wake',
    cloneTank: m.cloneTank ?? null,
  };
}

function sanitizeCharacter(c: Character): Character {
  return {
    sex: c.sex,
    face: c.face,
    hairStyle: c.hairStyle,
    facialHair: c.sex === 'female' ? 'none' : c.facialHair,
    hairColor: c.hairColor,
    eyeColor: c.eyeColor,
    job: c.job,
    firstName: c.firstName.trim().replace(/\s+/g, ' '),
    lastName: c.lastName.trim().replace(/\s+/g, ' '),
  };
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ships: store.count }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  let ship: ShipRecord | null = null;
  let pid: string | null = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = parseClientMsg(JSON.parse(String(raw)));
    } catch {
      return;
    }
    if (!msg) return;

    if (!ship || !pid) {
      if (msg.t !== 'host' && msg.t !== 'join') return;
      if (!validId(msg.playerId)) return send(ws, { t: 'error', message: 'Invalid player id.' });

      let target: ShipRecord | undefined;
      if (msg.t === 'host') {
        target = normalizeShip(store.create(msg.playerId));
        console.log(`[ship ${target.code}] hosted`);
      } else {
        const code = String(msg.code ?? '').toUpperCase().trim();
        target = store.get(code);
        if (!target) return send(ws, { t: 'error', message: `No ship found with invite code “${code}”.` });
        normalizeShip(target);
      }

      let member = target.members[msg.playerId];
      if (!member) {
        if (Object.keys(target.members).length >= MAX_CREW) {
          return send(ws, { t: 'error', message: `That crew is full (${MAX_CREW}/${MAX_CREW}).` });
        }
        const used = new Set(Object.values(target.members).map((m) => m.tube));
        let tube = 0;
        while (used.has(tube) && tube < TUBE_COUNT) tube++;
        const spawn = spawnFor(tube);
        member = normalizeMember({
          id: msg.playerId,
          tube,
          character: null,
          ...spawn,
          joinedAt: Date.now(),
          isClone: !!target.gameStarted,
        });
        if (member.isClone) assignCloneTank(target, member);
        target.members[member.id] = member;
        store.save();
      } else {
        normalizeMember(member);
        if (target.gameStarted && !member.character && !member.isClone) {
          member.isClone = true;
          assignCloneTank(target, member);
          store.save();
        }
      }

      ship = target;
      pid = msg.playerId;
      let peers = online.get(ship.code);
      if (!peers) online.set(ship.code, (peers = new Map()));
      const prev = peers.get(pid);
      peers.set(pid, ws);
      if (prev && prev !== ws) {
        send(prev, { t: 'error', message: 'You opened this ship in another window.', fatal: true });
        prev.close();
      }

      send(ws, {
        t: 'welcome',
        code: ship.code,
        you: pid,
        hostId: ship.hostId,
        ship: shipMeta(ship),
        players: Object.values(ship.members).map((m) => toState(ship!, m)),
      });
      broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, member) }, pid);
      console.log(`[ship ${ship.code}] ${pid.slice(0, 8)} connected (${peers.size} online)`);
      return;
    }

    const me = ship.members[pid];
    if (!me) return;

    switch (msg.t) {
      case 'startGame': {
        if (me.character) return;
        if (startGame(ship)) {
          store.save();
          broadcast(ship.code, { t: 'shipState', ship: shipMeta(ship) });
          console.log(`[ship ${ship.code}] voyage started`);
        }
        break;
      }
      case 'create': {
        if (me.character) return send(ws, { t: 'createError', message: 'Your clone has already been decanted.' });
        if (!ship.gameStarted) return send(ws, { t: 'createError', message: 'Wait for the crew to start the voyage.' });
        const err = validateCharacter(msg.character);
        if (err) return send(ws, { t: 'createError', message: err });
        const character = sanitizeCharacter(msg.character);
        const taken = Object.values(ship.members)
          .filter((m) => m.id !== pid && m.character)
          .map((m) => m.character!.job);
        const jobErr = jobCheck(taken, character.job);
        if (jobErr) return send(ws, { t: 'createError', message: jobErr });

        me.character = character;
        onCharacterCreated(me, character);
        Object.assign(me, spawnAfterCreate(me));
        budgets.delete(key(ship.code, pid));
        store.save();
        broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
        console.log(`[ship ${ship.code}] created ${character.job} ${character.firstName} ${character.lastName}`);
        break;
      }
      case 'interact': {
        const obs = cabinDoorObstaclesForShip(ship);
        const p = clampMoveToShip(me.x, me.z, msg.x, msg.z, 0, obs);
        me.x = p.x;
        me.z = p.z;
        if (msg.id === CABIN_KEYPAD_INTERACT_ID) {
          const k = applyCabinKeypadInteract(ship, me);
          if (!k.ok) return send(ws, { t: 'error', message: k.message });
          return;
        }
        const res = applyInteract(ship, me, msg.id);
        if (!res.ok) return send(ws, { t: 'error', message: res.message });
        store.save();
        broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
        if (res.notice) broadcast(ship.code, { t: 'notice', message: res.notice });
        if (res.nextHint) broadcast(ship.code, { t: 'notice', message: res.nextHint });
        break;
      }
      case 'cabinKeypad': {
        const obs = cabinDoorObstaclesForShip(ship);
        const p = clampMoveToShip(me.x, me.z, msg.x, msg.z, 0, obs);
        me.x = p.x;
        me.z = p.z;
        const now = Date.now();
        let res;
        if (msg.action === 'set') res = applyCabinKeypadSet(ship, me, msg.code, msg.confirm, now);
        else if (msg.action === 'enter') res = applyCabinKeypadEnter(ship, me, msg.code, now);
        else res = applyCabinKeypadChange(ship, me, msg.current, msg.code, msg.confirm, now);
        if (!res.ok) {
          send(ws, {
            t: 'cabinKeypadResult',
            ok: false,
            message: res.message,
            flash: res.flash,
            dismissMs: res.dismissMs,
            lockoutUntil: res.lockoutUntil,
          });
          return;
        }
        store.save();
        broadcast(ship.code, { t: 'cabinDoor', door: cabinDoorPublic(ship, now) });
        broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
        if (res.notice) broadcast(ship.code, { t: 'notice', message: res.notice });
        if (res.nextHint) broadcast(ship.code, { t: 'notice', message: res.nextHint });
        send(ws, {
          t: 'cabinKeypadResult',
          ok: true,
          message: res.notice,
          flash: res.flash,
          dismissMs: res.dismissMs,
        });
        break;
      }
      case 'reportIn': {
        const res = applyReportIn(ship, me);
        if (!res.ok) return send(ws, { t: 'error', message: res.message });
        store.save();
        broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
        if (res.notice) broadcast(ship.code, { t: 'notice', message: res.notice });
        if (res.nextHint) broadcast(ship.code, { t: 'notice', message: res.nextHint });
        const captainDone = maybeCompleteCaptain(ship);
        if (captainDone) {
          store.save();
          broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, captainDone) });
          broadcast(ship.code, { t: 'notice', message: 'All crew have reported in. The Captain may resume the journey.' });
        }
        break;
      }
      case 'move': {
        if (!me.character) return;
        const { x, z, rot } = msg;
        const k = key(ship.code, pid);
        let budget = budgets.get(k);
        if (!budget) budgets.set(k, (budget = new MoveBudget(performance.now() / 1000)));
        const prevX = me.x;
        const prevZ = me.z;
        const dx = x - me.x;
        const dz = z - me.z;
        const frac = budget.take(Math.hypot(dx, dz), performance.now() / 1000);
        const obs = cabinDoorObstaclesForShip(ship);
        // Swept from the last accepted position: a point clamp would eject a step past the panel's mid-plane on the
        // cabin side, letting a client that does not clamp (or a hacked one) walk through the closed door.
        const p = clampMoveToShip(me.x, me.z, me.x + dx * frac, me.z + dz * frac, 0, obs);
        me.x = p.x;
        me.z = p.z;
        trackCabinDoorPass(ship, me, prevX, prevZ);
        me.rot = rot;
        moving.set(k, !!msg.moving);
        lastMoveMs.set(k, Date.now());
        dirtyShips.add(ship.code);
        store.save(2000);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ship || !pid) return;
    const peers = online.get(ship.code);
    if (peers?.get(pid) !== ws) return;
    peers.delete(pid);
    const mk = key(ship.code, pid);
    moving.delete(mk);
    lastMoveMs.delete(mk);
    budgets.delete(mk);
    const me = ship.members[pid];
    if (me) broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
    console.log(`[ship ${ship.code}] ${pid.slice(0, 8)} disconnected (${peers.size} online)`);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const code of online.keys()) {
    const ship = store.get(code);
    if (!ship) continue;
    if (tickCabinDoors(ship, now)) {
      store.save();
      broadcast(code, { t: 'cabinDoor', door: cabinDoorPublic(ship, now) });
    }
  }
  for (const [mk, t] of lastMoveMs) {
    if (!moving.get(mk) || now - t <= MOVE_STALE_MS) continue;
    moving.set(mk, false);
    dirtyShips.add(mk.slice(0, mk.indexOf(':')));
  }
  for (const code of dirtyShips) {
    const ship = store.get(code);
    const peers = online.get(code);
    if (!ship || !peers) continue;
    const p: SnapEntry[] = [];
    for (const id of peers.keys()) {
      const m = ship.members[id];
      if (!m?.character) continue;
      p.push([m.id, +m.x.toFixed(3), +m.z.toFixed(3), +m.rot.toFixed(3), moving.get(key(code, id)) ? 1 : 0]);
    }
    broadcast(code, { t: 'snap', p });
  }
  dirtyShips.clear();
}, SNAP_MS);

const shutdown = () => {
  store.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

httpServer.listen(PORT, () => console.log(`[first-contact] ship server listening on :${PORT} (ws path /ws)`));
