/**
 * WebSocket smoke: captain sets code at the corridor keypad, walks in, the door closes behind her and the inside
 * keypad opens it with the same code (no set prompt, set refused); crew cannot walk through the closed door, crew
 * wrong x3 lockout, crew correct opens, crew walks through the open door.
 * Run: node tools/cabin-door-smoke.mjs (server on :47322)
 */
import WebSocket from 'ws';

const WS = process.env.WS_URL ?? 'ws://localhost:47322/ws';
const id = (n) => `smoke-${n}-${crypto.randomUUID()}`;

function waitOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function once(ws, pred, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    const onMsg = (raw) => {
      const m = JSON.parse(String(raw));
      if (pred(m)) {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

/** Handshake: host/join answers with the browser's saved characters; a fresh browser asks for a new one. */
async function enterNew(ws) {
  await once(ws, (m) => m.t === 'characters');
  send(ws, { t: 'newCharacter' });
  return once(ws, (m) => m.t === 'welcome');
}

async function connectHost() {
  const ws = new WebSocket(WS);
  await waitOpen(ws);
  send(ws, { t: 'host', clientId: id('host') });
  const w = await enterNew(ws);
  return { ws, pid: w.you, code: w.code };
}

async function join(code, label) {
  const ws = new WebSocket(WS);
  await waitOpen(ws);
  send(ws, { t: 'join', clientId: id(label), code });
  const w = await enterNew(ws);
  return { ws, pid: w.you };
}

async function startAndCreate(ws, pid, job, name, startVoyage = false) {
  if (startVoyage) {
    send(ws, { t: 'startGame' });
    await once(ws, (m) => m.t === 'shipState');
  }
  send(ws, {
    t: 'create',
    character: {
      sex: 'male',
      face: 'neutral',
      hairStyle: 'parted',
      facialHair: 'none',
      hairColor: '#1c1a1f',
      eyeColor: '#2f1d12',
      job,
      firstName: name,
      lastName: 'Smoke',
    },
  });
  const u = await once(ws, (m) => m.t === 'playerUpdated' && m.player.id === pid && m.player.character);
  return u.player;
}

/** shared/cabinDoor.ts cabinKeypadInteractPosition(): corridor side of the door plane, clear of the closed panel. */
const KEYPAD = { x: -46.74, z: 19.0 };

async function standAtKeypad(ws) {
  for (let i = 0; i < 50; i++) {
    send(ws, { t: 'move', x: KEYPAD.x, z: KEYPAD.z, rot: 0, moving: true });
    await new Promise((r) => setTimeout(r, 40));
  }
  send(ws, { t: 'move', x: KEYPAD.x, z: KEYPAD.z, rot: 0, moving: false });
  await new Promise((r) => setTimeout(r, 80));
}

async function keypad(ws, action, fields) {
  await standAtKeypad(ws);
  send(ws, { t: 'cabinKeypad', action, x: KEYPAD.x, z: KEYPAD.z, ...fields });
  return once(ws, (m) => m.t === 'cabinKeypadResult' || m.t === 'error');
}

/**
 * Inside the cabin, within reach of the inside keypad (shared/cabinDoor.ts cabinKeypadInInteractPosition, about
 * (-48.4, 19.5)) but too far from the corridor keypad's stand for its range check, so a pass here proves the server
 * checks the keypad named in the message.
 */
const INSIDE = { x: -49.9, z: 19.4 };

async function keypadInside(ws, action, fields, keypad = 'cabin-keypad-in') {
  await placeAt(ws, INSIDE.x, INSIDE.z);
  send(ws, { t: 'cabinKeypad', action, keypad, x: INSIDE.x, z: INSIDE.z, ...fields });
  return once(ws, (m) => m.t === 'cabinKeypadResult' || m.t === 'error');
}

/** Door plane (shared/cabinDoor.ts cabinDoorCenter): corridor is +x of it, cabin -x. */
const DOOR = { x: -47.2, z: 18.3 };

/** Test shortcut: the interact handler syncs the sender's position before its range check, so a no-op interact places us. */
async function placeAt(ws, x, z) {
  send(ws, { t: 'interact', id: 'smoke-noop', x, z });
  await once(ws, (m) => m.t === 'error');
}

/** Report 15 Hz jog steps straight through the doorway like a client that does not clamp; return the server's x for us. */
async function tryWalkThroughDoor(ws, pid, dir = -1) {
  const from = DOOR.x - dir * 1.2;
  await placeAt(ws, from, DOOR.z);
  for (let i = 1; i <= 14; i++) {
    send(ws, { t: 'move', x: from + dir * i * (3.5 / 15), z: DOOR.z, rot: 0, moving: true });
    await new Promise((r) => setTimeout(r, 67));
  }
  send(ws, { t: 'move', x: DOOR.x + dir * 2.0, z: DOOR.z, rot: 0, moving: false });
  const snap = await once(ws, (m) => m.t === 'snap' && m.p.some((e) => e[0] === pid));
  return snap.p.find((e) => e[0] === pid)[1];
}

/** True if a message of type `t` arrives within `ms`. */
function arrives(ws, pred, ms) {
  return once(ws, pred, ms).then(
    () => true,
    () => false,
  );
}

async function main() {
  const { ws: hostWs, pid: captainId, code } = await connectHost();
  const { ws: crewWs, pid: crewId } = await join(code, 'crew');

  await startAndCreate(hostWs, captainId, 'Captain', 'Cap', true);
  await startAndCreate(crewWs, crewId, 'Engineer', 'Eng');

  const lockedX = await tryWalkThroughDoor(crewWs, crewId);
  if (lockedX < DOOR.x + 0.3) throw new Error(`crew walked through the locked cabin door (server x=${lockedX})`);

  const doorBroadcast = once(hostWs, (m) => m.t === 'cabinDoor', 12_000);
  const setRes = await keypad(hostWs, 'set', { code: '1234', confirm: '1234' });
  if (setRes.t !== 'cabinKeypadResult' || !setRes.ok) throw new Error(`set failed: ${setRes.message ?? 'unknown'}`);
  const doorState = await doorBroadcast;
  if (!doorState.door.codeSet || !doorState.door.open) throw new Error('door broadcast after set should report codeSet and open');

  // -- Set once: the captain walks in, the door closes behind her, and the inside keypad lets her out with the same
  //    code. Using it never asks for a new code, and an explicit set is refused.
  await new Promise((r) => setTimeout(r, 700));
  const inX = await tryWalkThroughDoor(hostWs, captainId, -1);
  if (inX > DOOR.x - 0.3) throw new Error(`captain could not walk into the cabin through the door she opened (server x=${inX})`);
  await once(hostWs, (m) => m.t === 'cabinDoor' && !m.door.open, 6000); // closes a few seconds after she passes
  await new Promise((r) => setTimeout(r, 700));
  const stuckX = await tryWalkThroughDoor(hostWs, captainId, +1);
  if (stuckX > DOOR.x + 0.3) throw new Error(`cabin door did not close behind the captain (server x=${stuckX})`);

  await placeAt(hostWs, INSIDE.x, INSIDE.z);
  send(hostWs, { t: 'interact', id: 'cabin-keypad-in', x: INSIDE.x, z: INSIDE.z });
  if (await arrives(hostWs, (m) => m.t === 'error', 400)) throw new Error('inside keypad interact refused');
  const farRes = await keypadInside(hostWs, 'enter', { code: '1234' }, 'cabin-keypad');
  if (farRes.ok || !/closer/i.test(farRes.message ?? '')) throw new Error(`corridor keypad usable from deep inside the cabin: ${JSON.stringify(farRes)}`);
  const reSet = await keypadInside(hostWs, 'set', { code: '9999', confirm: '9999' });
  if (reSet.ok) throw new Error(`re-set from inside succeeded: ${JSON.stringify(reSet)}`);
  const inside = await keypadInside(hostWs, 'exit', {});
  if (inside.t !== 'cabinKeypadResult' || !inside.ok) throw new Error(`inside keypad did not open the door: ${inside.message}`);
  await new Promise((r) => setTimeout(r, 700));
  const outX = await tryWalkThroughDoor(hostWs, captainId, +1);
  if (outX < DOOR.x + 0.3) throw new Error(`captain could not leave the cabin after the inside keypad opened the door (server x=${outX})`);
  // The door auto-closes again before the crew finishes the lockout below.

  let lockout = false;
  for (let i = 0; i < 3; i++) {
    const bad = await keypad(crewWs, 'enter', { code: '0000' });
    if (bad.t === 'cabinKeypadResult' && bad.ok) throw new Error('bad code accepted');
    if (bad.lockoutUntil) lockout = true;
  }
  if (!lockout) throw new Error('expected lockout after 3 fails');

  await new Promise((r) => setTimeout(r, 10_300));
  const closedAgainX = await tryWalkThroughDoor(crewWs, crewId);
  if (closedAgainX < DOOR.x + 0.3) throw new Error(`crew walked through the auto-closed cabin door (server x=${closedAgainX})`);

  const good = await keypad(crewWs, 'enter', { code: '1234' });
  if (good.t !== 'cabinKeypadResult' || !good.ok) throw new Error(`correct code failed: ${good.message}`);
  await new Promise((r) => setTimeout(r, 700));
  const openX = await tryWalkThroughDoor(crewWs, crewId);
  if (openX > DOOR.x - 0.3) throw new Error(`crew could not walk through the open cabin door (server x=${openX})`);

  console.log('cabin-door-smoke ok');
  hostWs.close();
  crewWs.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
