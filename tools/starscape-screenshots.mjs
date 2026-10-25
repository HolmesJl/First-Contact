/**
 * Capture bridge starscape, corridor starscape, and helm console.
 * Requires: npm run dev, then node tools/starscape-screenshots.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';

const STORE = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media';
const OUT = {
  bridge: path.join(STORE, 'starscape-bridge.png'),
  corridor: path.join(STORE, 'starscape-corridor.png'),
  helm: path.join(STORE, 'helm-console.png'),
};
const URL = 'http://localhost:47321/';
const HELM = { x: -38.2, z: 34.4 };
const CORRIDOR = { x: -38.2, z: 8.0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#scene', { timeout: 30000 });

await page.click('[data-act=host]');
await sleep(3000);
for (let i = 0; i < 8; i++) {
  const skip = page.locator('.skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.keyboard.press('Space');
  await sleep(400);
}
const wakeAction = page.locator('.wake-action');
if (await wakeAction.isVisible().catch(() => false)) {
  await wakeAction.click();
  await sleep(2000);
}
if (await wakeAction.isVisible().catch(() => false)) {
  await wakeAction.click();
  await sleep(2000);
}

await page.waitForSelector('#fn', { timeout: 60000 });
await page.fill('#fn', 'Star');
await page.fill('#ln', 'Scape');
await page.click('button.create');
await page.waitForSelector('.creator.leaving, .creator', { state: 'detached', timeout: 60000 }).catch(() => {});
await sleep(3000);
await page.waitForFunction(() => window.__fc?.lab && !document.querySelector('.creator'), { timeout: 90000 });
await sleep(2000);

await page.evaluate(async () => {
  window.__fc.teleport(-38.2, 31.5, 0);
  window.__fc.setShipMotion?.('warp');
  await new Promise((r) => setTimeout(r, 800));
  const cam = window.__fc.lab?.camera;
  if (cam) {
    cam.position.set(-36.4, 2.15, 29.5);
    cam.lookAt(-37.8, 2.55, 41.5);
  }
});
await sleep(600);
await page.locator('#scene').screenshot({ path: OUT.bridge });
console.log('saved', OUT.bridge);

await page.evaluate(async ({ CORRIDOR }) => {
  window.__fc.teleport(CORRIDOR.x, CORRIDOR.z, 0);
  window.__fc.setShipMotion?.('warp');
  await new Promise((r) => setTimeout(r, 600));
  const cam = window.__fc.lab?.camera;
  if (cam) {
    cam.position.set(CORRIDOR.x + 0.5, 1.65, CORRIDOR.z);
    cam.lookAt(CORRIDOR.x + 1.2, 1.6, CORRIDOR.z + 2);
  }
}, { CORRIDOR });
await sleep(500);
await page.locator('#scene').screenshot({ path: OUT.corridor });
console.log('saved', OUT.corridor);

await page.evaluate(() => {
  window.__fc.teleport(-38.2, 34.4, 0);
  window.__fc.setShipMotion?.('still');
  window.__fc.openHelm?.();
});
await sleep(400);
await page.screenshot({ path: OUT.helm });
console.log('saved', OUT.helm);

await browser.close();
