import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media/cabin-door.png';
const URL = 'http://localhost:47321';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.locator('[data-act=host]').click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /start voyage/i }).click({ timeout: 12000 }).catch(() => {});
await page.waitForTimeout(500);
await page.getByRole('button', { name: /continue/i }).click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
await page.locator('.btn.primary').filter({ hasText: /create/i }).first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__fc?.teleport(-47.0, 18.3);
  window.__fc?.cabinDoorFrac(0.52);
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const c = document.querySelector('#scene');
  if (c) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 640, clientY: 400 }));
});
await page.waitForTimeout(200);
await mkdir(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
await page.screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
