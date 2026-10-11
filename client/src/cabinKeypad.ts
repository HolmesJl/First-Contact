import { CABIN_KEYPAD_INTERACT_ID, CABIN_KEYPAD_IN_INTERACT_ID, isCabinKeypadId } from '../../shared/cabinDoor';
import { cabinKeypadUiMode, canChangeCabinCode, type CabinKeypadMode } from '../../shared/cabinDoorUi';
import type { Job } from '../../shared/protocol';
import type { ShipMeta } from '../../shared/protocol';

const ui = document.getElementById('ui')!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

export interface CabinKeypadHandlers {
  onSubmitSet(code: string, confirm: string): void;
  onSubmitEnter(code: string): void;
  onSubmitChange(current: string, code: string, confirm: string): void;
  onClose(): void;
}

type Mode = CabinKeypadMode;

export class CabinKeypadOverlay {
  readonly el = h('div', 'cabin-keypad-overlay');
  private digits = h('div', 'keypad-digits');
  private message = h('div', 'keypad-message');
  private grid = h('div', 'keypad-grid');
  private title = h('div', 'keypad-title');
  private changeRow = h('div', 'keypad-change-row');
  private changeBtn = h('button', 'keypad-change');
  private mode: Mode = 'enter';
  private buf = '';
  private confirmBuf = '';
  private phase: 'code' | 'confirm' | 'current' = 'code';
  private lockoutUntil = 0;
  private currentCode = '';
  private canChange = false;

  constructor(
    private handlers: CabinKeypadHandlers,
  ) {
    this.changeBtn.type = 'button';
    this.changeBtn.textContent = 'Change code…';
    this.changeBtn.dataset.act = 'change-code';
    this.changeBtn.addEventListener('click', () => this.setMode('change'));
    this.changeRow.append(this.changeBtn);
    this.el.append(this.title, this.digits, this.message, this.grid, this.changeRow);
    ui.append(this.el);
    this.buildGrid();
    window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  /**
   * Same screen on either side of the door: set (Captain, no code yet), enter (anyone, code set) or locked. The
   * Captain can switch an `enter` screen to the change-code flow; it is never the default.
   */
  open(ship: ShipMeta, job: Job | null) {
    this.canChange = canChangeCabinCode(ship.cabinDoor.codeSet, job);
    this.setMode(cabinKeypadUiMode(ship.cabinDoor.codeSet, job));
    this.el.classList.add('show');
  }

  private setMode(mode: Mode) {
    this.mode = mode;
    this.buf = '';
    this.confirmBuf = '';
    this.currentCode = '';
    this.phase = mode === 'change' ? 'current' : 'code';
    this.lockoutUntil = 0;
    this.message.textContent = '';
    this.message.className = 'keypad-message';
    this.el.dataset.mode = mode;
    this.changeRow.hidden = !(mode === 'enter' && this.canChange);
    if (mode === 'locked') {
      this.title.textContent = "Captain's cabin";
      this.message.textContent = 'Locked. The captain has not set a code.';
      this.grid.hidden = true;
      this.digits.hidden = true;
    } else if (mode === 'set') {
      this.title.textContent = 'Set cabin code';
      this.grid.hidden = false;
      this.digits.hidden = false;
    } else if (mode === 'change') {
      this.title.textContent = 'Change cabin code';
      this.grid.hidden = false;
      this.digits.hidden = false;
    } else {
      this.title.textContent = "Captain's cabin";
      this.grid.hidden = false;
      this.digits.hidden = false;
    }
    this.renderDigits();
  }

  showResult(ok: boolean, message?: string, flash?: 'green' | 'red', dismissMs = 1200, lockoutUntil?: number) {
    if (message) {
      this.message.textContent = message;
      this.message.className = `keypad-message ${flash === 'green' ? 'ok' : flash === 'red' ? 'err' : ''}`;
    }
    if (lockoutUntil) this.lockoutUntil = lockoutUntil;
    if (ok) {
      this.el.classList.add(flash === 'green' ? 'flash-green' : '');
      setTimeout(() => {
        this.handlers.onClose();
        this.destroy();
      }, dismissMs);
    } else {
      this.el.classList.add(flash === 'red' ? 'flash-red' : '');
      setTimeout(() => {
        this.el.classList.remove('flash-red');
        this.buf = '';
        this.confirmBuf = '';
        this.phase = this.mode === 'change' ? 'current' : 'code';
        this.renderDigits();
        if (this.lockoutUntil > Date.now()) {
          this.message.textContent = `Locked out — wait ${Math.ceil((this.lockoutUntil - Date.now()) / 1000)}s`;
        } else {
          this.message.textContent = '';
          this.message.className = 'keypad-message';
        }
        this.handlers.onClose();
        this.destroy();
      }, dismissMs);
    }
  }

  private renderDigits() {
    this.renderDigitLine();
  }

  private renderDigitLine() {
    const label =
      this.mode === 'change' && this.phase === 'current'
        ? 'Current code'
        : this.phase === 'confirm'
          ? 'Confirm code'
          : this.mode === 'change' && this.phase === 'code'
            ? 'New code'
            : '';
    const active = this.phase === 'confirm' ? this.confirmBuf : this.buf;
    const dots = '•'.repeat(active.length) + '—'.repeat(Math.max(0, 4 - active.length));
    this.digits.textContent = label ? `${label}: ${dots}` : dots;
  }

  private buildGrid() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'Enter'];
    for (const k of keys) {
      const b = h('button', `keypad-key${k === 'Enter' ? ' enter' : ''}`);
      b.type = 'button';
      b.textContent = k;
      b.addEventListener('click', () => this.press(k));
      this.grid.append(b);
    }
  }

  private press(k: string) {
    if (this.lockoutUntil > Date.now()) return;
    if (k === '⌫') {
      if (this.phase === 'confirm') this.confirmBuf = this.confirmBuf.slice(0, -1);
      else this.buf = this.buf.slice(0, -1);
      this.renderDigits();
      return;
    }
    if (k === 'Enter') return this.submit();
    if (!/^\d$/.test(k)) return;
    const target = this.phase === 'confirm' ? 'confirm' : 'code';
    if (target === 'confirm') {
      if (this.confirmBuf.length >= 4) return;
      this.confirmBuf += k;
    } else {
      if (this.buf.length >= 4) return;
      this.buf += k;
    }
    this.renderDigits();
    if (this.mode === 'set' && this.buf.length === 4 && this.phase === 'code') {
      this.phase = 'confirm';
      this.renderDigits();
      return;
    }
    if ((target === 'confirm' ? this.confirmBuf : this.buf).length === 4 && this.mode === 'enter') {
      setTimeout(() => this.submit(), 80);
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.el.classList.contains('show')) return;
    if (e.key === 'Escape') {
      this.handlers.onClose();
      this.destroy();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      this.press('⌫');
      return;
    }
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      this.press(e.key);
    }
  };

  private submit() {
    if (this.lockoutUntil > Date.now()) return;
    if (this.mode === 'set') {
      if (this.phase === 'code') {
        if (this.buf.length !== 4) return;
        this.phase = 'confirm';
        this.renderDigits();
        return;
      }
      if (this.confirmBuf.length !== 4) return;
      this.handlers.onSubmitSet(this.buf, this.confirmBuf);
      return;
    }
    if (this.mode === 'change') {
      if (this.phase === 'current') {
        if (this.buf.length !== 4) return;
        this.currentCode = this.buf;
        this.buf = '';
        this.phase = 'code';
        this.renderDigits();
        return;
      }
      if (this.phase === 'code') {
        if (this.buf.length !== 4) return;
        this.phase = 'confirm';
        this.renderDigits();
        return;
      }
      if (this.confirmBuf.length !== 4) return;
      this.handlers.onSubmitChange(this.currentCode, this.buf, this.confirmBuf);
      return;
    }
    if (this.buf.length !== 4) return;
    this.handlers.onSubmitEnter(this.buf);
  }
}

export { CABIN_KEYPAD_INTERACT_ID, CABIN_KEYPAD_IN_INTERACT_ID, isCabinKeypadId };
