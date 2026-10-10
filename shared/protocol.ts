import type { QuestStep } from './opening';

export const JOBS = ['Captain', 'Engineer', 'Military', 'Doctor', 'Botanist'] as const;
export type Job = (typeof JOBS)[number];

export const JOB_CAPS: Record<Job, number> = {
  Captain: 1,
  Engineer: 3,
  Military: 3,
  Doctor: 2,
  Botanist: 4,
};

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
 * What a clone restores after death: the state of the character at the last upload. Inventory does not exist yet, so
 * only the timestamp and quest progress are real; the inventory slots are reserved so the shape does not change when
 * carry slots, equipped gear and closets land (on-person items are lost on death, closet contents are kept).
 */
export interface MemorySnapshot {
  version: 1;
  /** Server time (ms) of the upload. */
  at: number;
  questStep: QuestStep;
  inventory: { carry: unknown[]; equipped: unknown[] } | null;
}

export interface ShipMeta {
  gameStarted: boolean;
  gameStartedAt: number | null;
  shipName: string;
  transitYears: number;
  cabinDoor: CabinDoorState;
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
  isClone: boolean;
  hasPad: boolean;
  reportedIn: boolean;
  questStep: QuestStep;
  cloneTank: number | null;
  /** Claimed berth index (0 = Captain's berth, 1..9 = bunks), or null until the player uses a station. */
  berth: number | null;
  /** Server time (ms) of the last memory upload, or null. */
  lastUploadAt: number | null;
}

/** [id, x, z, rot, moving] */
export type SnapEntry = [string, number, number, number, 0 | 1];

export type ClientMsg =
  | { t: 'host'; playerId: string }
  | { t: 'join'; playerId: string; code: string }
  | { t: 'startGame' }
  | { t: 'create'; character: Character }
  | { t: 'move'; x: number; z: number; rot: number; moving: boolean }
  | { t: 'interact'; id: string; x: number; z: number }
  | { t: 'reportIn' }
  | { t: 'cabinKeypad'; action: 'set'; code: string; confirm: string; x: number; z: number }
  | { t: 'cabinKeypad'; action: 'enter'; code: string; x: number; z: number }
  | { t: 'cabinKeypad'; action: 'change'; current: string; code: string; confirm: string; x: number; z: number };

export type ServerMsg =
  | { t: 'welcome'; code: string; you: string; hostId: string; ship: ShipMeta; players: PlayerState[] }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'createError'; message: string }
  | { t: 'playerUpdated'; player: PlayerState }
  | { t: 'shipState'; ship: ShipMeta }
  | { t: 'notice'; message: string }
  | { t: 'snap'; p: SnapEntry[] }
  | { t: 'cabinDoor'; door: CabinDoorState }
  | { t: 'cabinKeypadResult'; ok: boolean; message?: string; flash?: 'green' | 'red'; dismissMs?: number; lockoutUntil?: number }
  /**
   * Sent to the uploading player only. `claimed` is true for their first berth; `from` is the berth they moved out of
   * when the upload also switched bunks, else null.
   */
  | { t: 'memoryUpload'; berth: number; at: number; claimed: boolean; from: number | null };

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

/** Returns a reason the job can't be taken, or null if it's available. */
export function jobCheck(takenJobs: Job[], job: Job): string | null {
  if (!JOBS.includes(job)) return 'Unknown job.';
  const count = takenJobs.filter((j) => j === job).length;
  if (count >= JOB_CAPS[job]) return `All ${JOB_CAPS[job]} ${job} berths are taken.`;
  if (takenJobs.length >= MAX_CREW) return 'The crew is full.';
  const hasCaptain = takenJobs.includes('Captain');
  if (!hasCaptain && job !== 'Captain' && takenJobs.length >= MAX_CREW - 1) {
    return 'The last berth is reserved for the Captain.';
  }
  return null;
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
    case 'host':
    case 'join':
      return typeof m.playerId === 'string' ? (m as ClientMsg) : null;
    case 'startGame':
    case 'reportIn':
      return { t: m.t };
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
      if (action !== 'set' && action !== 'enter' && action !== 'change') return null;
      if (![m.x, m.z].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
      const code = typeof m.code === 'string' ? m.code : '';
      const confirm = typeof m.confirm === 'string' ? m.confirm : '';
      const current = typeof m.current === 'string' ? m.current : '';
      if (action === 'set') return { t: 'cabinKeypad', action, code, confirm, x: m.x as number, z: m.z as number };
      if (action === 'enter') return { t: 'cabinKeypad', action, code, x: m.x as number, z: m.z as number };
      return { t: 'cabinKeypad', action, current, code, confirm, x: m.x as number, z: m.z as number };
    }
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
