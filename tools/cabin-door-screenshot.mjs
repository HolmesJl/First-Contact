import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media/cabin-door.png';
const URL = 'http://localhost:47321';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('[data-act=host]').click();
await page.waitForTimeout(1200);
await page.keyboard.press('Space');
await page.waitForSelector('.wake-action', { timeout: 15000 });
await page.locator('.wake-action').click();
await page.waitForFunction(() => /continue/i.test(document.querySelector('.wake-action')?.textContent ?? ''), { timeout: 8000 });
await page.locator('.wake-action').click();
await page.waitForSelector('button.create', { timeout: 10000 });
await page.locator('#fn').fill('Alex');
await page.locator('#ln').fill('Rook');
await page.locator('button.create').click();
await page.waitForFunction(() => typeof window.__fc?.teleport === 'function', { timeout: 15000 });
await page.evaluate(() => {
  window.__fc?.teleport(-46.85, 18.35);
  window.__fc?.cabinDoorFrac(0.52);
});
await page.waitForTimeout(800);
await mkdir(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
await page.screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
