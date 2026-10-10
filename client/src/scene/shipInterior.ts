import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { starfield, canvasTexture } from './common';
import { Batch, MAT, labelSprite, screenMaterial, type MatKey } from './interior/kit';
import { buildProp, type PodFx, type PropAnim, type PropContext } from './interior/props';
import { QuestTerminalLayer } from './questTerminals';
import { SHIP_LAYOUT, type Corridor, type Door, type Obstacle, type Rect, type Room } from '../../../shared/shipLayout';
import {
  BRIDGE_POLY,
  CABIN_KEYPAD,
  DOOR_HEIGHT,
  NPC_DORM,
  NPC_PANEL,
  PROPS,
  SPACE_NAMES,
  spaceGraph,
  visiblePorts,
} from '../../../shared/shipInterior';
import {
  CABIN_KEYPAD_INTERACT_ID,
  cabinDoorExtraObstacles,
  cabinDoorPanelPose,
  cabinDoorSlideBasis,
  cabinKeypadInteractPosition,
} from '../../../shared/cabinDoor';
import type { CabinDoorState } from '../../../shared/protocol';

/**
 * The walkable interior of the seed ship, built from shared/shipLayout.ts and shared/shipInterior.ts:
 * floors, walls with door gaps, flat ceilings (dome in the greenhouse, vault in the bay), octagonal corridors,
 * props and labels. One continuous level-0 scene; wall runs fade when they sit between the camera and the player,
 * rooms far from the player are culled, and a small pool of point lights follows the player.
 */

type Pt = [number, number];

const WALL_T = 0.4;
const FADE_ALPHA = 0.1;
const VISIBLE_DEPTH = 3;
const LIGHT_SLOTS = 3;

interface Opening {
  /** Coordinate the opening spans ('x' for a door in a wall that runs along x) and its centre. */
  span: 'x' | 'z';
  c0: number;
  hw: number;
  perp0: number;
  y0: number;
  y1: number;
}

interface Occluder {
  mesh: THREE.Mesh;
  /** Hidden while the occluder is faded (tube ribs and lights). */
  details?: THREE.Object3D;
  mat: THREE.MeshLambertMaterial;
  space: string;
  fade: number;
  target: number;
}

interface SpaceView {
  id: string;
  group: THREE.Group;
  center: { x: number; z: number };
  sprites: THREE.Sprite[];
}

interface LightSpec {
  color: number;
  y: number;
  intensity: number;
}

const LIGHTS: Record<string, LightSpec> = {
  bay: { color: 0x46d9ff, y: 3.4, intensity: 20 },
  medical: { color: 0xc8fff0, y: 3.4, intensity: 18 },
  commons: { color: 0xfff0d8, y: 4.0, intensity: 20 },
  bunks: { color: 0xffe2c0, y: 3.5, intensity: 11 },
  cabin: { color: 0xffd9a8, y: 3.8, intensity: 11 },
  bridge: { color: 0x7ab8ff, y: 4.2, intensity: 19 },
  ops: { color: 0xffa890, y: 4.4, intensity: 18 },
  hold: { color: 0xffd08a, y: 4.0, intensity: 18 },
  science: { color: 0xa9c0ff, y: 3.5, intensity: 18 },
  greenhouse: { color: 0xe4ffd0, y: 5.2, intensity: 28 },
  engine: { color: 0xffa060, y: 5.0, intensity: 18 },
  'fore-node': { color: 0xdbe6ff, y: 3.0, intensity: 8 },
  'aft-node': { color: 0xdbe6ff, y: 3.0, intensity: 8 },
};

/** Door sign names that read better than the full display name. */
const SIGN_NAMES: Record<string, string> = { bay: 'Cloning Bay' };
/** Widest a door sign may be at its rest scale (metres); the corridor is 2.4 m across at the ceiling. */
const SIGN_MAX_WIDTH = 1.6;
const SIGN_Y_CORRIDOR = 3.02;

const rectCenter = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

function polygonFor(room: Room): { pts: Pt[]; round: boolean; group: number } {
  const o = room.outer;
  const c = rectCenter(o);
  if (room.id === 'bridge') return { pts: BRIDGE_POLY, round: false, group: 1 };
  if (room.id === 'fore-node' || room.id === 'aft-node') {
    const a = 1.8;
    const b = 3;
    return {
      pts: [
        [c.x - a, c.z - b],
        [c.x + a, c.z - b],
        [c.x + b, c.z - a],
        [c.x + b, c.z + a],
        [c.x + a, c.z + b],
        [c.x - a, c.z + b],
        [c.x - b, c.z + a],
        [c.x - b, c.z - a],
      ],
      round: false,
      group: 1,
    };
  }
  if (room.id === 'cabin' || room.id === 'greenhouse') {
    const r = (o.maxX - o.minX) / 2;
    const n = 40;
    return { pts: Array.from({ length: n }, (_, i) => [c.x + Math.cos((i / n) * Math.PI * 2) * r, c.z + Math.sin((i / n) * Math.PI * 2) * r] as Pt), round: true, group: n / 4 };
  }
  return {
    pts: [
      [o.minX, o.minZ],
      [o.maxX, o.minZ],
      [o.maxX, o.maxZ],
      [o.minX, o.maxZ],
    ],
    round: false,
    group: 1,
  };
}

const ROUND_ROOMS: Record<string, { x: number; z: number; r: number }> = {
  cabin: { x: -51.2, z: 18.3, r: 4 },
  greenhouse: { x: -70.7, z: -9.5, r: 8.5 },
};

/** Where a door meets the wall. Round rooms have the opening where the strut's centre line crosses the real wall. */
function doorPlacement(d: Door): { x: number; z: number } {
  const round = ROUND_ROOMS[d.a] ?? ROUND_ROOMS[d.b];
  if (!round) return { x: d.x, z: d.z };
  if (d.axis === 'z') {
    const off = Math.sqrt(Math.max(0, round.r ** 2 - (d.z - round.z) ** 2));
    return { x: round.x + Math.sign(d.x - round.x) * off, z: d.z };
  }
  const off = Math.sqrt(Math.max(0, round.r ** 2 - (d.x - round.x) ** 2));
  return { x: d.x, z: round.z + Math.sign(d.z - round.z) * off };
}

const doorOpening = (d: Door): Opening => {
  const p = doorPlacement(d);
  return d.axis === 'x'
    ? { span: 'x', c0: p.x, hw: d.width / 2, perp0: p.z, y0: 0, y1: DOOR_HEIGHT }
    : { span: 'z', c0: p.z, hw: d.width / 2, perp0: p.x, y0: 0, y1: DOOR_HEIGHT };
};

/** Cuts a wall run into solid pieces and lintels around the openings that lie on it. */
function wallPieces(a: Pt, b: Pt, openings: Opening[], perpTol: number, height: number) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  const cuts: { s0: number; s1: number; y0: number; y1: number }[] = [];
  for (const o of openings) {
    const dc = o.span === 'x' ? dx : dz;
    const pc = o.span === 'x' ? a[0] : a[1];
    if (Math.abs(dc / L) < 0.2) continue;
    let s0 = (o.c0 - o.hw - pc) / (dc / L);
    let s1 = (o.c0 + o.hw - pc) / (dc / L);
    if (s0 > s1) [s0, s1] = [s1, s0];
    s0 = Math.max(0, s0);
    s1 = Math.min(L, s1);
    if (s1 - s0 < 0.05) continue;
    const m = (s0 + s1) / 2;
    const perp = o.span === 'x' ? a[1] + (dz / L) * m : a[0] + (dx / L) * m;
    if (Math.abs(perp - o.perp0) > perpTol) continue;
    cuts.push({ s0, s1, y0: o.y0, y1: o.y1 });
  }
  cuts.sort((p, q) => p.s0 - q.s0);
  const pieces: { s0: number; s1: number; y0: number; y1: number }[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.s0 > cursor + 0.02) pieces.push({ s0: cursor, s1: c.s0, y0: 0, y1: height });
    if (c.y0 > 0.01) pieces.push({ s0: c.s0, s1: c.s1, y0: 0, y1: c.y0 });
    if (c.y1 < height - 0.01) pieces.push({ s0: c.s0, s1: c.s1, y0: c.y1, y1: height });
    cursor = Math.max(cursor, c.s1);
  }
  if (cursor < L - 0.02) pieces.push({ s0: cursor, s1: L, y0: 0, y1: height });
  return { pieces, L, dx: dx / L, dz: dz / L };
}

function floorGeometry(pts: Pt[]) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ceilingGeometry(pts: Pt[], hole?: Rect) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  if (hole) {
    const path = new THREE.Path([new THREE.Vector2(hole.minX, hole.minZ), new THREE.Vector2(hole.minX, hole.maxZ), new THREE.Vector2(hole.maxX, hole.maxZ), new THREE.Vector2(hole.maxX, hole.minZ)]);
    shape.holes.push(path);
  }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  return g;
}

const OCT: Pt[] = [
  [-1.2, 0],
  [1.2, 0],
  [2.0, 0.8],
  [2.0, 2.4],
  [1.2, 3.2],
  [-1.2, 3.2],
  [-2.0, 2.4],
  [-2.0, 0.8],
];

/** `cut0` shapes the t0 end of the tube to a curved wall: it returns the end position for a lateral offset `u`. */
function tubeGeometry(axis: 'x' | 'z', cx: number, t0: number, t1: number, cut0?: (u: number) => number) {
  const pos: number[] = [];
  const map = (u: number, y: number, t: number): [number, number, number] => (axis === 'z' ? [cx + u, y, t] : [t, y, cx + u]);
  const end0 = (u: number) => (cut0 ? cut0(u) : t0);
  for (let i = 0; i < OCT.length; i++) {
    const [u0, y0] = OCT[i];
    const [u1, y1] = OCT[(i + 1) % OCT.length];
    const a = map(u0, y0, end0(u0));
    const b = map(u1, y1, end0(u1));
    const c = map(u1, y1, t1);
    const d = map(u0, y0, t1);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

let ribGeo: THREE.ExtrudeGeometry | null = null;
function ribGeometry() {
  if (ribGeo) return ribGeo;
  const outer = new THREE.Shape(OCT.map(([u, y]) => new THREE.Vector2(u * 1.045, 1.6 + (y - 1.6) * 1.05)));
  outer.holes.push(new THREE.Path(OCT.map(([u, y]) => new THREE.Vector2(u * 0.99, 1.6 + (y - 1.6) * 0.99)).reverse()));
  ribGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.16, bevelEnabled: false });
  ribGeo.translate(0, 0, -0.08);
  return ribGeo;
}

function statusPanelMaterial() {
  const tex = canvasTexture(320, 220, (c) => {
    c.fillStyle = '#0a0f16';
    c.fillRect(0, 0, 320, 220);
    c.strokeStyle = '#ff4b5c';
    c.lineWidth = 4;
    c.strokeRect(4, 4, 312, 212);
    c.fillStyle = '#ffd0d5';
    c.font = '700 26px monospace';
    c.textAlign = 'center';
    c.fillText('NPC DORM', 160, 46);
    c.fillStyle = '#9fb3c8';
    c.font = '600 18px monospace';
    c.fillText('SEALED · NOT WALKABLE', 160, 74);
    c.fillStyle = '#e8f1ff';
    c.font = '700 52px monospace';
    c.fillText(`${NPC_DORM.occupants} / ${NPC_DORM.capacity}`, 160, 146);
    c.fillStyle = '#9fb3c8';
    c.font = '600 18px monospace';
    c.fillText('NPCs sleeping / capacity', 160, 184);
  });
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}

export class ShipInterior {
  readonly root = new THREE.Group();
  private spaces = new Map<string, SpaceView>();
  private occluders: Occluder[] = [];
  private occluderMeshes: THREE.Mesh[] = [];
  private anim: PropAnim = { pods: [], holo: null };
  private graph = spaceGraph();
  private lightPool: { light: THREE.PointLight; id: string | null; target: number }[] = [];
  private anchors = new Map<string, { x: number; y: number; z: number; spec: LightSpec }>();
  private visible = new Set<string>();
  private focusSpace: string | null = null;
  private ray = new THREE.Raycaster();
  private time = 0;
  private sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
  private cameraAnchor = new THREE.Vector3();
  private questTerminals = new QuestTerminalLayer();
  private cabinDoorPanel: THREE.Group | null = null;
  private cabinDoorOpenFrac = 0;
  private cabinDoorTargetFrac = 0;
  private keypadGlow: THREE.Mesh | null = null;

  constructor() {
    this.buildEnvironment();
    for (const m of SHIP_LAYOUT.modules) for (const room of m.rooms) if (room.level === 0 && room.walkable !== false) this.buildRoom(room);
    for (const c of SHIP_LAYOUT.corridors) if (c.level === 0 && c.id !== 'c-dorm') this.buildCorridor(c);
    this.buildPassThrough();
    this.buildDoors();
    this.buildPorts();
    this.buildSealedDoors();
    this.questTerminals.attach(this.root);
    this.setFocus(null);
  }

  setQuestHighlight(interactId: string | null) {
    this.questTerminals.setHighlight(interactId);
    if (this.keypadGlow) this.keypadGlow.visible = interactId === CABIN_KEYPAD_INTERACT_ID;
  }

  setCabinDoor(door: CabinDoorState, snap = false) {
    // `openFrac` is the server's panel position at broadcast time (0 as it starts opening, 1 as it starts closing);
    // the end state the panel should animate toward is `open`.
    this.cabinDoorTargetFrac = door.open ? 1 : 0;
    if (snap) this.cabinDoorOpenFrac = door.openFrac;
  }

  /** Movement obstacles for the cabin door panel where it currently is (empty once slid aside). */
  cabinDoorObstacles(): Obstacle[] {
    return this.cabinDoorPanel ? cabinDoorExtraObstacles(this.cabinDoorOpenFrac) : [];
  }

  // ---------------------------------------------------------------- environment

  private buildEnvironment() {
    const s = this.root;
    s.add(new THREE.HemisphereLight(0xdbe6ff, 0x5a5262, 1.5));
    s.add(new THREE.AmbientLight(0xa0acc4, 0.8));
    this.sun.position.set(4, 12, 7);
    s.add(this.sun);
    s.add(this.sun.target);
    for (let i = 0; i < LIGHT_SLOTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 1.4);
      s.add(light);
      this.lightPool.push({ light, id: null, target: 0 });
    }
    const stars = starfield(2600, 260, 1.4);
    stars.position.set(-35, 0, -10);
    s.add(stars);
    const moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(9, 3),
      new THREE.MeshStandardMaterial({ color: 0xa4a4ac, roughness: 1, flatShading: true, fog: false, emissive: 0x1a1a22 }),
    );
    moon.position.set(14, 8, -60);
    s.add(moon);
  }

  // ---------------------------------------------------------------- spaces

  private space(id: string, center: { x: number; z: number }): SpaceView {
    const group = new THREE.Group();
    group.name = id;
    this.root.add(group);
    const v: SpaceView = { id, group, center, sprites: [] };
    this.spaces.set(id, v);
    return v;
  }

  private addOccluder(space: string, geos: THREE.BufferGeometry[], key: string) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (!merged) return;
    const mat = MAT.wall.clone();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `${space}:${key}`;
    this.spaces.get(space)!.group.add(mesh);
    this.occluders.push({ mesh, mat, space, fade: 1, target: 1 });
    this.occluderMeshes.push(mesh);
  }

  private wallBox(len: number, h: number, x: number, y: number, z: number, angle: number) {
    const g = new THREE.BoxGeometry(len, h, WALL_T);
    const m = new THREE.Matrix4().makeTranslation(x, y + h / 2, z).multiply(new THREE.Matrix4().makeRotationY(-angle));
    g.applyMatrix4(m);
    return g;
  }

  private buildRoom(room: Room) {
    const poly = polygonFor(room);
    const center = rectCenter(room.outer);
    const v = this.space(room.id, center);
    const g = v.group;

    // Floor.
    const floorMat = MAT.floor.clone();
    floorMat.color.setHex(({ bay: 0xdbeaff, medical: 0xe2f5ef, bridge: 0xcfd9ee, greenhouse: 0xdfe8d6, cabin: 0xe9ddcc, bunks: 0xe8e1d6 } as Record<string, number>)[room.id] ?? 0xffffff);
    const floor = new THREE.Mesh(floorGeometry(poly.pts), floorMat);
    g.add(floor);

    // Walls, in runs that fade together.
    const openings: Opening[] = SHIP_LAYOUT.doors.filter((d) => !d.sealed && (d.a === room.id || d.b === room.id)).map(doorOpening);
    if (room.id === 'bay') openings.push({ span: 'x', c0: 0, hw: 9.7, perp0: -6.2, y0: 1.9, y1: 3.7 });
    const tol = poly.round ? 3 : 0.6;
    const runs = new Map<string, THREE.BufferGeometry[]>();
    const n = poly.pts.length;
    poly.pts.forEach((a, i) => {
      const b = poly.pts[(i + 1) % n];
      const prev = poly.pts[(i + n - 1) % n];
      const next = poly.pts[(i + 2) % n];
      const edgeH = room.id === 'bay' && (i === 1 || i === 3) ? 5.4 : room.height;
      const { pieces, L, dx, dz } = wallPieces(a, b, openings, tol, edgeH);
      const angle = Math.atan2(dz, dx);
      const turn = (p: Pt, q: Pt, r: Pt) => {
        const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
        let d = Math.abs(a2 - a1);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return (WALL_T / 2) * Math.tan(d / 2);
      };
      const extStart = turn(prev, a, b);
      const extEnd = turn(a, b, next);
      const key = String(Math.floor(i / poly.group));
      for (const p of pieces) {
        const s0 = p.s0 - (p.s0 <= 0.001 ? extStart : 0);
        const s1 = p.s1 + (p.s1 >= L - 0.001 ? extEnd : 0);
        const mid = (s0 + s1) / 2;
        const geo = this.wallBox(s1 - s0, p.y1 - p.y0, a[0] + dx * mid, p.y0, a[1] + dz * mid, angle);
        let list = runs.get(key);
        if (!list) runs.set(key, (list = []));
        list.push(geo);
      }
    });
    for (const [key, geos] of runs) this.addOccluder(room.id, geos, key);

    // Ceiling.
    this.buildCeiling(room, poly.pts, v);

    // Props.
    const batch = new Batch();
    const ctx: PropContext = { batch, group: g, center, anim: this.anim, sprites: v.sprites };
    for (const p of PROPS) if (p.room === room.id) buildProp(p, ctx);
    this.roomExtras(room, batch, v);
    batch.build(g);

    const spec = LIGHTS[room.id];
    if (spec) this.anchors.set(room.id, { x: center.x, y: spec.y, z: center.z, spec });
  }

  private buildCeiling(room: Room, pts: Pt[], v: SpaceView) {
    const g = v.group;
    const h = room.height;
    if (room.id === 'greenhouse') return this.buildDome(room, v);
    if (room.id === 'bay') {
      const o = room.outer;
      const w = o.maxX - o.minX;
      const d = o.maxZ - o.minZ;
      const geo = new THREE.PlaneGeometry(w, d, 8, 24);
      geo.rotateX(Math.PI / 2);
      const p = geo.attributes.position;
      const Rv = 23.3;
      const zc = (o.minZ + o.maxZ) / 2;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        p.setXYZ(i, p.getX(i) + (o.minX + o.maxX) / 2, h + Math.sqrt(Rv * Rv - z * z) - (Rv - 1.0), z + zc);
      }
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, MAT.ceiling));
      return;
    }
    let hole: Rect | undefined;
    if (room.id === 'commons') hole = { minX: -41.2, maxX: -35.2, minZ: -1.0, maxZ: 4.2 };
    const mesh = new THREE.Mesh(ceilingGeometry(pts, hole), MAT.ceiling);
    mesh.position.y = h;
    g.add(mesh);
    if (hole) {
      // Flush skylight: a hole in the ceiling with faint glass.
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(hole.maxX - hole.minX, hole.maxZ - hole.minZ), MAT.glass);
      glass.rotation.x = Math.PI / 2;
      glass.position.set((hole.minX + hole.maxX) / 2, h - 0.01, (hole.minZ + hole.maxZ) / 2);
      g.add(glass);
    }
  }

  private buildDome(room: Room, v: SpaceView) {
    const c = v.center;
    const base = 8.5;
    const rise = 4.5;
    const rs = (base * base + rise * rise) / (2 * rise);
    const theta = Math.asin(base / rs);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(rs, 56, 12, 0, Math.PI * 2, 0, theta), MAT.glassDome);
    dome.position.set(c.x, room.height + rise - rs, c.z);
    dome.renderOrder = 3;
    v.group.add(dome);
    const b = new Batch();
    const cy = room.height + rise - rs;
    const point = (az: number, th: number): [number, number, number] => [c.x + Math.sin(th) * rs * Math.cos(az), cy + Math.cos(th) * rs, c.z + Math.sin(th) * rs * Math.sin(az)];
    const steps = 8;
    for (let m = 0; m < 12; m++) {
      const az = (m / 12) * Math.PI * 2;
      for (let s = 0; s < steps; s++) {
        const a = point(az, (s / steps) * theta);
        const bb = point(az, ((s + 1) / steps) * theta);
        b.beam(a[0], a[1], a[2], bb[0], bb[1], bb[2], 0.1, 'rib');
      }
    }
    for (const frac of [0.45, 0.75, 1]) {
      const th = theta * frac;
      for (let k = 0; k < 36; k++) {
        const a = point((k / 36) * Math.PI * 2, th);
        const bb = point(((k + 1) / 36) * Math.PI * 2, th);
        b.beam(a[0], a[1], a[2], bb[0], bb[1], bb[2], 0.1, 'rib');
      }
    }
    b.build(v.group);
  }

  /** Per-room details that are not tied to a single prop: floor strips, windows, signage. */
  private roomExtras(room: Room, b: Batch, v: SpaceView) {
    if (room.id === 'bay') {
      // Floor strips and the stern window (glass, mullions, sill light).
      for (let x = -8; x <= 8; x += 4) b.box(0.1, 0.03, 9, x, 0.01, 1.5, 'glowCyan');
      for (let x = -10; x <= 10; x += 4) b.box(0.4, 1.8, 0.5, x, 1.9, -6.15, 'frame');
      b.box(20.4, 0.08, 0.1, 0, 1.9, -5.98, 'glowCyan');
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 1.8), MAT.glass);
      glass.position.set(0, 2.8, -6.1);
      v.group.add(glass);
      b.box(20.4, 0.06, 0.1, 0, 0.62, 7.1, 'glowCyan');
    }
    if (room.id === 'commons') {
      b.ring(2.1, 0.04, -38.2, 0.012, 1.6, 'glowCyan', 48);
      for (const [x, z, w, d] of [[-38.2, -3.6, 0.12, 3.4], [-38.2, 5.2, 0.12, 2.4]] as const) b.box(w, 0.025, d, x, 0.01, z, 'glowCyan');
    }
    if (room.id === 'bridge') this.bridgeScreens(v, b);
    if (room.id === 'fore-node' || room.id === 'aft-node') {
      const c = v.center;
      b.ring(1.6, 0.04, c.x, 0.012, c.z, 'glowCyan', 32);
    }
    if (room.id === 'engine') {
      for (const z of [-62.5, -68.5]) b.box(8, 0.12, 0.12, -38.2, 0.4, z, 'glowAmber');
      for (const s of [-1, 1]) b.box(0.25, 0.25, 10, -38.2 + s * 5.85, 0, -65.2, 'dark');
    }
    if (room.id === 'greenhouse') b.ring(7.3, 0.05, v.center.x, 0.012, v.center.z, 'glowGreen', 64);
  }

  private bridgeScreens(v: SpaceView, b: Batch) {
    // Wide view screens along the flat front face and both angled facets of the nose.
    const mats = [screenMaterial('STAR MAP · SOL', 'cyan'), screenMaterial('NAV · LUNAR ORBIT', 'amber'), screenMaterial('SCAN · LONG RANGE', 'green')];
    const edges: [Pt, Pt][] = [
      [BRIDGE_POLY[3], BRIDGE_POLY[4]],
      [BRIDGE_POLY[4], BRIDGE_POLY[5]],
      [BRIDGE_POLY[5], BRIDGE_POLY[6]],
    ];
    let k = 0;
    for (const [p, q] of edges) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const dx = (q[0] - p[0]) / len;
      const dz = (q[1] - p[1]) / len;
      const inx = -dz;
      const inz = dx;
      const n = Math.max(1, Math.round(len / 2.8));
      const pw = (len - 0.5) / n - 0.1;
      for (let i = 0; i < n; i++) {
        const t = 0.25 + ((i + 0.5) * (len - 0.5)) / n;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, 2.3), mats[k++ % mats.length]);
        const off = WALL_T / 2 + 0.02;
        m.position.set(p[0] + dx * t + inx * off, 2.65, p[1] + dz * t + inz * off);
        m.rotation.y = Math.atan2(inx, inz);
        v.group.add(m);
      }
      b.beam(p[0] + dx * 0.2 + inx * 0.22, 1.4, p[1] + dz * 0.2 + inz * 0.22, q[0] - dx * 0.2 + inx * 0.22, 1.4, q[1] - dz * 0.2 + inz * 0.22, 0.07, 'glowCyan');
    }
  }

  // ---------------------------------------------------------------- corridors

  private buildCorridor(c: Corridor) {
    const center = rectCenter(c.outer);
    const v = this.space(c.id, center);
    const t0 = c.axis === 'z' ? c.outer.minZ : c.outer.minX;
    const t1 = c.axis === 'z' ? c.outer.maxZ : c.outer.maxX;
    // Struts that meet a round room end on its curved wall (the greenhouse strut is authored to run on into the drum).
    const round = c.id === 'c-cabin' ? ROUND_ROOMS.cabin : c.id === 'c-greenhouse' ? ROUND_ROOMS.greenhouse : null;
    const cut0 = round ? (u: number) => round.x + Math.sqrt(Math.max(0, round.r ** 2 - (center.z + u - round.z) ** 2)) : undefined;
    this.tube(v, c.axis, c.axis === 'z' ? center.x : center.z, t0, t1, cut0);
  }

  private buildPassThrough() {
    const o = { minX: -40.2, maxX: -36.2, minZ: -47.2, maxZ: -29.2 };
    const v = this.space('c-pass', rectCenter(o));
    this.tube(v, 'z', -38.2, o.minZ, o.maxZ);
    // The hangar below shows through the trench as a pair of cyan light lines along the walkway.
    const b = new Batch();
    for (const s of [-1, 1]) b.box(0.06, 0.06, o.maxZ - o.minZ - 3, -38.2 + s * 1.98, 1.2, rectCenter(o).z, 'glowCyan');
    b.build(v.group);
  }

  private tube(v: SpaceView, axis: 'x' | 'z', cx: number, t0: number, t1: number, cut0?: (u: number) => number) {
    const shell = new THREE.Mesh(tubeGeometry(axis, cx, t0, t1, cut0), MAT.shell.clone());
    shell.name = `${v.id}:tube`;
    v.group.add(shell);
    this.occluders.push({ mesh: shell, mat: shell.material as THREE.MeshLambertMaterial, space: v.id, fade: 1, target: 1 });
    this.occluderMeshes.push(shell);

    const start = cut0 ? Math.max(cut0(-2), cut0(2)) + 0.5 : t0;
    const len = t1 - start;
    const mid = (start + t1) / 2;
    const e0 = (u: number) => (cut0 ? cut0(u) : t0);
    const floorPts: Pt[] = axis === 'z' ? [[cx - 1.2, t0], [cx + 1.2, t0], [cx + 1.2, t1], [cx - 1.2, t1]] : [[e0(-1.2), cx - 1.2], [t1, cx - 1.2], [t1, cx + 1.2], [e0(1.2), cx + 1.2]];
    const floor = new THREE.Mesh(floorGeometry(floorPts), MAT.floor);
    floor.position.y = 0.012;
    v.group.add(floor);

    const detail = new THREE.Group();
    v.group.add(detail);
    this.occluders[this.occluders.length - 1].details = detail;
    const b = new Batch();
    const place = (t: number, y: number, w: number, h: number, d: number, mat: MatKey) => (axis === 'z' ? b.box(w, h, d, cx, y, t, mat) : b.box(d, h, w, t, y, cx, mat));
    place(mid, 3.12, 0.35, 0.05, len - 0.6, 'glowWhite');
    for (let t = start + 1.5; t < t1 - 1; t += 2) place(t, 0.013, 0.14, 0.02, 0.9, 'glowCyan');
    const geo = ribGeometry();
    for (let t = start + 1.6; t < t1 - 0.8; t += 4) {
      const m = new THREE.Matrix4();
      if (axis === 'z') m.makeTranslation(cx, 0, t);
      else m.makeTranslation(t, 0, cx).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      b.add(geo, 'rib', m);
    }
    b.build(detail);
  }

  // ---------------------------------------------------------------- doors, ports, signs

  private doorSide(d: Door): string | null {
    const isBuilt = (id: string) => this.spaces.has(id);
    const room = [d.a, d.b].find((id) => isBuilt(id) && !id.startsWith('c-'));
    if (room) return room;
    return [d.a, d.b].find(isBuilt) ?? null;
  }

  private buildDoors() {
    const per = new Map<string, Batch>();
    for (const d of SHIP_LAYOUT.doors) {
      if (d.level !== 0 || d.sealed) continue;
      const side = this.doorSide(d);
      if (!side) continue;
      let b = per.get(side);
      if (!b) per.set(side, (b = new Batch()));
      const w = d.width / 2;
      const { x: dx0, z: dz0 } = doorPlacement(d);
      const locked = d.locked === 'captain';
      const jamb: MatKey = locked ? 'red' : 'frame';
      if (d.axis === 'x') {
        for (const s of [-1, 1]) b.box(0.2, DOOR_HEIGHT + 0.1, 0.62, dx0 + s * (w + 0.1), 0, dz0, jamb);
        b.box(d.width + 0.4, 0.18, 0.62, dx0, DOOR_HEIGHT, dz0, jamb);
        b.box(d.width - 0.2, 0.04, 0.64, dx0, DOOR_HEIGHT - 0.04, dz0, locked ? 'glowRed' : 'glowCyan');
      } else {
        for (const s of [-1, 1]) b.box(0.62, DOOR_HEIGHT + 0.1, 0.2, dx0, 0, dz0 + s * (w + 0.1), jamb);
        b.box(0.62, 0.18, d.width + 0.4, dx0, DOOR_HEIGHT, dz0, jamb);
        b.box(0.64, 0.04, d.width - 0.2, dx0, DOOR_HEIGHT - 0.04, dz0, locked ? 'glowRed' : 'glowCyan');
      }
    }
    for (const [side, b] of per) b.build(this.spaces.get(side)!.group);

    // Signs on the approach side of each door: they name the room the door opens into. Corridor ceilings are 3.2 m, so the
    // sign sits just above the lintel, and its width is capped to fit the octagon.
    for (const d of SHIP_LAYOUT.doors) {
      if (d.level !== 0 || d.sealed) continue;
      const room = [d.a, d.b].find((id) => this.spaces.has(id) && !id.startsWith('c-'));
      const other = [d.a, d.b].find((id) => id !== room);
      if (!room || !other) continue;
      const corridor = SHIP_LAYOUT.corridors.find((c) => c.id === other);
      if (!corridor) continue;
      const approach = this.spaces.get(corridor.id);
      const text = `${SIGN_NAMES[room] ?? SPACE_NAMES[room] ?? room}`.toUpperCase();
      const view = this.spaces.get(room)!;
      const pl = doorPlacement(d);
      const inx = d.axis === 'z' ? Math.sign(view.center.x - pl.x) : 0;
      const inz = d.axis === 'x' ? Math.sign(view.center.z - pl.z) : 0;
      const s = labelSprite(`→ ${text}`, 'sign', 0.24);
      if (approach) {
        const aspect = s.scale.x / s.scale.y;
        const h = Math.min(0.24, SIGN_MAX_WIDTH / aspect);
        s.scale.set(h * aspect, h, 1);
        s.position.set(pl.x - inx * 0.7, SIGN_Y_CORRIDOR, pl.z - inz * 0.7);
        approach.group.add(s);
        approach.sprites.push(s);
      } else {
        s.position.set(pl.x + inx * 0.6, 3.35, pl.z + inz * 0.6);
        view.group.add(s);
        view.sprites.push(s);
      }
    }

    // The Captain's cabin keypad, on the strut side of the locked door.
    const cab = this.spaces.get('c-cabin');
    if (cab) {
      const doorWall = cabinDoorSlideBasis();
      const b = new Batch();
      const { z, y } = CABIN_KEYPAD;
      const kx = doorWall.x + doorWall.nx * (WALL_T / 2 + 0.05);
      const kFace = kx + doorWall.nx * 0.06;
      b.box(0.1, 0.55, 0.4, kx, y - 0.15, z, 'dark');
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) b.box(0.04, 0.07, 0.07, kFace, y - 0.3 + r * 0.1, z - 0.12 + c * 0.12, 'glowCyan');
      b.box(0.04, 0.06, 0.28, kFace, y + 0.18, z, 'glowRed');
      b.build(cab.group);
      const k = labelSprite("CAPTAIN'S CABIN · KEYPAD", 'warn', 0.22);
      k.position.set(kx + doorWall.nx * 0.35, y + 0.55, z);
      cab.group.add(k);
      cab.sprites.push(k);

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.7, 0.45),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.set(kx, y, z);
      pick.userData.interactId = CABIN_KEYPAD_INTERACT_ID;
      cab.group.add(pick);

      const stand = cabinKeypadInteractPosition();
      this.keypadGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.38, 32),
        new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      this.keypadGlow.rotation.x = -Math.PI / 2;
      this.keypadGlow.position.set(stand.x, 0.04, stand.z);
      this.keypadGlow.visible = false;
      this.root.add(this.keypadGlow);
    }

    const cabinDoor = SHIP_LAYOUT.doors.find((d) => d.id === 'cabin-in');
    if (cabinDoor && cabinDoor.level === 0 && !cabinDoor.sealed) {
      const basis = cabinDoorSlideBasis();
      const closed = cabinDoorPanelPose(0);
      const panel = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(basis.depth, DOOR_HEIGHT, cabinDoor.width - 0.12),
        new THREE.MeshStandardMaterial({ color: 0x4a3038, roughness: 0.55, metalness: 0.25 }),
      );
      mesh.position.y = DOOR_HEIGHT / 2;
      panel.add(mesh);
      panel.position.set(closed.x, 0, closed.z);
      panel.rotation.y = closed.yaw;
      this.cabinDoorPanel = panel;
      this.root.add(panel);
    }
  }

  private buildPorts() {
    for (const dock of visiblePorts()) {
      const room = SHIP_LAYOUT.modules.find((m) => m.id === dock.module)?.rooms[0];
      if (!room) continue;
      const v = this.spaces.get(room.id);
      if (!v) continue;
      const inward = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[dock.facing];
      const w = dock.width + 0.7;
      const h = 3.0;
      const ch = 0.75;
      const oct: [number, number][] = [
        [-w / 2 + ch, 0],
        [w / 2 - ch, 0],
        [w / 2, ch],
        [w / 2, h - ch],
        [w / 2 - ch, h],
        [-w / 2 + ch, h],
        [-w / 2, h - ch],
        [-w / 2, ch],
      ];
      const g = new THREE.Group();
      const inset = (k: number) => oct.map(([x, y]) => new THREE.Vector2(x * k, h / 2 + (y - h / 2) * k));
      const panel = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inset(0.92))), new THREE.MeshStandardMaterial({ color: 0x14070b, roughness: 0.9 }));
      g.add(panel);
      const outer = new THREE.Shape(inset(1.0));
      outer.holes.push(new THREE.Path(inset(0.92).reverse()));
      const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: false }), MAT.frame);
      frame.position.z = -0.02;
      g.add(frame);
      const glowShape = new THREE.Shape(inset(0.93));
      glowShape.holes.push(new THREE.Path(inset(0.88).reverse()));
      const glow = new THREE.Mesh(new THREE.ShapeGeometry(glowShape), MAT.glowRed);
      glow.position.z = 0.13;
      g.add(glow);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.7, 0.05), MAT.red);
      seam.position.set(0, h * 0.5, 0.04);
      g.add(seam);
      g.position.set(dock.x + inward[0] * 0.22, 0.1, dock.z + inward[1] * 0.22);
      g.rotation.y = Math.atan2(inward[0], inward[1]);
      v.group.add(g);
      const s = labelSprite('SEALED PORT · GROWTH POINT', 'warn', 0.22);
      s.position.set(dock.x + inward[0] * 0.5, 3.35, dock.z + inward[1] * 0.5);
      v.group.add(s);
      v.sprites.push(s);
    }
  }

  /** The NPC dorm: a sealed bulkhead on the bunk room's port wall with a status panel. */
  private buildSealedDoors() {
    const v = this.spaces.get(NPC_PANEL.room);
    if (!v) return;
    const d = SHIP_LAYOUT.doors.find((x) => x.id === 'bunks-dorm')!;
    const b = new Batch();
    const x = d.x + WALL_T / 2 + 0.02;
    b.box(0.12, 2.9, 0.2, x, 0, d.z - 1.6, 'red');
    b.box(0.12, 2.9, 0.2, x, 0, d.z + 1.6, 'red');
    b.box(0.12, 0.2, 3.4, x, 2.9, d.z, 'red');
    b.box(0.08, 2.8, 3.0, x - 0.02, 0, d.z, 'redDark');
    b.box(0.05, 0.05, 3.0, x + 0.04, 1.0, d.z, 'glowRed');
    b.build(v.group);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.17), statusPanelMaterial());
    panel.position.set(x + 0.075, 1.55, d.z);
    panel.rotation.y = Math.PI / 2;
    v.group.add(panel);
    const s = labelSprite('NPC DORM · SEALED', 'warn', 0.24);
    s.position.set(x + 0.3, 3.4, d.z);
    v.group.add(s);
    v.sprites.push(s);
  }

  // ---------------------------------------------------------------- runtime

  /** Space ids within `VISIBLE_DEPTH` doors of the focus space stay in the scene. */
  setFocus(id: string | null) {
    if (id === this.focusSpace && this.visible.size) return;
    this.focusSpace = id;
    this.visible.clear();
    if (!id || !this.graph.has(id)) for (const k of this.spaces.keys()) this.visible.add(k);
    else {
      let frontier = [id];
      this.visible.add(id);
      for (let d = 0; d < VISIBLE_DEPTH; d++) {
        const next: string[] = [];
        for (const f of frontier) for (const n of this.graph.get(f) ?? []) if (!this.visible.has(n)) (this.visible.add(n), next.push(n));
        frontier = next;
      }
    }
    for (const [sid, v] of this.spaces) v.group.visible = this.visible.has(sid);
  }

  isVisible(id: string | null) {
    return !id || this.visible.has(id);
  }

  flashPod(i: number) {
    const p = this.anim.pods[i];
    if (p) p.flash = 1;
  }

  /**
   * Per frame. `focus` is the player (eye height), `cameraPos` the camera. Walls and tubes whose geometry sits between
   * the two fade out; everything within a metre of the camera fades too so the near plane never shows a wall.
   */
  update(dt: number, focus: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    this.time += dt;
    this.questTerminals.update(this.time);
    if (this.cabinDoorPanel) {
      const t = Math.min(1, dt * 8);
      this.cabinDoorOpenFrac += (this.cabinDoorTargetFrac - this.cabinDoorOpenFrac) * t;
      // The ease never quite arrives; settle so the obstacle clears (open) or seats fully (closed) instead of hovering.
      if (Math.abs(this.cabinDoorTargetFrac - this.cabinDoorOpenFrac) < 0.01) this.cabinDoorOpenFrac = this.cabinDoorTargetFrac;
      const pose = cabinDoorPanelPose(this.cabinDoorOpenFrac);
      this.cabinDoorPanel.position.set(pose.x, 0, pose.z);
      this.cabinDoorPanel.rotation.y = pose.yaw;
    }
    if (this.keypadGlow?.visible) {
      const pulse = 0.5 + 0.35 * Math.sin(this.time * 3.2);
      (this.keypadGlow.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
    this.sun.position.set(focus.x + 4, 12, focus.z + 7);
    this.sun.target.position.copy(focus);

    this.anim.holo?.update(dt);
    this.anim.pods.forEach((t: PodFx, i: number) => {
      t.flash = Math.max(0, t.flash - dt * 0.8);
      t.fluid.opacity = 0.06 + Math.sin(this.time * 1.6 + i) * 0.02 + t.flash * 0.6;
      const pos = t.bubbles.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        let y = pos.getY(k) + dt * (0.18 + (k % 5) * 0.05);
        if (y > 1.65) y = 0.75;
        pos.setY(k, y);
      }
      pos.needsUpdate = true;
    });

    this.updateCutaway(dt, focus, camera);
    this.updateLights(dt, focus);

    for (const id of this.visible) {
      const v = this.spaces.get(id);
      if (!v) continue;
      for (const s of v.sprites) {
        const d = s.getWorldPosition(this.cameraAnchor).distanceTo(camera.position);
        s.visible = d < 15;
        if (s.visible) {
          const k = Math.min(1.25, Math.max(0.3, d / 7));
          const base = (s.userData.base ??= s.scale.clone()) as THREE.Vector3;
          s.scale.set(base.x * k, base.y * k, 1);
        }
      }
    }
  }

  private updateCutaway(dt: number, focus: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    const cam = camera.position;
    const toFocus = focus.clone().sub(cam);
    const dist = toFocus.length();
    const dir = toFocus.clone().normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (const o of this.occluders) o.target = 1;
    const active = this.occluderMeshes.filter((m) => m.parent?.visible);
    this.ray.near = 0;
    this.ray.far = Math.max(0.1, dist - 0.15);
    const targets: THREE.Vector3[] = [
      focus.clone(),
      focus.clone().add(new THREE.Vector3(0, -0.9, 0)),
      focus.clone().addScaledVector(side, 0.55),
      focus.clone().addScaledVector(side, -0.55),
      focus.clone().add(new THREE.Vector3(0, 0.6, 0)),
    ];
    const byMesh = new Map<THREE.Mesh, Occluder>(this.occluders.map((o) => [o.mesh, o]));
    for (const t of targets) {
      const d = t.clone().sub(cam);
      const len = d.length();
      this.ray.set(cam, d.normalize());
      this.ray.far = Math.max(0.1, len - 0.1);
      for (const hit of this.ray.intersectObjects(active, false)) {
        const o = byMesh.get(hit.object as THREE.Mesh);
        if (o) o.target = FADE_ALPHA;
      }
    }
    const k = 1 - Math.exp(-12 * dt);
    for (const o of this.occluders) {
      if (!o.mesh.parent?.visible) continue;
      o.fade += (o.target - o.fade) * k;
      const solid = o.fade > 0.97;
      const mat = o.mat;
      if (mat.transparent === solid) {
        mat.transparent = !solid;
        mat.depthWrite = solid;
        mat.needsUpdate = true;
      }
      mat.opacity = solid ? 1 : o.fade;
      if (o.details) o.details.visible = o.fade > 0.55;
    }
  }

  private updateLights(dt: number, focus: THREE.Vector3) {
    const wanted = [...this.anchors.entries()]
      .filter(([id]) => this.visible.has(id))
      .map(([id, a]) => ({ id, a, d: Math.hypot(a.x - focus.x, a.z - focus.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, LIGHT_SLOTS);
    const wantedIds = new Set(wanted.map((w) => w.id));
    for (const slot of this.lightPool) {
      if (slot.id && !wantedIds.has(slot.id)) {
        slot.target = 0;
        if (slot.light.intensity < 0.05) slot.id = null;
      }
    }
    for (const w of wanted) {
      if (this.lightPool.some((s) => s.id === w.id && s.target > 0)) continue;
      const slot = this.lightPool.find((s) => !s.id) ?? this.lightPool.find((s) => s.target === 0);
      if (!slot) continue;
      slot.id = w.id;
      slot.light.position.set(w.a.x, w.a.y, w.a.z);
      slot.light.color.setHex(w.a.spec.color);
      slot.light.intensity = 0;
      slot.target = w.a.spec.intensity;
    }
    const k = 1 - Math.exp(-5 * dt);
    for (const slot of this.lightPool) slot.light.intensity += (slot.target - slot.light.intensity) * k;
  }
}

