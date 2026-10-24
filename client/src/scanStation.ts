import {
  SCAN_DURATION_MS,
  SCAN_POSITIVES_FOR_LEVEL,
  type ScanResultEntry,
  type ScanningSkill,
} from '../../shared/scanning';

const ui = document.getElementById('ui')!;

const RESULT_DISMISS_MS = { hit: 4500, miss: 2800 } as const;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const formatTime = (ms: number) => {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export interface ScanStationHandlers {
  onStart(): void;
  onClose(): void;
  playerPos(): { x: number; z: number } | null;
}

/**
 * Bridge scan console UI: skill progress, start scan, client-side progress bar synced to server `endsAt`.
 */
export class ScanStationOverlay {
  readonly el = document.createElement('div');
  private skill: ScanningSkill;
  private results: ScanResultEntry[];
  private scanning = false;
  private pendingStart = false;
  private resultUntil = 0;
  private endsAt = 0;
  private raf = 0;
  private resultTimer = 0;
  private cooldownTimer = 0;
  private lastResult: { hit: boolean; find: ScanResultEntry | null; leveledUp: boolean } | null = null;

  constructor(
    skill: ScanningSkill,
    results: ScanResultEntry[],
    private handlers: ScanStationHandlers,
  ) {
    this.skill = skill;
    this.results = results;
    this.el.className = 'scan-station-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
      if ((e.target as HTMLElement).closest('.scan-start')) this.tryStart();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  get isOpen() {
    return this.el.isConnected;
  }

  private canStartScan(): boolean {
    return !this.scanning && !this.pendingStart && Date.now() >= this.resultUntil;
  }

  setPendingStart(on: boolean) {
    this.pendingStart = on;
    this.syncStartButton();
  }

  updateSkill(skill: ScanningSkill) {
    this.skill = skill;
    this.paintSkill();
  }

  setResults(results: ScanResultEntry[]) {
    this.results = results;
    this.paintResults();
  }

  beginScan(endsAt: number) {
    this.pendingStart = false;
    this.scanning = true;
    this.endsAt = endsAt;
    this.lastResult = null;
    this.paintScanning();
    this.tickBar();
  }

  showComplete(hit: boolean, find: ScanResultEntry | null, skill: ScanningSkill, leveledUp: boolean, results: ScanResultEntry[]) {
    this.pendingStart = false;
    this.scanning = false;
    this.skill = skill;
    this.results = results;
    this.lastResult = { hit, find, leveledUp };
    cancelAnimationFrame(this.raf);
    this.resultUntil = Date.now() + (hit ? RESULT_DISMISS_MS.hit : RESULT_DISMISS_MS.miss);
    this.paintComplete();
    clearTimeout(this.resultTimer);
    clearTimeout(this.cooldownTimer);
    this.resultTimer = window.setTimeout(() => {
      this.lastResult = null;
      this.paintIdle();
    }, hit ? RESULT_DISMISS_MS.hit : RESULT_DISMISS_MS.miss);
    this.cooldownTimer = window.setTimeout(() => this.syncStartButton(), hit ? RESULT_DISMISS_MS.hit : RESULT_DISMISS_MS.miss);
  }

  private tryStart() {
    if (!this.canStartScan()) return;
    this.handlers.onStart();
  }

  private syncStartButton() {
    const btn = this.el.querySelector<HTMLButtonElement>('.scan-start');
    if (!btn) return;
    const blocked = !this.canStartScan();
    btn.disabled = blocked;
    if (this.scanning) btn.textContent = 'Scanning…';
    else if (this.pendingStart) btn.textContent = 'Starting…';
    else btn.textContent = 'Start Scan';
  }

  private tickBar() {
    cancelAnimationFrame(this.raf);
    const bar = this.el.querySelector<HTMLElement>('.scan-bar i');
    const status = this.el.querySelector<HTMLElement>('.scan-status');
    if (!bar || !status) return;
    const loop = () => {
      const now = Date.now();
      const frac = Math.min(1, Math.max(0, (now - (this.endsAt - SCAN_DURATION_MS)) / SCAN_DURATION_MS));
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      status.textContent = frac >= 1 ? 'Awaiting analysis…' : 'Scanning in Progress';
      if (this.scanning && now < this.endsAt + 400) this.raf = requestAnimationFrame(loop);
      else if (this.scanning) bar.style.width = '100%';
    };
    this.raf = requestAnimationFrame(loop);
  }

  private render() {
    this.el.innerHTML = `
      <div class="scan-card panel" role="dialog" aria-label="Scan console">
        <div class="scan-head">
          <div class="scan-title">Sensor scan</div>
          <button type="button" class="scan-close" data-close aria-label="Close">×</button>
        </div>
        <div class="scan-skill"></div>
        <div class="scan-actions"></div>
        <div class="scan-result"></div>
        <div class="scan-log">
          <div class="scan-log-title">Recent contacts</div>
          <ul class="scan-log-list"></ul>
        </div>
      </div>`;
    this.paintIdle();
  }

  private paintSkill() {
    const el = this.el.querySelector('.scan-skill');
    if (!el) return;
    const { level, positiveScans } = this.skill;
    el.innerHTML = `
      <div class="scan-level">Scanning level <strong>${level}</strong> / 5</div>
      <div class="scan-progress-label">Successful finds toward next level: <strong>${positiveScans}</strong> / ${SCAN_POSITIVES_FOR_LEVEL}</div>`;
  }

  private paintResults() {
    const list = this.el.querySelector('.scan-log-list');
    if (!list) return;
    if (!this.results.length) {
      list.innerHTML = '<li class="scan-log-empty">No contacts logged yet.</li>';
      return;
    }
    list.innerHTML = [...this.results]
      .reverse()
      .slice(0, 8)
      .map(
        (r) =>
          `<li><span class="scan-log-type">${esc(r.type)}</span> · ${esc(r.distanceLabel)} · ${esc(r.foundBy)} <time>${esc(formatTime(r.foundAt))}</time></li>`,
      )
      .join('');
  }

  private paintStartButtonShell(extra = '') {
    const actions = this.el.querySelector('.scan-actions');
    if (!actions) return;
    actions.innerHTML = `<button type="button" class="scan-start primary">Start Scan</button>${extra}`;
    this.syncStartButton();
  }

  private paintIdle() {
    this.paintSkill();
    this.paintResults();
    this.paintStartButtonShell();
    const result = this.el.querySelector('.scan-result');
    if (result) result.innerHTML = '';
  }

  private paintScanning() {
    this.paintSkill();
    const actions = this.el.querySelector('.scan-actions');
    const result = this.el.querySelector('.scan-result');
    if (actions) {
      actions.innerHTML = `
        <button type="button" class="scan-start primary" disabled>Scanning…</button>
        <div class="scan-bar-wrap"><div class="scan-bar"><i></i></div></div>
        <div class="scan-status">Scanning in Progress</div>`;
    }
    if (result) result.innerHTML = '';
    this.tickBar();
  }

  private paintComplete() {
    this.paintSkill();
    this.paintResults();
    this.paintStartButtonShell();
    const result = this.el.querySelector('.scan-result');
    if (!result || !this.lastResult) return;
    const { hit, find, leveledUp } = this.lastResult;
    if (!hit) {
      result.innerHTML = `<div class="scan-toast miss">Nothing found. Try again.</div>`;
      return;
    }
    const levelNote = leveledUp ? '<div class="scan-levelup">Scanning skill increased!</div>' : '';
    result.innerHTML = `
      ${levelNote}
      <div class="scan-toast hit">
        <div class="scan-find-title">Contact logged</div>
        <div>${esc(find?.type ?? 'signal')} · ${esc(find?.distanceLabel ?? '')}</div>
      </div>`;
  }

  close() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resultTimer);
    clearTimeout(this.cooldownTimer);
    window.removeEventListener('keydown', this.onKey);
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 200);
    this.handlers.onClose();
  }
}
