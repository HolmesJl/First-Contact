import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media/cabin-keypad.png';
const URL = 'http://localhost:47321';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });

await page.evaluate(() => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'Enter'];
  const grid = keys
    .map((k) => `<button type="button" class="keypad-key${k === 'Enter' ? ' enter' : ''}">${k}</button>`)
    .join('');
  const el = document.createElement('div');
  el.className = 'cabin-keypad-overlay show';
  el.innerHTML = `
    <div class="keypad-title">Set cabin code</div>
    <div class="keypad-digits">••——</div>
    <div class="keypad-message"></div>
    <div class="keypad-grid">${grid}</div>`;
  document.getElementById('ui')?.append(el);
});

await mkdir(path.dirname(OUT), { recursive: true });
await page.locator('.cabin-keypad-overlay.show').screenshot({ path: OUT });
console.log('saved', OUT);
await browser.close();
