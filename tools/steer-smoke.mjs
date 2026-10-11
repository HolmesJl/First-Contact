/**
 * Browser smoke for mouse steering vs. the UI overlays.
 *
 * Run: npm run smoke:steer
 * Needs a Chromium: `npx playwright install chromium` (uses the `playwright` package), or set CHROME to a Chrome /
 * Chromium binary and have `playwright-core` installed. Starts its own ship server and Vite dev server on free ports
 * with a temp data file, boards a saved Captain, then checks with real pointer events that:
 *   - inventory closed: right-drag steers (facing changes) and left-drag orbits the camera;
 *   - inventory open: no drag reaches the canvas;
 *   - opening the inventory mid-drag ends the drag cleanly, and steering works again once it is closed;
 *   - a vertical left-drag changes the camera pitch (up looks up, down looks down, within MIN/MAX_PITCH) and the
 *     pitch holds after release while the yaw eases back behind the character.
 * Regression guard for the hidden inventory backdrop swallowing canvas pointer events and for pitch snapping back.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PORT = 47800 + Math.floor(Math.random() * 400);
const CLIENT_PORT = 48300 + Math.floor(Math.random() * 400);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-steer-smoke-'));
const CLIENT_ID = 'steer-smoke-client';
const children = [];

async function chromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const { chromium } = await import('playwright-core');
    const executablePath = process.env.CHROME;
    if (!executablePath) throw new Error('install playwright (npx playwright install chromium) or set CHROME=/path/to/chrome');
    return { launch: (o) => chromium.launch({ ...o, executablePath, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }) };
  }
}

function waitFor(child, marker) {
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      if (String(d).includes(marker)) resolve();
    });
    child.once('exit', (code) => reject(new Error(`${marker}: process exited early (${code})`)));
  });
}

async function startStack() {
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, PORT: String(SERVER_PORT), DATA_FILE: path.join(DATA_DIR, 'ships.json') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(server);
  await waitFor(server, 'listening');
  const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(CLIENT_PORT), '--strictPort', '--clearScreen', 'false'], {
    cwd: path.join(ROOT, 'client'),
    env: { ...process.env, SERVER_PORT: String(SERVER_PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(vite);
  await waitFor(vite, `${CLIENT_PORT}`);
}

function stopStack() {
  for (const c of children) c.kill('SIGTERM');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

/** Host a ship and save a Captain for CLIENT_ID so the landing screen offers Board (straight into walk mode). */
async function precreate() {
  const ws = new WebSocket(`ws://localhost:${SERVER_PORT}/ws`);
  const seen = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    seen.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const wait = (pred) =>
    new Promise((resolve, reject) => {
      const hit = seen.find(pred);
      if (hit) return resolve(hit);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('timed out waiting for server')), 6000);
    });
  await new Promise((r) => ws.on('open', r));
  const send = (m) => ws.send(JSON.stringify(m));
  send({ t: 'host', clientId: CLIENT_ID });
  await wait((m) => m.t === 'characters');
  send({ t: 'newCharacter' });
  const w = await wait((m) => m.t === 'welcome');
  send({ t: 'startGame' });
  await wait((m) => m.t === 'shipState' && m.ship.gameStarted);
  send({
    t: 'create',
    character: { sex: 'female', face: 'calm', hairStyle: 'buns', facialHair: 'none', hairColor: '#8e3b1f', eyeColor: '#3f8a4f', job: 'Captain', firstName: 'Steer', lastName: 'Smoke' },
  });
  await wait((m) => m.t === 'playerUpdated' && m.player.id === w.you && m.player.character);
  ws.close();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`steer-smoke: ${msg}`);
}

const close = (a, b) => Math.abs(a - b) < 1e-6;

async function main() {
  await startStack();
  await precreate();
  const browser = await (await chromium()).launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.addInitScript((id) => localStorage.setItem('fc.clientId', id), CLIENT_ID);
    await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('button[data-act="pick"]:not([disabled])', { timeout: 20000 });
    await page.click('button[data-act="pick"]');
    // Dev build only: main.ts exposes the scene as window.__fc. Private fields are read as plain JS.
    await page.waitForFunction(() => globalThis.__fc?.lab?.mode === 'walk', null, { timeout: 30000 });
    await page.waitForTimeout(800);

    const read = () =>
      page.evaluate(() => {
        const c = globalThis.__fc.lab.controls;
        return { facing: c.facing, orbit: c.orbitOffset, pitch: c.pitch, dragging: c.dragging, invOpen: !!document.querySelector('.inv-overlay.show') };
      });
    const under = () => page.evaluate(() => document.elementFromPoint(640, 400)?.tagName ?? null);
    const toggleInventory = async () => {
      await page.keyboard.press('i');
      await page.waitForTimeout(250);
    };
    /** Press at the screen centre, drag 200 px right in steps, read mid-drag, release. */
    const drag = async (button) => {
      await page.mouse.move(640, 400);
      await page.mouse.down({ button });
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(640 + 20 * i, 400 + (button === 'left' ? 2 * i : 0));
        await page.waitForTimeout(16);
      }
      const mid = await read();
      await page.mouse.up({ button });
      await page.waitForTimeout(60);
      return { mid, after: await read() };
    };
    /** Left-press at the screen centre, drag `dy` px vertically (negative = up), release, then wait out the yaw return. */
    const dragVertical = async (dy) => {
      await page.mouse.move(640, 400);
      await page.mouse.down({ button: 'left' });
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(640, 400 + (dy * i) / 10);
        await page.waitForTimeout(16);
      }
      const mid = await read();
      await page.mouse.up({ button: 'left' });
      await page.waitForTimeout(700);
      return { mid, after: await read() };
    };

    // 1. Inventory closed: the canvas gets the pointer; right-drag steers, left-drag orbits, both release.
    assert((await under()) === 'CANVAS', `with the inventory closed the canvas should be under the cursor, got ${await under()}`);
    const start = await read();
    assert(!start.invOpen && start.dragging === null, 'clean start');
    let r = await drag('right');
    assert(r.mid.dragging === 'steer', `right-drag should steer, got ${r.mid.dragging}`);
    assert(!close(r.mid.facing, start.facing), 'right-drag should change facing');
    assert(r.after.dragging === null, 'right-drag should end on release');
    const steered = r.after.facing;
    r = await drag('left');
    assert(r.mid.dragging === 'orbit', `left-drag should orbit, got ${r.mid.dragging}`);
    assert(!close(r.mid.orbit, 0), 'left-drag should change the orbit offset');
    assert(close(r.mid.facing, steered), 'left-drag must not turn the character');
    assert(r.after.dragging === null, 'left-drag should end on release');

    // 2. Inventory open: the modal takes the mouse; nothing reaches the controls.
    await toggleInventory();
    assert((await read()).invOpen, 'I opens the inventory');
    assert((await under()) !== 'CANVAS', 'with the inventory open the modal should be under the cursor');
    const before = await read();
    for (const b of ['right', 'left']) {
      r = await drag(b);
      assert(r.mid.dragging === null && r.after.dragging === null, `${b}-drag over the open inventory must not start a drag`);
      assert(close(r.after.facing, before.facing) && close(r.after.orbit, before.orbit), `${b}-drag over the open inventory must not move the camera`);
    }
    await toggleInventory();
    assert(!(await read()).invOpen, 'I closes the inventory');

    // 3. Opening the inventory mid-drag ends the drag (pointer capture would otherwise keep feeding the canvas).
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(700, 400);
    await page.waitForTimeout(16);
    assert((await read()).dragging === 'steer', 'steer drag in progress before opening');
    await toggleInventory();
    const opened = await read();
    assert(opened.invOpen && opened.dragging === null, 'opening the inventory must end the drag');
    await page.mouse.move(900, 400);
    await page.waitForTimeout(16);
    assert(close((await read()).facing, opened.facing), 'moves after opening must not steer');
    await page.mouse.up({ button: 'right' });
    await toggleInventory();

    // 4. Closed again: steering works as before.
    r = await drag('right');
    assert(r.mid.dragging === 'steer' && !close(r.mid.facing, opened.facing) && r.after.dragging === null, 'steering works again after the modal cycle');

    // 5. Pitch: a vertical left-drag looks up / down, and the pitch holds after release (only the yaw eases back).
    const MIN_PITCH = -0.55;
    const MAX_PITCH = 1.2;
    const level = await read();
    r = await dragVertical(-200);
    assert(r.mid.dragging === 'orbit', `vertical left-drag should orbit, got ${r.mid.dragging}`);
    assert(r.mid.pitch < level.pitch - 0.1, `dragging up should look up (pitch ${level.pitch} -> ${r.mid.pitch})`);
    assert(r.mid.pitch >= MIN_PITCH - 1e-6, `pitch must not go below MIN_PITCH, got ${r.mid.pitch}`);
    assert(r.after.dragging === null, 'vertical left-drag should end on release');
    assert(close(r.after.pitch, r.mid.pitch), `pitch must hold after release (${r.mid.pitch} -> ${r.after.pitch})`);
    assert(Math.abs(r.after.orbit) < 1e-3, `yaw should still ease back behind the character, got ${r.after.orbit}`);
    const lookedUp = r.after.pitch;
    r = await dragVertical(400);
    assert(r.mid.pitch > lookedUp + 0.1, `dragging down should look down (pitch ${lookedUp} -> ${r.mid.pitch})`);
    assert(r.mid.pitch <= MAX_PITCH + 1e-6, `pitch must not go above MAX_PITCH, got ${r.mid.pitch}`);
    assert(close(r.after.pitch, r.mid.pitch), `pitch must hold after release (${r.mid.pitch} -> ${r.after.pitch})`);
    assert(Math.abs(r.after.orbit) < 1e-3, 'yaw eases back after a downward drag too');
    const lookedDown = r.after.pitch;
    // Yaw-only orbit and release must leave the held pitch alone.
    r = await drag('right');
    r = await dragVertical(0);
    assert(close(r.after.pitch, lookedDown), `steering and an idle left click must not reset the pitch (${lookedDown} -> ${r.after.pitch})`);
    console.log('steer-smoke ok');
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(stopStack);
