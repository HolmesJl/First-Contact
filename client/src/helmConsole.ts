import {
  distanceNeedsTransit,
  formatEta,
  parseDistanceKm,
  warpDurationMs,
  type WarpMode,
} from '../../shared/navigation';
import { scanFindTitle, type ScanResultEntry } from '../../shared/scanning';
import type { ShipNavigation } from '../../shared/navigation';

const ui = document.getElementById('ui')!;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HelmConsoleHandlers {
  onStart(scanId: string, mode: WarpMode): void;
  onClose(): void;
  isCaptain(): boolean;
}

/**
 * Bridge center console: scan destinations, warp speed, ETA. Captain starts transit; others view only.
 */
export class HelmConsoleOverlay {
  readonly el = document.createElement('div');
  private results: ScanResultEntry[];
  private navigation: ShipNavigation;
  private selectedId: string | null = null;
  private mode: WarpMode = 'warp';
  private pending = false;
  private transitEndsAt = 0;
  private transitMode: WarpMode | null = null;
  private raf = 0;

  constructor(
    results: ScanResultEntry[],
    navigation: ShipNavigation,
    private handlers: HelmConsoleHandlers,
  ) {
    this.results = results;
    this.navigation = navigation;
    if (navigation.transit) {
      this.transitEndsAt = navigation.transit.endsAt;
      this.transitMode = navigation.transit.mode;
      this.selectedId = navigation.transit.scanId;
      this.mode = navigation.transit.mode;
    } else if (results.length) this.selectedId = results[results.length - 1].id;
    this.el.className = 'helm-console-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', this.onKey);
    if (this.inTransit()) this.tickTransitBar();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.closePanel();
  };

  get isOpen() {
    return this.el.isConnected;
  }

  close() {
    if (!this.el.isConnected) return;
    this.closePanel();
  }

  setPending(on: boolean) {
    this.pending = on;
    this.paintActions();
  }

  setResults(results: ScanResultEntry[]) {
    this.results = results;
    this.paintList();
  }

  setNavigation(nav: ShipNavigation) {
    this.navigation = nav;
    if (nav.transit) {
      this.transitEndsAt = nav.transit.endsAt;
      this.transitMode = nav.transit.mode;
      this.selectedId = nav.transit.scanId;
      this.mode = nav.transit.mode;
      this.tickTransitBar();
    } else {
      this.transitEndsAt = 0;
      this.transitMode = null;
      cancelAnimationFrame(this.raf);
    }
    this.paintStatus();
    this.paintActions();
  }

  beginTransit(endsAt: number, mode: WarpMode) {
    this.pending = false;
    this.transitEndsAt = endsAt;
    this.transitMode = mode;
    this.mode = mode;
    this.tickTransitBar();
    this.paintStatus();
    this.paintActions();
  }

  endTransit(results: ScanResultEntry[]) {
    this.results = results;
    this.transitEndsAt = 0;
    this.transitMode = null;
    cancelAnimationFrame(this.raf);
    this.paintList();
    this.paintStatus();
    this.paintActions();
  }

  private inTransit() {
    return this.transitEndsAt > Date.now();
  }

  private closePanel() {
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('show');
    window.removeEventListener('keydown', this.onKey);
    setTimeout(() => {
      this.el.remove();
      this.handlers.onClose();
    }, 220);
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return this.closePanel();
    const row = t.closest('[data-scan-id]') as HTMLElement | null;
    if (row && !this.inTransit()) {
      this.selectedId = row.dataset.scanId ?? null;
      this.paintList();
      this.paintEta();
      this.paintActions();
      return;
    }
    const modeBtn = t.closest('[data-warp-mode]') as HTMLElement | null;
    if (modeBtn && !this.inTransit() && this.handlers.isCaptain()) {
      const m = modeBtn.dataset.warpMode;
      if (m === 'warp' || m === 'f-warp') {
        this.mode = m;
        this.paintModes();
        this.paintEta();
        this.paintActions();
      }
      return;
    }
    if (t.closest('.helm-start')) this.tryStart();
  }

  private tryStart() {
    if (!this.handlers.isCaptain() || this.pending || this.inTransit() || !this.selectedId) return;
    const entry = this.results.find((r) => r.id === this.selectedId);
    if (!entry || !distanceNeedsTransit(entry.distanceLabel)) return;
    this.handlers.onStart(this.selectedId, this.mode);
  }

  private render() {
    this.el.innerHTML = `
      <div class="helm-console-panel">
        <header class="helm-console-head">
          <h2>Helm · Navigation</h2>
          <button type="button" class="helm-close" data-close aria-label="Close">×</button>
        </header>
        <p class="helm-console-sub">Scan contacts · approach hold at 20 km</p>
        <div class="helm-status"></div>
        <div class="helm-list-wrap"><ul class="helm-list"></ul></div>
        <div class="helm-speed">
          <span class="helm-speed-label">Engine speed</span>
          <div class="helm-modes"></div>
        </div>
        <p class="helm-eta"></p>
        <div class="helm-actions"></div>
      </div>`;
    this.paintList();
    this.paintModes();
    this.paintEta();
    this.paintStatus();
    this.paintActions();
  }

  private paintList() {
    const ul = this.el.querySelector('.helm-list')!;
    if (!this.results.length) {
      ul.innerHTML = '<li class="helm-empty">No scan contacts yet. Run a sensor scan first.</li>';
      return;
    }
    ul.innerHTML = this.results
      .map((r) => {
        const sel = r.id === this.selectedId;
        const transit = distanceNeedsTransit(r.distanceLabel);
        return `<li class="helm-row${sel ? ' selected' : ''}" data-scan-id="${esc(r.id)}" role="button" tabindex="0">
          <span class="helm-row-title">${esc(scanFindTitle(r))}</span>
          <span class="helm-row-dist">${esc(r.distanceLabel)}</span>
          ${transit ? '' : '<span class="helm-row-near">In range</span>'}
        </li>`;
      })
      .join('');
  }

  private paintModes() {
    const box = this.el.querySelector('.helm-modes')!;
    const cap = this.handlers.isCaptain();
    const disabled = !cap || this.inTransit();
    const modes: { id: WarpMode; label: string; hint: string }[] = [
      { id: 'warp', label: 'Warp', hint: '2 min / LY' },
      { id: 'f-warp', label: 'F-Warp', hint: '30 s / LY' },
    ];
    box.innerHTML =
      modes
        .map(
          (m) =>
            `<button type="button" class="helm-mode${this.mode === m.id ? ' on' : ''}" data-warp-mode="${m.id}" ${disabled ? 'disabled' : ''}>
              <span class="helm-mode-name">${m.label}</span><span class="helm-mode-hint">${m.hint}</span>
            </button>`,
        )
        .join('') +
      `<button type="button" class="helm-mode helm-mode-stub" disabled title="Coming soon">
        <span class="helm-mode-name">Thrusters</span><span class="helm-mode-hint">Docking · coming soon</span>
      </button>`;
  }

  private paintEta() {
    const p = this.el.querySelector('.helm-eta')!;
    const entry = this.results.find((r) => r.id === this.selectedId);
    if (!entry) {
      p.textContent = '';
      return;
    }
    if (!distanceNeedsTransit(entry.distanceLabel)) {
      p.textContent = 'Within 20 km — no warp needed for approach.';
      return;
    }
    const km = parseDistanceKm(entry.distanceLabel);
    if (km === null) {
      p.textContent = '';
      return;
    }
    const ms = warpDurationMs(km, this.mode);
    p.textContent = `Time to destination: ${formatEta(ms)} at ${this.mode === 'f-warp' ? 'F-Warp' : 'Warp'}`;
  }

  private paintStatus() {
    const box = this.el.querySelector('.helm-status')!;
    if (this.inTransit()) {
      box.innerHTML = `<div class="helm-transit">Transit in progress · ${this.transitMode === 'f-warp' ? 'F-Warp' : 'Warp'}</div><div class="helm-bar"><div class="helm-bar-fill"></div></div>`;
      return;
    }
    box.innerHTML = this.handlers.isCaptain()
      ? '<div class="helm-hint">Captain: select a destination and start warp.</div>'
      : '<div class="helm-hint">View only — only the Captain can start transit.</div>';
  }

  private paintActions() {
    const box = this.el.querySelector('.helm-actions')!;
    const entry = this.results.find((r) => r.id === this.selectedId);
    const can =
      this.handlers.isCaptain() &&
      !this.pending &&
      !this.inTransit() &&
      entry &&
      distanceNeedsTransit(entry.distanceLabel);
    box.innerHTML = `<button type="button" class="helm-start" ${can ? '' : 'disabled'}>${this.pending ? 'Starting…' : 'Start transit'}</button>`;
  }

  private tickTransitBar() {
    cancelAnimationFrame(this.raf);
    const fill = this.el.querySelector('.helm-bar-fill') as HTMLElement | null;
    const step = () => {
      const now = Date.now();
      const nav = this.navigation.transit;
      const start = nav?.startedAt ?? now;
      const end = this.transitEndsAt;
      const t = end <= start ? 1 : Math.min(1, (now - start) / (end - start));
      if (fill) fill.style.width = `${(t * 100).toFixed(1)}%`;
      if (now < end) this.raf = requestAnimationFrame(step);
    };
    step();
  }
}
