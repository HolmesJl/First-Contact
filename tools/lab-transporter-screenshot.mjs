/**
 * Capture lab transporter amber console (hover highlight).
 * Requires: npm run dev (client+server), then node tools/lab-transporter-screenshot.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';

const OUT = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media/lab-transporter-pad.png';
const URL = 'http://localhost:47321/';
const STAND = { x: -53.2, z: -19.28 };
/** Pillar-mounted lab transporter screen (shared/transporter TRANSPORTER_STATIONS). */
const PAD = { x: -51.79, y: 1.45, z: -20.13 };

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
await page.fill('#fn', 'Shot');
await page.fill('#ln', 'Tester');
await page.click('button.create');
await page.waitForSelector('.creator.leaving, .creator', { state: 'detached', timeout: 60000 }).catch(() => {});
await sleep(3000);
await page.waitForFunction(() => window.__fc?.lab && !document.querySelector('.creator'), { timeout: 90000 });
await sleep(4000);

const pos = await page.evaluate(
  async ({ STAND, PAD }) => {
    for (let i = 0; i < 5; i++) {
      window.__fc.teleport(STAND.x, STAND.z, 0);
      await new Promise((r) => setTimeout(r, 400));
    }
    window.__fc.highlightTransporter('lab-transporter');
    await new Promise((r) => setTimeout(r, 1500));
    const lab = window.__fc.lab;
    if (lab?.camera) {
      const cam = lab.camera;
      cam.position.set(STAND.x, 1.55, STAND.z);
      cam.lookAt(PAD.x, PAD.y, PAD.z);
    }
    await new Promise((r) => setTimeout(r, 500));
    return window.__fc.lab.localPos();
  },
  { STAND, PAD },
);
console.log('player at', pos);

await page.locator('#scene').screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
