import {
  CARRY_SLOTS,
  CLOSET_SLOTS,
  EQUIP_SLOT_LABEL,
  EQUIP_SLOT_ORDER,
  ITEMS,
  RAW_MATERIALS,
  SHIP_MATERIALS,
  deleteBlock,
  emptySlots,
  putBackPanelFor,
  recipeText,
  stackName,
  startingInventory,
  totalAc,
  type Inventory,
  type ItemGlyph,
  type ItemStack,
  type SlotRef,
  type Slots,
  type StockPanel,
} from '../../shared/items';
import { inRange } from '../../shared/opening';
import type { InventoryAction } from '../../shared/protocol';

const ui = document.getElementById('ui')!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const GLYPHS: Record<ItemGlyph, string> = {
  suit: '🧥',
  vest: '🦺',
  file: '📄',
  apple: '🍎',
  leaf: '🥬',
  protein: '🧆',
  cup: '🥤',
  bottle: '🍺',
  glass: '🍸',
};

export interface InventoryHandlers {
  /** Send an inventory action to the server (the app adds the player's position). */
  send(action: InventoryAction): void;
  playerPos(): { x: number; z: number } | null;
  /** The modal is taking the mouse: the game should drop any drag or held keys so nothing is left stuck. */
  onOpen?(): void;
  onClose?(): void;
}

const sameRef = (a: SlotRef, b: SlotRef) => a.c === b.c && a.i === b.i;

/**
 * The personal inventory modal (`I`): six carry slots, the equipped list with armor class, and beside it either the
 * player's closet or the stock panel they clicked. Left click lifts a stack onto the cursor and drops it on the next
 * slot clicked; Ctrl+click lifts one; right click uses, wears, or opens a File. Delete and Put back act on the lifted
 * stack. Nothing changes locally until the server echoes the new inventory.
 */
export class InventoryOverlay {
  readonly el = h('div', 'inv-overlay');
  private win = h('div', 'inv-window panel');
  private carryGrid = h('div', 'inv-grid carry');
  private equippedList = h('ul', 'inv-equipped');
  private carryCount = h('span', 'inv-count');
  private acLine = h('span', 'inv-count');
  private deleteBtn = h('button', 'btn small danger');
  private putBackBtn = h('button', 'btn small');
  private cursorHint = h('div', 'inv-cursor-hint');
  private side = h('section', 'inv-side');
  private viewer = h('div', 'inv-viewer panel');
  private ghost = h('div', 'inv-ghost');

  private inv: Inventory = startingInventory();
  private closet: Slots = emptySlots(CLOSET_SLOTS);
  private stock: Record<string, number> = {};
  private closetBerth: number | null = null;
  private panel: StockPanel | null = null;
  private cursor: { loc: SlotRef; qty: number } | null = null;
  private rangeTimer = 0;
  private shown = false;

  constructor(private handlers: InventoryHandlers) {
    this.deleteBtn.type = 'button';
    this.deleteBtn.textContent = 'Delete';
    this.deleteBtn.title = 'Destroy the lifted stack (works anywhere)';
    this.putBackBtn.type = 'button';
    this.putBackBtn.textContent = 'Put back';
    this.deleteBtn.addEventListener('click', () => this.deleteCursor());
    this.putBackBtn.addEventListener('click', () => this.putBackCursor());

    const head = h(
      'div',
      'inv-head',
      `<div><div class="kicker">Personal inventory</div><div class="inv-hint"><kbd>Click</kbd> lift / place · <kbd>Ctrl</kbd>+<kbd>Click</kbd> one · <kbd>Right click</kbd> use / wear / open</div></div>`,
    );
    const close = h('button', 'btn small ghost', 'Close <kbd>I</kbd>');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    head.append(close);

    const carry = h('section', 'inv-carry');
    const carryHead = h('div', 'inv-section-head', `<span class="label">Carried</span>`);
    carryHead.append(this.carryCount);
    const eqHead = h('div', 'inv-section-head', `<span class="label">Equipped</span>`);
    eqHead.append(this.acLine);
    const actions = h('div', 'inv-actions');
    actions.append(this.deleteBtn, this.putBackBtn, this.cursorHint);
    carry.append(carryHead, this.carryGrid, eqHead, this.equippedList, actions);

    const body = h('div', 'inv-body');
    body.append(carry, this.side);
    this.win.append(head, body, this.viewer);
    this.viewer.hidden = true;
    this.el.append(this.win, this.ghost);
    this.ghost.hidden = true;

    this.bindGrid(this.carryGrid);
    this.el.addEventListener('pointermove', (e) => {
      this.ghost.style.left = `${e.clientX + 14}px`;
      this.ghost.style.top = `${e.clientY + 10}px`;
    });
    // Clicking the dim backdrop drops nothing and closes nothing; right click there is swallowed so no browser menu.
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.equippedList.addEventListener('contextmenu', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-slot]');
      if (!li) return;
      e.preventDefault();
      this.unequip(li.dataset.slot as 'suit' | 'armor');
    });
    this.equippedList.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-unequip]');
      if (b) this.unequip(b.dataset.unequip as 'suit' | 'armor');
    });
    ui.append(this.el);
    window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    clearInterval(this.rangeTimer);
    this.el.remove();
  }

  get isOpen() {
    return this.shown;
  }

  /** Show the modal. Pass a closet berth or a stock panel to open it beside the carry slots. */
  open(side: { closet?: number | null; panel?: StockPanel | null } = {}) {
    if ('closet' in side) {
      this.closetBerth = side.closet ?? null;
      if (this.closetBerth !== null) this.panel = null;
    }
    if ('panel' in side) {
      this.panel = side.panel ?? null;
      if (this.panel) this.closetBerth = null;
    }
    if (!this.shown) this.handlers.onOpen?.();
    this.shown = true;
    this.el.classList.add('show');
    this.render();
    clearInterval(this.rangeTimer);
    this.rangeTimer = window.setInterval(() => this.renderActions(), 400);
  }

  close() {
    if (!this.shown) return;
    this.shown = false;
    this.cursor = null;
    this.closetBerth = null;
    this.panel = null;
    this.viewer.hidden = true;
    this.el.classList.remove('show');
    clearInterval(this.rangeTimer);
    this.handlers.onClose?.();
  }

  setInventory(inv: Inventory) {
    this.inv = inv;
    if (this.shown) this.render();
  }

  setCloset(slots: Slots) {
    this.closet = slots;
    if (this.shown) this.render();
  }

  setStock(stock: Record<string, number>) {
    this.stock = stock;
    if (this.shown) this.render();
  }

  // ---------------------------------------------------------------- rendering

  private stackAt(ref: SlotRef): ItemStack | null {
    return (ref.c === 'carry' ? this.inv.carry : this.closet)[ref.i] ?? null;
  }

  private render() {
    // A lifted stack that vanished or shrank below the lifted count (server echo) drops the cursor.
    if (this.cursor) {
      const s = this.stackAt(this.cursor.loc);
      if (!s || s.qty < this.cursor.qty) this.cursor = null;
    }
    this.renderGrid(this.carryGrid, this.inv.carry, 'carry');
    const carried = this.inv.carry.filter(Boolean).length;
    this.carryCount.textContent = `${carried} / ${CARRY_SLOTS}`;
    this.renderEquipped();
    this.renderSide();
    this.renderActions();
    this.renderGhost();
  }

  private renderGrid(grid: HTMLElement, slots: Slots, c: SlotRef['c']) {
    const n = c === 'carry' ? CARRY_SLOTS : CLOSET_SLOTS;
    if (grid.childElementCount !== n) {
      grid.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const b = h('button', 'inv-slot');
        b.type = 'button';
        b.dataset.c = c;
        b.dataset.i = String(i);
        grid.append(b);
      }
    }
    for (let i = 0; i < n; i++) {
      const b = grid.children[i] as HTMLButtonElement;
      const s = slots[i];
      const lifted = !!this.cursor && sameRef(this.cursor.loc, { c, i });
      b.classList.toggle('filled', !!s);
      b.classList.toggle('lifted', lifted);
      if (!s) {
        b.innerHTML = '';
        b.title = 'Empty slot';
        continue;
      }
      const def = ITEMS[s.item];
      const shownQty = lifted ? s.qty - this.cursor!.qty : s.qty;
      b.innerHTML = `<span class="glyph">${GLYPHS[def.glyph]}</span>${shownQty > 1 ? `<span class="qty">${shownQty}</span>` : ''}${s.name ? `<span class="tag">${esc(s.name)}</span>` : ''}`;
      const uses = s.usesLeft !== undefined ? ` · ${s.usesLeft} uses left` : '';
      b.title = `${stackName(s)}${s.qty > 1 ? ` × ${s.qty}` : ''}${uses}\n${def.blurb}`;
    }
  }

  private renderEquipped() {
    const rows: string[] = [];
    for (const slot of EQUIP_SLOT_ORDER) {
      const s = this.inv.equipped[slot];
      if (!s) continue;
      const def = ITEMS[s.item];
      const ac = def.ac ? `<span class="ac">AC ${def.ac}</span>` : '';
      const off = slot === 'suit' ? '' : `<button type="button" class="btn small ghost" data-unequip="${slot}" title="Take off (right click also works)">Take off</button>`;
      rows.push(
        `<li data-slot="${slot}"><span class="glyph">${GLYPHS[def.glyph]}</span><span class="who"><b>${esc(def.name)}</b><span class="muted"> · ${esc(EQUIP_SLOT_LABEL[slot])}</span></span>${ac}${off}</li>`,
      );
    }
    this.equippedList.innerHTML = rows.join('');
    this.acLine.textContent = `AC ${totalAc(this.inv.equipped)}`;
  }

  private renderSide() {
    this.side.innerHTML = '';
    this.side.hidden = this.closetBerth === null && !this.panel;
    if (this.closetBerth !== null) {
      const label = this.closetBerth === 0 ? "Captain's trunk" : `Closet ${this.closetBerth}`;
      const used = this.closet.filter(Boolean).length;
      this.side.append(h('div', 'inv-section-head', `<span class="label">${esc(label)}</span><span class="inv-count">${used} / ${CLOSET_SLOTS}</span>`));
      const grid = h('div', 'inv-grid closet');
      this.bindGrid(grid);
      this.renderGrid(grid, this.closet, 'closet');
      this.side.append(grid, h('div', 'inv-note muted', 'Kept through a recloning. Move stacks between here and your carry slots.'));
      return;
    }
    const p = this.panel;
    if (!p) return;
    this.side.append(h('div', 'inv-section-head', `<span class="label">${esc(p.title)}</span><span class="inv-count">${esc(p.room)}</span>`));
    if (p.kind === 'eatery' || p.kind === 'shelves') {
      const list = h('div', 'inv-stock');
      for (const id of p.takes) {
        const def = ITEMS[id];
        const n = this.stock[id] ?? 0;
        const b = h('button', `inv-row${n <= 0 ? ' out' : ''}`);
        b.type = 'button';
        b.dataset.item = id;
        b.disabled = n <= 0;
        b.title = n <= 0 ? `${def.name}: out of stock` : `Take one ${def.name}`;
        b.innerHTML = `<span class="glyph">${GLYPHS[def.glyph]}</span><span class="who">${esc(def.name)}</span><span class="n">${n}</span>`;
        b.addEventListener('click', () => this.handlers.send({ k: 'take', station: p.interactId, item: id }));
        list.append(b);
      }
      this.side.append(list);
      this.side.append(
        h(
          'div',
          'inv-note muted',
          p.kind === 'eatery'
            ? 'Click a row to take one. Lift Fruit onto the cursor and press Put back to return it here.'
            : 'Click to take a set. Lift armor onto the cursor and press Put back to return it to the shelves.',
        ),
      );
      return;
    }
    const mats = p.kind === 'printer' ? SHIP_MATERIALS : RAW_MATERIALS;
    const list = h('ul', 'inv-materials');
    for (const m of mats) {
      const recipe = m.recipe ? `<span class="recipe muted">${esc(recipeText(m))}</span>` : '';
      list.append(h('li', '', `<span class="who">${esc(m.name)}</span>${recipe}<span class="n">${this.stock[m.id] ?? 0}</span>`));
    }
    this.side.append(list, h('div', 'inv-note muted', p.kind === 'printer' ? 'Ship Materials on hand and what the printer needs to make more. View only for now.' : 'Raw Materials on hand. View only for now.'));
  }

  private renderActions() {
    const s = this.cursor ? this.stackAt(this.cursor.loc) : null;
    const noDelete = s ? deleteBlock(s) : null;
    this.deleteBtn.disabled = !s || !!noDelete;
    this.deleteBtn.title = noDelete ?? 'Destroy the lifted stack (works anywhere)';
    let canPutBack = false;
    let putTitle = 'Lift a stack to put it back where it came from';
    if (s) {
      const panel = putBackPanelFor(s);
      const pos = this.handlers.playerPos();
      if (!panel) putTitle = `${stackName(s)} has nowhere to go back to`;
      else if (!pos || !inRange(pos.x, pos.z, panel.stand.x, panel.stand.z)) putTitle = `Stand beside the ${panel.title} (${panel.room}) to put this back`;
      else {
        canPutBack = true;
        putTitle = `Return to the ${panel.title}`;
      }
    }
    this.putBackBtn.disabled = !canPutBack;
    this.putBackBtn.title = putTitle;
    this.cursorHint.textContent = s ? `Lifted: ${stackName(s)}${this.cursor!.qty > 1 ? ` × ${this.cursor!.qty}` : ''}` : 'Nothing lifted';
  }

  private renderGhost() {
    const s = this.cursor ? this.stackAt(this.cursor.loc) : null;
    this.ghost.hidden = !s;
    if (!s) return;
    this.ghost.innerHTML = `<span class="glyph">${GLYPHS[ITEMS[s.item].glyph]}</span>${this.cursor!.qty > 1 ? `<span class="qty">${this.cursor!.qty}</span>` : ''}`;
  }

  // ---------------------------------------------------------------- input

  private bindGrid(grid: HTMLElement) {
    const refOf = (e: Event): SlotRef | null => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
      if (!b) return null;
      return { c: b.dataset.c as SlotRef['c'], i: Number(b.dataset.i) };
    };
    grid.addEventListener('click', (e) => {
      const ref = refOf(e);
      if (ref) this.leftClick(ref, e.ctrlKey || e.metaKey);
    });
    grid.addEventListener('contextmenu', (e) => {
      const ref = refOf(e);
      if (!ref) return;
      e.preventDefault();
      this.rightClick(ref);
    });
  }

  private leftClick(ref: SlotRef, one: boolean) {
    const stack = this.stackAt(ref);
    if (!this.cursor) {
      if (!stack) return;
      this.cursor = { loc: ref, qty: one ? 1 : stack.qty };
      this.render();
      return;
    }
    if (sameRef(this.cursor.loc, ref)) {
      this.cursor = null;
      this.render();
      return;
    }
    const held = this.stackAt(this.cursor.loc);
    if (held) {
      const qty = this.cursor.qty < held.qty ? this.cursor.qty : undefined;
      this.handlers.send({ k: 'move', from: this.cursor.loc, to: ref, ...(qty ? { qty } : {}) });
    }
    this.cursor = null;
    this.render();
  }

  private rightClick(ref: SlotRef) {
    const stack = this.stackAt(ref);
    if (!stack) return;
    const def = ITEMS[stack.item];
    // Files go through the server too: opening one saves it to the data pad and counts for the quest.
    if (def.viewable) return this.handlers.send({ k: 'open', loc: ref });
    if (def.uses === null && !def.slot) return;
    this.handlers.send({ k: 'use', loc: ref });
  }

  private unequip(slot: 'suit' | 'armor') {
    this.handlers.send({ k: 'unequip', slot });
  }

  private deleteCursor() {
    if (!this.cursor) return;
    const held = this.stackAt(this.cursor.loc);
    if (!held || deleteBlock(held)) return;
    const qty = this.cursor.qty < held.qty ? this.cursor.qty : undefined;
    this.handlers.send({ k: 'delete', loc: this.cursor.loc, ...(qty ? { qty } : {}) });
    this.cursor = null;
    this.render();
  }

  private putBackCursor() {
    if (!this.cursor) return;
    const held = this.stackAt(this.cursor.loc);
    if (!held) return;
    const qty = this.cursor.qty < held.qty ? this.cursor.qty : undefined;
    this.handlers.send({ k: 'putBack', loc: this.cursor.loc, ...(qty ? { qty } : {}) });
    this.cursor = null;
    this.render();
  }

  /** Show a File's text (the server's answer to `open`); the modal opens if it was closed. */
  showFile(name: string, text: string) {
    if (!this.shown) this.open();
    this.viewer.hidden = false;
    this.viewer.innerHTML = `<div class="kicker">File · saved to your data pad</div><div class="inv-file-name">${esc(name)}</div><p class="inv-file-text">${esc(text)}</p>`;
    const close = h('button', 'btn small ghost', 'Close file');
    close.type = 'button';
    close.addEventListener('click', () => (this.viewer.hidden = true));
    this.viewer.append(close);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.shown) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.viewer.hidden) this.viewer.hidden = true;
      else if (this.cursor) {
        this.cursor = null;
        this.render();
      } else this.close();
      return;
    }
    if (e.key === 'Delete' && this.cursor) {
      e.preventDefault();
      this.deleteCursor();
    }
  };
}
