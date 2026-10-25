import { materialName } from '../../shared/items';
import { scanFindTitle, type ScanResultEntry } from '../../shared/scanning';
import {
  TRANSPORTER_DURATION_MS,
  TRANSPORTER_POSITIVES_FOR_LEVEL,
  beamableLootForPad,
  formatLootSummary,
  type TransporterPadId,
  type TransporterSkill,
  type TransporterStation,
} from '../../shared/transporter';

const ui = document.getElementById('ui')!;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface TransporterStartPayload {
  scanId: string;
  materialId: string;
  qty: number;
}

export interface TransporterStationHandlers {
  onStart(payload: TransporterStartPayload): void;
  onClose(): void;
}

/**
 * Science Lab / Cargo Bay transporter pad UI: pick a scan contact and material, then beam aboard.
 */
export class TransporterStationOverlay {
  readonly el = document.createElement('div');
  private skill: TransporterSkill;
  private results: ScanResultEntry[];
  private beaming = false;
  private pendingStart = false;
  private endsAt = 0;
  private raf = 0;
  private scanId: string | null = null;
  private materialId: string | null = null;
  private qty = 1;
  private statusMessage: string | null = null;

  constructor(
    private pad: TransporterStation,
    skill: TransporterSkill,
    results: ScanResultEntry[],
    private handlers: TransporterStationHandlers,
  ) {
    this.skill = skill;
    this.results = results;
    this.el.className = 'scan-station-overlay transporter-station-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
      if ((e.target as HTMLElement).closest('.transport-start')) this.tryStart();
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-scan-id]');
      if (row?.dataset.scanId) {
        this.scanId = row.dataset.scanId;
        this.materialId = row.dataset.materialId ?? null;
        this.qty = 1;
        this.paintBody();
      }
      const matBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-material-id]');
      if (matBtn?.dataset.materialId && this.scanId) {
        this.materialId = matBtn.dataset.materialId;
        this.paintBody();
      }
      const qtyBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-qty]');
      if (qtyBtn?.dataset.qty && this.scanId && this.materialId) {
        this.qty = Math.max(1, Number(qtyBtn.dataset.qty));
        this.paintBody();
      }
    });
    window.addEventListener('keydown', this.onKey);
  }

  get padId(): TransporterPadId {
    return this.pad.interactId;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  get isOpen() {
    return this.el.isConnected;
  }

  setPendingStart(on: boolean) {
    this.pendingStart = on;
    this.syncStartButton();
  }

  updateSkill(skill: TransporterSkill) {
    this.skill = skill;
    this.paintSkill();
  }

  setResults(results: ScanResultEntry[]) {
    this.results = results;
    if (this.scanId && !results.some((r) => r.id === this.scanId)) {
      this.scanId = null;
      this.materialId = null;
    }
    this.paintBody();
  }

  showMessage(message: string) {
    this.statusMessage = message;
    this.paintStatus();
  }

  /** Skill miss or other start failure: unlock Start and keep the message in the dialog. */
  failStart(message: string) {
    this.pendingStart = false;
    this.beaming = false;
    cancelAnimationFrame(this.raf);
    this.statusMessage = message;
    this.syncStartButton();
    this.paintStatus();
  }

  beginBeam(endsAt: number) {
    this.pendingStart = false;
    this.beaming = true;
    this.endsAt = endsAt;
    this.statusMessage = null;
    this.paintBeaming();
    this.tickBar();
  }

  showComplete(ok: boolean, message: string | undefined, skill: TransporterSkill, results: ScanResultEntry[]) {
    this.pendingStart = false;
    this.beaming = false;
    this.skill = skill;
    this.results = results;
    cancelAnimationFrame(this.raf);
    this.statusMessage = message ?? (ok ? 'Beam complete.' : 'Beam failed.');
    this.paintIdle();
    this.paintStatus();
  }

  private maxQty(): number {
    if (!this.scanId || !this.materialId) return 0;
    const entry = this.results.find((r) => r.id === this.scanId);
    if (!entry) return 0;
    const line = beamableLootForPad(this.pad, entry).find((l) => l.materialId === this.materialId);
    return line?.remaining ?? 0;
  }

  private canStart(): boolean {
    return !this.beaming && !this.pendingStart && this.maxQty() > 0 && this.qty > 0;
  }

  private tryStart() {
    if (!this.canStart() || !this.scanId || !this.materialId) return;
    this.statusMessage = null;
    this.paintStatus();
    this.handlers.onStart({ scanId: this.scanId, materialId: this.materialId, qty: this.qty });
  }

  private syncStartButton() {
    const btn = this.el.querySelector<HTMLButtonElement>('.transport-start');
    if (!btn) return;
    btn.disabled = !this.canStart();
    if (this.beaming) btn.textContent = 'Beaming…';
    else if (this.pendingStart) btn.textContent = 'Starting…';
    else btn.textContent = 'Start Beam In Process';
  }

  private tickBar() {
    cancelAnimationFrame(this.raf);
    const bar = this.el.querySelector<HTMLElement>('.scan-bar i');
    const status = this.el.querySelector<HTMLElement>('.scan-status');
    if (!bar || !status) return;
    const loop = () => {
      const now = Date.now();
      const frac = Math.min(1, Math.max(0, (now - (this.endsAt - TRANSPORTER_DURATION_MS)) / TRANSPORTER_DURATION_MS));
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      status.textContent = frac >= 1 ? 'Locking coordinates…' : 'Beam in Progress';
      if (this.beaming && now < this.endsAt + 400) this.raf = requestAnimationFrame(loop);
      else if (this.beaming) bar.style.width = '100%';
    };
    this.raf = requestAnimationFrame(loop);
  }

  private render() {
    this.el.innerHTML = `
      <div class="scan-card panel" role="dialog" aria-label="Transporter">
        <div class="scan-head">
          <div class="scan-title">Transporter · ${esc(this.pad.room)}</div>
          <button type="button" class="scan-close" data-close aria-label="Close">×</button>
        </div>
        <div class="scan-skill transport-skill"></div>
        <div class="transport-body"></div>
        <div class="scan-actions transport-actions"></div>
        <div class="transport-status"></div>
      </div>`;
    this.paintIdle();
  }

  private paintSkill() {
    const el = this.el.querySelector('.transport-skill');
    if (!el) return;
    const { level, positiveBeams } = this.skill;
    el.innerHTML = `
      <div class="scan-level">Transporter level <strong>${level}</strong> / 5</div>
      <div class="scan-progress-label">Successful beams toward next level: <strong>${positiveBeams}</strong> / ${TRANSPORTER_POSITIVES_FOR_LEVEL}</div>`;
  }

  private paintStatus() {
    const el = this.el.querySelector('.transport-status');
    if (!el) return;
    el.innerHTML = this.statusMessage
      ? `<div class="transport-feedback miss" role="status">${esc(this.statusMessage)}</div>`
      : '';
  }

  private paintBody() {
    const body = this.el.querySelector('.transport-body');
    if (!body) return;
    const contacts = [...this.results].reverse().filter((r) => beamableLootForPad(this.pad, r).length > 0);
    if (!contacts.length) {
      body.innerHTML = '<p class="scan-log-empty">No beamable contacts. Run a Bridge scan first.</p>';
      return;
    }
    const list = contacts
      .map((r) => {
        const loot = beamableLootForPad(this.pad, r);
        const selected = r.id === this.scanId;
        const lootHtml = loot
          .map((l) => {
            const on = selected && l.materialId === this.materialId;
            return `<button type="button" class="transport-mat${on ? ' on' : ''}" data-material-id="${esc(l.materialId)}">${esc(materialName(l.materialId))} <span class="n">${l.remaining}</span></button>`;
          })
          .join('');
        return `<div class="transport-contact${selected ? ' on' : ''}" data-scan-id="${esc(r.id)}">
          <div class="transport-contact-head"><strong>${esc(scanFindTitle(r))}</strong> · ${esc(r.distanceLabel)}</div>
          <div class="transport-contact-sub muted">${esc(formatLootSummary(r))}</div>
          <div class="transport-mats">${lootHtml}</div>
        </div>`;
      })
      .join('');
    body.innerHTML = `<div class="transport-contacts">${list}</div>`;
    if (this.scanId && this.materialId) {
      const max = this.maxQty();
      const qtyRow = [1, 2, 3, 4, 5]
        .filter((n) => n <= max)
        .map((n) => `<button type="button" class="transport-qty${n === this.qty ? ' on' : ''}" data-qty="${n}">${n}</button>`)
        .join('');
      body.append(
        Object.assign(document.createElement('div'), {
          className: 'transport-qty-row',
          innerHTML: `<span class="muted">Beam qty:</span> ${qtyRow || '<span class="muted">None left</span>'}`,
        }),
      );
    }
    this.syncStartButton();
  }

  private paintStartShell(extra = '') {
    const actions = this.el.querySelector('.transport-actions');
    if (!actions) return;
    actions.innerHTML = `<button type="button" class="transport-start scan-start primary">Start Beam In Process</button>${extra}`;
    this.syncStartButton();
  }

  private paintIdle() {
    this.paintSkill();
    this.paintBody();
    this.paintStartShell();
  }

  private paintBeaming() {
    this.paintSkill();
    const actions = this.el.querySelector('.transport-actions');
    if (actions) {
      actions.innerHTML = `
        <button type="button" class="transport-start scan-start primary" disabled>Beaming…</button>
        <div class="scan-bar-wrap"><div class="scan-bar"><i></i></div></div>
        <div class="scan-status">Beam in Progress</div>`;
    }
    this.tickBar();
  }

  close() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 200);
    this.handlers.onClose();
  }
}
