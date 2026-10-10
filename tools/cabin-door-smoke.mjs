/**
 * WebSocket smoke: captain sets code, crew wrong x3 lockout, crew correct opens.
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

async function connectHost() {
  const ws = new WebSocket(WS);
  await waitOpen(ws);
  const pid = id('host');
  send(ws, { t: 'host', playerId: pid });
  const w = await once(ws, (m) => m.t === 'welcome');
  return { ws, pid, code: w.code };
}

async function join(code, label) {
  const ws = new WebSocket(WS);
  await waitOpen(ws);
  const pid = id(label);
  send(ws, { t: 'join', playerId: pid, code });
  await once(ws, (m) => m.t === 'welcome');
  return { ws, pid };
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

const KEYPAD = { x: -47.34, z: 19.0 };

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

async function main() {
  const { ws: hostWs, pid: captainId, code } = await connectHost();
  const { ws: crewWs, pid: crewId } = await join(code, 'crew');

  await startAndCreate(hostWs, captainId, 'Captain', 'Cap', true);
  await startAndCreate(crewWs, crewId, 'Engineer', 'Eng');

  const setRes = await keypad(hostWs, 'set', { code: '1234', confirm: '1234' });
  if (setRes.t !== 'cabinKeypadResult' || !setRes.ok) throw new Error(`set failed: ${setRes.message ?? 'unknown'}`);

  let lockout = false;
  for (let i = 0; i < 3; i++) {
    const bad = await keypad(crewWs, 'enter', { code: '0000' });
    if (bad.t === 'cabinKeypadResult' && bad.ok) throw new Error('bad code accepted');
    if (bad.lockoutUntil) lockout = true;
  }
  if (!lockout) throw new Error('expected lockout after 3 fails');

  await new Promise((r) => setTimeout(r, 10_300));
  const good = await keypad(crewWs, 'enter', { code: '1234' });
  if (good.t !== 'cabinKeypadResult' || !good.ok) throw new Error(`correct code failed: ${good.message}`);

  console.log('cabin-door-smoke ok');
  hostWs.close();
  crewWs.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
