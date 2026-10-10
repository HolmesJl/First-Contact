import { berthLabel, formatUploadTime } from '../../shared/bunks';

const ui = document.getElementById('ui')!;

const UPLOAD_MS = 1400;
const HOLD_MS = 1900;

/**
 * Short full-screen confirmation for a memory upload: a progress sweep, then the stored snapshot time. Auto-dismisses;
 * click or Escape closes early.
 */
export class MemoryUploadOverlay {
  readonly el = document.createElement('div');
  private timer = 0;

  constructor(berth: number, at: number, claimed: boolean, from: number | null, private onClose: () => void) {
    this.el.className = 'memory-upload-overlay';
    const label = berthLabel(berth);
    const headline = claimed ? `${label} is now yours` : from !== null ? `Moved to ${label}` : label;
    const sub = from !== null ? `<div class="memory-sub">${berthLabel(from)} released</div>` : '';
    this.el.innerHTML = `
      <div class="memory-card">
        <div class="memory-title">Memory upload</div>
        <div class="memory-berth">${headline}</div>${sub}
        <div class="memory-bar"><i></i></div>
        <div class="memory-status">Scanning engrams…</div>
      </div>`;
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    const status = this.el.querySelector<HTMLElement>('.memory-status')!;
    this.timer = window.setTimeout(() => {
      this.el.classList.add('done');
      status.textContent = `Snapshot stored · ${formatUploadTime(at)}`;
      this.timer = window.setTimeout(() => this.close(), HOLD_MS);
    }, UPLOAD_MS);
    this.el.addEventListener('click', () => this.close());
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  close() {
    clearTimeout(this.timer);
    window.removeEventListener('keydown', this.onKey);
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 250);
    this.onClose();
  }
}
