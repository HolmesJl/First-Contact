import { materialName, UNREFINED_MATERIALS, REFINED_MATERIALS } from '../../shared/items';
import {
  ENGINEER_POSITIVES_FOR_LEVEL,
  REFINE_DURATION_MS,
  type EngineerSkill,
} from '../../shared/refining';
import { REFINERY_CAPACITY, refineryTotalUnits } from '../../shared/transporter';

const ui = document.getElementById('ui')!;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RefineryStationHandlers {
  onRefine(materialId: string, mode: 'one' | 'all'): void;
  onCancel(): void;
  onClose(): void;
}

export interface RefineryStocksView {
  unrefined: Record<string, number>;
  refined: Record<string, number>;
}

export class RefineryStationOverlay {
  readonly el = document.createElement('div');
  private skill: EngineerSkill;
  private stocks: RefineryStocksView;
  private selected: string | null = null;
  private refining = false;
  private pending = false;
  private endsAt = 0;
  private raf = 0;
  private statusMessage: string | null = null;

  constructor(
    skill: EngineerSkill,
    stocks: RefineryStocksView,
    private handlers: RefineryStationHandlers,
  ) {
    this.skill = skill;
    this.stocks = stocks;
    this.el.className = 'scan-station-overlay refinery-station-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-unrefined]');
      if (row?.dataset.unrefined) {
        this.selected = row.dataset.unrefined;
        this.paintBody();
        this.paintActions();
      }
      if ((e.target as HTMLElement).closest('.refine-one')) this.tryStart('one');
      if ((e.target as HTMLElement).closest('.refine-all')) this.tryStart('all');
      if ((e.target as HTMLElement).closest('.refine-cancel')) this.cancelJob();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  get isOpen() {
    return this.el.isConnected;
  }

  setPending(on: boolean) {
    this.pending = on;
    this.paintActions();
  }

  updateSkill(skill: EngineerSkill) {
    this.skill = skill;
    this.paintSkill();
  }

  setStocks(stocks: RefineryStocksView) {
    this.stocks = stocks;
    this.paintBody();
    this.paintActions();
  }

  beginRefine(endsAt: number) {
    this.pending = false;
    this.refining = true;
    this.endsAt = endsAt;
    this.paintProgress();
    this.tickBar();
  }

  showComplete(
    hit: boolean,
    message: string | undefined,
    skill: EngineerSkill,
    stocks: RefineryStocksView,
    continued?: boolean,
    endsAt?: number,
  ) {
    this.skill = skill;
    this.stocks = stocks;
    this.statusMessage = message ?? (hit ? 'Refined.' : 'Skill check missed.');
    if (continued && endsAt) {
      this.refining = true;
      this.endsAt = endsAt;
      this.tickBar();
    } else {
      this.refining = false;
      cancelAnimationFrame(this.raf);
    }
    this.paintAll();
  }

  failStart(message: string) {
    this.pending = false;
    this.statusMessage = message;
    this.paintStatus();
  }

  private cancelJob() {
    if (!this.refining) return;
    this.handlers.onCancel();
    this.refining = false;
    this.pending = false;
    cancelAnimationFrame(this.raf);
    this.statusMessage = 'Cancelled.';
    this.paintAll();
  }

  private tryStart(mode: 'one' | 'all') {
    if (this.refining || this.pending || !this.selected) return;
    const qty = this.stocks.unrefined[this.selected] ?? 0;
    if (qty <= 0) return;
    this.handlers.onRefine(this.selected, mode);
  }

  close() {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
    this.el.remove();
    this.handlers.onClose();
  }

  private tickBar() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.paintProgress();
      if (this.refining) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private paintAll() {
    this.paintSkill();
    this.paintBody();
    this.paintProgress();
    this.paintStatus();
    this.paintActions();
  }

  private render() {
    this.el.innerHTML = `<div class="scan-card panel refinery-panel" role="dialog" aria-label="Refining control panel">
      <div class="scan-head">
        <div class="scan-title">Refining control panel</div>
        <button type="button" class="scan-close" data-close aria-label="Close">×</button>
      </div>
      <div class="scan-skill" data-skill></div>
      <div data-cap class="refinery-cap muted"></div>
      <div class="refinery-columns" data-body></div>
      <div data-progress class="scan-progress" hidden></div>
      <div data-status class="scan-status refinery-status"></div>
      <div data-actions class="refinery-actions scan-actions"></div>
    </div>`;
    this.paintAll();
  }

  private paintSkill() {
    const el = this.el.querySelector('[data-skill]');
    if (!el) return;
    const s = this.skill;
    el.innerHTML = `Engineer skill · Lv ${s.level} · ${s.positiveRefines}/${ENGINEER_POSITIVES_FOR_LEVEL} refines`;
  }

  private paintBody() {
    const cap = this.el.querySelector('[data-cap]');
    const body = this.el.querySelector('[data-body]');
    if (!cap || !body) return;
    const used = refineryTotalUnits(this.stocks.unrefined, this.stocks.refined);
    cap.textContent = `Storage: ${used} / ${REFINERY_CAPACITY} units (unrefined + refined)`;
    const unrefRows = UNREFINED_MATERIALS.filter((m) => m.id !== 'seeds')
      .map((m) => {
        const n = this.stocks.unrefined[m.id] ?? 0;
        const on = this.selected === m.id;
        return `<button type="button" class="refinery-row${on ? ' on' : ''}" data-unrefined="${esc(m.id)}">${esc(m.name)} <span class="n">${n}</span></button>`;
      })
      .join('');
    const refRows = REFINED_MATERIALS
      .map((m) => {
        const n = this.stocks.refined[m.id] ?? 0;
        return `<div class="refinery-row read-only">${esc(m.name)} <span class="n">${n}</span></div>`;
      })
      .join('');
    body.innerHTML = `<section><div class="label">Unrefined</div>${unrefRows || '<p class="muted">Empty</p>'}</section>
      <section><div class="label">Refined</div>${refRows}</section>`;
  }

  private paintProgress() {
    const el = this.el.querySelector('[data-progress]') as HTMLElement | null;
    if (!el) return;
    if (!this.refining) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const t = Math.max(0, Math.min(1, 1 - (this.endsAt - Date.now()) / REFINE_DURATION_MS));
    el.innerHTML = `<div class="scan-progress-label">Refining in progress…</div>
      <div class="scan-progress-track"><div class="scan-progress-fill" style="width:${(t * 100).toFixed(1)}%"></div></div>`;
  }

  private paintStatus() {
    const el = this.el.querySelector('[data-status]');
    if (el) el.textContent = this.statusMessage ?? '';
  }

  private paintActions() {
    const el = this.el.querySelector('[data-actions]');
    if (!el) return;
    const sel = this.selected;
    const qty = sel ? this.stocks.unrefined[sel] ?? 0 : 0;
    const disabled = this.refining || this.pending || !sel || qty <= 0;
    el.innerHTML = `<button type="button" class="btn refine-one" ${disabled ? 'disabled' : ''}>Refine 1</button>
      <button type="button" class="btn refine-all" ${disabled ? 'disabled' : ''}>Refine all</button>
      ${this.refining ? '<button type="button" class="btn ghost refine-cancel">Cancel</button>' : ''}`;
  }
}
