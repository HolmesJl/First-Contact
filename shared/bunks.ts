/**
 * Memory upload stations: one glowing data pad on every berth (the nine bunks and the Captain's bed). Using a free
 * station claims the berth for that player (and releases their previous one: players may move bunks); every use
 * records a memory snapshot on the server (what a future clone would restore). Stations work at any point, independent
 * of quest progress. Placement is derived from the bunk and bed prop boxes in shipInterior.ts.
 */
import type { Job, PlayerState } from './protocol';
import type { Facing } from './shipLayout';
import { BERTHS, BUNK_SLAB_Y, BUNK_STACKS, FACE_OUT, PROPS, SPACE_NAMES, standPointOnFace, type Prop } from './shipInterior';

export const MEMORY_STATION_PREFIX = 'memory-upload-';
export const memoryStationId = (berth: number) => `${MEMORY_STATION_PREFIX}${berth}`;

export function berthFromMemoryStationId(id: string): number | null {
  if (!id.startsWith(MEMORY_STATION_PREFIX)) return null;
  const n = Number(id.slice(MEMORY_STATION_PREFIX.length));
  return Number.isInteger(n) && MEMORY_STATIONS.some((s) => s.berth === n) ? n : null;
}

export const isMemoryStationId = (id: string) => berthFromMemoryStationId(id) !== null;

export const berthLabel = (berth: number) => (berth === 0 ? "Captain's berth" : `Bunk ${berth}`);

export interface MemoryStation {
  interactId: string;
  berth: number;
  propId: string;
  /** Display name of the room (HUD and objective text). */
  room: string;
  /** Pad mount point and the direction its screen faces. */
  x: number;
  y: number;
  z: number;
  face: Facing;
  /** Where the player stands to use it (interact range is measured from here). */
  stand: { x: number; z: number };
}

/** Pads sit toward the closet end of a bunk so they clear the ladder on the other end. */
const BUNK_PAD_SLIDE = 0.55;
const PAD_STANDOFF = 0.04;

function placeStation(berth: number): MemoryStation {
  const b = BERTHS.find((x) => x.index === berth);
  if (!b) throw new Error(`unknown berth ${berth}`);
  let prop: Prop | undefined;
  let y: number;
  let slide: number;
  if (b.room === 'cabin') {
    prop = PROPS.find((p) => p.id === 'captain-bed');
    y = (prop?.h ?? 0.6) + 0.5;
    slide = 0;
  } else {
    const stack = Math.floor((berth - 1) / 3) + 1;
    const tier = (berth - 1) % 3;
    prop = PROPS.find((p) => p.id === `bunk-stack-${stack}`);
    y = BUNK_SLAB_Y[tier] + 0.66;
    slide = BUNK_PAD_SLIDE;
  }
  if (!prop) throw new Error(`memory station ${berth}: missing prop`);
  const face = prop.face ?? 'S';
  const f = FACE_OUT[face];
  const half = Math.abs(f.dx) > 0 ? prop.sx / 2 : prop.sz / 2;
  const stand = standPointOnFace(prop, 0.22, slide);
  return {
    interactId: memoryStationId(berth),
    berth,
    propId: prop.id,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x: prop.x + f.dx * (half + PAD_STANDOFF) + (f.dx === 0 ? slide : 0),
    y,
    z: prop.z + f.dz * (half + PAD_STANDOFF) + (f.dx !== 0 ? slide : 0),
    face,
    stand: { x: stand.x, z: stand.z },
  };
}

export const MEMORY_STATIONS: readonly MemoryStation[] = BERTHS.map((b) => placeStation(b.index));

export const memoryStationFor = (berth: number) => MEMORY_STATIONS.find((s) => s.berth === berth);

/** The Captain's berth is in the cabin; everyone else sleeps in the bunk room. */
export function berthAllowedForJob(berth: number, job: Job): boolean {
  return berth === 0 ? job === 'Captain' : job !== 'Captain';
}

export interface BerthOwner {
  id: string;
  name: string;
}

export function berthOwners(players: Iterable<PlayerState>): Map<number, BerthOwner> {
  const out = new Map<number, BerthOwner>();
  for (const p of players) {
    if (p.berth === null || !p.character) continue;
    out.set(p.berth, { id: p.id, name: `${p.character.firstName} ${p.character.lastName}` });
  }
  return out;
}

/** Hover line for a station, given who owns it (if anyone) and who is looking. */
export function memoryStationHoverPrompt(berth: number, owner: BerthOwner | null, me: PlayerState | null): string {
  const label = berthLabel(berth);
  const job = me?.character?.job ?? null;
  if (owner && me && owner.id === me.id) return `Upload memories · ${label} · yours`;
  if (owner) return `${label} · ${owner.name}'s`;
  if (job && !berthAllowedForJob(berth, job)) {
    return berth === 0 ? `${label} · Captain only` : `${label} · crew bunk`;
  }
  if (me && me.berth !== null) return `${label} · free · move here`;
  return `Claim ${label} and upload memories`;
}

/**
 * Stations to light up for the upload objective: the player's own berth once claimed, otherwise every free berth they
 * are allowed to take.
 */
export function uploadObjectiveStationIds(me: PlayerState, players: Iterable<PlayerState>): string[] {
  if (!me.character) return [];
  if (me.berth !== null) return [memoryStationId(me.berth)];
  const owners = berthOwners(players);
  const job = me.character.job;
  return MEMORY_STATIONS.filter((s) => !owners.has(s.berth) && berthAllowedForJob(s.berth, job)).map((s) => s.interactId);
}

/** Facing into the bunk room from a berth's standing spot (west stacks face east and vice versa). */
const BUNK_ROOM_FACING = { W: Math.PI / 2, E: -Math.PI / 2 } as const;
/** Middle of the bunk room, facing the desk; for crew who have not claimed a bunk yet. */
const BUNK_ROOM_SPAWN = { x: -54.2, z: 5.2, rot: 0 };
/** Beside the Captain's bed, facing into the cabin. */
const CABIN_SPAWN = { x: BERTHS[0].x, z: BERTHS[0].z, rot: Math.PI / 2 };

/**
 * Where a saved character appears on login: the Captain in the cabin, everyone else in the bunk room (at their own
 * bunk once they have claimed one). Logging out is treated as going back to quarters, so nobody is ever stranded
 * wherever the ship happened to be when they left.
 */
export function homeSpawnFor(job: Job, berth: number | null): { x: number; z: number; rot: number } {
  if (job === 'Captain') return { ...CABIN_SPAWN };
  const b = berth !== null && berthAllowedForJob(berth, job) ? BERTHS.find((x) => x.index === berth) : undefined;
  if (!b) return { ...BUNK_ROOM_SPAWN };
  const stack = Math.floor((b.index - 1) / 3);
  const side = BUNK_STACKS[stack]?.side ?? 'W';
  return { x: b.x, z: b.z, rot: BUNK_ROOM_FACING[side] };
}

export function formatUploadTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
