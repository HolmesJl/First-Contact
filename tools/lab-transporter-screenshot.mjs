/**
 * Capture lab transporter amber console (hover highlight).
 * Requires: npm run dev (client+server), then node tools/lab-transporter-screenshot.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';

const OUT = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media/lab-transporter-pad.png';
const URL = 'http://localhost:47321/';
const STAND = { x: -53.2, z: -19.28 };

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
const startBtn = page.locator('button:has-text("Start")');
if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
const contBtn = page.locator('button:has-text("Continue")');
if (await contBtn.isVisible().catch(() => false)) await contBtn.click();
await sleep(2000);
const newCrew = page.locator('button:has-text("New crew member")');
if (await newCrew.isVisible().catch(() => false)) await newCrew.click();
await sleep(1500);

await page.waitForSelector('#fn', { timeout: 60000 });
await page.fill('#fn', 'Shot');
await page.fill('#ln', 'Tester');
await page.click('button.create');
await sleep(5000);

await page.waitForFunction(() => window.__fc?.lab, { timeout: 90000 });

await page.evaluate(
  async ({ STAND }) => {
    window.__fc.teleport(STAND.x, STAND.z, 0);
    window.__fc.highlightTransporter('lab-transporter');
    await new Promise((r) => setTimeout(r, 1200));
  },
  { STAND },
);

await page.locator('#scene').screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
