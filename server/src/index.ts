import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ShipStore, type MemberRecord, type ShipRecord } from './store';
import {
  MAX_CREW,
  jobCheck,
  validateCharacter,
  type Character,
  type ClientMsg,
  type PlayerState,
  type ServerMsg,
  type SnapEntry,
} from '../../shared/protocol';
import { TUBE_COUNT, clampToLab, spawnFor } from '../../shared/lab';

const PORT = Number(process.env.PORT ?? 47322);
const DATA_FILE = process.env.DATA_FILE ?? path.resolve(import.meta.dirname, '../data/ships.json');
const SNAP_MS = 66;

const store = new ShipStore(DATA_FILE);
/** ship code -> player id -> socket */
const online = new Map<string, Map<string, WebSocket>>();
const moving = new Map<string, boolean>();
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
  return {
    id: m.id,
    tube: m.tube,
    character: m.character,
    x: m.x,
    z: m.z,
    rot: m.rot,
    moving: moving.get(key(ship.code, m.id)) ?? false,
    connected: online.get(ship.code)?.has(m.id) ?? false,
  };
}

function sanitizeCharacter(c: Character): Character {
  return {
    sex: c.sex,
    face: c.face,
    hairLength: c.hairLength,
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
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (!ship || !pid) {
      if (msg.t !== 'host' && msg.t !== 'join') return;
      if (!validId(msg.playerId)) return send(ws, { t: 'error', message: 'Invalid player id.' });

      let target: ShipRecord | undefined;
      if (msg.t === 'host') {
        target = store.create(msg.playerId);
        console.log(`[ship ${target.code}] hosted`);
      } else {
        const code = String(msg.code ?? '').toUpperCase().trim();
        target = store.get(code);
        if (!target) return send(ws, { t: 'error', message: `No ship found with invite code “${code}”.` });
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
        member = { id: msg.playerId, tube, character: null, ...spawn, joinedAt: Date.now() };
        target.members[member.id] = member;
        store.save();
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
        players: Object.values(ship.members).map((m) => toState(ship!, m)),
      });
      broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, member) }, pid);
      console.log(`[ship ${ship.code}] ${pid.slice(0, 8)} connected (${peers.size} online)`);
      return;
    }

    const me = ship.members[pid];
    if (!me) return;

    switch (msg.t) {
      case 'create': {
        if (me.character) return send(ws, { t: 'createError', message: 'Your clone has already been decanted.' });
        const err = validateCharacter(msg.character);
        if (err) return send(ws, { t: 'createError', message: err });
        const character = sanitizeCharacter(msg.character);
        const taken = Object.values(ship.members)
          .filter((m) => m.id !== pid && m.character)
          .map((m) => m.character!.job);
        const jobErr = jobCheck(taken, character.job);
        if (jobErr) return send(ws, { t: 'createError', message: jobErr });

        me.character = character;
        Object.assign(me, spawnFor(me.tube));
        store.save();
        broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
        console.log(`[ship ${ship.code}] created ${character.job} ${character.firstName} ${character.lastName}`);
        break;
      }
      case 'move': {
        if (!me.character) return;
        const { x, z, rot } = msg;
        if (![x, z, rot].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
        const p = clampToLab(x, z);
        me.x = p.x;
        me.z = p.z;
        me.rot = rot;
        moving.set(key(ship.code, pid), !!msg.moving);
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
    moving.delete(key(ship.code, pid));
    const me = ship.members[pid];
    if (me) broadcast(ship.code, { t: 'playerUpdated', player: toState(ship, me) });
    console.log(`[ship ${ship.code}] ${pid.slice(0, 8)} disconnected (${peers.size} online)`);
  });
});

setInterval(() => {
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
