import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const STORE = '/cursor/stores/bc-b1f931ed-bed1-4801-beaf-b959cd99a4de/media';
const URL = 'http://localhost:47321';

function overlayHtml(title, contacts) {
  return `
    <div class="scan-station-overlay transporter-station-overlay show" style="opacity:1;pointer-events:auto">
      <div class="scan-card panel" role="dialog">
        <div class="scan-head">
          <div class="scan-title">Transporter · ${title}</div>
          <button type="button" class="scan-close">×</button>
        </div>
        <div class="scan-skill transport-skill">
          <div class="scan-level">Transporter level <strong>1</strong> / 5</div>
          <div class="scan-progress-label">Successful beams toward next level: <strong>12</strong> / 100</div>
        </div>
        <div class="transport-body">
          <div class="transport-contacts">${contacts}</div>
          <div class="transport-qty-row"><span class="muted">Beam qty:</span>
            <button type="button" class="transport-qty on">1</button>
            <button type="button" class="transport-qty">2</button>
          </div>
        </div>
        <div class="scan-actions transport-actions">
          <button type="button" class="transport-start scan-start primary">Start Beam In Process</button>
        </div>
      </div>
    </div>`;
}

const labContacts = `
  <div class="transport-contact on">
    <div class="transport-contact-head"><strong>Planet with atmosphere</strong> · 214 km</div>
    <div class="transport-contact-sub muted">3 Lithium · 2 Plastics</div>
    <div class="transport-mats">
      <button type="button" class="transport-mat on">Lithium <span class="n">3</span></button>
      <button type="button" class="transport-mat">Plastics <span class="n">2</span></button>
    </div>
  </div>`;

const cargoContacts = `
  <div class="transport-contact on">
    <div class="transport-contact-head"><strong>Space debris</strong> · 88 km</div>
    <div class="transport-contact-sub muted">2 Paneling · 3 Conduit</div>
    <div class="transport-mats">
      <button type="button" class="transport-mat on">Paneling <span class="n">2</span></button>
      <button type="button" class="transport-mat">Conduit <span class="n">3</span></button>
    </div>
  </div>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await mkdir(STORE, { recursive: true });

for (const [file, title, contacts] of [
  ['transporter-lab.png', 'Science Lab', labContacts],
  ['transporter-cargo.png', 'Cargo Bay', cargoContacts],
]) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate((html) => {
    document.querySelector('.transporter-station-overlay')?.remove();
    document.getElementById('ui')?.insertAdjacentHTML('beforeend', html);
  }, overlayHtml(title, contacts));
  await page.locator('.transporter-station-overlay.show').screenshot({ path: path.join(STORE, file) });
  console.log('saved', path.join(STORE, file));
}

await browser.close();
