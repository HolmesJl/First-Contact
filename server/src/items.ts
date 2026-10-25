/**
 * Server-authoritative inventory: carry slots, worn gear, the per-character closet, stock stations and world Files.
 * Every rule in shared/items.ts is enforced here; the client only draws what it is told.
 */
import {
  CLOSET_SLOTS,
  EQUIP_SLOT_LABEL,
  ITEMS,
  MAX_PAD_FILES,
  addStack,
  closetFor,
  deleteBlock,
  fileText,
  findRoom,
  materialName,
  RAW_MATERIALS,
  SHIP_MATERIALS,
  normalizeInventory,
  normalizePadFiles,
  normalizeSlots,
  putBackPanelFor,
  sameKind,
  stackName,
  stockPanelById,
  uniqueBlock,
  worldFileById,
  type EquipSlot,
  type ItemEvent,
  type ItemId,
  type ItemStack,
  type SlotRef,
  type Slots,
} from '../../shared/items';
import { inRange } from '../../shared/opening';
import type { InventoryAction } from '../../shared/protocol';
import type { MemberRecord, ShipRecord } from './store';
import { normalizeShipStocks } from './transporter';

const RAW_MATERIAL_IDS = new Set(RAW_MATERIALS.map((m) => m.id));
const SHIP_MATERIAL_IDS = new Set(SHIP_MATERIALS.map((m) => m.id));

export type InvResult =
  | {
      ok: true;
      /** Shown to the acting player (a use message, what was taken). */
      message?: string;
      /** Ship stock changed: broadcast `shipState`. */
      stock?: boolean;
      /** Refinery / cargo-hold material stock changed: broadcast `shipState`. */
      shipStocks?: boolean;
      /** Closet contents changed: resend the owner's closet. */
      closet?: boolean;
      /** A stack that just landed in the carry slots (the client opens the inventory on it). */
      gained?: ItemStack;
      /** An opened File's text, for the client's viewer. */
      file?: { name: string; text: string };
      /** What happened, for the quest system (emitted via `itemEvents` once the action is saved). */
      events?: ItemEvent[];
    }
  | { ok: false; message: string };

const fail = (message: string): InvResult => ({ ok: false, message });

// ---------------------------------------------------------------- item events (the quest hook)

export interface ItemEventContext {
  ship: ShipRecord;
  member: MemberRecord;
}

/** A listener may return a notice for the acting player (toast); it may also mutate the member (quest progress). */
export type ItemEventListener = (ev: ItemEvent, ctx: ItemEventContext) => string | void;

const listeners = new Set<ItemEventListener>();

/**
 * Observable item events: `used` (Fruit eaten), `fileOpened` (by name), `taken` (from a stock panel), `equipped`,
 * `panelOpened`, `gained`. Quest code subscribes with `itemEvents.on`; the connection layer calls `emit` after the
 * action has been applied and the member saved.
 */
export const itemEvents = {
  on(fn: ItemEventListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Returns the notices listeners produced, in order. */
  emit(ev: ItemEvent, ctx: ItemEventContext): string[] {
    const notices: string[] = [];
    for (const fn of listeners) {
      const n = fn(ev, ctx);
      if (n) notices.push(n);
    }
    return notices;
  },
};

/**
 * The member's containers, created if missing. Records are normalised on load and on every state broadcast, so this
 * must not rebuild them here: an action holds references across several calls and a fresh copy would lose its edits.
 */
function ensure(member: MemberRecord) {
  member.inventory ??= normalizeInventory(undefined);
  member.closet ??= normalizeSlots(undefined, CLOSET_SLOTS);
  return { inv: member.inventory, closet: member.closet };
}

/** Why the player may not reach into their closet right now, or null. */
export function closetAccess(member: MemberRecord): string | null {
  if (member.berth === null || member.berth === undefined) return 'Claim a bunk first: upload your memories at its pad.';
  const c = closetFor(member.berth);
  if (!c) return 'Your berth has no closet.';
  if (!inRange(member.x, member.z, c.stand.x, c.stand.z)) return 'Stand beside your closet.';
  return null;
}

function slotsFor(member: MemberRecord, ref: SlotRef): Slots | string {
  const { inv, closet } = ensure(member);
  if (ref.c === 'carry') return inv.carry;
  return closetAccess(member) ?? closet;
}

const take = (slots: Slots, i: number, qty: number) => {
  const s = slots[i]!;
  slots[i] = s.qty > qty ? { ...s, qty: s.qty - qty } : null;
};

export function applyInventoryAction(ship: ShipRecord, member: MemberRecord, a: InventoryAction): InvResult {
  if (!member.character) return fail('Finish creating your clone first.');
  switch (a.k) {
    case 'move':
      return applyMove(member, a.from, a.to, a.qty);
    case 'use':
      return applyUse(member, a.loc);
    case 'open':
      return applyOpen(member, a.loc);
    case 'unequip':
      return applyUnequip(member, a.slot, a.to);
    case 'delete':
      return applyDelete(member, a.loc, a.qty);
    case 'take':
      return applyTake(ship, member, a.station, a.item);
    case 'putBack':
      return applyPutBack(ship, member, a.loc, a.qty);
    case 'destroyMaterial':
      return applyDestroyMaterial(ship, member, a.station, a.materialId);
  }
}

export function applyMove(member: MemberRecord, from: SlotRef, to: SlotRef, qtyReq?: number): InvResult {
  if (from.c === to.c && from.i === to.i) return { ok: true };
  const src = slotsFor(member, from);
  if (typeof src === 'string') return fail(src);
  const dstSlots = from.c === to.c ? src : slotsFor(member, to);
  if (typeof dstSlots === 'string') return fail(dstSlots);
  const stack = src[from.i];
  if (!stack) return fail('Nothing there.');
  const qty = Math.min(qtyReq ?? stack.qty, stack.qty);
  const moving: ItemStack = { ...stack, qty };
  const { inv } = ensure(member);
  const dst = dstSlots[to.i];
  const touchesCloset = from.c === 'closet' || to.c === 'closet';

  if (!dst) {
    if (to.c === 'carry' && from.c === 'closet') {
      const block = uniqueBlock(inv, moving);
      if (block) return fail(block);
    }
    dstSlots[to.i] = moving;
    take(src, from.i, qty);
    return { ok: true, closet: touchesCloset };
  }
  if (sameKind(dst, moving) && dst.qty + qty <= ITEMS[dst.item].maxStack) {
    dstSlots[to.i] = { ...dst, qty: dst.qty + qty };
    take(src, from.i, qty);
    return { ok: true, closet: touchesCloset };
  }
  if (qty < stack.qty) return fail('Put the partial stack in an empty slot.');
  // Swap whole stacks. A stack entering the carry slots still has to pass the unique rules (minus the one leaving).
  if (from.c !== to.c) {
    const entering = to.c === 'carry' ? moving : dst;
    const leaving = to.c === 'carry' ? dst : stack;
    const leavingRef = to.c === 'carry' ? to : from;
    inv.carry[leavingRef.i] = null;
    const block = uniqueBlock(inv, entering);
    inv.carry[leavingRef.i] = leaving;
    if (block) return fail(block);
  }
  dstSlots[to.i] = stack;
  src[from.i] = dst;
  return { ok: true, closet: touchesCloset };
}

export function applyUse(member: MemberRecord, loc: SlotRef): InvResult {
  const slots = slotsFor(member, loc);
  if (typeof slots === 'string') return fail(slots);
  const stack = slots[loc.i];
  if (!stack) return fail('Nothing there.');
  const def = ITEMS[stack.item];
  const { inv } = ensure(member);
  if (def.slot) {
    // Equip: the worn item (if any) drops into the vacated slot, so a swap never needs a free slot.
    const worn = inv.equipped[def.slot] ?? null;
    inv.equipped[def.slot] = { ...stack, qty: 1 };
    slots[loc.i] = stack.qty > 1 ? { ...stack, qty: stack.qty - 1 } : null;
    if (worn) {
      if (slots[loc.i] === null) slots[loc.i] = worn;
      else if (!addStack(inv.carry, worn) && !addStack(slots, worn)) {
        // Cannot happen with maxStack 1 gear (the slot we just emptied takes it), but never lose an item.
        inv.equipped[def.slot] = worn;
        slots[loc.i] = stack;
        return fail('No room to take off what you are wearing.');
      }
    }
    return {
      ok: true,
      message: worn ? `Swapped ${stackName(worn)} for ${stackName(stack)}.` : `Wearing ${stackName(stack)}.`,
      closet: loc.c === 'closet',
      events: [{ kind: 'equipped', item: stack.item, slot: def.slot }],
    };
  }
  if (def.viewable) return applyOpen(member, loc);
  if (def.uses === null) return fail('Nothing happens.');
  if (def.uses === 1) take(slots, loc.i, 1);
  else {
    const left = (stack.usesLeft ?? def.uses) - 1;
    slots[loc.i] = left > 0 ? { ...stack, usesLeft: left } : stack.qty > 1 ? { ...stack, qty: stack.qty - 1, usesLeft: undefined } : null;
  }
  const used: ItemEvent = { kind: 'used', item: stack.item, ...(stack.name ? { name: stack.name } : {}) };
  return { ok: true, message: def.useMessage ?? `Used ${def.name}.`, closet: loc.c === 'closet', events: [used] };
}

/** Open a File: its text comes back for the viewer and a copy is saved to the data pad with the time it was read. */
export function applyOpen(member: MemberRecord, loc: SlotRef): InvResult {
  const slots = slotsFor(member, loc);
  if (typeof slots === 'string') return fail(slots);
  const stack = slots[loc.i];
  if (!stack) return fail('Nothing there.');
  const def = ITEMS[stack.item];
  if (!def.viewable) return fail(`${def.name} has nothing to read.`);
  const name = stack.name ?? def.name;
  const text = fileText(name) ?? 'The pad is blank.';
  const now = Date.now();
  const files = normalizePadFiles(member.padFiles).filter((f) => f.name !== name);
  files.unshift({ name, text, at: now });
  member.padFiles = files.slice(0, MAX_PAD_FILES);
  return { ok: true, file: { name, text }, events: [{ kind: 'fileOpened', name }] };
}

export function applyUnequip(member: MemberRecord, slot: EquipSlot, to?: SlotRef): InvResult {
  const { inv } = ensure(member);
  const worn = inv.equipped[slot];
  if (!worn) return fail(`Nothing worn as ${EQUIP_SLOT_LABEL[slot].toLowerCase()}.`);
  if (slot === 'suit') return fail('You cannot take off your jumpsuit.');
  let target: Slots;
  let i: number;
  if (to) {
    const slots = slotsFor(member, to);
    if (typeof slots === 'string') return fail(slots);
    if (slots[to.i]) return fail('That slot is taken.');
    target = slots;
    i = to.i;
  } else {
    target = inv.carry;
    i = findRoom(inv.carry, worn);
    if (i < 0) return fail('Your carry slots are full.');
  }
  target[i] = worn;
  delete inv.equipped[slot];
  return { ok: true, message: `Took off ${stackName(worn)}.`, closet: to?.c === 'closet' };
}

export function applyDelete(member: MemberRecord, loc: SlotRef, qtyReq?: number): InvResult {
  const slots = slotsFor(member, loc);
  if (typeof slots === 'string') return fail(slots);
  const stack = slots[loc.i];
  if (!stack) return fail('Nothing there.');
  const block = deleteBlock(stack);
  if (block) return fail(block);
  const qty = Math.min(qtyReq ?? stack.qty, stack.qty);
  take(slots, loc.i, qty);
  return { ok: true, message: `Deleted ${qty > 1 ? `${qty} x ` : ''}${stackName(stack)}.`, closet: loc.c === 'closet' };
}

/** A stock panel was clicked in range: nothing changes hands, but the quest system hears about it. */
export function applyOpenPanel(member: MemberRecord, station: string): InvResult {
  const panel = stockPanelById(station);
  if (!panel) return fail('Nothing to open there.');
  if (!inRange(member.x, member.z, panel.stand.x, panel.stand.z)) return fail('Move closer.');
  return { ok: true, events: [{ kind: 'panelOpened', station }] };
}

export function applyTake(ship: ShipRecord, member: MemberRecord, station: string, item: ItemId): InvResult {
  const panel = stockPanelById(station);
  if (!panel || !panel.takes.includes(item)) return fail('Nothing to take there.');
  if (!inRange(member.x, member.z, panel.stand.x, panel.stand.z)) return fail('Move closer.');
  const def = ITEMS[item];
  const stock = ship.stock ?? (ship.stock = {});
  if ((stock[item] ?? 0) <= 0) return fail(`${def.name} is out of stock.`);
  const { inv } = ensure(member);
  const stack: ItemStack = { item, qty: 1 };
  const block = uniqueBlock(inv, stack);
  if (block) return fail(block);
  if (!addStack(inv.carry, stack)) return fail('Your carry slots are full.');
  stock[item] = (stock[item] ?? 0) - 1;
  return {
    ok: true,
    message: `Took 1 ${def.name} (${stock[item]} left).`,
    stock: true,
    gained: stack,
    events: [
      { kind: 'taken', station, item },
      { kind: 'gained', stack, from: station },
    ],
  };
}

export function applyPutBack(ship: ShipRecord, member: MemberRecord, loc: SlotRef, qtyReq?: number): InvResult {
  const slots = slotsFor(member, loc);
  if (typeof slots === 'string') return fail(slots);
  const stack = slots[loc.i];
  if (!stack) return fail('Nothing there.');
  const panel = putBackPanelFor(stack);
  if (!panel) return fail(`${stackName(stack)} has nowhere to go back to.`);
  if (!inRange(member.x, member.z, panel.stand.x, panel.stand.z)) return fail(`Stand beside the ${panel.title} to put that back.`);
  const qty = Math.min(qtyReq ?? stack.qty, stack.qty);
  const stock = ship.stock ?? (ship.stock = {});
  stock[stack.item] = (stock[stack.item] ?? 0) + qty;
  take(slots, loc.i, qty);
  return { ok: true, message: `Put back ${qty > 1 ? `${qty} x ` : ''}${stackName(stack)} (${stock[stack.item]} in stock).`, stock: true, closet: loc.c === 'closet' };
}

/** Remove one unit of a material from refinery or cargo-hold stock (frees shared capacity). */
export function applyDestroyMaterial(ship: ShipRecord, member: MemberRecord, station: string, materialId: string): InvResult {
  const panel = stockPanelById(station);
  if (!panel) return fail('Nothing to destroy there.');
  if (!inRange(member.x, member.z, panel.stand.x, panel.stand.z)) return fail('Move closer.');
  normalizeShipStocks(ship);
  if (panel.kind === 'refinery') {
    if (!RAW_MATERIAL_IDS.has(materialId)) return fail('Unknown material.');
    const stock = ship.refineryStock!;
    const have = stock[materialId] ?? 0;
    if (have <= 0) return fail('Nothing to destroy.');
    stock[materialId] = have - 1;
    return { ok: true, message: `Destroyed 1 ${materialName(materialId)}.`, shipStocks: true };
  }
  if (panel.kind === 'materials' || panel.kind === 'printer') {
    if (!SHIP_MATERIAL_IDS.has(materialId)) return fail('Unknown material.');
    const stock = ship.cargoHoldStock!;
    const have = stock[materialId] ?? 0;
    if (have <= 0) return fail('Nothing to destroy.');
    stock[materialId] = have - 1;
    return { ok: true, message: `Destroyed 1 ${materialName(materialId)}.`, shipStocks: true };
  }
  return fail('This panel does not store materials.');
}

/** Pick up a world File (via `interact`): a copy goes into a carry slot; one of each name per person. */
export function applyPickupFile(member: MemberRecord, interactId: string): InvResult {
  const f = worldFileById(interactId);
  if (!f) return fail('Nothing to pick up.');
  if (!member.character) return fail('Finish creating your clone first.');
  if (!inRange(member.x, member.z, f.stand.x, f.stand.z)) return fail('Move closer.');
  const { inv } = ensure(member);
  const stack: ItemStack = { item: 'file', qty: 1, name: f.name };
  const block = uniqueBlock(inv, stack);
  if (block) return fail(block);
  if (!addStack(inv.carry, stack)) return fail('Your carry slots are full.');
  return { ok: true, message: `Picked up File: ${f.name}.`, gained: stack, events: [{ kind: 'gained', stack, from: interactId }] };
}
