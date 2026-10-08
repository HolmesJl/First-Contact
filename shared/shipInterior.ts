/**
 * Interior of the seed ship, derived from the exterior data in shipLayout.ts.
 *
 * One source for client and server: walkable shapes per space (rooms, corridors, the hangar pass-through), door
 * thresholds, props with their obstacle footprints, stations, spawns, berths and the lift. `clampToShip` replaces the
 * old `clampToLab`: the union of walk shapes and door thresholds on a level, minus obstacles.
 *
 * Frame, units and numbering are those of shipLayout.ts (bay at the origin, +x starboard, +z bow, metres).
 */
import { PLAYER_RADIUS, TUBE_COUNT, TUBE_X, TUBE_Z } from './lab';
import {
  SHIP_LAYOUT,
  type Berth,
  type Door,
  type Dock,
  type Facing,
  type Job,
  type Level,
  type Obstacle,
  type Rect,
  type RoomId,
  type ShipLayout,
  type Spawn,
  type Station,
} from './shipLayout';

export type WalkShape = ({ k: 'rect' } & Rect) | { k: 'circle'; x: number; z: number; r: number };

export type PropKind =
  | 'pod'
  | 'tank'
  | 'console'
  | 'bed'
  | 'bunk'
  | 'closet'
  | 'desk'
  | 'planter'
  | 'holo'
  | 'crate'
  | 'rack'
  | 'bench'
  | 'sofa'
  | 'table'
  | 'counter'
  | 'chair'
  | 'pad'
  | 'arch'
  | 'reactor'
  | 'board'
  | 'machine'
  | 'bio-tank'
  | 'rug'
  | 'lift';

/** An axis-aligned prop. `cyl` props are round with radius `sx / 2`. Solid props become obstacles. */
export interface Prop {
  id: string;
  room: RoomId;
  kind: PropKind;
  label?: string;
  x: number;
  z: number;
  sx: number;
  sz: number;
  h: number;
  /** Elevation of the bottom above the floor. */
  y?: number;
  round?: boolean;
  /** Blocks movement (default true). */
  solid?: boolean;
  /** Direction the front (screen, door, bed foot) points. Default: toward the room centre. */
  face?: Facing;
  /** Interactable: becomes a server-known station. */
  station?: string;
  job?: Job;
}

export type SpaceKind = 'room' | 'corridor' | 'pass';

export interface Space {
  id: string;
  name: string;
  kind: SpaceKind;
  level: Level;
  outer: Rect;
  shapes: WalkShape[];
  /** False for hull-only modules and sealed corridors. */
  walkable: boolean;
}

export const NPC_DORM = { capacity: 12, occupants: 0 };

/** Display names for the HUD and signs. */
export const SPACE_NAMES: Record<string, string> = {
  commons: 'The Commons',
  bay: 'Hibernation & Cloning Bay',
  'fore-node': 'Fore Node',
  'aft-node': 'Aft Node',
  bridge: 'Bridge',
  ops: 'Operations',
  engine: 'Engine Room',
  science: 'Science Lab',
  bunks: 'Crew Quarters',
  cabin: "Captain's Cabin",
  greenhouse: 'Greenhouse',
  medical: 'Medical Lab',
  hold: 'Cargo Hold',
  'npc-dorm': 'NPC Dorm',
  hangar: 'Hangar',
  'c-fore': 'Fore Corridor',
  'c-bridge': 'Bridge Corridor',
  'c-ops': 'Operations Corridor',
  'c-cabin': 'Cabin Corridor',
  'c-aft': 'Aft Corridor',
  'c-engine': 'Engine Corridor',
  'c-pass': 'Hangar Pass-through',
  'c-spine': 'Spine Corridor',
  'c-science': 'Science Corridor',
  'c-quarters': 'Quarters Corridor',
  'c-greenhouse': 'Greenhouse Corridor',
  'c-medical': 'Medical Corridor',
  'c-hold': 'Hold Corridor',
  'c-bay': 'Bay Corridor',
  'c-dorm': 'Dorm Corridor',
  'c-lower': 'Lower Strut',
};

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });
const rect = (r: Rect): WalkShape => ({ k: 'rect', ...r });
const circle = (x: number, z: number, r: number): WalkShape => ({ k: 'circle', x, z, r });

/** Width of the walkable lane through a door (corridor walk width). */
export const DOOR_LANE = 2.2;
/** Half depth of the threshold rect across a wall (wall half thickness 0.2 + player radius 0.35 + margin). */
export const THRESHOLD_HALF = 1.0;
/** Door height in the greybox. */
export const DOOR_HEIGHT = 2.8;

/** Corridor walk rect of the hangar's roof-trench pass-through (level 0). */
const PASS_X = -38.2;
const PASS_OUTER = R(PASS_X - 2, PASS_X + 2, -47.2, -29.2);

/** Plus-shaped walk area of a round node room: arms along the strut axes plus a central disc. */
function nodeShapes(cx: number, cz: number): WalkShape[] {
  return [rect(R(cx - 2.1, cx + 2.1, cz - 1.1, cz + 1.1)), rect(R(cx - 1.1, cx + 1.1, cz - 2.1, cz + 2.1)), circle(cx, cz, 2.4)];
}

/** Rooms whose walk area is not just the layout's bounding rect. Round rooms clip to their circle (open question 24). */
const WALK_OVERRIDES: Partial<Record<RoomId, WalkShape[]>> = {
  'fore-node': nodeShapes(-38.2, 18.3),
  'aft-node': nodeShapes(-38.2, -17.2),
  cabin: [circle(-51.2, 18.3, 3.1)],
  greenhouse: [circle(-70.7, -9.5, 7.6)],
  // The bridge's rear plan corners are cut 1.5 m, so the rear strip is narrower than the rest.
  bridge: [rect(R(-43.3, -33.1, 27.1, 36)), rect(R(-42.8, -33.6, 26.2, 27.1))],
};

export const BRIDGE_POLY: [number, number][] = [
  [-42.7, 25.3],
  [-33.7, 25.3],
  [-32.2, 26.8],
  [-32.2, 36.3],
  [-34.2, 43.3],
  [-42.2, 43.3],
  [-44.2, 36.3],
  [-44.2, 26.8],
];

const PASS_CORRIDOR = {
  id: 'c-pass',
  level: 0,
  axis: 'z' as const,
  width: 4,
  height: 3.2,
  outer: PASS_OUTER,
  walk: R(PASS_X - 1.1, PASS_X + 1.1, -46.3, -30.1),
};

function buildSpaces(layout: ShipLayout): Space[] {
  const out: Space[] = [];
  for (const m of layout.modules) {
    for (const r of m.rooms) {
      const walkable = r.walkable !== false;
      out.push({
        id: r.id,
        name: SPACE_NAMES[r.id] ?? r.id,
        kind: 'room',
        level: r.level,
        outer: r.outer,
        shapes: walkable ? (WALK_OVERRIDES[r.id] ?? [rect(r.walk)]) : [],
        walkable,
      });
    }
  }
  const sealedDoors = new Set(layout.doors.filter((d) => d.sealed).map((d) => d.id));
  for (const c of layout.corridors) {
    const walkable = !(sealedDoors.has(c.ends[0]) && sealedDoors.has(c.ends[1]));
    out.push({ id: c.id, name: SPACE_NAMES[c.id] ?? c.id, kind: 'corridor', level: c.level, outer: c.outer, shapes: walkable ? [rect(c.walk)] : [], walkable });
  }
  out.push({ id: PASS_CORRIDOR.id, name: SPACE_NAMES['c-pass'], kind: 'pass', level: 0, outer: PASS_CORRIDOR.outer, shapes: [rect(PASS_CORRIDOR.walk)], walkable: true });
  return out;
}

/** Rect across the wall at a door, so the two walk areas it joins overlap. Null for sealed doors. */
export function thresholdRect(d: Door): Rect | null {
  if (d.sealed) return null;
  const w = Math.min(d.width, DOOR_LANE) / 2;
  const t = THRESHOLD_HALF;
  return d.axis === 'x' ? R(d.x - w, d.x + w, d.z - t, d.z + t) : R(d.x - t, d.x + t, d.z - w, d.z + w);
}

// ---------------------------------------------------------------- props

const props: Prop[] = [];

function box(room: RoomId, id: string, kind: PropKind, x: number, z: number, sx: number, sz: number, h: number, o: Partial<Prop> = {}) {
  props.push({ id, room, kind, x, z, sx, sz, h, ...o });
}
function cyl(room: RoomId, id: string, kind: PropKind, x: number, z: number, r: number, h: number, o: Partial<Prop> = {}) {
  props.push({ id, room, kind, x, z, sx: r * 2, sz: r * 2, h, round: true, ...o });
}

// Hibernation and cloning bay: pods on the stern wall, tanks on the bow wall.
for (let i = 0; i < TUBE_COUNT; i++) box('bay', `pod-${i + 1}`, 'pod', TUBE_X[i], TUBE_Z, 2.5, 1.3, 1.9, { label: `CL-0${i + 1}`, face: 'S' });
const TANK_X = [-8, -6, 6, 8];
TANK_X.forEach((x, i) => cyl('bay', `tank-${i + 1}`, 'tank', x, 6.6, 0.55, 2.4, { label: `T${i + 1}` }));
box('bay', 'clone-console', 'console', 0, 6.55, 2.0, 0.7, 1.05, { face: 'S', label: 'CLONE CONSOLE', station: 'clone-console', job: 'doctor' });
box('bay', 'bay-console-w1', 'console', -9.45, 0.5, 0.9, 1.8, 0.95, { face: 'E', label: 'CLONE VITALS' });
box('bay', 'bay-console-w2', 'console', -9.45, 5.9, 0.9, 1.8, 0.95, { face: 'E', label: 'GENOME SEQUENCER' });
box('bay', 'bay-console-e1', 'console', 9.45, -2.6, 0.9, 1.8, 0.95, { face: 'W', label: 'CLONE VITALS' });
box('bay', 'bay-console-e2', 'console', 9.45, 3.9, 0.9, 1.8, 0.95, { face: 'W', label: 'GENOME SEQUENCER' });

// Medical lab.
[6.9, 8.9, 10.9].forEach((z, i) => box('medical', `med-bed-${i + 1}`, 'bed', -24.65, z, 0.9, 1.8, 0.6, { face: 'E', label: `INFIRMARY BED ${i + 1}`, station: 'infirmary-bed', job: 'doctor' }));
box('medical', 'scanner-arch', 'arch', -23.4, 3.5, 0.3, 2.6, 2.6, { solid: false, label: 'SCANNER' });
box('medical', 'lab-bench', 'bench', -16.0, 10.0, 1.0, 3.2, 0.95, { face: 'W', label: 'LAB BENCH', station: 'lab-bench', job: 'doctor' });
box('medical', 'biomatter', 'machine', -15.9, 6.6, 1.2, 1.8, 1.2, { face: 'W', label: 'BIOMATTER STATION', station: 'biomatter', job: 'doctor' });
cyl('medical', 'bio-tank-1', 'bio-tank', -17.9, 11.3, 0.6, 2.6, { label: 'BIO TANK 1', station: 'bio-tank' });
cyl('medical', 'bio-tank-2', 'bio-tank', -17.9, 9.6, 0.6, 2.6, { label: 'BIO TANK 2', station: 'bio-tank' });

// The Commons: lounge (west), eatery (bow-east), R&R (bow-west), holo table, lift pad.
cyl('commons', 'holo-table', 'holo', -38.2, 1.6, 1.25, 0.85, { label: 'HOLO TABLE', station: 'holo-table' });
box('commons', 'lift-pad', 'lift', -32.2, 0.4, 2.2, 2.2, 0.06, { solid: false, label: 'LIFT · HANGAR SEALED', station: 'lift-commons' });
box('commons', 'lounge-sofa', 'sofa', -44.7, 0.0, 0.9, 3.0, 0.8, { face: 'E', label: 'LOUNGE' });
box('commons', 'lounge-table', 'table', -43.1, 0.0, 1.0, 1.2, 0.45);
box('commons', 'lounge-chair-1', 'chair', -42.2, 1.55, 0.8, 0.8, 0.75, { face: 'W' });
box('commons', 'lounge-chair-2', 'chair', -42.2, -1.55, 0.8, 0.8, 0.75, { face: 'W' });
box('commons', 'eatery-counter', 'counter', -33.9, 5.95, 4.4, 0.8, 1.05, { face: 'S', label: 'EATERY' });
cyl('commons', 'eatery-table-1', 'table', -35.7, 4.8, 0.45, 0.75);
cyl('commons', 'eatery-table-2', 'table', -34.3, 4.7, 0.45, 0.75);
box('commons', 'rr-shelf', 'rack', -42.6, 6.0, 3.4, 0.7, 1.6, { face: 'S', label: 'R&R · GAMES & BOOKS' });
cyl('commons', 'rr-beanbag-1', 'chair', -42.0, 5.0, 0.45, 0.5);
cyl('commons', 'rr-beanbag-2', 'chair', -40.7, 5.0, 0.45, 0.5);
box('commons', 'rug-lounge', 'rug', -43.4, 0, 3.6, 3.4, 0.02, { solid: false });
box('commons', 'rug-eatery', 'rug', -34.4, 4.6, 4.6, 3.0, 0.02, { solid: false });
box('commons', 'rug-rr', 'rug', -41.8, 4.9, 3.6, 2.4, 0.02, { solid: false });

// Crew quarters (bunk room): three stacks of three bunks, each with its own closet.
export const BUNK_STACKS = [
  { x: -56.8, z: 2.95, side: 'W' as const },
  { x: -56.8, z: 8.55, side: 'W' as const },
  { x: -51.6, z: 6.05, side: 'E' as const },
];
BUNK_STACKS.forEach((s, i) => {
  const face: Facing = s.side === 'W' ? 'E' : 'W';
  box('bunks', `bunk-stack-${i + 1}`, 'bunk', s.x, s.z, 1.0, 1.9, 3.2, { face, label: `BUNKS ${i * 3 + 1}-${i * 3 + 3}` });
  box('bunks', `closet-stack-${i + 1}`, 'closet', s.x, s.z + 1.2, 1.0, 0.5, 2.6, { face, label: `CLOSETS ${i * 3 + 1}-${i * 3 + 3}` });
});
box('bunks', 'upload-station', 'console', -51.6, 9.0, 1.0, 1.4, 1.3, { face: 'W', label: 'UPLOAD MEMORIES', station: 'upload' });

// Captain's cabin.
box('cabin', 'captain-bed', 'bed', -53.1, 18.3, 2.0, 1.4, 0.6, { face: 'E', label: "CAPTAIN'S BERTH" });
box('cabin', 'captain-trunk', 'closet', -51.2, 20.55, 1.4, 0.7, 0.8, { face: 'N', label: "CAPTAIN'S TRUNK" });
box('cabin', 'captain-desk', 'desk', -51.2, 16.15, 1.8, 0.8, 0.8, { face: 'S', label: 'DESK · DATA PAD', station: 'captain-datapad', job: 'captain' });
cyl('cabin', 'cabin-rug', 'rug', -51.2, 18.3, 1.5, 0.02, { solid: false });

// Bridge.
box('bridge', 'bridge-comms', 'console', -34.2, 28.6, 1.4, 1.2, 1.1, { face: 'W', label: 'COMMS', station: 'comms' });
cyl('bridge', 'bridge-chair', 'chair', -38.2, 30.4, 0.4, 1.2, { face: 'S', label: "CAPTAIN'S CHAIR", station: 'captain-chair', job: 'captain' });
box('bridge', 'scan-1', 'console', -42.2, 33.2, 1.8, 1.2, 1.1, { face: 'S', label: 'SCANNING 1', station: 'scanner' });
box('bridge', 'scan-2', 'console', -34.2, 33.2, 1.8, 1.2, 1.1, { face: 'S', label: 'SCANNING 2', station: 'scanner' });
box('bridge', 'star-map', 'console', -38.2, 34.4, 2.6, 1.2, 1.0, { face: 'N', label: 'STAR MAP', station: 'star-map', job: 'captain' });

// Operations.
box('ops', 'armory', 'rack', -23.3, 16.4, 4.2, 0.9, 2.0, { face: 'S', label: 'ARMORY', station: 'armory', job: 'military' });
box('ops', 'weapon-printer', 'machine', -18.9, 24.5, 1.0, 1.8, 1.3, { face: 'W', label: 'WEAPON PRINTER', station: 'weapon-printer', job: 'military' });
box('ops', 'planning-table', 'table', -23.2, 21.0, 3.0, 1.6, 0.95, { face: 'S', label: 'PLANNING BOARD', station: 'planning-board', job: 'military' });
box('ops', 'mission-board', 'board', -23.2, 25.8, 4.0, 0.3, 1.8, { solid: false, y: 0.6, face: 'S', label: 'MISSION BOARD' });

// Hold.
[-3.2, -4.6, -6.0].forEach((z, i) => box('hold', `hold-crate-${i + 1}`, 'crate', -15.9, z, 1.2, 1.2, 1.2, { label: i === 0 ? 'HOLD STORAGE' : undefined, station: i === 0 ? 'hold-storage' : undefined }));
box('hold', 'hold-crate-4', 'crate', -15.9, -3.9, 1.0, 1.0, 1.0, { y: 1.2, solid: false });
box('hold', 'hold-crate-5', 'crate', -16.6, -11.1, 1.2, 1.2, 1.2);
box('hold', 'hold-rack-1', 'rack', -20.2, -2.6, 4.4, 0.7, 2.2, { face: 'N', label: 'SHELVING' });
cyl('hold', 'beam-in-pad', 'pad', -20.2, -6.5, 1.4, 0.08, { solid: false, label: 'BEAM-IN PAD', station: 'beam-in-pad' });
box('hold', 'hold-net', 'board', -24.9, -8.5, 0.3, 3.6, 2.2, { solid: false, face: 'E', label: 'CARGO NET' });

// Science lab.
cyl('science', 'teleporter-pad', 'pad', -53.2, -21.0, 1.5, 0.12, { solid: false, label: 'TELEPORTER PAD', station: 'teleporter', job: 'engineer' });
box('science', 'refinery', 'machine', -57.3, -24.5, 1.8, 2.0, 1.8, { face: 'E', label: 'REFINERY', station: 'refinery', job: 'engineer' });
box('science', 'robotics-bench', 'bench', -57.7, -17.0, 1.2, 2.4, 0.95, { face: 'E', label: 'ROBOTICS BENCH', station: 'robotics', job: 'engineer' });
box('science', 'printer', 'machine', -49.5, -25.3, 1.4, 1.2, 1.3, { face: 'N', label: 'PRINTER', station: 'printer', job: 'engineer' });
box('science', 'build-terminal', 'console', -48.55, -21.9, 0.9, 1.6, 1.2, { face: 'W', label: 'BUILD TERMINAL (SOON)', station: 'build-terminal', job: 'engineer' });

// Greenhouse: six large planter containers in a 3 x 2 grid; the aisles are 2 m.
const GH = { x: -70.7, z: -9.5 };
[-4, 0, 4].forEach((dx, c) =>
  [-2.55, 2.55].forEach((dz, r) =>
    box('greenhouse', `planter-${c * 2 + r + 1}`, 'planter', GH.x + dx, GH.z + dz, 2.0, 4.5, 0.9, { label: `PLANTER ${c * 2 + r + 1}`, station: 'planter', job: 'botanist' }),
  ),
);
box('greenhouse', 'botanist-station', 'console', GH.x - 3, GH.z + 6.0, 2.0, 0.8, 1.1, { face: 'S', label: 'BOTANIST STATION', station: 'botanist', job: 'botanist' });
box('greenhouse', 'atmosphere-panel', 'console', GH.x, GH.z - 6.6, 2.0, 0.7, 1.1, { face: 'N', label: 'ATMOSPHERE GENERATOR', station: 'atmosphere', job: 'botanist' });

// Engine room (placeholder).
cyl('engine', 'reactor-core', 'reactor', -38.2, -65.5, 1.5, 3.2, { label: 'REACTOR CORE (PLACEHOLDER)' });
box('engine', 'engine-console', 'console', -33.3, -62.2, 0.9, 1.8, 1.1, { face: 'W', label: 'ENGINE STATUS', station: 'engine-status', job: 'engineer' });

export const PROPS: readonly Prop[] = props;

export const NPC_PANEL = { room: 'bunks' as RoomId, x: -57.95, z: 6, text: 'NPC DORM' };
export const CABIN_KEYPAD = { x: -47.3, z: 19.8, y: 1.3 };

// ---------------------------------------------------------------- stations, spawns, berths

const facingRot: Record<Facing, number> = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

export const STATIONS: readonly Station[] = PROPS.filter((p) => p.station).map((p) => ({
  id: p.id,
  kind: p.station!,
  room: p.room,
  level: 0,
  x: p.x,
  z: p.z,
  rot: p.face ? facingRot[p.face] : 0,
  radius: Math.max(p.sx, p.sz) / 2 + 1.3,
  job: p.job,
}));

export const SPAWNS: readonly Spawn[] = [
  ...TUBE_X.map<Spawn>((x, i) => ({ id: `pod-${i + 1}`, kind: 'pod', room: 'bay', level: 0, x: x + 0.9, z: -3.1, rot: 0 })),
  ...TANK_X.map<Spawn>((x, i) => ({ id: `tank-${i + 1}`, kind: 'tank', room: 'bay', level: 0, x, z: 5.2, rot: Math.PI })),
];

/** Berth 0 is the Captain's bed; 1..9 are the bunks (three stacks of three). `x, z` is the standing spot beside the bunk. */
export const BERTHS: readonly Berth[] = [
  { index: 0, room: 'cabin', level: 0, x: -52.6, z: 19.6, closet: { x: -51.2, z: 20.55 } },
  ...BUNK_STACKS.flatMap((s, si) =>
    [0, 1, 2].map<Berth>((k) => ({
      index: si * 3 + k + 1,
      room: 'bunks',
      level: 0,
      x: s.side === 'W' ? s.x + 1.5 : s.x - 1.5,
      z: s.z,
      closet: { x: s.x, z: s.z + 1.2 },
    })),
  ),
];

// ---------------------------------------------------------------- derived walk area

export interface Area {
  level: Level;
  shapes: WalkShape[];
  obstacles: Obstacle[];
}

const spaces = buildSpaces(SHIP_LAYOUT);
export const SPACES: readonly Space[] = spaces;
export const spaceById = (id: string) => spaces.find((s) => s.id === id);

function propObstacle(p: Prop): Obstacle {
  if (p.round) return { x: p.x, z: p.z, r: p.sx / 2 };
  return { rect: true, minX: p.x - p.sx / 2, maxX: p.x + p.sx / 2, minZ: p.z - p.sz / 2, maxZ: p.z + p.sz / 2 };
}

function buildArea(level: Level): Area {
  const shapes: WalkShape[] = [];
  for (const s of spaces) if (s.level === level) shapes.push(...s.shapes);
  for (const d of SHIP_LAYOUT.doors) {
    const t = d.level === level ? thresholdRect(d) : null;
    if (t) shapes.push(rect(t));
  }
  for (const l of SHIP_LAYOUT.lifts) if (l.levels.includes(level)) shapes.push(rect(l.pad));
  if (level === 0) {
    for (const d of SHIP_LAYOUT.doors) {
      if ((d.id === 'hangar-pass-fore' || d.id === 'hangar-pass-aft') && d.level === 0) shapes.push(rect(R(d.x - 1.1, d.x + 1.1, d.z - THRESHOLD_HALF, d.z + THRESHOLD_HALF)));
    }
  }
  const obstacles: Obstacle[] = [];
  if (level === 0) for (const p of PROPS) if (p.solid !== false) obstacles.push(propObstacle(p));
  return { level, shapes, obstacles };
}

const areas = new Map<Level, Area>();
export function areaFor(level: Level): Area {
  let a = areas.get(level);
  if (!a) areas.set(level, (a = buildArea(level)));
  return a;
}

function insideShape(s: WalkShape, x: number, z: number) {
  if (s.k === 'rect') return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
  return Math.hypot(x - s.x, z - s.z) <= s.r;
}

export function isWalkable(x: number, z: number, level: Level = 0): boolean {
  const a = areaFor(level);
  return a.shapes.some((s) => insideShape(s, x, z)) && !a.obstacles.some((o) => insideObstacle(o, x, z));
}

function insideObstacle(o: Obstacle, x: number, z: number) {
  const R_ = PLAYER_RADIUS;
  if ('rect' in o) {
    const cx = Math.min(o.maxX, Math.max(o.minX, x));
    const cz = Math.min(o.maxZ, Math.max(o.minZ, z));
    return Math.hypot(x - cx, z - cz) < R_ - 1e-6;
  }
  return Math.hypot(x - o.x, z - o.z) < o.r + R_ - 1e-6;
}

function nearestInShapes(shapes: WalkShape[], x: number, z: number): { x: number; z: number } {
  let best = { x, z };
  let bestD = Infinity;
  for (const s of shapes) {
    let px: number;
    let pz: number;
    if (s.k === 'rect') {
      px = Math.min(s.maxX, Math.max(s.minX, x));
      pz = Math.min(s.maxZ, Math.max(s.minZ, z));
    } else {
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d <= s.r) {
        px = x;
        pz = z;
      } else {
        px = s.x + (dx / d) * s.r;
        pz = s.z + (dz / d) * s.r;
      }
    }
    const d2 = (px - x) ** 2 + (pz - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = { x: px, z: pz };
    }
  }
  return best;
}

/** Push a point out of one obstacle (with the player's radius). Returns true if it moved. */
function pushOut(o: Obstacle, p: { x: number; z: number }): boolean {
  const R_ = PLAYER_RADIUS;
  if ('rect' in o) {
    const cx = Math.min(o.maxX, Math.max(o.minX, p.x));
    const cz = Math.min(o.maxZ, Math.max(o.minZ, p.z));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= R_) return false;
    if (d > 1e-6) {
      p.x = cx + (dx / d) * R_;
      p.z = cz + (dz / d) * R_;
      return true;
    }
    const left = p.x - o.minX;
    const right = o.maxX - p.x;
    const down = p.z - o.minZ;
    const up = o.maxZ - p.z;
    const m = Math.min(left, right, down, up);
    if (m === left) p.x = o.minX - R_;
    else if (m === right) p.x = o.maxX + R_;
    else if (m === down) p.z = o.minZ - R_;
    else p.z = o.maxZ + R_;
    return true;
  }
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const min = o.r + R_;
  const d = Math.hypot(dx, dz);
  if (d >= min) return false;
  if (d < 1e-4) {
    p.x = o.x;
    p.z = o.z + min;
  } else {
    p.x = o.x + (dx / d) * min;
    p.z = o.z + (dz / d) * min;
  }
  return true;
}

/** Nearest legal position on a level: inside the walk area and outside every obstacle. */
export function clampToShip(x: number, z: number, level: Level = 0): { x: number; z: number } {
  const a = areaFor(level);
  const p = { x, z };
  for (let i = 0; i < 4; i++) {
    if (!a.shapes.some((s) => insideShape(s, p.x, p.z))) Object.assign(p, nearestInShapes(a.shapes, p.x, p.z));
    let moved = false;
    for (const o of a.obstacles) if (pushOut(o, p)) moved = true;
    if (!moved) break;
  }
  return p;
}

/** The room, corridor or pass-through containing a point (null on door thresholds and outside the ship). */
export function spaceAt(x: number, z: number, level: Level = 0): Space | null {
  let hit: Space | null = null;
  for (const s of spaces) {
    if (s.level !== level || !s.walkable) continue;
    if (s.shapes.some((sh) => insideShape(sh, x, z))) {
      if (s.kind === 'room') return s;
      hit ??= s;
    }
  }
  return hit;
}

// ---------------------------------------------------------------- graph and ports

/** Space adjacency through (non-sealed) doors, for culling and the HUD. */
export function spaceGraph(): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a)!.add(b);
    g.get(b)!.add(a);
  };
  for (const d of SHIP_LAYOUT.doors) {
    if (d.level !== 0) continue;
    const a = d.id.startsWith('hangar-pass') && d.a === 'hangar' ? 'c-pass' : d.a;
    const b = d.id.startsWith('hangar-pass') && d.b === 'hangar' ? 'c-pass' : d.b;
    link(a, b);
  }
  return g;
}

/** Docks that show as sealed octagonal portal frames from inside: free faces on level 0, not the fixed spine or prow. */
export function visiblePorts(): Dock[] {
  return SHIP_LAYOUT.docks.filter((d) => d.level === 0 && d.occupant === null && d.kind !== 'spine' && d.kind !== 'prow');
}

/** Door-sized clear zone inside a dock's face (3 m wide, 2.5 m deep), for the placement check. */
export function portClearZone(d: Dock): Rect {
  const w = d.width / 2;
  const depth = 2.5;
  switch (d.facing) {
    case 'W':
      return R(d.x, d.x + depth + 0.9, d.z - w, d.z + w);
    case 'E':
      return R(d.x - depth - 0.9, d.x, d.z - w, d.z + w);
    case 'N':
      return R(d.x - w, d.x + w, d.z, d.z + depth + 0.9);
    case 'S':
      return R(d.x - w, d.x + w, d.z - depth - 0.9, d.z);
  }
}

/** The world's one ship, with the interior arrays of the layout's modules filled in (stations, spawns, berths). */
export const SHIP: ShipLayout = {
  ...SHIP_LAYOUT,
  modules: SHIP_LAYOUT.modules.map((m) => {
    const rooms = new Set<string>(m.rooms.map((r) => r.id));
    return {
      ...m,
      stations: STATIONS.filter((s) => rooms.has(s.room)),
      spawns: SPAWNS.filter((s) => rooms.has(s.room)),
      berths: BERTHS.filter((b) => rooms.has(b.room)),
    };
  }),
};
