import { recipeText, SHIP_MATERIALS } from '../../shared/items';

const ui = document.getElementById('ui')!;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface PrinterStationHandlers {
  onPrint(materialId: string): void;
  onClose(): void;
}

export interface PrinterStocksView {
  refined: Record<string, number>;
  cargo: Record<string, number>;
}

export class PrinterStationOverlay {
  readonly el = document.createElement('div');
  private stocks: PrinterStocksView;
  private statusMessage: string | null = null;

  constructor(stocks: PrinterStocksView, private handlers: PrinterStationHandlers) {
    this.stocks = stocks;
    this.el.className = 'scan-station-overlay printer-station-overlay';
    this.render();
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-print]');
      if (btn?.dataset.print) this.handlers.onPrint(btn.dataset.print);
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  get isOpen() {
    return this.el.isConnected;
  }

  setStocks(stocks: PrinterStocksView) {
    this.stocks = stocks;
    this.paintBody();
  }

  showMessage(message: string) {
    this.statusMessage = message;
    this.paintStatus();
  }

  private canPrint(m: (typeof SHIP_MATERIALS)[number]): boolean {
    if (!m.recipe?.length) return false;
    for (const need of m.recipe) {
      if ((this.stocks.refined[need.of] ?? 0) < need.qty) return false;
    }
    return true;
  }

  close() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.handlers.onClose();
  }

  private render() {
    this.el.innerHTML = `<div class="scan-station panel">
      <div class="scan-station-head">
        <div><div class="kicker">Printer control panel</div><div class="muted">Uses refined stock · output goes to Cargo Hold</div></div>
        <button type="button" class="btn small ghost" data-close>Close <kbd>Esc</kbd></button>
      </div>
      <div data-body class="printer-list"></div>
      <div data-status class="scan-status"></div>
    </div>`;
    this.paintBody();
    this.paintStatus();
  }

  private paintBody() {
    const body = this.el.querySelector('[data-body]');
    if (!body) return;
    body.innerHTML = SHIP_MATERIALS
      .map((m) => {
        const cargo = this.stocks.cargo[m.id] ?? 0;
        const ok = this.canPrint(m);
        return `<div class="printer-row">
          <div class="who"><b>${esc(m.name)}</b> <span class="muted">Cargo: ${cargo}</span></div>
          <div class="recipe muted">${esc(recipeText(m))}</div>
          <button type="button" class="btn small" data-print="${esc(m.id)}" ${ok ? '' : 'disabled'}>Print 1</button>
        </div>`;
      })
      .join('');
  }

  private paintStatus() {
    const el = this.el.querySelector('[data-status]');
    if (el) el.textContent = this.statusMessage ?? '';
  }
}
