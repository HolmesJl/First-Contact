import type { QuestStep } from './opening';
import { isItemId, validSlotRef, type EquipSlot, type Inventory, type ItemId, type ItemStack, type PadFile, type SlotRef, type Slots } from './items';
import type { ScavengerState } from './scavenger';
import type { ScanResultEntry, ScanningSkill } from './scanning';

export const JOBS = ['Captain', 'Engineer', 'Military', 'Doctor', 'Botanist'] as const;
export type Job = (typeof JOBS)[number];

/**
 * How many players may be aboard a ship at once. Saved characters do not hold a slot; only players online right now
 * count, so a browser can keep as many characters as it likes and the cap bites only at boarding time.
 */
export const MAX_CREW = 6;

export const JOB_INFO: Record<Job, { color: string; role: string; blurb: string }> = {
  Captain: {
    color: '#ffd166',
    role: 'Light fighter',
    blurb: 'Pilots the ship, assigns job training, sets coordinates and authorizes attacks.',
  },
  Engineer: {
    color: '#ff9f43',
    role: 'Medium fighter',
    blurb: 'Runs harvesting drones and the refiner-printer. Minor healing.',
  },
  Military: {
    color: '#ff5d5d',
    role: 'Heavy fighter',
    blurb: 'Designs weapons, arms the crew, and can clone soldiers for battle.',
  },
  Doctor: {
    color: '#5ef2c6',
    role: 'Heavy fighter · defense',
    blurb: 'Advanced healing and full control of the cloning bay.',
  },
  Botanist: {
    color: '#9be15d',
    role: 'Support',
    blurb: 'Keeps greenhouses and bio-atmosphere generators alive. Food and air.',
  },
};

export const SEXES = ['male', 'female'] as const;
export const FACES = ['neutral', 'smiling', 'serious', 'angry', 'flirty', 'calm', 'determined', 'smirk'] as const;
/** Hairstyles that ship with the Quaternius base characters and fit the heads, per sex (first entry is the default). */
export const HAIR_STYLES = {
  male: [
    { id: 'parted', name: 'Parted' },
    { id: 'buzzed', name: 'Buzzed' },
  ],
  female: [
    { id: 'buzzed', name: 'Buzzed' },
    { id: 'buns', name: 'Buns' },
    { id: 'long', name: 'Long' },
  ],
} as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard'] as const;

export const HAIR_COLORS = [
  { name: 'Black', hex: '#1c1a1f' },
  { name: 'Dark brown', hex: '#3b2417' },
  { name: 'Chestnut', hex: '#52341f' },
  { name: 'Brown', hex: '#6e4526' },
  { name: 'Auburn', hex: '#8e3b1f' },
  { name: 'Copper', hex: '#c0521f' },
  { name: 'Dark blonde', hex: '#a88652' },
  { name: 'Blonde', hex: '#d8b56d' },
  { name: 'Platinum', hex: '#e9e2d0' },
  { name: 'Silver', hex: '#9aa3ad' },
  { name: 'Cobalt', hex: '#3f7bff' },
  { name: 'Violet', hex: '#8e4dff' },
] as const;

export const EYE_COLORS = [
  { name: 'Dark brown', hex: '#2f1d12' },
  { name: 'Brown', hex: '#5a3a1e' },
  { name: 'Light brown', hex: '#7c5733' },
  { name: 'Hazel', hex: '#8a6a2f' },
  { name: 'Amber', hex: '#d08a1d' },
  { name: 'Olive', hex: '#66783a' },
  { name: 'Green', hex: '#3f8a4f' },
  { name: 'Blue-grey', hex: '#6a8aa3' },
  { name: 'Grey', hex: '#8b98a5' },
  { name: 'Light blue', hex: '#7aaedb' },
  { name: 'Blue', hex: '#3a78c9' },
  { name: 'Violet', hex: '#7a4fd1' },
] as const;

export type Sex = (typeof SEXES)[number];
export type Face = (typeof FACES)[number];
export type HairStyle = (typeof HAIR_STYLES)[Sex][number]['id'];
export type FacialHair = (typeof FACIAL_HAIR)[number];

export interface Appearance {
  sex: Sex;
  face: Face;
  hairStyle: HairStyle;
  facialHair: FacialHair;
  hairColor: string;
  eyeColor: string;
}

export interface Character extends Appearance {
  firstName: string;
  lastName: string;
  job: Job;
}

export interface CabinDoorState {
  codeSet: boolean;
  open: boolean;
  animAt: number;
  openFrac: number;
}

/**
 * What a clone restores after death: the state of the character at the last upload. The on-person inventory at upload
 * time is recorded for reference; the death rules (on-person lost, closet kept) are not built yet, so nothing reads it.
 */
export interface MemorySnapshot {
  version: 1;
  /** Server time (ms) of the upload. */
  at: number;
  questStep: QuestStep;
  inventory: Inventory | null;
}

export interface ShipMeta {
  gameStarted: boolean;
  gameStartedAt: number | null;
  shipName: string;
  transitYears: number;
  cabinDoor: CabinDoorState;
  /** Ship-wide item and material counts by id (Eatery food, Cargo Hold armor, printer and refinery materials). */
  stock: Record<string, number>;
  /** Raw materials in the refinery (beamed from atmosphere finds). */
  refineryStock: Record<string, number>;
  /** Ship materials in the cargo hold (beamed from debris finds). */
  cargoHoldStock: Record<string, number>;
  scanResults: ScanResultEntry[];
}

/** The only uniform so far; everyone starts with the crew jumpsuit equipped. */
export const UNIFORMS = ['crew'] as const;
export type Uniform = (typeof UNIFORMS)[number];

/**
 * A character saved on the server, as listed on the pick screen. Only the owner (same browser `clientId`) ever sees
 * their characters; the server decides what goes in the list.
 */
export interface SavedCharacter {
  id: string;
  character: Character;
  uniform: Uniform;
  isClone: boolean;
  questStep: QuestStep;
  berth: number | null;
  createdAt: number;
  lastPlayedAt: number;
  /** Another window is playing this character right now (picking it here takes over). */
  online: boolean;
  /** Why Board is unavailable at the moment (ship full, a Captain already aboard), or null. Re-checked on pick. */
  blocked: string | null;
}

/** A saved character as listed on the landing screen: the same record plus the ship it lives on. */
export interface ProfileCharacter extends SavedCharacter {
  shipCode: string;
  shipName: string;
}

export interface PlayerState {
  id: string;
  tube: number;
  character: Character | null;
  x: number;
  z: number;
  rot: number;
  moving: boolean;
  connected: boolean;
  /** Owned by the browser that hosted the ship. */
  isHost: boolean;
  isClone: boolean;
  hasPad: boolean;
  reportedIn: boolean;
  questStep: QuestStep;
  cloneTank: number | null;
  /** Claimed berth index (0 = Captain's berth, 1..9 = bunks), or null until the player uses a station. */
  berth: number | null;
  /** Server time (ms) of the last memory upload, or null. */
  lastUploadAt: number | null;
  /** On-person items: six carry slots and worn gear. The closet is private and sent to its owner only. */
  inventory: Inventory;
  /** Read Me Files opened from the inventory, saved to the data pad (newest first). */
  padFiles: PadFile[];
  /** Quest 2 progress, or null until the pad issues it on the Bridge. */
  scavenger: ScavengerState | null;
  skills: { scanning: ScanningSkill; transporter: import('./transporter').TransporterSkill };
}

/** [id, x, z, rot, moving] */
export type SnapEntry = [string, number, number, number, 0 | 1];

export type ClientMsg =
  /** Landing screen: list every character this browser owns, on any ship. Answered with `profile`. */
  | { t: 'hello'; clientId: string }
  /** `clientId` is the browser's stable id (localStorage); saved characters are tied to it. */
  | { t: 'host'; clientId: string }
  /** `legacyPlayerId` is the per-tab id older clients used; a character it owns is adopted by `clientId`. */
  | { t: 'join'; clientId: string; code: string; legacyPlayerId?: string }
  /** Resume a saved character; it spawns in its cabin or bunk room. */
  | { t: 'pickCharacter'; characterId: string }
  /** Start the creation flow for a fresh character. */
  | { t: 'newCharacter' }
  | { t: 'deleteCharacter'; characterId: string }
  /** Save and leave the world; the server answers `loggedOut` once the save file is written. */
  | { t: 'logout' }
  | { t: 'startGame' }
  | { t: 'create'; character: Character }
  | { t: 'move'; x: number; z: number; rot: number; moving: boolean }
  | { t: 'interact'; id: string; x: number; z: number }
  | { t: 'reportIn' }
  /** `keypad` is which side's keypad is being used (defaults to the corridor one); the server range-checks against it. */
  | { t: 'cabinKeypad'; action: 'set'; code: string; confirm: string; x: number; z: number; keypad?: string }
  | { t: 'cabinKeypad'; action: 'enter'; code: string; x: number; z: number; keypad?: string }
  | { t: 'cabinKeypad'; action: 'change'; current: string; code: string; confirm: string; x: number; z: number; keypad?: string }
  | { t: 'cabinKeypad'; action: 'exit'; x: number; z: number; keypad?: string }
  | { t: 'inv'; action: InventoryAction; x: number; z: number }
  /** Opening the data pad on the Bridge after the opening quest: receive the scavenger hunt (server checks place and step). */
  | { t: 'scavengerIssue'; x: number; z: number }
  /** Start a Bridge sensor scan (server owns the timer and the roll). */
  | { t: 'scanStart'; x: number; z: number }
  /** Beam material from a scan contact at a transporter pad. */
  | { t: 'transportStart'; padId: string; scanId: string; materialId: string; qty: number; x: number; z: number };

/**
 * Inventory actions. All are validated on the server (ownership, range, item rules); `x, z` is where the player
 * stands, synced like `interact`. Closet slots need the player beside their own berth's closet.
 */
export type InventoryAction =
  /** Move `qty` (default: the whole stack) between two slots; a different kind at `to` swaps whole stacks. */
  | { k: 'move'; from: SlotRef; to: SlotRef; qty?: number }
  /** Right click: eat / equip. */
  | { k: 'use'; loc: SlotRef }
  /** Right click a File: the server saves it to the data pad and answers with the text (`invResult.file`). */
  | { k: 'open'; loc: SlotRef }
  /** Take worn gear off into a carry slot (`to`, or the first free one). */
  | { k: 'unequip'; slot: EquipSlot; to?: SlotRef }
  | { k: 'delete'; loc: SlotRef; qty?: number }
  /** Take one `item` from a stock station (Eatery panel, Cargo Hold shelves). */
  | { k: 'take'; station: string; item: ItemId }
  /** Return `qty` of a stack to the stock of the station it came from. */
  | { k: 'putBack'; loc: SlotRef; qty?: number }
  /** Destroy one unit of a material listed on a refinery / cargo-hold stock panel. */
  | { k: 'destroyMaterial'; station: string; materialId: string };

export type ServerMsg =
  | { t: 'profile'; characters: ProfileCharacter[] }
  | { t: 'loggedOut' }
  /**
   * Reply to `host` / `join` (and to `deleteCharacter`): the ship and this browser's saved characters on it. The
   * client answers with `pickCharacter` or `newCharacter`; `welcome` follows.
   */
  | { t: 'characters'; code: string; ship: ShipMeta; characters: SavedCharacter[]; aboard: number }
  | { t: 'welcome'; code: string; you: string; ship: ShipMeta; players: PlayerState[] }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'createError'; message: string }
  | { t: 'playerUpdated'; player: PlayerState }
  /** A member left the crew for good: a deleted character, or a forming clone whose window closed. */
  | { t: 'playerLeft'; id: string }
  | { t: 'shipState'; ship: ShipMeta }
  | { t: 'notice'; message: string }
  | { t: 'snap'; p: SnapEntry[] }
  | { t: 'cabinDoor'; door: CabinDoorState }
  | { t: 'cabinKeypadResult'; ok: boolean; message?: string; flash?: 'green' | 'red'; dismissMs?: number; lockoutUntil?: number }
  /** The player's own closet contents (on welcome and after every change); never broadcast. */
  | { t: 'closet'; slots: Slots }
  /**
   * Result of an inventory action for the acting player: a use message, a refusal, or a pick-up note. `gained` is a
   * stack that just landed in the carry slots (the client opens the inventory); `file` is an opened File's text.
   */
  | { t: 'invResult'; ok: boolean; message?: string; gained?: ItemStack; file?: { name: string; text: string } }
  /**
   * Sent to the uploading player only. `claimed` is true for their first berth; `from` is the berth they moved out of
   * when the upload also switched bunks, else null.
   */
  | { t: 'memoryUpload'; berth: number; at: number; claimed: boolean; from: number | null }
  /** Scan timer started for this player. */
  | { t: 'scanProgress'; endsAt: number }
  /** Scan finished: hit or miss; skill counts only advance on hits. */
  | {
      t: 'scanComplete';
      hit: boolean;
      find: ScanResultEntry | null;
      skill: ScanningSkill;
      leveledUp: boolean;
      scanResults: ScanResultEntry[];
    }
  | { t: 'transportProgress'; endsAt: number }
  | {
      t: 'transportComplete';
      ok: boolean;
      message?: string;
      skill: import('./transporter').TransporterSkill;
      leveledUp: boolean;
      scanResults: ScanResultEntry[];
      refineryStock: Record<string, number>;
      cargoHoldStock: Record<string, number>;
    };

export const NAME_PATTERN = /^[\p{L}][\p{L}' -]{0,15}$/u;

export const defaultHairStyle = (sex: Sex): HairStyle => HAIR_STYLES[sex][0].id;

export const hairStyleAvailable = (sex: Sex, style: unknown) => HAIR_STYLES[sex].some((h) => h.id === style);

/** Characters saved before hairstyles had ids carry a `hairLength` of short or long. */
export function upgradeLegacyCharacter(c: Record<string, unknown>) {
  if (c.hairStyle === undefined && 'hairLength' in c) {
    const sex = c.sex === 'female' ? 'female' : 'male';
    c.hairStyle = sex === 'female' && c.hairLength === 'long' ? 'long' : defaultHairStyle(sex);
    delete c.hairLength;
  }
}

/**
 * Why a job cannot be taken given the jobs of the players aboard right now, or null. Only the Captain is unique (one
 * aboard at a time); any number of players may share the other jobs.
 */
export function jobCheck(onlineJobs: Job[], job: Job): string | null {
  if (!JOBS.includes(job)) return 'Unknown job.';
  if (job === 'Captain' && onlineJobs.includes('Captain')) return 'Captain is aboard right now.';
  return null;
}

export function shipFullMessage() {
  return `The ship is full right now (${MAX_CREW}/${MAX_CREW} aboard). Try again when someone logs out.`;
}

/**
 * Why a saved character cannot board right now, or null. Taking over a character that is already aboard never
 * needs a slot or a job check: it replaces that window.
 */
export function boardCheck(aboard: number, onlineJobs: Job[], job: Job, selfOnline: boolean): string | null {
  if (selfOnline) return null;
  if (aboard >= MAX_CREW) return shipFullMessage();
  return jobCheck(onlineJobs, job);
}

const INTERACT_ID = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function validateInteractId(id: unknown): string | null {
  if (typeof id !== 'string' || !INTERACT_ID.test(id)) return 'Unknown object.';
  return null;
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
    case 'host':
      return typeof m.clientId === 'string' ? { t: m.t, clientId: m.clientId } : null;
    case 'join':
      if (typeof m.clientId !== 'string') return null;
      return {
        t: 'join',
        clientId: m.clientId,
        code: typeof m.code === 'string' ? m.code : '',
        legacyPlayerId: typeof m.legacyPlayerId === 'string' ? m.legacyPlayerId : undefined,
      };
    case 'pickCharacter':
    case 'deleteCharacter':
      return typeof m.characterId === 'string' ? { t: m.t, characterId: m.characterId } : null;
    case 'startGame':
    case 'reportIn':
    case 'newCharacter':
    case 'logout':
      return { t: m.t };
    case 'scavengerIssue':
    case 'scanStart':
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      return { t: m.t, x: m.x as number, z: m.z as number };
    case 'transportStart':
      if (typeof m.padId !== 'string' || typeof m.scanId !== 'string' || typeof m.materialId !== 'string') return null;
      if (typeof m.qty !== 'number' || !Number.isFinite(m.qty)) return null;
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      return {
        t: 'transportStart',
        padId: m.padId,
        scanId: m.scanId,
        materialId: m.materialId,
        qty: m.qty,
        x: m.x as number,
        z: m.z as number,
      };
    case 'create':
      return m.character ? { t: 'create', character: m.character as Character } : null;
    case 'move':
      if (![m.x, m.z, m.rot].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      return { t: 'move', x: m.x as number, z: m.z as number, rot: m.rot as number, moving: !!m.moving };
    case 'interact': {
      const err = validateInteractId(m.id);
      if (err) return null;
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      return { t: 'interact', id: m.id as string, x: m.x as number, z: m.z as number };
    }
    case 'cabinKeypad': {
      const action = m.action;
      if (action !== 'set' && action !== 'enter' && action !== 'change' && action !== 'exit') return null;
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      const code = typeof m.code === 'string' ? m.code : '';
      const confirm = typeof m.confirm === 'string' ? m.confirm : '';
      const current = typeof m.current === 'string' ? m.current : '';
      const keypad = typeof m.keypad === 'string' ? m.keypad : undefined;
      if (action === 'exit') return { t: 'cabinKeypad', action, x: m.x as number, z: m.z as number, keypad };
      if (action === 'set') return { t: 'cabinKeypad', action, code, confirm, x: m.x as number, z: m.z as number, keypad };
      if (action === 'enter') return { t: 'cabinKeypad', action, code, x: m.x as number, z: m.z as number, keypad };
      return { t: 'cabinKeypad', action, current, code, confirm, x: m.x as number, z: m.z as number, keypad };
    }
    case 'inv': {
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      const action = parseInventoryAction(m.action);
      return action ? { t: 'inv', action, x: m.x as number, z: m.z as number } : null;
    }
    default:
      return null;
  }
}

const qtyOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
const slotRef = (v: SlotRef): SlotRef => ({ c: v.c, i: v.i });

export function parseInventoryAction(raw: unknown): InventoryAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.k) {
    case 'move':
      if (!validSlotRef(a.from) || !validSlotRef(a.to)) return null;
      return { k: 'move', from: slotRef(a.from), to: slotRef(a.to), qty: qtyOf(a.qty) };
    case 'use':
    case 'open':
      return validSlotRef(a.loc) ? { k: a.k, loc: slotRef(a.loc) } : null;
    case 'unequip':
      if (a.slot !== 'suit' && a.slot !== 'armor') return null;
      if (a.to !== undefined && !validSlotRef(a.to)) return null;
      return { k: 'unequip', slot: a.slot, to: a.to ? slotRef(a.to as SlotRef) : undefined };
    case 'delete':
      return validSlotRef(a.loc) ? { k: 'delete', loc: slotRef(a.loc), qty: qtyOf(a.qty) } : null;
    case 'take':
      if (validateInteractId(a.station) || !isItemId(a.item)) return null;
      return { k: 'take', station: a.station as string, item: a.item };
    case 'putBack':
      return validSlotRef(a.loc) ? { k: 'putBack', loc: slotRef(a.loc), qty: qtyOf(a.qty) } : null;
    case 'destroyMaterial':
      if (validateInteractId(a.station) || typeof a.materialId !== 'string' || !a.materialId) return null;
      return { k: 'destroyMaterial', station: a.station as string, materialId: a.materialId };
    default:
      return null;
  }
}

export function validateCharacter(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'Missing character.';
  const ch = c as Record<string, unknown>;
  if (!SEXES.includes(ch.sex as Sex)) return 'Pick male or female.';
  if (!FACES.includes(ch.face as Face)) return 'Pick a face.';
  if (!hairStyleAvailable(ch.sex as Sex, ch.hairStyle)) return 'Pick a hairstyle.';
  if (!FACIAL_HAIR.includes(ch.facialHair as FacialHair)) return 'Pick facial hair.';
  if (ch.sex === 'female' && ch.facialHair !== 'none') return 'Facial hair is only available for men.';
  if (!HAIR_COLORS.some((h) => h.hex === ch.hairColor)) return 'Pick a hair color.';
  if (!EYE_COLORS.some((h) => h.hex === ch.eyeColor)) return 'Pick an eye color.';
  if (!JOBS.includes(ch.job as Job)) return 'Pick a starting job.';
  for (const key of ['firstName', 'lastName'] as const) {
    const v = typeof ch[key] === 'string' ? (ch[key] as string).trim() : '';
    const label = key === 'firstName' ? 'First name' : 'Last name';
    if (!v) return `${label} is required.`;
    if (!NAME_PATTERN.test(v)) return `${label} must be 1–16 letters (spaces, ' and - allowed).`;
  }
  return null;
}
