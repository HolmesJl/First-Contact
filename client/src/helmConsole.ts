import {
  distanceNeedsTransit,
  FIRST_CONTACT_COORDINATES,
  FIRST_CONTACT_DESTINATION_ID,
  FIRST_CONTACT_DISPLAY_NAME,
  FIRST_CONTACT_DISTANCE_LABEL,
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

export type HelmSelection = typeof FIRST_CONTACT_DESTINATION_ID | string;

export interface HelmConsoleHandlers {
  onStart(scanId: string, mode: WarpMode): void;
  onResume(): void;
  onCruiseMode(mode: WarpMode): void;
  onClose(): void;
  isCaptain(): boolean;
}

/**
 * Bridge center console: permanent First Contact heading + temporary scan diverts.
 */
export class HelmConsoleOverlay {
  readonly el = document.createElement('div');
  private results: ScanResultEntry[];
  private navigation: ShipNavigation;
  private selection: HelmSelection = FIRST_CONTACT_DESTINATION_ID;
  private mode: WarpMode = 'warp';
  private pending = false;
  private pendingResume = false;
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
      this.selection = navigation.transit.scanId;
      this.mode = navigation.transit.mode;
    } else if (navigation.firstContactCourse) {
      this.selection = FIRST_CONTACT_DESTINATION_ID;
      this.mode = navigation.cruiseMode;
    } else if (results.length) this.selection = results[results.length - 1].id;
    this.el.className = 'helm-console-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', this.onKey);
    if (this.inScanTransit()) this.tickTransitBar();
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

  setPendingResume(on: boolean) {
    this.pendingResume = on;
    this.paintFirstContact();
  }

  setResults(results: ScanResultEntry[]) {
    this.results = results;
    this.paintScanList();
  }

  setNavigation(nav: ShipNavigation) {
    this.navigation = nav;
    if (nav.transit) {
      this.transitEndsAt = nav.transit.endsAt;
      this.transitMode = nav.transit.mode;
      this.selection = nav.transit.scanId;
      this.mode = nav.transit.mode;
      this.tickTransitBar();
    } else {
      this.transitEndsAt = 0;
      this.transitMode = null;
      cancelAnimationFrame(this.raf);
      if (nav.firstContactCourse) {
        this.selection = FIRST_CONTACT_DESTINATION_ID;
        this.mode = nav.cruiseMode;
      }
    }
    this.paintFirstContact();
    this.paintScanList();
    this.paintStatus();
    this.paintModes();
    this.paintEta();
    this.paintActions();
  }

  beginTransit(endsAt: number, mode: WarpMode) {
    this.pending = false;
    this.transitEndsAt = endsAt;
    this.transitMode = mode;
    this.mode = mode;
    this.tickTransitBar();
    this.paintFirstContact();
    this.paintStatus();
    this.paintActions();
  }

  endTransit(results: ScanResultEntry[]) {
    this.results = results;
    this.transitEndsAt = 0;
    this.transitMode = null;
    this.selection = FIRST_CONTACT_DESTINATION_ID;
    cancelAnimationFrame(this.raf);
    this.paintFirstContact();
    this.paintScanList();
    this.paintStatus();
    this.paintActions();
  }

  private inScanTransit() {
    return this.transitEndsAt > Date.now();
  }

  private onCourse() {
    return this.navigation.firstContactCourse && !this.navigation.transit;
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
    if (t.closest('.helm-resume') && !this.inScanTransit()) {
      this.tryResume();
      return;
    }
    if (t.closest('[data-select-first-contact]') && !this.inScanTransit()) {
      this.selection = FIRST_CONTACT_DESTINATION_ID;
      this.paintFirstContact();
      this.paintScanList();
      this.paintEta();
      this.paintActions();
      this.paintModes();
      return;
    }
    const row = t.closest('[data-scan-id]') as HTMLElement | null;
    if (row && !this.inScanTransit()) {
      this.selection = row.dataset.scanId ?? this.selection;
      this.paintFirstContact();
      this.paintScanList();
      this.paintEta();
      this.paintActions();
      this.paintModes();
      return;
    }
    const modeBtn = t.closest('[data-warp-mode]') as HTMLElement | null;
    if (modeBtn && !this.inScanTransit() && this.handlers.isCaptain()) {
      const m = modeBtn.dataset.warpMode;
      if (m === 'warp' || m === 'f-warp') {
        this.mode = m;
        if (this.onCourse()) this.handlers.onCruiseMode(m);
        this.paintModes();
        this.paintEta();
      }
      return;
    }
    if (t.closest('.helm-start')) this.tryStart();
  }

  private tryResume() {
    if (!this.handlers.isCaptain() || this.pendingResume || this.inScanTransit()) return;
    this.handlers.onResume();
  }

  private tryStart() {
    if (!this.handlers.isCaptain() || this.pending || this.inScanTransit()) return;
    if (this.selection === FIRST_CONTACT_DESTINATION_ID) return;
    const entry = this.results.find((r) => r.id === this.selection);
    if (!entry || !distanceNeedsTransit(entry.distanceLabel)) return;
    this.handlers.onStart(this.selection, this.mode);
  }

  private render() {
    this.el.innerHTML = `
      <div class="helm-console-panel">
        <header class="helm-console-head">
          <h2>Helm · Navigation</h2>
          <button type="button" class="helm-close" data-close aria-label="Close">×</button>
        </header>
        <section class="helm-mission" data-select-first-contact role="button" tabindex="0">
          <div class="helm-mission-label">Primary heading</div>
          <div class="helm-mission-title">${esc(FIRST_CONTACT_DISPLAY_NAME)}</div>
          <div class="helm-mission-meta">Distance: ${esc(FIRST_CONTACT_DISTANCE_LABEL)}</div>
          <div class="helm-mission-coords">${esc(FIRST_CONTACT_COORDINATES)}</div>
          <button type="button" class="helm-resume">Resume Heading to First Contact</button>
        </section>
        <div class="helm-divider"><span>Scan contacts</span><small>Temporary diverts · hold at 20 km</small></div>
        <div class="helm-status"></div>
        <div class="helm-list-wrap"><ul class="helm-list helm-scan-list"></ul></div>
        <div class="helm-speed">
          <span class="helm-speed-label">Engine speed</span>
          <div class="helm-modes"></div>
        </div>
        <p class="helm-eta"></p>
        <div class="helm-actions"></div>
      </div>`;
    this.paintFirstContact();
    this.paintScanList();
    this.paintModes();
    this.paintEta();
    this.paintStatus();
    this.paintActions();
  }

  private paintFirstContact() {
    const section = this.el.querySelector('.helm-mission')!;
    const btn = this.el.querySelector('.helm-resume') as HTMLButtonElement;
    const onCourse = this.onCourse();
    section.classList.toggle('on-course', onCourse);
    section.classList.toggle('selected', this.selection === FIRST_CONTACT_DESTINATION_ID);
    const cap = this.handlers.isCaptain();
    const busy = this.inScanTransit() || this.pendingResume;
    btn.disabled = !cap || busy;
    btn.textContent = this.pendingResume
      ? 'Resuming…'
      : onCourse
        ? 'On course to First Contact'
        : 'Resume Heading to First Contact';
  }

  private paintScanList() {
    const ul = this.el.querySelector('.helm-scan-list')!;
    if (!this.results.length) {
      ul.innerHTML = '<li class="helm-empty">No scan contacts yet. Run a sensor scan first.</li>';
      return;
    }
    ul.innerHTML = this.results
      .map((r) => {
        const sel = r.id === this.selection;
        const transit = distanceNeedsTransit(r.distanceLabel);
        return `<li class="helm-row helm-row-scan${sel ? ' selected' : ''}" data-scan-id="${esc(r.id)}" role="button" tabindex="0">
          <span class="helm-row-title">${esc(scanFindTitle(r))}</span>
          <span class="helm-row-dist">${esc(r.distanceLabel)}</span>
          ${transit ? '<span class="helm-row-tag">Divert</span>' : '<span class="helm-row-near">In range</span>'}
        </li>`;
      })
      .join('');
  }

  private paintModes() {
    const box = this.el.querySelector('.helm-modes')!;
    const cap = this.handlers.isCaptain();
    const disabled = !cap || this.inScanTransit();
    const modes: { id: WarpMode; label: string; hint: string }[] = [
      { id: 'warp', label: 'Warp', hint: '2 min / LY' },
      { id: 'f-warp', label: 'F-Warp', hint: '30 s / LY' },
    ];
    const activeMode = this.onCourse() ? this.navigation.cruiseMode : this.mode;
    box.innerHTML =
      modes
        .map(
          (m) =>
            `<button type="button" class="helm-mode${activeMode === m.id ? ' on' : ''}" data-warp-mode="${m.id}" ${disabled ? 'disabled' : ''}>
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
    if (this.onCourse()) {
      p.textContent = `Open voyage toward ${FIRST_CONTACT_DISPLAY_NAME} at ${this.navigation.cruiseMode === 'f-warp' ? 'F-Warp' : 'Warp'}.`;
      return;
    }
    if (this.selection === FIRST_CONTACT_DESTINATION_ID) {
      p.textContent = 'Resume sets course and Warp. Use F-Warp above for a faster main leg.';
      return;
    }
    const entry = this.results.find((r) => r.id === this.selection);
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
    p.textContent = `Divert ETA: ${formatEta(ms)} at ${this.mode === 'f-warp' ? 'F-Warp' : 'Warp'}`;
  }

  private paintStatus() {
    const box = this.el.querySelector('.helm-status')!;
    if (this.inScanTransit()) {
      box.innerHTML = `<div class="helm-transit">Divert in progress · ${this.transitMode === 'f-warp' ? 'F-Warp' : 'Warp'}</div><div class="helm-bar"><div class="helm-bar-fill"></div></div>`;
      return;
    }
    if (this.onCourse()) {
      box.innerHTML = '<div class="helm-hint helm-hint-course">Underway toward First Contact. Scan diverts pause this course.</div>';
      return;
    }
    box.innerHTML = this.handlers.isCaptain()
      ? '<div class="helm-hint">Captain: resume the main voyage or divert to a scan contact.</div>'
      : '<div class="helm-hint">View only — only the Captain can command the helm.</div>';
  }

  private paintActions() {
    const box = this.el.querySelector('.helm-actions')!;
    if (this.selection === FIRST_CONTACT_DESTINATION_ID) {
      box.innerHTML = '';
      return;
    }
    const entry = this.results.find((r) => r.id === this.selection);
    const can =
      this.handlers.isCaptain() &&
      !this.pending &&
      !this.inScanTransit() &&
      entry &&
      distanceNeedsTransit(entry.distanceLabel);
    box.innerHTML = `<button type="button" class="helm-start" ${can ? '' : 'disabled'}>${this.pending ? 'Starting…' : 'Start divert'}</button>`;
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
