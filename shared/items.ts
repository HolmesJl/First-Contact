/**
 * Items, inventories and the places that hand them out. One source for client and server.
 *
 * Every collectable item has a rule set (persistent, usable with a use count, unique, stackable, equippable) in
 * `ITEMS`. A player's on-person inventory is six carry slots plus the equipped record (worn items use no slot); the
 * closet is a 20-slot store that travels with the character record but is opened at the closet of their claimed berth.
 * The split matters for the death rules to come: on-person is lost, the closet is kept.
 *
 * Stock stations (Eatery panel, Cargo Hold shelves) hand out items from a ship-wide count and take them back when the
 * player stands beside them; the Printer and Refinery panels only list materials for now. World Files are read-me pads
 * lying on props around the ship; a copy is picked up, and a player carries at most one File of a given name.
 */
import { BERTHS, BUNK_SLAB_Y, FACE_OUT, PROPS, SPACE_NAMES, standPointOnFace, type Prop } from './shipInterior';
import type { Facing, RoomId } from './shipLayout';

// ---------------------------------------------------------------- item definitions

export const ITEM_IDS = [
  'jumpsuit',
  'lite-body-armor',
  'file',
  'fruit',
  'vegetables',
  'complex-protein',
  'simple-protein',
  'water',
  'beer',
  'mixed-drink',
] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export type EquipSlot = 'suit' | 'armor';
export type ItemGlyph = 'suit' | 'vest' | 'file' | 'apple' | 'leaf' | 'protein' | 'cup' | 'bottle' | 'glass';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Stays in inventory until deleted, used up or put back. (False would mean it vanishes on logout; none do yet.) */
  persistent: boolean;
  /** Right click uses it this many times before the system deletes it; null means right click does nothing. */
  uses: number | null;
  /** Message shown to the user on use. */
  useMessage?: string;
  /** `name`: at most one per player of each name (Files). `player`: at most one per player. `none`: unlimited. */
  unique: 'none' | 'player' | 'name';
  /** Stacks in one slot up to `maxStack` (1 = not stackable). */
  maxStack: number;
  /** Worn in this slot when equipped (right click); equipped items use no carry slot. */
  slot: EquipSlot | null;
  /** Interact id of the stock station it came from; Put back works there and returns it to that stock. */
  source: string | null;
  /** False: Delete is refused; the only way to part with it is Put back at its source (starter gear). */
  deletable: boolean;
  /** Armor class contributed while worn (meaningless until combat exists). */
  ac?: number;
  /** Visual hook for worn body armor (see client `setBodyArmor`). */
  armor?: { primary: string };
  /** Right click opens the item's text instead of consuming it. */
  viewable?: boolean;
  glyph: ItemGlyph;
  /** Short line for the tooltip. */
  blurb: string;
}

const food = (id: ItemId, name: string, glyph: ItemGlyph, useMessage: string, blurb: string): ItemDef => ({
  id,
  name,
  persistent: true,
  uses: 1,
  useMessage,
  unique: 'none',
  maxStack: 25,
  slot: null,
  source: 'eatery-panel',
  deletable: true,
  glyph,
  blurb,
});

export const ITEMS: Record<ItemId, ItemDef> = {
  jumpsuit: {
    id: 'jumpsuit',
    name: 'Jumpsuit',
    persistent: true,
    uses: null,
    unique: 'none',
    maxStack: 1,
    slot: 'suit',
    source: null,
    deletable: false,
    ac: 1,
    glyph: 'suit',
    blurb: 'Standard crew jumpsuit. Worn from the moment you wake.',
  },
  // Starter gear (scavenger hunt task 4): collect as many sets as you like (one worn, spares in carry slots or the
  // closet); never deleted, only put back on the Cargo Hold shelves.
  'lite-body-armor': {
    id: 'lite-body-armor',
    name: 'Lite Body Armor',
    persistent: true,
    uses: null,
    unique: 'none',
    maxStack: 1,
    slot: 'armor',
    source: 'hold-shelves',
    deletable: false,
    ac: 2,
    armor: { primary: '#ffffff' },
    glyph: 'vest',
    blurb: 'Starter gear: moulded armor worn over the jumpsuit. Right click to wear. Cannot be deleted; put spares back on the shelves.',
  },
  file: {
    id: 'file',
    name: 'File',
    persistent: true,
    uses: null,
    unique: 'name',
    maxStack: 1,
    slot: null,
    source: null,
    deletable: true,
    viewable: true,
    glyph: 'file',
    blurb: 'A read-me pad. Right click to open; one of each name per person.',
  },
  fruit: food('fruit', 'Fruit', 'apple', 'The apple tastes good', 'Fresh from the greenhouse. Right click to eat.'),
  vegetables: food('vegetables', 'Vegetables', 'leaf', 'Crunchy and green.', 'Greenhouse vegetables.'),
  'complex-protein': food('complex-protein', 'Complex Protein', 'protein', 'Dense and filling.', 'Vat-grown protein block.'),
  'simple-protein': food('simple-protein', 'Simple Protein', 'protein', 'Plain, but it fills you up.', 'Protein paste.'),
  water: food('water', 'Water', 'cup', 'Cold and clean.', 'Reclaimed water.'),
  beer: food('beer', 'Beer', 'bottle', 'Not bad for ship brew.', 'Ship-brewed beer.'),
  'mixed-drink': food('mixed-drink', 'Mixed Drink', 'glass', 'Strong. The bartender is a printer.', 'A printed cocktail.'),
};

export const isItemId = (v: unknown): v is ItemId => typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v);

/** A stack in a slot. `name` is the File's title; `usesLeft` only for multi-use, non-stackable items. */
export interface ItemStack {
  item: ItemId;
  qty: number;
  name?: string;
  usesLeft?: number;
}

export const CARRY_SLOTS = 6;
export const CLOSET_SLOTS = 20;

export type Slots = (ItemStack | null)[];
export type Equipped = Partial<Record<EquipSlot, ItemStack>>;

/** What a character has on their person: lost on death. */
export interface Inventory {
  carry: Slots;
  equipped: Equipped;
}

export type Container = 'carry' | 'closet';
export interface SlotRef {
  c: Container;
  i: number;
}

export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = { suit: 'Suit', armor: 'Body armor' };
export const EQUIP_SLOT_ORDER: readonly EquipSlot[] = ['suit', 'armor'];

export function emptySlots(n: number): Slots {
  return Array.from({ length: n }, () => null);
}

/** Everyone starts dressed in the jumpsuit with empty pockets. */
export function startingInventory(): Inventory {
  return { carry: emptySlots(CARRY_SLOTS), equipped: { suit: { item: 'jumpsuit', qty: 1 } } };
}

/** Repair a stored inventory (missing fields, wrong slot counts, unknown items). */
export function normalizeInventory(inv: Partial<Inventory> | null | undefined): Inventory {
  const base = startingInventory();
  const carry = normalizeSlots(inv?.carry, CARRY_SLOTS);
  const equipped: Equipped = {};
  const eq = inv?.equipped ?? base.equipped;
  for (const slot of EQUIP_SLOT_ORDER) {
    const s = eq[slot];
    if (s && isItemId(s.item) && ITEMS[s.item].slot === slot) equipped[slot] = normalizeStack(s)!;
  }
  if (!equipped.suit) equipped.suit = base.equipped.suit;
  return { carry, equipped };
}

export function normalizeSlots(slots: unknown, n: number): Slots {
  const out = emptySlots(n);
  if (!Array.isArray(slots)) return out;
  for (let i = 0; i < n; i++) out[i] = normalizeStack(slots[i]);
  return out;
}

function normalizeStack(s: unknown): ItemStack | null {
  if (!s || typeof s !== 'object') return null;
  const st = s as Record<string, unknown>;
  if (!isItemId(st.item)) return null;
  const def = ITEMS[st.item];
  const qty = Math.min(def.maxStack, Math.max(1, Math.floor(Number(st.qty) || 1)));
  const out: ItemStack = { item: st.item, qty };
  if (typeof st.name === 'string' && st.name) out.name = st.name;
  if (typeof st.usesLeft === 'number' && def.uses && def.uses > 1) out.usesLeft = Math.min(def.uses, Math.max(1, Math.floor(st.usesLeft)));
  return out;
}

export const sameKind = (a: ItemStack, b: ItemStack) => a.item === b.item && (a.name ?? '') === (b.name ?? '') && a.usesLeft === b.usesLeft;

export function stackName(s: ItemStack) {
  return s.name ? `${ITEMS[s.item].name}: ${s.name}` : ITEMS[s.item].name;
}

export function totalAc(eq: Equipped): number {
  let ac = 0;
  for (const slot of EQUIP_SLOT_ORDER) {
    const s = eq[slot];
    if (s) ac += ITEMS[s.item].ac ?? 0;
  }
  return ac;
}

/** Index of the slot a stack would land in: an existing stack of the same kind with room, else the first empty slot. */
export function findRoom(slots: Slots, stack: ItemStack): number {
  const def = ITEMS[stack.item];
  if (def.maxStack > 1) {
    const i = slots.findIndex((s) => s && sameKind(s, stack) && s.qty + stack.qty <= def.maxStack);
    if (i >= 0) return i;
  }
  return slots.findIndex((s) => s === null);
}

/** Add a stack to a container in place; returns false (and changes nothing) if there is no room. */
export function addStack(slots: Slots, stack: ItemStack): boolean {
  const i = findRoom(slots, stack);
  if (i < 0) return false;
  const cur = slots[i];
  slots[i] = cur ? { ...cur, qty: cur.qty + stack.qty } : { ...stack };
  return true;
}

/** True if the inventory (carry + equipped) holds an item of this id, and for Files, of this name. */
export function holdsUnique(inv: Inventory, item: ItemId, name?: string): boolean {
  const def = ITEMS[item];
  const match = (s: ItemStack | null | undefined) => !!s && s.item === item && (def.unique !== 'name' || (s.name ?? '') === (name ?? ''));
  return inv.carry.some(match) || EQUIP_SLOT_ORDER.some((slot) => match(inv.equipped[slot]));
}

/** Why a stack may not enter the personal inventory (unique rules), or null. Closets have no such rule. */
export function uniqueBlock(inv: Inventory, stack: ItemStack): string | null {
  const def = ITEMS[stack.item];
  if (def.unique === 'none') return null;
  if (!holdsUnique(inv, stack.item, stack.name)) return null;
  return def.unique === 'name' ? `You already carry the File “${stack.name ?? ''}”.` : `You already have a ${def.name} (one per person).`;
}

/** Why a stack may not be deleted, or null. */
export function deleteBlock(stack: ItemStack): string | null {
  const def = ITEMS[stack.item];
  if (def.deletable) return null;
  const src = def.source ? stockPanelById(def.source) : null;
  return src ? `${def.name} cannot be deleted. Put it back at the ${src.title}.` : `${def.name} cannot be deleted.`;
}

export const validSlotRef = (v: unknown): v is SlotRef => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.c !== 'carry' && r.c !== 'closet') return false;
  const n = r.c === 'carry' ? CARRY_SLOTS : CLOSET_SLOTS;
  return typeof r.i === 'number' && Number.isInteger(r.i) && r.i >= 0 && r.i < n;
};

// ---------------------------------------------------------------- stock and materials

/** What the ship holds at the start of the voyage, by item or material id. */
export const STARTING_STOCK: Record<string, number> = {
  fruit: 25,
  'lite-body-armor': 6,
  paneling: 15,
  alloys: 15,
  cables: 15,
  struts: 15,
  conduit: 15,
  battery: 15,
  lithium: 20,
  plastics: 20,
  copper: 20,
  iron: 20,
  tin: 20,
  minerals: 20,
};

export const EATERY_MENU: readonly ItemId[] = ['fruit', 'vegetables', 'complex-protein', 'simple-protein', 'water', 'beer', 'mixed-drink'];

export interface MaterialDef {
  id: string;
  name: string;
  /** Printer recipe, as "count x material" pairs. */
  recipe?: { qty: number; of: string }[];
}

export const RAW_MATERIALS: readonly MaterialDef[] = [
  { id: 'lithium', name: 'Lithium' },
  { id: 'plastics', name: 'Plastics' },
  { id: 'copper', name: 'Copper' },
  { id: 'iron', name: 'Iron' },
  { id: 'tin', name: 'Tin' },
  { id: 'minerals', name: 'Minerals' },
];

export const SHIP_MATERIALS: readonly MaterialDef[] = [
  { id: 'paneling', name: 'Paneling', recipe: [{ qty: 2, of: 'plastics' }] },
  { id: 'alloys', name: 'Alloys', recipe: [{ qty: 1, of: 'minerals' }, { qty: 1, of: 'tin' }, { qty: 1, of: 'iron' }] },
  { id: 'cables', name: 'Cables', recipe: [{ qty: 1, of: 'plastics' }, { qty: 1, of: 'minerals' }] },
  { id: 'struts', name: 'Struts', recipe: [{ qty: 1, of: 'plastics' }, { qty: 1, of: 'iron' }] },
  { id: 'conduit', name: 'Conduit', recipe: [{ qty: 1, of: 'plastics' }, { qty: 1, of: 'tin' }, { qty: 1, of: 'minerals' }] },
  { id: 'battery', name: 'Battery', recipe: [{ qty: 2, of: 'lithium' }] },
];

export const materialName = (id: string) => RAW_MATERIALS.find((m) => m.id === id)?.name ?? SHIP_MATERIALS.find((m) => m.id === id)?.name ?? id;

export function recipeText(m: MaterialDef) {
  return (m.recipe ?? []).map((r) => `${r.qty}x ${materialName(r.of)}`).join(' + ');
}

export function normalizeStock(stock: unknown): Record<string, number> {
  const out = { ...STARTING_STOCK };
  if (stock && typeof stock === 'object') {
    for (const [k, v] of Object.entries(stock as Record<string, unknown>)) {
      if (k in out && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
    }
  }
  return out;
}

// ---------------------------------------------------------------- stations: stock panels, closets, files

export type StockPanelKind = 'eatery' | 'printer' | 'refinery' | 'shelves' | 'materials';

export interface StockPanel {
  interactId: string;
  kind: StockPanelKind;
  title: string;
  /** Prop the panel hangs on, or null for a wall mount. */
  propId: string | null;
  /** Room display name. */
  room: string;
  /** Panel mount point and the direction its screen faces. */
  x: number;
  y: number;
  z: number;
  face: Facing;
  /** Where the player stands to use it (interact range is measured from here). */
  stand: { x: number; z: number };
  /** Items this panel hands out (empty for view-only panels). */
  takes: readonly ItemId[];
}

interface PanelSpec {
  interactId: string;
  kind: StockPanelKind;
  title: string;
  /** Prop the panel hangs on; `face` is the side (toward the room; a few props are authored facing the hull). */
  propId?: string;
  /** Wall mount instead: the panel's own position (just off the wall) and the room it is in. */
  wall?: { x: number; z: number; room: RoomId };
  /** Direction the screen faces. */
  face: Facing;
  /** Offset along the face so the panel does not sit dead centre on a long counter. */
  slide: number;
  /** Panel height above the floor, or null for "just above the prop top". */
  y: number | null;
  takes: readonly ItemId[];
}

/** The Cargo Hold's materials data pad hangs on the north wall (wall half thickness 0.2 m), clear of the door and racks. */
const MATERIALS_PAD_WALL = { x: -22.5, z: -12.78, room: 'hold' as RoomId };
export const MATERIALS_PAD_INTERACT_ID = 'hold-materials-pad';

const PANEL_SPECS: readonly PanelSpec[] = [
  { interactId: 'eatery-panel', kind: 'eatery', title: 'Eatery control panel', propId: 'eatery-counter', face: 'N', slide: 1.5, y: null, takes: EATERY_MENU },
  { interactId: 'printer-panel', kind: 'printer', title: 'Printer control panel', propId: 'printer', face: 'S', slide: 0, y: 1.15, takes: [] },
  { interactId: 'refinery-panel', kind: 'refinery', title: 'Refining control panel', propId: 'refinery', face: 'E', slide: 0, y: 1.25, takes: [] },
  { interactId: 'hold-shelves', kind: 'shelves', title: 'Cargo Hold shelves', propId: 'hold-rack-1', face: 'N', slide: 0, y: 1.35, takes: ['lite-body-armor'] },
  { interactId: MATERIALS_PAD_INTERACT_ID, kind: 'materials', title: 'Materials data pad', wall: MATERIALS_PAD_WALL, face: 'S', slide: 0, y: 1.45, takes: [] },
];

const PANEL_STANDOFF = 0.05;
/** How far in front of a wall-mounted panel the player stands. */
const WALL_STAND_OFF = 0.75;

function propById(id: string): Prop {
  const p = PROPS.find((x) => x.id === id);
  if (!p) throw new Error(`items: unknown prop ${id}`);
  return p;
}

/** A point just outside a prop's `face` side, offset `slide` along the face. */
function mountOnFace(prop: Prop, face: Facing, slide: number, standoff: number) {
  const f = FACE_OUT[face];
  const half = Math.abs(f.dx) > 0 ? prop.sx / 2 : prop.sz / 2;
  return {
    x: prop.x + f.dx * (half + standoff) + (f.dx === 0 ? slide : 0),
    z: prop.z + f.dz * (half + standoff) + (f.dx !== 0 ? slide : 0),
  };
}

function placePanel(s: PanelSpec): StockPanel {
  if (s.wall) {
    const f = FACE_OUT[s.face];
    return {
      interactId: s.interactId,
      kind: s.kind,
      title: s.title,
      propId: null,
      room: SPACE_NAMES[s.wall.room] ?? s.wall.room,
      x: s.wall.x,
      y: s.y ?? 1.4,
      z: s.wall.z,
      face: s.face,
      stand: { x: s.wall.x + f.dx * WALL_STAND_OFF, z: s.wall.z + f.dz * WALL_STAND_OFF },
      takes: s.takes,
    };
  }
  const prop = propById(s.propId!);
  const m = mountOnFace(prop, s.face, s.slide, PANEL_STANDOFF);
  const stand = standPointOnFace({ ...prop, face: s.face }, 0.22, s.slide);
  return {
    interactId: s.interactId,
    kind: s.kind,
    title: s.title,
    propId: prop.id,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x: m.x,
    y: s.y ?? (prop.y ?? 0) + prop.h + 0.3,
    z: m.z,
    face: s.face,
    stand: { x: stand.x, z: stand.z },
    takes: s.takes,
  };
}

export const STOCK_PANELS: readonly StockPanel[] = PANEL_SPECS.map(placePanel);
export const stockPanelById = (id: string) => STOCK_PANELS.find((p) => p.interactId === id);

export interface ClosetStation {
  interactId: string;
  berth: number;
  propId: string;
  room: string;
  /** Door handle / tier panel the player clicks, and the direction it faces. */
  x: number;
  y: number;
  z: number;
  face: Facing;
  stand: { x: number; z: number };
}

export const CLOSET_PREFIX = 'closet-';
export const closetInteractId = (berth: number) => `${CLOSET_PREFIX}${berth}`;

export function berthFromClosetId(id: string): number | null {
  if (!id.startsWith(CLOSET_PREFIX)) return null;
  const n = Number(id.slice(CLOSET_PREFIX.length));
  return Number.isInteger(n) && CLOSETS.some((c) => c.berth === n) ? n : null;
}
export const isClosetId = (id: string) => berthFromClosetId(id) !== null;

/** Bunk closets are shared cabinets three tiers high; each berth owns one tier. */
const CLOSET_TIER_Y = BUNK_SLAB_Y.map((y) => y + 0.35);

function placeCloset(berth: number): ClosetStation {
  const b = BERTHS.find((x) => x.index === berth);
  if (!b) throw new Error(`items: unknown berth ${berth}`);
  const prop = PROPS.find((p) => p.kind === 'closet' && Math.abs(p.x - b.closet.x) < 0.01 && Math.abs(p.z - b.closet.z) < 0.01);
  if (!prop) throw new Error(`items: no closet prop at berth ${berth}`);
  const face = prop.face ?? 'S';
  const tier = berth === 0 ? 0 : (berth - 1) % 3;
  const y = berth === 0 ? (prop.y ?? 0) + prop.h * 0.55 : CLOSET_TIER_Y[tier];
  const m = mountOnFace(prop, face, 0, 0.03);
  const stand = standPointOnFace(prop, 0.22);
  return { interactId: closetInteractId(berth), berth, propId: prop.id, room: SPACE_NAMES[prop.room] ?? prop.room, x: m.x, y, z: m.z, face, stand: { x: stand.x, z: stand.z } };
}

export const CLOSETS: readonly ClosetStation[] = BERTHS.map((b) => placeCloset(b.index));
export const closetFor = (berth: number) => CLOSETS.find((c) => c.berth === berth);

export interface WorldFile {
  interactId: string;
  name: string;
  text: string;
  propId: string;
  room: string;
  /** Where the pad lies (on top of the prop). */
  x: number;
  y: number;
  z: number;
  face: Facing;
  stand: { x: number; z: number };
}

export const FILE_PREFIX = 'file-';

interface FileSpec {
  slug: string;
  name: string;
  text: string;
  propId: string;
  /** Side the reader stands on. */
  face: Facing;
  /** Offset along the face from the prop centre. */
  slide: number;
}

const FILE_SPECS: readonly FileSpec[] = [
  {
    slug: 'transit-log',
    name: 'Transit Log',
    text: 'Year 60 of transit. Hibernation cycle complete. Crew revival authorised. Seed core intact; growth modules not yet fabricated. Resume the journey once the crew has reported in.',
    propId: 'scan-2',
    face: 'S',
    slide: 0,
  },
  {
    slug: 'commons-notice',
    name: 'Commons Notice',
    text: 'Eatery stock is finite until the greenhouse is producing. Take what you need; put back what you do not eat. The Botanist keeps the counter stocked.',
    propId: 'lounge-table',
    face: 'S',
    slide: 0,
  },
  {
    slug: 'cloning-protocol',
    name: 'Cloning Protocol',
    text: 'Every clone reports to Medical before joining the crew. Memory uploads at your berth define what a clone remembers. On-person items are lost on death; closet contents are kept.',
    propId: 'lab-bench',
    face: 'W',
    slide: -1.1,
  },
  {
    // Scavenger hunt task 2: the Read Me on the Science Lab desk (name is Jennifer's working title).
    slug: 'module-replicator',
    name: 'Read Me: module replicator',
    text: [
      'How to use the Printer:',
      '1) Open the Printer interface',
      '2) Select the Ship Material you wish to create',
      '3) Review the list of items needed to manufacture it',
      '4) A new Ship Material item can only be created if you have the required Raw Materials in the refinery',
      '5) Ship Materials are sent directly to the Cargo Bay',
    ].join('\n'),
    propId: 'robotics-bench',
    face: 'E',
    slide: 0.7,
  },
  {
    slug: 'operations-brief',
    name: 'Operations Brief',
    text: 'Lite Body Armor is on the Cargo Hold shelves: six sets. Wear one. Stow spares in your closet; armor on your person does not survive a recloning.',
    propId: 'planning-table',
    face: 'S',
    slide: -0.9,
  },
];

function placeFile(s: FileSpec): WorldFile {
  const prop = propById(s.propId);
  const f = FACE_OUT[s.face];
  // On the prop top, pulled toward the reader's side so it reads as "lying at the edge".
  const half = Math.abs(f.dx) > 0 ? prop.sx / 2 : prop.sz / 2;
  const inset = Math.max(0.18, half - 0.22);
  const x = prop.x + f.dx * inset + (f.dx === 0 ? s.slide : 0);
  const z = prop.z + f.dz * inset + (f.dx !== 0 ? s.slide : 0);
  const stand = standPointOnFace({ ...prop, face: s.face }, 0.22, s.slide);
  return {
    interactId: `${FILE_PREFIX}${s.slug}`,
    name: s.name,
    text: s.text,
    propId: prop.id,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x,
    y: (prop.y ?? 0) + prop.h + 0.015,
    z,
    face: s.face,
    stand: { x: stand.x, z: stand.z },
  };
}

export const WORLD_FILES: readonly WorldFile[] = FILE_SPECS.map(placeFile);
export const worldFileById = (id: string) => WORLD_FILES.find((f) => f.interactId === id);
export const isWorldFileId = (id: string) => WORLD_FILES.some((f) => f.interactId === id);
/** Text of a File by name (the inventory viewer), or null. */
export const fileText = (name: string) => WORLD_FILES.find((f) => f.name === name)?.text ?? null;

/** Any interact id this module owns (the server routes these to the item handlers). */
export const isItemInteractId = (id: string) => !!stockPanelById(id) || isClosetId(id) || isWorldFileId(id);

export function itemInteractPosition(id: string): { x: number; z: number } | null {
  const p = stockPanelById(id);
  if (p) return p.stand;
  const berth = berthFromClosetId(id);
  if (berth !== null) return closetFor(berth)!.stand;
  const f = worldFileById(id);
  return f ? f.stand : null;
}

/** Hover line for an item interactable. `ownBerth` is the looking player's claimed berth (closets). */
export function itemInteractPrompt(id: string, ownBerth: number | null = null): string | null {
  const p = stockPanelById(id);
  if (p) return p.kind === 'shelves' ? 'Browse the Cargo Hold shelves' : p.kind === 'materials' ? 'Check the Ship Materials inventory' : `Open the ${p.title}`;
  const berth = berthFromClosetId(id);
  if (berth !== null) {
    const label = berth === 0 ? "Captain's trunk" : `Closet ${berth}`;
    if (ownBerth === berth) return `Open ${label} · yours`;
    return ownBerth === null ? `${label} · claim a bunk first` : `${label} · not yours`;
  }
  const f = worldFileById(id);
  return f ? `Pick up File: ${f.name}` : null;
}

/** A Read Me saved to the player's Data Pad when they opened the File; listed there with its timestamp. */
export interface PadFile {
  name: string;
  text: string;
  /** Server time (ms) the File was last opened. */
  at: number;
}

export const MAX_PAD_FILES = 50;

export function normalizePadFiles(v: unknown): PadFile[] {
  if (!Array.isArray(v)) return [];
  const out: PadFile[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const f = e as Record<string, unknown>;
    if (typeof f.name !== 'string' || !f.name || typeof f.at !== 'number' || !Number.isFinite(f.at)) continue;
    if (out.some((o) => o.name === f.name)) continue;
    out.push({ name: f.name, text: typeof f.text === 'string' ? f.text : (fileText(f.name) ?? ''), at: f.at });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_PAD_FILES);
}

/**
 * What the quest system can observe about items. Emitted on the server after the action has been applied and saved
 * (see server/src/items.ts `itemEvents`); the acting player's `invResult` carries nothing about them.
 */
export type ItemEvent =
  /** A consumable was used (Fruit eaten); `name` is set for named items. */
  | { kind: 'used'; item: ItemId; name?: string }
  /** A File was opened from the inventory (and saved to the Data Pad). */
  | { kind: 'fileOpened'; name: string }
  /** One item was taken from a stock panel. */
  | { kind: 'taken'; station: string; item: ItemId }
  /** Gear was put on. */
  | { kind: 'equipped'; item: ItemId; slot: EquipSlot }
  /** A stock panel (Eatery, Printer, Refinery, shelves, materials pad) was opened in range. */
  | { kind: 'panelOpened'; station: string }
  /** A world File copy or a stock item landed in the carry slots (the client opens the inventory on this). */
  | { kind: 'gained'; stack: ItemStack; from: string };

/** Stations a put-back of this stack is accepted at. */
export function putBackPanelFor(stack: ItemStack): StockPanel | null {
  const src = ITEMS[stack.item].source;
  return src ? (stockPanelById(src) ?? null) : null;
}
