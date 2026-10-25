/**
 * Transporter pad dialog: after a failed start, Start is enabled again without closing.
 *
 * Run: npm run smoke:transporter-dialog
 */
import { parseHTML } from 'linkedom';
import { TRANSPORTER_SKILL_MISS_MESSAGE, TRANSPORTER_STATIONS } from '../shared/transporter';
import type { ScanResultEntry } from '../shared/scanning';

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const { document, window } = parseHTML('<!DOCTYPE html><html><body><div id="ui"></div></body></html>');
(globalThis as unknown as { document: Document; window: Window }).document = document as unknown as Document;
(globalThis as unknown as { window: Window }).window = window as unknown as Window;
(globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame = () => 0;
(globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = () => {};

const { TransporterStationOverlay } = await import('../client/src/transporterStation');

const pad = TRANSPORTER_STATIONS.find((s) => s.interactId === 'lab-transporter')!;
const results: ScanResultEntry[] = [
  {
    id: 'smoke-scan',
    outcome: 'atmosphere',
    distanceLabel: '40 km',
    foundAt: 0,
    foundBy: 'Smoke',
    loot: [{ materialId: 'lithium', qty: 3, remaining: 3 }],
  },
];

let overlay: InstanceType<typeof TransporterStationOverlay> | null = null;
overlay = new TransporterStationOverlay(
  pad,
  { level: 1, positiveBeams: 0 },
  results,
  {
    onStart: () => overlay?.setPendingStart(true),
    onClose: () => {
      overlay = null;
    },
  },
);

const startBtn = () => overlay!.el.querySelector<HTMLButtonElement>('.transport-start');
const statusText = () => overlay!.el.querySelector('.transport-status')?.textContent ?? '';

// Select contact + material via DOM
const contact = overlay.el.querySelector<HTMLElement>('[data-scan-id]');
assert(contact, 'contact row');
(contact as HTMLElement).click();
const mat = overlay.el.querySelector<HTMLElement>('[data-material-id]');
assert(mat, 'material button');
mat.click();

assert(startBtn()?.disabled === false, 'Start enabled before first beam');

startBtn()?.click();
assert(startBtn()?.disabled === true, 'Start disabled while pending');
assert(startBtn()?.textContent === 'Starting…', 'Starting label while pending');

overlay.failStart(TRANSPORTER_SKILL_MISS_MESSAGE);
assert(startBtn()?.disabled === false, 'Start enabled after failStart without closing modal');
assert(statusText().includes(TRANSPORTER_SKILL_MISS_MESSAGE), 'miss message stays in dialog');

startBtn()?.click();
assert(startBtn()?.disabled === true, 'Start can be clicked again after a miss');
assert(!statusText().includes(TRANSPORTER_SKILL_MISS_MESSAGE), 'status clears on next Start click');

overlay.close();
console.log('transporter dialog smoke ok');
