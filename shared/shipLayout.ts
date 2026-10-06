/**
 * Seed-core ship layout (hub-and-spoke greybox), transcribed from ship-layout.md.
 * Data only: shared by the exterior builder now and by the interior greybox and server later.
 *
 * Frame: the hibernation and cloning bay is the origin (it keeps the old lab numbers).
 * +x = starboard, +z = bow, y up, level 0 floor at y = 0. Metres.
 * `outer` rects are wall centre lines (for rendering); `walk` rects are the walkable interiors.
 */

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Obstacle = { x: number; z: number; r: number } | ({ rect: true } & Rect);
/** 0 = main deck, -1 = lower deck. Floor y = level * DECK_PITCH. */
export type Level = number;

export type ModuleId =
  | 'commons'
  | 'bay'
  | 'fore-node'
  | 'bridge'
  | 'ops'
  | 'cabin'
  | 'quarters'
  | 'greenhouse'
  | 'medical'
  | 'hold'
  | 'aft-node'
  | 'science'
  | 'engine'
  | 'hangar';

export type RoomId =
  | 'commons'
  | 'bay'
  | 'fore-node'
  | 'aft-node'
  | 'bridge'
  | 'ops'
  | 'engine'
  | 'science'
  | 'bunks'
  | 'cabin'
  | 'greenhouse'
  | 'medical'
  | 'hold'
  | 'hangar';

export type CorridorId =
  | 'c-fore'
  | 'c-bridge'
  | 'c-ops'
  | 'c-cabin'
  | 'c-aft'
  | 'c-engine'
  | 'c-science'
  | 'c-quarters'
  | 'c-greenhouse'
  | 'c-medical'
  | 'c-hold'
  | 'c-bay'
  | 'c-lower';

export type SpaceId = RoomId | CorridorId;
export type Job = 'captain' | 'engineer' | 'military' | 'doctor' | 'botanist';
export type Facing = 'N' | 'S' | 'E' | 'W';

/** Ceiling shape. Flat by default; the greenhouse is the first non-flat ceiling. */
export type Ceiling = { kind: 'dome'; apex: number };

export interface Room {
  id: RoomId;
  module: ModuleId;
  level: Level;
  outer: Rect;
  walk: Rect;
  /** Wall height in metres (floor to ceiling rim). */
  height: number;
  /** Only set for non-flat ceilings. `apex` is metres above the floor. */
  ceiling?: Ceiling;
  obstacles: Obstacle[];
  job?: Job;
}

/** A strut: a first-class segment between two spaces, door at each end. */
export interface Corridor {
  id: CorridorId;
  level: Level;
  axis: 'x' | 'z';
  width: number;
  /** Ceiling height in metres. */
  height: number;
  outer: Rect;
  walk: Rect;
  /** Spaces joined, in the order of `ends`. The lower strut starts at the lift landing instead of a room. */
  joins: [SpaceId | 'lift-commons', SpaceId];
  /** Door ids at each end (the lower strut's first end is its lift id). */
  ends: [string, string];
}

export interface Door {
  id: string;
  level: Level;
  a: SpaceId;
  b: SpaceId;
  axis: 'x' | 'z';
  x: number;
  z: number;
  width: number;
  locked?: 'captain' | 'crew';
}

export interface Lift {
  id: string;
  pad: Rect;
  levels: Level[];
}

export type StationKind = string;
export interface Station {
  id: string;
  kind: StationKind;
  room: RoomId;
  level: Level;
  x: number;
  z: number;
  rot: number;
  radius: number;
  job?: Job;
}
export interface Spawn {
  id: string;
  kind: 'pod' | 'tank';
  room: RoomId;
  level: Level;
  x: number;
  z: number;
  rot: number;
}
export interface Berth {
  index: number;
  room: 'cabin' | 'bunks';
  level: Level;
  x: number;
  z: number;
  closet: { x: number; z: number };
}

/** A free face where a strut + module can attach. N = stern, S = bow, E = starboard, W = port. */
export interface Dock {
  id: string;
  kind: 'spine' | 'ring' | 'wing' | 'prow' | 'bay';
  module: ModuleId;
  level: Level;
  x: number;
  z: number;
  facing: Facing;
  width: number;
  occupant: CorridorId | null;
}

export interface ShipModule {
  id: ModuleId;
  kind: 'hub' | 'junction' | 'room';
  level: Level;
  frame: { x: number; z: number; rot: number };
  rooms: Room[];
  stations: Station[];
  spawns: Spawn[];
  berths: Berth[];
}

export interface ShipLayout {
  version: number;
  modules: ShipModule[];
  corridors: Corridor[];
  doors: Door[];
  lifts: Lift[];
  docks: Dock[];
}

export const DECK_PITCH = 5.0;
export const WALL_HEIGHT = 3.2;
export const STRUT_WIDTH = 4.0;
export const floorY = (level: Level) => level * DECK_PITCH;

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

const IDENTITY = { x: 0, z: 0, rot: 0 };

function mod(
  id: ModuleId,
  kind: ShipModule['kind'],
  level: Level,
  room: Omit<Room, 'module' | 'level' | 'height' | 'obstacles'> & Partial<Pick<Room, 'height' | 'obstacles'>>,
): ShipModule {
  return {
    id,
    kind,
    level,
    frame: IDENTITY,
    rooms: [{ module: id, level, height: WALL_HEIGHT, obstacles: [], ...room }],
    stations: [],
    spawns: [],
    berths: [],
  };
}

export const SHIP_LAYOUT: ShipLayout = {
  version: 1,
  modules: [
    mod('commons', 'hub', 0, {
      id: 'commons',
      outer: R(-46.2, -30.2, -6.2, 7.3),
      walk: R(-45.3, -31.1, -5.3, 6.4),
      obstacles: [{ x: -38.2, z: 1.6, r: 1.25 }],
    }),
    mod('bay', 'room', 0, { id: 'bay', outer: R(-10.2, 10.2, -6.2, 7.3), walk: R(-9.3, 9.3, -3.6, 6.3) }),
    mod('fore-node', 'junction', 0, { id: 'fore-node', outer: R(-41.2, -35.2, 15.3, 21.3), walk: R(-40.3, -36.1, 16.2, 20.4) }),
    mod('bridge', 'room', 0, { id: 'bridge', outer: R(-45.2, -31.2, 25.3, 35.3), walk: R(-44.3, -32.1, 26.2, 34.4) }),
    mod('ops', 'room', 0, { id: 'ops', outer: R(-29.2, -17.2, 15, 27), walk: R(-28.3, -18.1, 15.9, 26.1) }),
    mod('cabin', 'room', 0, { id: 'cabin', outer: R(-55.2, -47.2, 14.3, 22.3), walk: R(-54.3, -48.1, 15.2, 21.4) }),
    mod('quarters', 'room', 0, { id: 'bunks', outer: R(-58.2, -50.2, 1, 11), walk: R(-57.3, -51.1, 1.9, 10.1) }),
    mod('greenhouse', 'room', 0, {
      id: 'greenhouse',
      outer: R(-79.2, -62.2, -18, -1),
      walk: R(-78.3, -63.1, -17.1, -1.9),
      ceiling: { kind: 'dome', apex: 7 },
      job: 'botanist',
    }),
    mod('medical', 'room', 0, { id: 'medical', outer: R(-26.2, -14.2, 1, 13), walk: R(-25.3, -15.1, 1.9, 12.1), job: 'doctor' }),
    mod('hold', 'room', 0, { id: 'hold', outer: R(-26.2, -14.2, -13, -1), walk: R(-25.3, -15.1, -12.1, -1.9) }),
    mod('aft-node', 'junction', 0, { id: 'aft-node', outer: R(-41.2, -35.2, -20.2, -14.2), walk: R(-40.3, -36.1, -19.3, -15.1) }),
    mod('science', 'room', 0, { id: 'science', outer: R(-59.2, -47.2, -27, -15), walk: R(-58.3, -48.1, -26.1, -15.9), job: 'engineer' }),
    mod('engine', 'room', 0, { id: 'engine', outer: R(-45.2, -31.2, -36.2, -24.2), walk: R(-44.3, -32.1, -35.3, -25.1), job: 'engineer' }),
    mod('hangar', 'room', -1, { id: 'hangar', outer: R(-38.2, -22.2, -34, -16), walk: R(-37.3, -23.1, -33.1, -16.9) }),
  ],

  corridors: [
    { id: 'c-fore', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, 7.3, 15.3), walk: R(-39.3, -37.1, 8.2, 14.4), joins: ['commons', 'fore-node'], ends: ['commons-fore', 'fore-node-s'] },
    { id: 'c-bridge', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, 21.3, 25.3), walk: R(-39.3, -37.1, 22.2, 24.4), joins: ['fore-node', 'bridge'], ends: ['fore-node-bridge', 'bridge-in'] },
    { id: 'c-ops', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-35.2, -29.2, 16.3, 20.3), walk: R(-34.3, -30.1, 17.2, 19.4), joins: ['fore-node', 'ops'], ends: ['fore-node-ops', 'ops-in'] },
    { id: 'c-cabin', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-47.2, -41.2, 16.3, 20.3), walk: R(-46.3, -42.1, 17.2, 19.4), joins: ['fore-node', 'cabin'], ends: ['fore-node-cabin', 'cabin-in'] },
    { id: 'c-aft', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, -14.2, -6.2), walk: R(-39.3, -37.1, -13.3, -7.1), joins: ['commons', 'aft-node'], ends: ['commons-aft', 'aft-node-n'] },
    { id: 'c-engine', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, -24.2, -20.2), walk: R(-39.3, -37.1, -23.3, -21.1), joins: ['aft-node', 'engine'], ends: ['aft-node-engine', 'engine-in'] },
    { id: 'c-science', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-47.2, -41.2, -19.2, -15.2), walk: R(-46.3, -42.1, -18.3, -16.1), joins: ['aft-node', 'science'], ends: ['aft-node-sci', 'science-in'] },
    { id: 'c-quarters', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-50.2, -46.2, 1.5, 5.5), walk: R(-49.3, -47.1, 2.4, 4.6), joins: ['commons', 'bunks'], ends: ['commons-quarters', 'bunks-in'] },
    { id: 'c-greenhouse', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-62.2, -46.2, -5.5, -1.5), walk: R(-61.3, -47.1, -4.6, -2.4), joins: ['commons', 'greenhouse'], ends: ['commons-greenhouse', 'greenhouse-in'] },
    { id: 'c-medical', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-30.2, -26.2, 1.5, 5.5), walk: R(-29.3, -27.1, 2.4, 4.6), joins: ['commons', 'medical'], ends: ['commons-medical', 'medical-in'] },
    { id: 'c-hold', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-30.2, -26.2, -5.5, -1.5), walk: R(-29.3, -27.1, -4.6, -2.4), joins: ['commons', 'hold'], ends: ['commons-hold', 'hold-in'] },
    { id: 'c-bay', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-14.2, -10.2, 1.5, 5.5), walk: R(-13.3, -11.1, 2.4, 4.6), joins: ['medical', 'bay'], ends: ['medical-bay', 'bay-in'] },
    { id: 'c-lower', level: -1, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-34.2, -30.2, -16, 2.5), walk: R(-33.3, -31.1, -15.1, 1.6), joins: ['lift-commons', 'hangar'], ends: ['lift-commons', 'lower-hangar'] },
  ],

  doors: [
    { id: 'commons-fore', level: 0, a: 'commons', b: 'c-fore', axis: 'x', x: -38.2, z: 7.3, width: 3.0 },
    { id: 'fore-node-s', level: 0, a: 'c-fore', b: 'fore-node', axis: 'x', x: -38.2, z: 15.3, width: 3.0 },
    { id: 'fore-node-bridge', level: 0, a: 'fore-node', b: 'c-bridge', axis: 'x', x: -38.2, z: 21.3, width: 3.0 },
    { id: 'bridge-in', level: 0, a: 'c-bridge', b: 'bridge', axis: 'x', x: -38.2, z: 25.3, width: 3.0 },
    { id: 'fore-node-ops', level: 0, a: 'fore-node', b: 'c-ops', axis: 'z', x: -35.2, z: 18.3, width: 3.0 },
    { id: 'ops-in', level: 0, a: 'c-ops', b: 'ops', axis: 'z', x: -29.2, z: 18.3, width: 3.0 },
    { id: 'fore-node-cabin', level: 0, a: 'fore-node', b: 'c-cabin', axis: 'z', x: -41.2, z: 18.3, width: 3.0 },
    { id: 'cabin-in', level: 0, a: 'c-cabin', b: 'cabin', axis: 'z', x: -47.2, z: 18.3, width: 1.6, locked: 'captain' },
    { id: 'commons-aft', level: 0, a: 'commons', b: 'c-aft', axis: 'x', x: -38.2, z: -6.2, width: 3.0 },
    { id: 'aft-node-n', level: 0, a: 'c-aft', b: 'aft-node', axis: 'x', x: -38.2, z: -14.2, width: 3.0 },
    { id: 'aft-node-engine', level: 0, a: 'aft-node', b: 'c-engine', axis: 'x', x: -38.2, z: -20.2, width: 3.0 },
    { id: 'engine-in', level: 0, a: 'c-engine', b: 'engine', axis: 'x', x: -38.2, z: -24.2, width: 3.0 },
    { id: 'aft-node-sci', level: 0, a: 'aft-node', b: 'c-science', axis: 'z', x: -41.2, z: -17.2, width: 3.0 },
    { id: 'science-in', level: 0, a: 'c-science', b: 'science', axis: 'z', x: -47.2, z: -17.2, width: 3.0 },
    { id: 'commons-quarters', level: 0, a: 'commons', b: 'c-quarters', axis: 'z', x: -46.2, z: 3.5, width: 2.8 },
    { id: 'bunks-in', level: 0, a: 'c-quarters', b: 'bunks', axis: 'z', x: -50.2, z: 3.5, width: 3.0 },
    { id: 'commons-greenhouse', level: 0, a: 'commons', b: 'c-greenhouse', axis: 'z', x: -46.2, z: -3.5, width: 2.8 },
    { id: 'greenhouse-in', level: 0, a: 'c-greenhouse', b: 'greenhouse', axis: 'z', x: -62.2, z: -3.5, width: 3.0 },
    { id: 'commons-medical', level: 0, a: 'commons', b: 'c-medical', axis: 'z', x: -30.2, z: 3.5, width: 2.8 },
    { id: 'medical-in', level: 0, a: 'c-medical', b: 'medical', axis: 'z', x: -26.2, z: 3.5, width: 3.0 },
    { id: 'medical-bay', level: 0, a: 'medical', b: 'c-bay', axis: 'z', x: -14.2, z: 3.5, width: 3.0 },
    { id: 'bay-in', level: 0, a: 'c-bay', b: 'bay', axis: 'z', x: -10.2, z: 3.5, width: 2.8 },
    { id: 'commons-hold', level: 0, a: 'commons', b: 'c-hold', axis: 'z', x: -30.2, z: -3.5, width: 2.8 },
    { id: 'hold-in', level: 0, a: 'c-hold', b: 'hold', axis: 'z', x: -26.2, z: -3.5, width: 3.0 },
    { id: 'lower-hangar', level: -1, a: 'c-lower', b: 'hangar', axis: 'x', x: -32.2, z: -16.0, width: 3.0 },
  ],

  lifts: [{ id: 'lift-commons', pad: R(-33.3, -31.1, -0.7, 1.5), levels: [0, -1] }],

  docks: [
    { id: 'spine', kind: 'spine', module: 'engine', level: 0, x: -38.2, z: -36.2, facing: 'N', width: 6, occupant: null },
    { id: 'prow', kind: 'prow', module: 'bridge', level: 0, x: -38.2, z: 35.3, facing: 'S', width: 4, occupant: null },
    { id: 'wing-sensor', kind: 'wing', module: 'bridge', level: 0, x: -45.2, z: 30.3, facing: 'W', width: 3, occupant: null },
    { id: 'wing-ops', kind: 'wing', module: 'ops', level: 0, x: -17.2, z: 21, facing: 'E', width: 3, occupant: null },
    { id: 'ext-bay', kind: 'wing', module: 'bay', level: 0, x: 10.2, z: 0.5, facing: 'E', width: 3, occupant: null },
    { id: 'ring-resid', kind: 'ring', module: 'quarters', level: 0, x: -58.2, z: 6, facing: 'W', width: 3, occupant: null },
    { id: 'ring-agri', kind: 'ring', module: 'greenhouse', level: 0, x: -79.2, z: -9.5, facing: 'W', width: 3, occupant: null },
    { id: 'ring-ind', kind: 'ring', module: 'aft-node', level: 0, x: -35.2, z: -17.2, facing: 'E', width: 3, occupant: null },
    { id: 'hold-ext', kind: 'wing', module: 'hold', level: 0, x: -20.2, z: -13, facing: 'N', width: 3, occupant: null },
    { id: 'bay-hull', kind: 'bay', module: 'hangar', level: -1, x: -22.2, z: -25, facing: 'E', width: 3, occupant: null },
  ],
};
