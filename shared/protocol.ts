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
export const FACES = ['smiling', 'serious', 'angry', 'flirty'] as const;
export const HAIR_LENGTHS = ['short', 'long'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard'] as const;

export const HAIR_COLORS = [
  { name: 'Black', hex: '#1c1a1f' },
  { name: 'Dark brown', hex: '#3b2417' },
  { name: 'Brown', hex: '#6e4526' },
  { name: 'Auburn', hex: '#8e3b1f' },
  { name: 'Copper', hex: '#c0521f' },
  { name: 'Blonde', hex: '#d8b56d' },
  { name: 'Platinum', hex: '#e9e2d0' },
  { name: 'Silver', hex: '#9aa3ad' },
  { name: 'Cobalt', hex: '#3f7bff' },
  { name: 'Violet', hex: '#8e4dff' },
] as const;

export const EYE_COLORS = [
  { name: 'Brown', hex: '#5a3a1e' },
  { name: 'Hazel', hex: '#8a6a2f' },
  { name: 'Green', hex: '#3f8a4f' },
  { name: 'Blue', hex: '#3a78c9' },
  { name: 'Grey', hex: '#8b98a5' },
  { name: 'Amber', hex: '#d08a1d' },
  { name: 'Violet', hex: '#7a4fd1' },
] as const;

export type Sex = (typeof SEXES)[number];
export type Face = (typeof FACES)[number];
export type HairLength = (typeof HAIR_LENGTHS)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];

export interface Appearance {
  sex: Sex;
  face: Face;
  hairLength: HairLength;
  facialHair: FacialHair;
  hairColor: string;
  eyeColor: string;
}

export interface Character extends Appearance {
  firstName: string;
  lastName: string;
  job: Job;
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
}

/** [id, x, z, rot, moving] */
export type SnapEntry = [string, number, number, number, 0 | 1];

export type ClientMsg =
  | { t: 'host'; playerId: string }
  | { t: 'join'; playerId: string; code: string }
  | { t: 'create'; character: Character }
  | { t: 'move'; x: number; z: number; rot: number; moving: boolean };

export type ServerMsg =
  | { t: 'welcome'; code: string; you: string; hostId: string; players: PlayerState[] }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'createError'; message: string }
  | { t: 'playerUpdated'; player: PlayerState }
  | { t: 'snap'; p: SnapEntry[] };

export const NAME_PATTERN = /^[\p{L}][\p{L}' -]{0,15}$/u;

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

export function validateCharacter(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'Missing character.';
  const ch = c as Record<string, unknown>;
  if (!SEXES.includes(ch.sex as Sex)) return 'Pick male or female.';
  if (!FACES.includes(ch.face as Face)) return 'Pick a face.';
  if (!HAIR_LENGTHS.includes(ch.hairLength as HairLength)) return 'Pick a hair length.';
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
