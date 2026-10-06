import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  SHIP_LAYOUT,
  floorY,
  type Corridor,
  type Dock,
  type Facing,
  type Rect,
  type Room,
  type ShipLayout,
} from '../../../shared/shipLayout';

/**
 * Greybox exterior of the seed ship, built from the shared layout data.
 * World frame matches the layout: bay at the origin, +x starboard, +z bow, y up.
 */

export interface ExteriorLabel {
  text: string;
  position: THREE.Vector3;
}

export interface ShipExterior {
  root: THREE.Group;
  /** Translucent markers on the free docks (growth points). Hidden by default. */
  docks: THREE.Group;
  labels: ExteriorLabel[];
  bounds: THREE.Box3;
}

const HULL_BOTTOM = 0.45;
const HULL_TOP = 0.3;
const STRUT_RY = 1.75;

const mats = {
  light: new THREE.MeshStandardMaterial({ color: 0xaeb8c6, metalness: 0.3, roughness: 0.6 }),
  mid: new THREE.MeshStandardMaterial({ color: 0x76849a, metalness: 0.4, roughness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x343c4a, metalness: 0.5, roughness: 0.55 }),
  seam: new THREE.MeshStandardMaterial({ color: 0x2a303c, metalness: 0.3, roughness: 0.8 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xe6b422, metalness: 0.2, roughness: 0.6 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xa6f0c8,
    transparent: true,
    opacity: 0.26,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    emissive: 0x2f7a52,
    emissiveIntensity: 0.35,
  }),
  viewport: new THREE.MeshBasicMaterial({ color: 0x8fdcff, toneMapped: false }),
  window: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  glow: new THREE.MeshBasicMaterial({ color: 0x66ccff, toneMapped: false }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4fbf6a, emissive: 0x1d6a33, emissiveIntensity: 0.7, roughness: 0.8 }),
  floorGreen: new THREE.MeshStandardMaterial({ color: 0x2a3a2c, roughness: 0.9 }),
};

const ACCENT: Record<string, number> = {
  commons: 0xf2c14e,
  bay: 0x5ee7ff,
  bridge: 0x4aa3ff,
  ops: 0xff6b5a,
  cabin: 0x4aa3ff,
  bunks: 0xb78cff,
  medical: 0xff5d7a,
  hold: 0xe39a3a,
  science: 0xb78cff,
  engine: 0xff9442,
  hangar: 0xe6b422,
  greenhouse: 0x5fe08a,
  'fore-node': 0x8995a8,
  'aft-node': 0x8995a8,
};

const rectCenter = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
const rectSize = (r: Rect) => ({ w: r.maxX - r.minX, d: r.maxZ - r.minZ });

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Unit cylinder (radius 1, length 1) along z; the +z end carries rTop. */
function cylZ(rTop: number, rBottom: number, length: number, segments = 28, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function roundedBox(w: number, h: number, d: number, radius: number, mat: THREE.Material) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)), mat);
}

function tintFor(room: Room) {
  if (room.id === 'fore-node' || room.id === 'aft-node') return mats.mid;
  if (room.id === 'hangar') return mats.dark;
  return mats.light;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  ry?: number;
  rz?: number;
  color?: THREE.Color;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[]) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z);
    o.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    o.scale.set(it.sx, it.sy, it.sz);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    if (it.color) im.setColorAt(i, it.color);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}

const WINDOW_COLORS = [0xffdc9a, 0xffdc9a, 0xffdc9a, 0xffd08a, 0x9fd6ff, 0x39414f].map((c) => new THREE.Color(c));

type FaceName = 'N' | 'S' | 'E' | 'W';
const FACE_DIR: Record<FaceName, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Intervals along a room face that are taken by a strut or other fixture. */
function blockedIntervals(room: Room, face: FaceName, corridors: Corridor[]) {
  const o = room.outer;
  const out: [number, number][] = [];
  for (const c of corridors) {
    if (c.level !== room.level) continue;
    const r = c.outer;
    const eps = 0.01;
    if (face === 'N' && Math.abs(r.maxZ - o.minZ) < eps && r.maxX > o.minX && r.minX < o.maxX) out.push([r.minX, r.maxX]);
    if (face === 'S' && Math.abs(r.minZ - o.maxZ) < eps && r.maxX > o.minX && r.minX < o.maxX) out.push([r.minX, r.maxX]);
    if (face === 'W' && Math.abs(r.maxX - o.minX) < eps && r.maxZ > o.minZ && r.minZ < o.maxZ) out.push([r.minZ, r.maxZ]);
    if (face === 'E' && Math.abs(r.minX - o.maxX) < eps && r.maxZ > o.minZ && r.minZ < o.maxZ) out.push([r.minZ, r.maxZ]);
  }
  return out;
}

function windowsFor(room: Room, corridors: Corridor[], extraBlocked: Partial<Record<FaceName, [number, number][]>>, rand: () => number) {
  const items: Inst[] = [];
  const o = room.outer;
  const y = floorY(room.level) + 1.9;
  (['N', 'S', 'E', 'W'] as FaceName[]).forEach((face) => {
    const alongX = face === 'N' || face === 'S';
    const lo = alongX ? o.minX : o.minZ;
    const hi = alongX ? o.maxX : o.maxZ;
    const len = hi - lo;
    const pitch = 3.0;
    const n = Math.floor((len - 2.4) / pitch) + 1;
    if (n < 1) return;
    const blocked = [...blockedIntervals(room, face, corridors), ...(extraBlocked[face] ?? [])];
    const mid = (lo + hi) / 2;
    for (let i = 0; i < n; i++) {
      const p = mid + (i - (n - 1) / 2) * pitch;
      if (blocked.some(([a, b]) => p + 0.75 > a - 0.5 && p - 0.75 < b + 0.5)) continue;
      const [nx, nz] = FACE_DIR[face];
      const fixed = alongX ? (nz > 0 ? o.maxZ : o.minZ) : nx > 0 ? o.maxX : o.minX;
      const color = WINDOW_COLORS[Math.floor(rand() * WINDOW_COLORS.length)];
      items.push({
        x: alongX ? p : fixed,
        y,
        z: alongX ? fixed : p,
        sx: alongX ? 1.5 : 0.12,
        sy: 0.8,
        sz: alongX ? 0.12 : 1.5,
        color,
      });
    }
  });
  return items;
}

function wallSeams(room: Room, corridors: Corridor[]) {
  const items: Inst[] = [];
  const o = room.outer;
  const base = floorY(room.level);
  (['N', 'S', 'E', 'W'] as FaceName[]).forEach((face) => {
    const alongX = face === 'N' || face === 'S';
    const lo = alongX ? o.minX : o.minZ;
    const hi = alongX ? o.maxX : o.maxZ;
    const pitch = 3.0;
    const n = Math.floor((hi - lo - 2.4) / pitch) + 1;
    const blocked = blockedIntervals(room, face, corridors);
    const [nx, nz] = FACE_DIR[face];
    const fixed = alongX ? (nz > 0 ? o.maxZ : o.minZ) : nx > 0 ? o.maxX : o.minX;
    for (let i = 0; i <= n; i++) {
      const p = (lo + hi) / 2 + (i - n / 2) * pitch;
      if (p < lo + 0.8 || p > hi - 0.8) continue;
      if (blocked.some(([a, b]) => p > a - 0.3 && p < b + 0.3)) continue;
      items.push({
        x: alongX ? p : fixed,
        y: base + 1.6,
        z: alongX ? fixed : p,
        sx: alongX ? 0.05 : 0.04,
        sy: 2.8,
        sz: alongX ? 0.04 : 0.05,
      });
    }
  });
  return items;
}

function roofSeams(room: Room, top: number) {
  const items: Inst[] = [];
  const { x, z } = rectCenter(room.outer);
  const { w, d } = rectSize(room.outer);
  const nx = Math.max(1, Math.round(w / 3.6));
  const nz = Math.max(1, Math.round(d / 3.6));
  for (let i = 1; i < nx; i++) items.push({ x: room.outer.minX + (w * i) / nx, y: top + 0.01, z, sx: 0.06, sy: 0.03, sz: d - 1.4 });
  for (let j = 1; j < nz; j++) items.push({ x, y: top + 0.01, z: room.outer.minZ + (d * j) / nz, sx: w - 1.4, sy: 0.03, sz: 0.06 });
  return items;
}

function greebles(room: Room, top: number, rand: () => number, group: THREE.Group) {
  const { w, d } = rectSize(room.outer);
  const { x, z } = rectCenter(room.outer);
  const n = 2 + Math.floor((w * d) / 70);
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * (w - 3.4);
    const pz = z + (rand() - 0.5) * (d - 3.4);
    const mat = rand() > 0.5 ? mats.mid : mats.dark;
    if (rand() > 0.45) {
      const bw = 0.8 + rand() * 1.4;
      const bd = 0.8 + rand() * 1.4;
      const bh = 0.3 + rand() * 0.5;
      group.add(mesh(new THREE.BoxGeometry(bw, bh, bd), mat, px, top + bh / 2, pz));
    } else {
      const r = 0.3 + rand() * 0.4;
      const h = 0.35 + rand() * 0.5;
      group.add(mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 12), mat, px, top + h / 2, pz));
    }
  }
}

function dish(x: number, y: number, z: number, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 1.1 * scale, 8), mats.dark, 0, 0.55 * scale, 0));
  const bowl = mesh(new THREE.SphereGeometry(1.1 * scale, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mats.light, 0, 1.3 * scale, 0);
  bowl.material = mats.light;
  bowl.rotation.x = -0.5;
  g.add(bowl);
  return g;
}

function buildModuleShell(room: Room, group: THREE.Group, layout: ShipLayout, labels: ExteriorLabel[]) {
  const base = floorY(room.level);
  const yBot = base - HULL_BOTTOM;
  const yTop = base + room.height + HULL_TOP;
  const { x, z } = rectCenter(room.outer);
  const { w, d } = rectSize(room.outer);
  const rand = mulberry32(hash(room.id));
  const g = new THREE.Group();
  g.name = `module:${room.module}`;
  const accent = new THREE.MeshStandardMaterial({ color: ACCENT[room.id] ?? 0x8995a8, emissive: ACCENT[room.id] ?? 0x8995a8, emissiveIntensity: 0.55, roughness: 0.5 });

  if (room.ceiling?.kind === 'dome') {
    buildGreenhouse(room, g, accent);
  } else {
    const shell = roundedBox(w, yTop - yBot, d, 0.35, tintFor(room));
    shell.position.set(x, (yTop + yBot) / 2, z);
    g.add(shell);
  }

  const bandY = base + room.height - 0.25;
  const band = (bw: number, bd: number) => mesh(new THREE.BoxGeometry(bw, 0.16, bd), accent, x, bandY, z);
  if (room.id !== 'greenhouse') {
    g.add(band(w + 0.06, d + 0.06));
    const lower = mesh(new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), mats.seam, x, base + 0.7, z);
    g.add(lower);
  }

  const extra: Partial<Record<FaceName, [number, number][]>> = {};
  if (room.id === 'bridge') extra.S = [[x - 6, x + 6]];
  if (room.id === 'engine') extra.N = [[x - 3.5, x + 3.5]];
  const skipWindows = room.id === 'greenhouse' || room.id === 'hangar';
  if (!skipWindows) {
    const wins = windowsFor(room, layout.corridors, extra, rand);
    if (wins.length) g.add(instanced(new THREE.BoxGeometry(1, 1, 1), mats.window, wins));
  }

  if (!skipWindows) {
    const ws = wallSeams(room, layout.corridors);
    if (ws.length) g.add(instanced(new THREE.BoxGeometry(1, 1, 1), mats.seam, ws));
  }

  if (room.ceiling?.kind !== 'dome') {
    const seams = roofSeams(room, yTop);
    if (seams.length) g.add(instanced(new THREE.BoxGeometry(1, 1, 1), mats.seam, seams));
  }

  const isNode = room.id === 'fore-node' || room.id === 'aft-node';
  if (isNode) {
    g.add(mesh(new THREE.SphereGeometry(1.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.light, x, yTop, z));
    g.add(mesh(new THREE.TorusGeometry(1.35, 0.1, 6, 28), accent, x, yTop + 0.02, z).rotateX(Math.PI / 2));
  } else if (room.id !== 'greenhouse' && room.id !== 'bridge') {
    greebles(room, yTop, rand, g);
  }

  if (room.id === 'bridge') buildBridgeDetail(room, g, yTop);
  if (room.id === 'engine') buildEngineModuleDetail(room, g, yTop, accent);
  if (room.id === 'hangar') buildHangarDetail(room, g);
  if (room.id === 'ops') g.add(dish(x + 2.5, yTop, z + 1, 1.0));
  if (room.id === 'science') g.add(dish(x - 2, yTop, z, 0.8));

  group.add(g);
  const labelY = room.ceiling ? base + room.ceiling.apex + 1.5 : yTop + 1.8;
  labels.push({ text: room.id, position: new THREE.Vector3(x, labelY, z) });
}

function buildGreenhouse(room: Room, g: THREE.Group, accent: THREE.Material) {
  const base = floorY(room.level);
  const yBot = base - HULL_BOTTOM;
  const rimY = base + room.height;
  const { x, z } = rectCenter(room.outer);
  const { w, d } = rectSize(room.outer);
  const apex = room.ceiling?.kind === 'dome' ? room.ceiling.apex : 7;
  const domeR = Math.min(w, d) / 2 - 0.2;

  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, domeR - 0.1, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const depth = rimY - yBot - 0.3;
  const slabGeo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 2,
    curveSegments: 64,
  });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, mats.light);
  slab.position.set(x, yBot + 0.15, z);
  g.add(slab);

  g.add(mesh(new THREE.CylinderGeometry(domeR, domeR, 0.2, 48), mats.floorGreen, x, base + 0.05, z));
  g.add(mesh(new THREE.CylinderGeometry(domeR, domeR, 0.4, 48), mats.light, x, yBot + 0.2, z));
  const bandY = rimY - 0.25;
  for (const sz of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(w + 0.06, 0.16, 0.06), accent, x, bandY, z + (sz * (d + 0.06)) / 2));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.16, d + 0.06), accent, x + (sx * (w + 0.06)) / 2, bandY, z));

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 20, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass);
  dome.scale.set(domeR, apex - room.height, domeR);
  dome.position.set(x, rimY, z);
  dome.renderOrder = 2;
  g.add(dome);

  const rim = mesh(new THREE.TorusGeometry(domeR, 0.2, 8, 64), mats.dark, x, rimY, z);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  const H = apex - room.height;
  for (let i = 0; i < 16; i++) {
    const phi = (i / 16) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = (k / 20) * (Math.PI / 2);
      pts.push(new THREE.Vector3(Math.cos(t) * domeR * Math.cos(phi), Math.sin(t) * H, Math.cos(t) * domeR * Math.sin(phi)));
    }
    const rib = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6), mats.dark, x, rimY, z);
    g.add(rib);
  }
  for (const t of [0.35, 0.7, 1.0].map((f) => f * (Math.PI / 2) * 0.62)) {
    const ring = mesh(new THREE.TorusGeometry(Math.cos(t) * domeR, 0.06, 6, 56), mats.dark, x, rimY + Math.sin(t) * H, z);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 10), mats.dark, x, rimY + H - 0.1, z));

  const plants = new THREE.Group();
  const rows = [-14.3, -8.2];
  const cols = [-75.4, -71.2, -67.0];
  const rand = mulberry32(7);
  for (const pz of rows) {
    for (const px of cols) {
      plants.add(mesh(new THREE.BoxGeometry(2, 0.9, 4.5), mats.soil, px, base + 0.5, pz));
      for (let k = 0; k < 7; k++) {
        const r = 0.35 + rand() * 0.35;
        const leaf = mesh(new THREE.IcosahedronGeometry(r, 1), mats.leaf, px + (rand() - 0.5) * 1.2, base + 1.15 + rand() * 0.6, pz + (rand() - 0.5) * 3.6);
        plants.add(leaf);
      }
    }
  }
  g.add(plants);
  const lamp = new THREE.PointLight(0x8dffb0, 120, 30, 2);
  lamp.position.set(x, base + 3.5, z);
  g.add(lamp);
}

function buildBridgeDetail(room: Room, g: THREE.Group, yTop: number) {
  const { x, z } = rectCenter(room.outer);
  const { w } = rectSize(room.outer);
  const base = floorY(room.level);
  const front = room.outer.maxZ;

  g.add(mesh(new THREE.BoxGeometry(10.4, 1.7, 0.16), mats.dark, x, base + 1.95, front + 0.02));
  g.add(mesh(new THREE.BoxGeometry(10, 1.3, 0.2), mats.viewport, x, base + 1.95, front + 0.04));
  for (let i = -2; i <= 2; i++) g.add(mesh(new THREE.BoxGeometry(0.12, 1.34, 0.24), mats.dark, x + i * 2, base + 1.95, front + 0.05));

  const canopy = roundedBox(8, 1.5, 3.6, 0.5, mats.light);
  canopy.position.set(x, yTop + 0.65, front - 3.2);
  g.add(canopy);
  g.add(mesh(new THREE.BoxGeometry(6.6, 0.7, 0.14), mats.viewport, x, yTop + 0.75, front - 3.2 + 1.82));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), mats.dark, x - 3, yTop + 3.0, z - 2));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), mats.dark, x + 3.3, yTop + 2.5, z - 1));
  g.add(dish(x + w / 2 - 3, yTop, z - 2.5, 0.7));
}

function buildEngineModuleDetail(room: Room, g: THREE.Group, yTop: number, accent: THREE.Material) {
  const { x, z } = rectCenter(room.outer);
  g.add(mesh(new THREE.CylinderGeometry(2.6, 2.8, 1.1, 28), mats.mid, x + 2.5, yTop + 0.55, z + 1.5));
  const ring = mesh(new THREE.TorusGeometry(2.0, 0.08, 6, 36), accent, x + 2.5, yTop + 1.12, z + 1.5);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.add(mesh(new THREE.BoxGeometry(2.2, 0.7, 4.5), mats.dark, x - 4, yTop + 0.35, z - 1));
}

function buildHangarDetail(room: Room, g: THREE.Group) {
  const base = floorY(room.level);
  const x = room.outer.maxX;
  const z = -25;
  const y = base + 1.5;
  g.add(mesh(new THREE.BoxGeometry(0.25, 2.9, 7.0), mats.seam, x + 0.02, y, z));
  g.add(mesh(new THREE.BoxGeometry(0.3, 2.5, 6.4), mats.mid, x + 0.05, y, z));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.1, 6.4), mats.seam, x + 0.06, y, z));
  for (let i = 0; i < 8; i++) {
    const zz = z - 3.0 + i * 0.86;
    const s = mesh(new THREE.BoxGeometry(0.34, 0.45, 0.42), mats.hazard, x + 0.07, base + 0.42, zz);
    g.add(s);
  }
  const { x: cx, z: cz } = rectCenter(room.outer);
  const top = base + room.height + HULL_TOP;
  g.add(mesh(new THREE.BoxGeometry(7, 0.04, 0.5), mats.hazard, cx, top + 0.02, cz));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.04, 7), mats.hazard, cx, top + 0.02, cz));
  const seams = roofSeams(room, top);
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), mats.seam, seams));
}

function buildCorridor(c: Corridor, group: THREE.Group, labels: ExteriorLabel[]) {
  const base = floorY(c.level);
  const yc = base + c.height / 2;
  const { x, z } = rectCenter(c.outer);
  const { w, d } = rectSize(c.outer);
  const length = c.axis === 'z' ? d : w;
  const rx = c.width / 2;
  const g = new THREE.Group();
  g.name = `strut:${c.id}`;
  g.position.set(x, yc, z);
  if (c.axis === 'x') g.rotation.y = Math.PI / 2;

  const unit = cylZ(1, 1, 1);
  const tube = new THREE.Mesh(unit, mats.mid);
  tube.scale.set(rx, STRUT_RY, length);
  g.add(tube);

  const ring = (at: number, thick: number, grow: number) => {
    const m = new THREE.Mesh(unit, mats.dark);
    m.scale.set(rx + grow, STRUT_RY + grow * 0.85, thick);
    m.position.z = at;
    g.add(m);
  };
  ring(length / 2 - 0.3, 0.6, 0.2);
  ring(-length / 2 + 0.3, 0.6, 0.2);
  if (length > 7) {
    const n = Math.floor(length / 4);
    for (let i = 1; i < n; i++) ring(-length / 2 + (length * i) / n, 0.28, 0.1);
  }
  if (c.id === 'c-lower') {
    const cap = new THREE.Mesh(unit, mats.dark);
    cap.scale.set(rx, STRUT_RY, 0.3);
    cap.position.z = length / 2 + 0.1;
    g.add(cap);
  }

  const ports: Inst[] = [];
  const step = 2.0;
  const n = Math.floor((length - 2) / step) + 1;
  for (let i = 0; i < n; i++) {
    const p = (i - (n - 1) / 2) * step;
    for (const side of [-1, 1]) {
      ports.push({ x: side * (rx - 0.03), y: 0.1, z: p, sx: 1, sy: 1, sz: 1, rz: Math.PI / 2, color: WINDOW_COLORS[(i + (side > 0 ? 1 : 0)) % 4] });
    }
  }
  const portGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14);
  g.add(instanced(portGeo, mats.window, ports));

  group.add(g);
  void labels;
}

function buildSpine(group: THREE.Group, dock: Dock, engineRoom: Room) {
  const yc = floorY(engineRoom.level) + engineRoom.height / 2;
  const g = new THREE.Group();
  g.name = 'engine-spine';
  g.position.set(dock.x, yc, dock.z);

  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number, x = 0, y = 0) => {
    const m = mesh(geo, mat, x, y, z);
    g.add(m);
    return m;
  };

  const R = dock.width / 2;
  part(cylZ(R + 0.1, R + 0.1, 1.4), mats.dark, -0.7);
  part(cylZ(R, 1.5, 4.5), mats.mid, -3.65);
  part(cylZ(1.3, 1.3, 22), mats.mid, -17);
  for (let i = 0; i < 7; i++) part(cylZ(1.65, 1.65, 0.35), mats.dark, -8 - i * 3);

  for (const side of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 7, 6, 18), mats.light);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(side * 3.5, 0, -20);
    g.add(tank);
    for (const zz of [-16.5, -23.5]) part(new THREE.BoxGeometry(2.4, 0.25, 0.35), mats.dark, zz, side * 2.3);
    for (const zz of [-18, -22]) {
      const band = mesh(new THREE.TorusGeometry(1.27, 0.07, 6, 24), mats.dark, side * 3.5, 0, zz);
      band.rotation.y = Math.PI / 2;
      g.add(band);
    }
  }

  const finEdge = new THREE.MeshStandardMaterial({ color: 0xff9442, emissive: 0xff7a1f, emissiveIntensity: 0.9 });
  part(new THREE.BoxGeometry(0.14, 9, 10), mats.dark, -22);
  for (const sy of [-1, 1]) part(new THREE.BoxGeometry(0.2, 0.12, 10.1), finEdge, -22, 0, sy * 4.5);

  part(cylZ(3.4, 3.4, 10), mats.dark, -33);
  for (const zz of [-30, -34, -37]) part(cylZ(3.55, 3.55, 0.4), mats.mid, zz);
  part(cylZ(3.5, 3.5, 0.5), mats.mid, -28.3);

  const bellMat = new THREE.MeshStandardMaterial({ color: 0x2c3340, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide });
  const glowDisc = new THREE.CircleGeometry(1.0, 20);
  glowDisc.rotateY(Math.PI);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const bx = sx * 1.6;
      const by = sy * 1.6;
      part(cylZ(0.9, 1.4, 3.6, 24, true), bellMat, -39.8, bx, by);
      part(glowDisc, mats.glow, -38.4, bx, by);
      part(new THREE.TorusGeometry(1.4, 0.07, 6, 24), mats.mid, -41.6, bx, by);
    }
  }
  const light = new THREE.PointLight(0x66ccff, 400, 40, 2);
  light.position.set(0, 0, -45);
  g.add(light);

  group.add(g);
  return g;
}

function buildDockMarkers(docks: Dock[]) {
  const group = new THREE.Group();
  group.name = 'docks';
  const markMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, toneMapped: false });
  const dirs: Record<Facing, THREE.Vector3> = {
    N: new THREE.Vector3(0, 0, -1),
    S: new THREE.Vector3(0, 0, 1),
    E: new THREE.Vector3(1, 0, 0),
    W: new THREE.Vector3(-1, 0, 0),
  };
  for (const dock of docks) {
    const dir = dirs[dock.facing];
    const g = new THREE.Group();
    g.position.set(dock.x, floorY(dock.level) + 1.6, dock.z);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(dock.width, 3.2), markMat));
    const arrow = new THREE.Mesh(cylZ(0, 0.7, 2.2, 12), arrowMat);
    arrow.position.z = 2.2;
    arrow.rotation.y = Math.PI;
    g.add(arrow);
    group.add(g);
  }
  return group;
}

function buildLiftTrunk(layout: ShipLayout, group: THREE.Group) {
  for (const lift of layout.lifts) {
    const { x, z } = rectCenter(lift.pad);
    const top = Math.max(...lift.levels);
    const bot = Math.min(...lift.levels);
    const y0 = floorY(bot) + 3.2;
    const y1 = floorY(top) - HULL_BOTTOM;
    group.add(mesh(new THREE.BoxGeometry(2.8, y1 - y0 + 0.2, 2.8), mats.dark, x, (y0 + y1) / 2, z));
  }
}

function buildPylons(group: THREE.Group) {
  const lowerTop = floorY(-1) + 3.2 + HULL_TOP;
  const upperBot = -HULL_BOTTOM;
  for (const [x, z] of [
    [-36, -32],
    [-33, -28],
    [-36, -25],
  ]) {
    group.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, upperBot - lowerTop + 0.2, 10), mats.dark, x, (upperBot + lowerTop) / 2, z));
  }
}

function buildStars() {
  const rand = mulberry32(42);
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = 700 + rand() * 200;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(t);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, fog: false, toneMapped: false }));
}

export function buildShipExterior(layout: ShipLayout = SHIP_LAYOUT): ShipExterior {
  const root = new THREE.Group();
  root.name = 'ship-exterior';
  const labels: ExteriorLabel[] = [];

  let engineRoom: Room | undefined;
  for (const m of layout.modules) {
    for (const room of m.rooms) {
      buildModuleShell(room, root, layout, labels);
      if (room.id === 'engine') engineRoom = room;
    }
  }
  for (const c of layout.corridors) buildCorridor(c, root, labels);
  buildLiftTrunk(layout, root);
  buildPylons(root);

  const spine = layout.docks.find((d) => d.id === 'spine');
  if (spine && engineRoom) buildSpine(root, spine, engineRoom);

  const docks = buildDockMarkers(layout.docks.filter((d) => d.id !== 'spine'));
  docks.visible = false;
  root.add(docks);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent) {
      o.castShadow = false;
    }
  });

  const bounds = new THREE.Box3().setFromObject(root);
  return { root, docks, labels, bounds };
}

export { buildStars };
