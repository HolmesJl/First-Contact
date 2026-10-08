/**
 * Seed-core ship layout (hub-and-spoke greybox), transcribed from ship-layout.md.
 * Data only: shared by the exterior builder now and by the interior greybox and server later.
 *
 * Frame: the hibernation and cloning bay is the origin (it keeps the old lab numbers).
 * +x = starboard, +z = bow, y up, level 0 floor at y = 0. Metres.
 * `outer` rects are wall centre lines (for rendering); `walk` rects are the walkable interiors.
 *
 * Revision 5 (interior pass): the NPC dorm's `dorm-grow` dock is gone (single-connection rule), `bunks-dorm` and
 * `dorm-in` are sealed doors, and the dorm and the Captain's cabin carry `maxPorts: 1`. Stations, props, spawns,
 * berths and the walkable-area derivation live in shipInterior.ts.
 *
 * Revision 4: the bridge is a faceted one-storey hull (taller walls, chamfered edges, flat front face, raised tiered
 * centre section) and corridors have a chamfered-rectangle cross-section. The bridge is exempt from the roof-clearance
 * rule: it blocks building above and below. The sensor arms are gone; nothing extends forward of the bridge body.
 *
 * Revision 3: roofs are flat or low-profile so nothing blocks a module placed on the level above or below.
 *
 * Revision 2 (exterior silhouette pass): rooms carry a `shape` and a `height`, the hangar and
 * engine swapped places (hangar aft of the Commons with a pass-through, engine detached further
 * aft), and an NPC dorm hangs off the bunk room. Deviations from ship-layout.md are listed in the PR.
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
  | 'npc-dorm'
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
  | 'npc-dorm'
  | 'hangar';

export type CorridorId =
  | 'c-fore'
  | 'c-bridge'
  | 'c-ops'
  | 'c-cabin'
  | 'c-aft'
  | 'c-engine'
  | 'c-spine'
  | 'c-dorm'
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

/**
 * Plan form of a module's hull.
 * box: rectangle; wedge: faceted hull with a flat-fronted tapered nose (+z end) and chamfered edges; cylinder: round walls;
 * spheroid: egg-shaped pod; drum: horizontal cylinder along z; hangar: tall block with a pass-through trench.
 */
export type ModuleShape = 'box' | 'wedge' | 'cylinder' | 'spheroid' | 'drum' | 'hangar';

/**
 * Roof form. `apex` is metres above the room's floor. Flat if absent.
 * dome: glass dome; vault: barrel vault along x; hip: pyramid roof; shed: single slope rising toward the stern;
 * tiered: stepped faceted superstructure on the roof centre (the bridge).
 * Only the dome, the tiered bridge superstructure and the greenhouse/hangar heights rise meaningfully above a
 * module's wall height; the rest are low-profile so a corridor or module on the level above or below is never
 * blocked. The bridge is exempt (see `blocksAbove` / `blocksBelow`).
 */
export type Ceiling = { kind: 'dome' | 'vault' | 'hip' | 'shed' | 'tiered'; apex: number };

/** A tunnel through a module that a strut continues along (the hangar's pass-through). */
export interface PassThrough {
  axis: 'z';
  x: number;
  width: number;
  /** Level whose floor the passage runs at. */
  level: Level;
}

export interface Room {
  id: RoomId;
  module: ModuleId;
  level: Level;
  outer: Rect;
  walk: Rect;
  shape: ModuleShape;
  /** Wall height in metres (floor to wall top, the tallest flat part of the hull). */
  height: number;
  /** Decks stacked inside the module. */
  storeys?: number;
  /** Size in metres of the hull edge chamfers (`wedge`): top and bottom bevels; rear plan corners are cut 1.5x this. */
  chamfer?: number;
  /** No module or corridor may be built on the level above (its roof is tiered and tall). For the build terminal. */
  blocksAbove?: boolean;
  /** No module or corridor may be built on the level below. For the build terminal. */
  blocksBelow?: boolean;
  /** Nose width in metres for `wedge` (the rear is the full outer width). */
  nose?: number;
  /** Length of the tapered nose for `wedge`; the hull is straight-sided behind it. */
  noseLength?: number;
  ceiling?: Ceiling;
  passThrough?: PassThrough;
  /** False for modules that are hull only (the NPC dorm shows a status panel instead). */
  walkable?: boolean;
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
  /** Not passable: a bulkhead with a panel on it (the NPC dorm). Interior only. */
  sealed?: boolean;
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
  /** Small leaf modules have a single connection and no free faces (NPC dorm, Captain's cabin). */
  maxPorts?: number;
}

export interface ShipLayout {
  version: number;
  modules: ShipModule[];
  corridors: Corridor[];
  doors: Door[];
  lifts: Lift[];
  docks: Dock[];
}

/** Modules that have a single connection point and no other ports. */
export const SINGLE_PORT_MODULES: ModuleId[] = ['npc-dorm', 'cabin'];

export const DECK_PITCH = 5.0;
export const WALL_HEIGHT = 3.2;
export const STRUT_WIDTH = 4.0;

/**
 * Corridor cross-section: an elongated octagon (chamfered rectangle). `clearWidth` is the walkable interior width
 * (= STRUT_WIDTH); the outer hull adds wall thickness. Chamfer legs are measured along each face.
 */
export const CORRIDOR_PROFILE = {
  clearWidth: STRUT_WIDTH,
  outerWidth: 4.6,
  outerHeight: 3.9,
  chamferX: 1.0,
  chamferY: 0.9,
} as const;
export const floorY = (level: Level) => level * DECK_PITCH;

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

const IDENTITY = { x: 0, z: 0, rot: 0 };

function mod(
  id: ModuleId,
  kind: ShipModule['kind'],
  level: Level,
  room: Omit<Room, 'module' | 'level' | 'height' | 'obstacles' | 'shape'> & Partial<Pick<Room, 'height' | 'obstacles' | 'shape'>>,
): ShipModule {
  return {
    id,
    kind,
    level,
    frame: IDENTITY,
    rooms: [{ module: id, level, shape: 'box', height: WALL_HEIGHT, obstacles: [], ...room }],
    stations: [],
    spawns: [],
    berths: [],
  };
}

export const SHIP_LAYOUT: ShipLayout = {
  version: 4,
  modules: [
    mod('commons', 'hub', 0, {
      id: 'commons',
      outer: R(-46.2, -30.2, -6.2, 7.3),
      walk: R(-45.3, -31.1, -5.3, 6.4),
      height: 5,
      obstacles: [{ x: -38.2, z: 1.6, r: 1.25 }],
    }),
    mod('bay', 'room', 0, {
      id: 'bay',
      outer: R(-10.2, 10.2, -6.2, 7.3),
      walk: R(-9.3, 9.3, -3.6, 6.3),
      height: 4.4,
      ceiling: { kind: 'vault', apex: 5.4 },
    }),
    mod('fore-node', 'junction', 0, {
      id: 'fore-node',
      outer: R(-41.2, -35.2, 15.3, 21.3),
      walk: R(-40.3, -36.1, 16.2, 20.4),
      shape: 'cylinder',
      height: 3.8,
    }),
    mod('bridge', 'room', 0, {
      id: 'bridge',
      outer: R(-44.2, -32.2, 25.3, 43.3),
      walk: R(-43.3, -33.1, 26.2, 36),
      shape: 'wedge',
      nose: 8,
      noseLength: 7,
      chamfer: 1,
      height: 5.5,
      storeys: 1,
      ceiling: { kind: 'tiered', apex: 10 },
      blocksAbove: true,
      blocksBelow: true,
    }),
    mod('ops', 'room', 0, {
      id: 'ops',
      outer: R(-29.2, -17.2, 15, 27),
      walk: R(-28.3, -18.1, 15.9, 26.1),
      height: 6,
    }),
    mod('cabin', 'room', 0, {
      id: 'cabin',
      outer: R(-55.2, -47.2, 14.3, 22.3),
      walk: R(-54.3, -48.1, 15.2, 21.4),
      shape: 'spheroid',
      height: 5.2,
    }),
    mod('quarters', 'room', 0, {
      id: 'bunks',
      outer: R(-58.2, -50.2, 1, 11),
      walk: R(-57.3, -51.1, 1.9, 10.1),
      height: 11,
    }),
    mod('npc-dorm', 'room', 0, {
      id: 'npc-dorm',
      outer: R(-70.2, -62.2, 2, 10),
      walk: R(-69.3, -63.1, 2.9, 9.1),
      shape: 'cylinder',
      height: 11,
      walkable: false,
    }),
    mod('greenhouse', 'room', 0, {
      id: 'greenhouse',
      outer: R(-79.2, -62.2, -18, -1),
      walk: R(-78.3, -63.1, -17.1, -1.9),
      shape: 'cylinder',
      height: 6.5,
      ceiling: { kind: 'dome', apex: 11 },
      job: 'botanist',
    }),
    mod('medical', 'room', 0, {
      id: 'medical',
      outer: R(-26.2, -14.2, 1, 13),
      walk: R(-25.3, -15.1, 1.9, 12.1),
      height: 4.4,
      ceiling: { kind: 'hip', apex: 5.1 },
      job: 'doctor',
    }),
    mod('hold', 'room', 0, {
      id: 'hold',
      outer: R(-26.2, -14.2, -13, -1),
      walk: R(-25.3, -15.1, -12.1, -1.9),
      height: 5.2,
    }),
    mod('aft-node', 'junction', 0, {
      id: 'aft-node',
      outer: R(-41.2, -35.2, -20.2, -14.2),
      walk: R(-40.3, -36.1, -19.3, -15.1),
      shape: 'cylinder',
      height: 3.8,
    }),
    mod('science', 'room', 0, {
      id: 'science',
      outer: R(-59.2, -47.2, -27, -15),
      walk: R(-58.3, -48.1, -26.1, -15.9),
      height: 4.2,
      ceiling: { kind: 'shed', apex: 5 },
      job: 'engineer',
    }),
    mod('hangar', 'room', -2, {
      id: 'hangar',
      outer: R(-46.2, -30.2, -47.2, -29.2),
      walk: R(-45.3, -31.1, -46.3, -30.1),
      shape: 'hangar',
      height: 13.4,
      passThrough: { axis: 'z', x: -38.2, width: 6, level: 0 },
    }),
    mod('engine', 'room', 0, {
      id: 'engine',
      outer: R(-45.2, -31.2, -71.2, -59.2),
      walk: R(-44.3, -32.1, -70.3, -60.1),
      shape: 'drum',
      height: 8,
      job: 'engineer',
    }),
  ],

  corridors: [
    { id: 'c-fore', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, 7.3, 15.3), walk: R(-39.3, -37.1, 8.2, 14.4), joins: ['commons', 'fore-node'], ends: ['commons-fore', 'fore-node-s'] },
    { id: 'c-bridge', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, 21.3, 25.3), walk: R(-39.3, -37.1, 22.2, 24.4), joins: ['fore-node', 'bridge'], ends: ['fore-node-bridge', 'bridge-in'] },
    { id: 'c-ops', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-35.2, -29.2, 16.3, 20.3), walk: R(-34.3, -30.1, 17.2, 19.4), joins: ['fore-node', 'ops'], ends: ['fore-node-ops', 'ops-in'] },
    { id: 'c-cabin', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-47.2, -41.2, 16.3, 20.3), walk: R(-46.3, -42.1, 17.2, 19.4), joins: ['fore-node', 'cabin'], ends: ['fore-node-cabin', 'cabin-in'] },
    { id: 'c-aft', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, -14.2, -6.2), walk: R(-39.3, -37.1, -13.3, -7.1), joins: ['commons', 'aft-node'], ends: ['commons-aft', 'aft-node-n'] },
    { id: 'c-engine', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, -29.2, -20.2), walk: R(-39.3, -37.1, -28.3, -21.1), joins: ['aft-node', 'hangar'], ends: ['aft-node-engine', 'hangar-pass-fore'] },
    { id: 'c-spine', level: 0, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-40.2, -36.2, -59.2, -47.2), walk: R(-39.3, -37.1, -58.3, -48.1), joins: ['hangar', 'engine'], ends: ['hangar-pass-aft', 'engine-in'] },
    { id: 'c-science', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-47.2, -41.2, -19.2, -15.2), walk: R(-46.3, -42.1, -18.3, -16.1), joins: ['aft-node', 'science'], ends: ['aft-node-sci', 'science-in'] },
    { id: 'c-quarters', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-50.2, -46.2, 1.5, 5.5), walk: R(-49.3, -47.1, 2.4, 4.6), joins: ['commons', 'bunks'], ends: ['commons-quarters', 'bunks-in'] },
    { id: 'c-greenhouse', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-67.5, -46.2, -5.5, -1.5), walk: R(-66.6, -47.1, -4.6, -2.4), joins: ['commons', 'greenhouse'], ends: ['commons-greenhouse', 'greenhouse-in'] },
    { id: 'c-dorm', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-62.2, -58.2, 4, 8), walk: R(-61.3, -59.1, 4.9, 7.1), joins: ['bunks', 'npc-dorm'], ends: ['bunks-dorm', 'dorm-in'] },
    { id: 'c-medical', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-30.2, -26.2, 1.5, 5.5), walk: R(-29.3, -27.1, 2.4, 4.6), joins: ['commons', 'medical'], ends: ['commons-medical', 'medical-in'] },
    { id: 'c-hold', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-30.2, -26.2, -5.5, -1.5), walk: R(-29.3, -27.1, -4.6, -2.4), joins: ['commons', 'hold'], ends: ['commons-hold', 'hold-in'] },
    { id: 'c-bay', level: 0, axis: 'x', width: 4, height: WALL_HEIGHT, outer: R(-14.2, -10.2, 1.5, 5.5), walk: R(-13.3, -11.1, 2.4, 4.6), joins: ['medical', 'bay'], ends: ['medical-bay', 'bay-in'] },
    { id: 'c-lower', level: -2, axis: 'z', width: 4, height: WALL_HEIGHT, outer: R(-34.2, -30.2, -29.2, 2.5), walk: R(-33.3, -31.1, -28.3, 1.6), joins: ['lift-commons', 'hangar'], ends: ['lift-commons', 'lower-hangar'] },
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
    { id: 'hangar-pass-fore', level: 0, a: 'c-engine', b: 'hangar', axis: 'x', x: -38.2, z: -29.2, width: 3.0 },
    { id: 'hangar-pass-aft', level: 0, a: 'hangar', b: 'c-spine', axis: 'x', x: -38.2, z: -47.2, width: 3.0 },
    { id: 'engine-in', level: 0, a: 'c-spine', b: 'engine', axis: 'x', x: -38.2, z: -59.2, width: 3.0 },
    { id: 'aft-node-sci', level: 0, a: 'aft-node', b: 'c-science', axis: 'z', x: -41.2, z: -17.2, width: 3.0 },
    { id: 'science-in', level: 0, a: 'c-science', b: 'science', axis: 'z', x: -47.2, z: -17.2, width: 3.0 },
    { id: 'commons-quarters', level: 0, a: 'commons', b: 'c-quarters', axis: 'z', x: -46.2, z: 3.5, width: 2.8 },
    { id: 'bunks-in', level: 0, a: 'c-quarters', b: 'bunks', axis: 'z', x: -50.2, z: 3.5, width: 3.0 },
    { id: 'bunks-dorm', level: 0, a: 'bunks', b: 'c-dorm', axis: 'z', x: -58.2, z: 6, width: 3.0, sealed: true },
    { id: 'dorm-in', level: 0, a: 'c-dorm', b: 'npc-dorm', axis: 'z', x: -62.2, z: 6, width: 3.0, sealed: true },
    { id: 'commons-greenhouse', level: 0, a: 'commons', b: 'c-greenhouse', axis: 'z', x: -46.2, z: -3.5, width: 2.8 },
    { id: 'greenhouse-in', level: 0, a: 'c-greenhouse', b: 'greenhouse', axis: 'z', x: -62.2, z: -3.5, width: 3.0 },
    { id: 'commons-medical', level: 0, a: 'commons', b: 'c-medical', axis: 'z', x: -30.2, z: 3.5, width: 2.8 },
    { id: 'medical-in', level: 0, a: 'c-medical', b: 'medical', axis: 'z', x: -26.2, z: 3.5, width: 3.0 },
    { id: 'medical-bay', level: 0, a: 'medical', b: 'c-bay', axis: 'z', x: -14.2, z: 3.5, width: 3.0 },
    { id: 'bay-in', level: 0, a: 'c-bay', b: 'bay', axis: 'z', x: -10.2, z: 3.5, width: 2.8 },
    { id: 'commons-hold', level: 0, a: 'commons', b: 'c-hold', axis: 'z', x: -30.2, z: -3.5, width: 2.8 },
    { id: 'hold-in', level: 0, a: 'c-hold', b: 'hold', axis: 'z', x: -26.2, z: -3.5, width: 3.0 },
    { id: 'lower-hangar', level: -2, a: 'c-lower', b: 'hangar', axis: 'x', x: -32.2, z: -29.2, width: 3.0 },
  ],

  lifts: [{ id: 'lift-commons', pad: R(-33.3, -31.1, -0.7, 1.5), levels: [0, -2] }],

  docks: [
    { id: 'spine', kind: 'spine', module: 'engine', level: 0, x: -38.2, z: -71.2, facing: 'N', width: 6, occupant: null },
    { id: 'prow', kind: 'prow', module: 'bridge', level: 0, x: -38.2, z: 43.3, facing: 'S', width: 2.4, occupant: null },
    { id: 'wing-bridge', kind: 'wing', module: 'bridge', level: 0, x: -44.2, z: 30, facing: 'W', width: 3, occupant: null },
    { id: 'wing-ops', kind: 'wing', module: 'ops', level: 0, x: -17.2, z: 21, facing: 'E', width: 3, occupant: null },
    { id: 'ext-bay', kind: 'wing', module: 'bay', level: 0, x: 10.2, z: 0.5, facing: 'E', width: 3, occupant: null },
    { id: 'ring-resid', kind: 'ring', module: 'quarters', level: 0, x: -58.2, z: 6, facing: 'W', width: 3, occupant: 'c-dorm' },
    { id: 'ring-agri', kind: 'ring', module: 'greenhouse', level: 0, x: -79.2, z: -9.5, facing: 'W', width: 3, occupant: null },
    { id: 'ring-ind', kind: 'ring', module: 'aft-node', level: 0, x: -35.2, z: -17.2, facing: 'E', width: 3, occupant: null },
    { id: 'hold-ext', kind: 'wing', module: 'hold', level: 0, x: -20.2, z: -13, facing: 'N', width: 3, occupant: null },
    { id: 'bay-hull', kind: 'bay', module: 'hangar', level: -2, x: -30.2, z: -41.5, facing: 'E', width: 3, occupant: null },
  ],
};

for (const m of SHIP_LAYOUT.modules) if (SINGLE_PORT_MODULES.includes(m.id)) m.maxPorts = 1;
