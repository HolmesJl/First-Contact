import * as THREE from 'three';
import {
  SHIP_LAYOUT,
  floorY,
  type Corridor,
  type Dock,
  type Facing,
  type ModuleId,
  type Rect,
  type Room,
  type ShipLayout,
} from '../../../shared/shipLayout';

/**
 * Greybox exterior of the seed ship, built from the shared layout data.
 * World frame matches the layout: bay at the origin, +x starboard, +z bow, y up.
 * Every module shape and height comes from `Room.shape`, `Room.height` and `Room.ceiling`.
 */

export interface ExteriorLabel {
  text: string;
  module: ModuleId;
  /** Label point above the module (moves with the module when exploded). */
  position: THREE.Vector3;
  /** Point inside the module that the leader line ends on. */
  anchor: THREE.Vector3;
  basePosition: THREE.Vector3;
  baseAnchor: THREE.Vector3;
}

export interface ShipExterior {
  root: THREE.Group;
  /** Translucent markers on the free docks (growth points). Hidden by default. */
  docks: THREE.Group;
  labels: ExteriorLabel[];
  bounds: THREE.Box3;
  /** Push modules outward from the Commons. 0 = assembled; 1 = default exploded; larger spreads further. */
  setExplode(amount: number): void;
  /** Bounds of the hull with the given explode amount applied (leaves the current amount untouched). */
  boundsAt(amount: number): THREE.Box3;
}

type Pt = [number, number];

const HULL_BOTTOM = 0.45;
const HULL_TOP = 0.3;
const STRUT_RY = 1.75;
const PANEL_TILE = 6;
const NAME = 'FIRST CONTACT';

/* ------------------------------------------------------------------ textures */

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

/** 6 m tile of 2 m hull plates: seams, rivets, slight tonal variation, the odd vent. */
function makePanelTextures() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rand = mulberry32(99);
  const cell = size / 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const v = 226 + Math.floor(rand() * 26);
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(i * cell, j * cell, cell, cell);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.strokeRect(i * cell + 9, j * cell + 9, cell - 18, cell - 18);
      g.fillStyle = 'rgba(40,48,62,0.4)';
      for (const [dx, dy] of [[16, 16], [cell - 16, 16], [16, cell - 16], [cell - 16, cell - 16]]) {
        g.beginPath();
        g.arc(i * cell + dx, j * cell + dy, 3, 0, Math.PI * 2);
        g.fill();
      }
      if (rand() > 0.72) {
        g.fillStyle = 'rgba(30,36,48,0.5)';
        for (let k = 0; k < 4; k++) g.fillRect(i * cell + 46, j * cell + 56 + k * 12, cell - 92, 5);
      } else if (rand() > 0.8) {
        g.strokeStyle = 'rgba(30,36,48,0.55)';
        g.lineWidth = 3;
        g.strokeRect(i * cell + 40, j * cell + 40, cell - 80, cell - 80);
      }
    }
  }
  g.strokeStyle = 'rgba(40,48,64,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 3; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, size);
    g.moveTo(0, i * cell);
    g.lineTo(size, i * cell);
    g.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;
  return { map, bump };
}

function makeNameTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 176px "Arial Black", "Helvetica Neue", Impact, "DejaVu Sans", sans-serif';
  (g as unknown as { letterSpacing: string }).letterSpacing = '26px';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(8,12,22,0.85)';
  g.strokeText(NAME, 1024 + 13, 128);
  g.fillStyle = '#eef3fb';
  g.fillText(NAME, 1024 + 13, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const panels = makePanelTextures();

function hullMat(color: number, metalness = 0.3, roughness = 0.6) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, map: panels.map, bumpMap: panels.bump, bumpScale: 0.7 });
}

const mats = {
  light: hullMat(0xb9c3d1),
  mid: hullMat(0x7d8ba1, 0.4, 0.5),
  dark: hullMat(0x3a4250, 0.5, 0.55),
  plain: new THREE.MeshStandardMaterial({ color: 0x343c4a, metalness: 0.5, roughness: 0.55 }),
  seam: new THREE.MeshStandardMaterial({ color: 0x232833, metalness: 0.3, roughness: 0.8 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xe6b422, metalness: 0.2, roughness: 0.6 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xa6f0c8,
    transparent: true,
    opacity: 0.24,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    emissive: 0x2f7a52,
    emissiveIntensity: 0.35,
  }),
  glassWarm: new THREE.MeshPhysicalMaterial({
    color: 0xfff0c8,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
    emissive: 0xffc870,
    emissiveIntensity: 0.9,
  }),
  viewport: new THREE.MeshBasicMaterial({ color: 0x8fdcff, toneMapped: false }),
  window: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  glow: new THREE.MeshBasicMaterial({ color: 0x66ccff, toneMapped: false }),
  portGlow: new THREE.MeshBasicMaterial({ color: 0x5ee7ff, toneMapped: false }),
  portInner: new THREE.MeshStandardMaterial({ color: 0x0b1018, metalness: 0.6, roughness: 0.4 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3a2d22, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x4fbf6a, emissive: 0x1d6a33, emissiveIntensity: 0.7, roughness: 0.8 }),
  floorGreen: new THREE.MeshStandardMaterial({ color: 0x2a3a2c, roughness: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 }),
  name: new THREE.MeshStandardMaterial({
    map: makeNameTexture(),
    transparent: true,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0xffffff,
    emissiveIntensity: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    depthWrite: false,
  }),
};
mats.name.emissiveMap = mats.name.map;

const ACCENT: Record<string, number> = {
  commons: 0xf2c14e,
  bay: 0x5ee7ff,
  bridge: 0x4aa3ff,
  ops: 0xff5a4a,
  cabin: 0x4aa3ff,
  bunks: 0xb78cff,
  'npc-dorm': 0xb78cff,
  medical: 0xff4d6d,
  hold: 0xe39a3a,
  science: 0xa56bff,
  engine: 0xff9442,
  hangar: 0xe6b422,
  greenhouse: 0x5fe08a,
  'fore-node': 0x8fa0ba,
  'aft-node': 0x8fa0ba,
};

const TONE: Record<string, THREE.Material> = {
  commons: mats.light,
  bay: mats.light,
  bridge: mats.light,
  cabin: mats.light,
  medical: mats.light,
  science: mats.light,
  greenhouse: mats.light,
  bunks: mats.mid,
  'npc-dorm': mats.mid,
  hold: mats.mid,
  'fore-node': mats.mid,
  'aft-node': mats.mid,
  ops: mats.dark,
  hangar: mats.mid,
  engine: mats.dark,
};

/* --------------------------------------------------------------------- utils */

const rectCenter = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
const rectSize = (r: Rect) => ({ w: r.maxX - r.minX, d: r.maxZ - r.minZ });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Cylinder along z, radius 1 / length 1 by default; the +z end carries rTop. */
function cylZ(rTop: number, rBottom: number, length: number, segments = 32, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
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
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  im.count = items.length;
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
  im.frustumCulled = false;
  return im;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** World-scale panel UVs by dominant face normal (flat geometry). */
function projectUV(geo: THREE.BufferGeometry, tile = PANEL_TILE) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Rescale parametric UVs (cylinders, spheres) so panels keep a world size. */
function scaleUV(geo: THREE.BufferGeometry, circumference: number, height: number, tile = PANEL_TILE) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circumference) / tile, (uv.getY(i) * height) / tile);
  return geo;
}

function extrudePlan(poly: Pt[], yBot: number, yTop: number, bevel = 0.22) {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, yTop - yBot - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yBot + bevel, 0);
  return projectUV(geo);
}

/** Extrude a (z, y) profile along x between xMin and xMax. */
function extrudeAlongX(profile: Pt[], xMin: number, xMax: number, bevel = 0.2) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(-z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: xMax - xMin - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.5, bevelSegments: 1, curveSegments: 1 });
  geo.translate(0, 0, bevel);
  geo.rotateY(Math.PI / 2);
  geo.translate(xMin, 0, 0);
  return projectUV(geo);
}

function circlePoly(cx: number, cz: number, r: number, n = 40): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

function isRound(room: Room) {
  return room.shape === 'cylinder' || room.shape === 'spheroid';
}

function planPolygon(room: Room): Pt[] {
  const o = room.outer;
  const { x, z } = rectCenter(o);
  const { w, d } = rectSize(o);
  if (isRound(room)) return circlePoly(x, z, Math.min(w, d) / 2);
  if (room.shape === 'wedge') {
    const n = (room.nose ?? w) / 2;
    return [
      [o.minX, o.minZ],
      [o.maxX, o.minZ],
      [x + n, o.maxZ],
      [x - n, o.maxZ],
    ];
  }
  return [
    [o.minX, o.minZ],
    [o.maxX, o.minZ],
    [o.maxX, o.maxZ],
    [o.minX, o.maxZ],
  ];
}

function edgeNormal(p0: Pt, p1: Pt, c: Pt): Pt {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz) || 1;
  let nx = dz / len;
  let nz = -dx / len;
  if (nx * ((p0[0] + p1[0]) / 2 - c[0]) + nz * ((p0[1] + p1[1]) / 2 - c[1]) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

interface FacadePoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** Evenly spaced points along a convex plan perimeter, with outward normals. */
function facadePoints(poly: Pt[], round: boolean, pitch: number, margin = 1.0): FacadePoint[] {
  const out: FacadePoint[] = [];
  const c: Pt = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  if (round) {
    const r = Math.hypot(poly[0][0] - c[0], poly[0][1] - c[1]);
    const n = Math.max(3, Math.floor((2 * Math.PI * r) / pitch));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.01;
      out.push({ x: c[0] + Math.cos(a) * r, z: c[1] + Math.sin(a) * r, nx: Math.cos(a), nz: Math.sin(a) });
    }
    return out;
  }
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (len < 2 * margin + 0.6) continue;
    const [nx, nz] = edgeNormal(p0, p1, c);
    const n = Math.floor((len - 2 * margin) / pitch) + 1;
    for (let k = 0; k < n; k++) {
      const t = 0.5 + (k - (n - 1) / 2) * (pitch / len);
      out.push({ x: p0[0] + (p1[0] - p0[0]) * t, z: p0[1] + (p1[1] - p0[1]) * t, nx, nz });
    }
  }
  return out;
}

function blockedBy(level: number, x: number, z: number, margin: number, layout: ShipLayout) {
  for (const c of layout.corridors) {
    if (c.level !== level) continue;
    const r = c.outer;
    if (x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin) return true;
  }
  for (const d of layout.docks) {
    if (d.level !== level) continue;
    if (Math.hypot(d.x - x, d.z - z) < 2.5) return true;
  }
  return false;
}

const WINDOW_COLORS = [0xffdc9a, 0xffdc9a, 0xffdc9a, 0xffd08a, 0x9fd6ff, 0x39414f].map((c) => new THREE.Color(c));

function windowRows(room: Room): number[] {
  if (room.id === 'bridge') return [1.9, 6.3];
  if (room.height >= 8) {
    const rows: number[] = [];
    for (let y = 1.7; y < room.height - 1; y += 3.1) rows.push(y);
    return rows;
  }
  return [1.9];
}

/* ------------------------------------------------------------------- modules */

interface Ctx {
  room: Room;
  layout: ShipLayout;
  g: THREE.Group;
  base: number;
  wallTop: number;
  yBot: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  poly: Pt[];
  tone: THREE.Material;
  accent: THREE.MeshStandardMaterial;
  rand: () => number;
}

function addHull(ctx: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material = ctx.tone) {
  const m = new THREE.Mesh(geo, mat);
  ctx.g.add(m);
  return m;
}

function addWindows(ctx: Ctx, rows: number[], pitch = 3.0) {
  const { room, base } = ctx;
  const pts = facadePoints(ctx.poly, isRound(room), pitch);
  const items: Inst[] = [];
  for (const p of pts) {
    if (blockedBy(room.level, p.x, p.z, 0.9, ctx.layout)) continue;
    if (room.id === 'bridge' && p.nz > 0.7) continue;
    for (const ry of rows) {
      items.push({
        x: p.x + p.nx * 0.03,
        y: base + ry,
        z: p.z + p.nz * 0.03,
        sx: 1.5,
        sy: 0.8,
        sz: 0.12,
        ry: Math.atan2(p.nx, p.nz),
        color: WINDOW_COLORS[Math.floor(ctx.rand() * WINDOW_COLORS.length)],
      });
    }
  }
  if (items.length) ctx.g.add(instanced(UNIT_BOX, mats.window, items));
}

function addBand(ctx: Ctx, y: number) {
  if (isRound(ctx.room)) {
    const r = Math.min(ctx.w, ctx.d) / 2;
    const t = mesh(new THREE.TorusGeometry(r + 0.02, 0.09, 6, 64), ctx.accent, ctx.cx, y, ctx.cz);
    t.rotation.x = Math.PI / 2;
    ctx.g.add(t);
    return;
  }
  const items: Inst[] = [];
  const poly = ctx.poly;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ang = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    items.push({ x: (p0[0] + p1[0]) / 2, y, z: (p0[1] + p1[1]) / 2, sx: 0.16, sy: 0.16, sz: len + 0.3, ry: ang });
  }
  ctx.g.add(instanced(UNIT_BOX, ctx.accent, items));
}

function greebles(ctx: Ctx, top: number, region: Rect, count: number) {
  const { x, z } = rectCenter(region);
  const { w, d } = rectSize(region);
  for (let i = 0; i < count; i++) {
    const px = x + (ctx.rand() - 0.5) * (w - 2.6);
    const pz = z + (ctx.rand() - 0.5) * (d - 2.6);
    const mat = ctx.rand() > 0.5 ? mats.mid : mats.plain;
    if (ctx.rand() > 0.45) {
      const bw = 0.8 + ctx.rand() * 1.4;
      const bd = 0.8 + ctx.rand() * 1.4;
      const bh = 0.3 + ctx.rand() * 0.6;
      ctx.g.add(mesh(new THREE.BoxGeometry(bw, bh, bd), mat, px, top + bh / 2, pz));
    } else {
      const r = 0.3 + ctx.rand() * 0.4;
      const h = 0.35 + ctx.rand() * 0.5;
      ctx.g.add(mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 12), mat, px, top + h / 2, pz));
    }
  }
}

function dish(x: number, y: number, z: number, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 1.1 * scale, 8), mats.plain, 0, 0.55 * scale, 0));
  const bowl = mesh(new THREE.SphereGeometry(1.1 * scale, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mats.light, 0, 1.3 * scale, 0);
  bowl.rotation.x = -0.5;
  g.add(bowl);
  return g;
}

function mast(ctx: Ctx, x: number, y: number, z: number, h: number) {
  ctx.g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, h, 6), mats.plain, x, y + h / 2, z));
  ctx.g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), mats.glow, x, y + h, z));
}

/** Name lettering on a hull plane; `n` is the outward normal in plan. */
function nameDecal(parent: THREE.Group, x: number, y: number, z: number, nx: number, nz: number, width: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8), mats.name);
  m.position.set(x + nx * 0.05, y, z + nz * 0.05);
  m.rotation.y = Math.atan2(nx, nz);
  m.renderOrder = 3;
  parent.add(m);
}

function buildBoxLike(ctx: Ctx) {
  const { room, base, wallTop, yBot, cx, cz, w, d } = ctx;
  const o = room.outer;
  const hullTop = wallTop + HULL_TOP;
  const ceil = room.ceiling;
  let flatTop = hullTop;
  let flatRegion: Rect | null = o;

  if (ceil?.kind === 'vault') {
    const apex = base + ceil.apex;
    const prof: Pt[] = [[o.minZ, yBot], [o.minZ, wallTop]];
    const rise = apex - wallTop;
    for (let i = 1; i < 24; i++) {
      const a = Math.PI - (i / 24) * Math.PI;
      prof.push([cz + Math.cos(a) * (d / 2), wallTop + Math.sin(a) * rise]);
    }
    prof.push([o.maxZ, wallTop], [o.maxZ, yBot]);
    addHull(ctx, extrudeAlongX(prof, o.minX, o.maxX));
    for (let i = 0; i < 5; i++) {
      const x = o.minX + 1.2 + (i * (w - 2.4)) / 4;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(d / 2 + 0.05, 0.12, 6, 32, Math.PI), mats.plain);
      rib.scale.set(1, rise / (d / 2), 1);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(x, wallTop, cz);
      ctx.g.add(rib);
    }
    ctx.g.add(mesh(new THREE.BoxGeometry(w - 1.2, 0.18, 0.5), ctx.accent, cx, apex + 0.05, cz));
    flatRegion = null;
  } else if (ceil?.kind === 'shed') {
    const hi = base + ceil.apex;
    addHull(ctx, extrudeAlongX([[o.minZ, yBot], [o.minZ, hi], [o.maxZ, hullTop], [o.maxZ, yBot]], o.minX, o.maxX));
    flatRegion = null;
    const ring = mesh(new THREE.TorusGeometry(3.2, 0.32, 10, 40), mats.plain, cx, hi + 3.2, o.minZ + 3.2);
    ring.rotation.y = Math.PI / 2;
    ctx.g.add(ring);
    const inner = mesh(new THREE.TorusGeometry(3.2, 0.1, 6, 40), ctx.accent, cx, hi + 3.2, o.minZ + 3.2);
    inner.rotation.y = Math.PI / 2;
    inner.scale.setScalar(0.88);
    ctx.g.add(inner);
    for (const dz of [-2.4, 2.4]) ctx.g.add(mesh(new THREE.BoxGeometry(0.4, 3.4, 0.5), mats.plain, cx, hi + 1.7, o.minZ + 3.2 + dz));
  } else if (ceil?.kind === 'hip') {
    addHull(ctx, extrudePlan(ctx.poly, yBot, hullTop));
    const hipH = base + ceil.apex - hullTop;
    const frustum = new THREE.CylinderGeometry(0.34 * Math.SQRT2, Math.SQRT2, hipH, 4, 1);
    frustum.rotateY(Math.PI / 4);
    frustum.scale(w / 2, 1, d / 2);
    frustum.translate(cx, hullTop + hipH / 2, cz);
    scaleUV(frustum, w * 2, hipH);
    addHull(ctx, frustum);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d, toneMapped: false });
    const topY = base + ceil.apex;
    ctx.g.add(mesh(new THREE.BoxGeometry(2.6, 0.2, 0.8), crossMat, cx, topY + 0.1, cz));
    ctx.g.add(mesh(new THREE.BoxGeometry(0.8, 0.2, 2.6), crossMat, cx, topY + 0.1, cz));
    flatRegion = null;
  } else if (ceil?.kind === 'step') {
    addHull(ctx, extrudePlan(ctx.poly, yBot, hullTop));
    const inset = room.id === 'bunks' ? 1.2 : 2.0;
    const upper: Pt[] = [
      [o.minX + inset, o.minZ + inset],
      [o.maxX - inset, o.minZ + inset],
      [o.maxX - inset, o.maxZ - inset],
      [o.minX + inset, o.maxZ - inset],
    ];
    const up = extrudePlan(upper, hullTop - 0.2, base + ceil.apex, 0.18);
    addHull(ctx, up, room.id === 'bunks' ? mats.light : mats.mid);
    const ring = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * inset + 0.08, 0.14, d - 2 * inset + 0.08), ctx.accent);
    ring.position.set(cx, base + ceil.apex - 0.6, cz);
    ctx.g.add(ring);
    flatTop = base + ceil.apex + 0.18;
    flatRegion = {
      minX: o.minX + inset,
      maxX: o.maxX - inset,
      minZ: o.minZ + inset,
      maxZ: o.maxZ - inset,
    };
    if (room.id === 'ops') {
      // radar tower and a roof ring on the lower tier
      ctx.g.add(mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.2, 8), mats.plain, cx + 1.4, flatTop + 1.6, cz - 1));
      ctx.g.add(dish(cx + 1.4, flatTop + 3.2, cz - 1, 0.9));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.2), mats.plain);
      frame.position.set(o.minX + 1.3, hullTop + 0.6, o.minZ + 1.3);
      ctx.g.add(frame);
    }
  } else if (ceil?.kind === 'rotunda') {
    addHull(ctx, extrudePlan(ctx.poly, yBot, hullTop));
    const r = 5;
    const h = base + ceil.apex - hullTop;
    const drum = new THREE.CylinderGeometry(r, r + 0.15, 0.5, 40);
    drum.translate(cx, hullTop + 0.25, cz);
    scaleUV(drum, 2 * Math.PI * r, 0.5);
    addHull(ctx, drum, mats.mid);
    ctx.g.add(mesh(new THREE.CylinderGeometry(r - 0.1, r - 0.1, h - 1, 40, 1, true), mats.glassWarm, cx, hullTop + 0.5 + (h - 1) / 2, cz));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ctx.g.add(mesh(new THREE.BoxGeometry(0.14, h - 0.7, 0.14), mats.plain, cx + Math.cos(a) * (r - 0.05), hullTop + 0.5 + (h - 1) / 2, cz + Math.sin(a) * (r - 0.05)));
    }
    const cap = new THREE.CylinderGeometry(r + 0.4, r + 0.4, 0.5, 40);
    cap.translate(cx, hullTop + h - 0.25, cz);
    scaleUV(cap, 2 * Math.PI * r, 0.5);
    addHull(ctx, cap, mats.mid);
    const capRing = mesh(new THREE.TorusGeometry(r + 0.4, 0.1, 6, 48), ctx.accent, cx, hullTop + h - 0.3, cz);
    capRing.rotation.x = Math.PI / 2;
    ctx.g.add(capRing);
    ctx.g.add(mesh(new THREE.CylinderGeometry(0.08, 0.14, 2.8, 6), mats.plain, cx, hullTop + h + 1.4, cz));
    ctx.g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), mats.glow, cx, hullTop + h + 2.8, cz));
    flatRegion = null;
    const lamp = new THREE.PointLight(0xffcf8a, 60, 24, 2);
    lamp.position.set(cx, hullTop + 2, cz);
    ctx.g.add(lamp);
    ctx.g.add(mesh(new THREE.BoxGeometry(2.4, 0.9, 2.4), mats.plain, o.minX + 2.2, hullTop + 0.45, o.minZ + 2.0));
    ctx.g.add(mesh(new THREE.BoxGeometry(1.8, 0.7, 3), mats.plain, o.maxX - 2.2, hullTop + 0.35, o.maxZ - 2.4));
  } else {
    addHull(ctx, extrudePlan(ctx.poly, yBot, hullTop));
  }

  return { flatTop, flatRegion };
}

function buildWedge(ctx: Ctx) {
  const { room, base, wallTop, yBot, cx } = ctx;
  const o = room.outer;
  const hullTop = wallTop + HULL_TOP;
  addHull(ctx, extrudePlan(ctx.poly, yBot, hullTop, 0.3));
  // second storey set-back on the roof: a raked canopy
  const nose = room.nose ?? ctx.w;
  const canopy = extrudePlan(
    [
      [cx - ctx.w / 2 + 3, o.minZ + 2],
      [cx + ctx.w / 2 - 3, o.minZ + 2],
      [cx + nose / 2 - 0.8, o.maxZ - 1.2],
      [cx - nose / 2 + 0.8, o.maxZ - 1.2],
    ],
    hullTop - 0.2,
    hullTop + 1.6,
    0.2,
  );
  addHull(ctx, canopy, mats.mid);
  ctx.g.add(mesh(new THREE.BoxGeometry(nose - 2.4, 0.5, 0.14), mats.viewport, cx, hullTop + 0.95, o.maxZ - 1.2 + 0.22));

  // tall view screens across the nose, one band per storey
  const front = o.maxZ + 0.3;
  const screenW = nose - 0.9;
  ctx.g.add(mesh(new THREE.BoxGeometry(screenW + 0.5, 7.3, 0.14), mats.plain, cx, base + 4.9, front));
  ctx.g.add(mesh(new THREE.BoxGeometry(screenW, 6.9, 0.2), mats.viewport, cx, base + 4.9, front + 0.04));
  const mull: Inst[] = [];
  for (let i = -3; i <= 3; i++) mull.push({ x: cx + (i * screenW) / 7, y: base + 4.9, z: front + 0.1, sx: 0.12, sy: 7, sz: 0.1 });
  mull.push({ x: cx, y: base + 4.5, z: front + 0.1, sx: screenW + 0.2, sy: 0.32, sz: 0.12 });
  mull.push({ x: cx, y: base + 6.7, z: front + 0.1, sx: screenW + 0.2, sy: 0.1, sz: 0.1 });
  mull.push({ x: cx, y: base + 2.7, z: front + 0.1, sx: screenW + 0.2, sy: 0.1, sz: 0.1 });
  ctx.g.add(instanced(UNIT_BOX, mats.plain, mull));

  // flanks: angled plates, lettering and a command-deck window strip
  const poly = ctx.poly;
  const c: Pt = [cx, rectCenter(o).z];
  const edges: [Pt, Pt][] = [
    [poly[1], poly[2]],
    [poly[3], poly[0]],
  ];
  for (const [p0, p1] of edges) {
    const [nx, nz] = edgeNormal(p0, p1, c);
    const mx = (p0[0] + p1[0]) / 2;
    const mz = (p0[1] + p1[1]) / 2;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    nameDecal(ctx.g, mx + nx * 0.3, base + 3.3, mz + nz * 0.3, nx, nz, len - 1.2);
  }

  mast(ctx, cx - 3, hullTop + 1.6, o.minZ + 4, 3.2);
  mast(ctx, cx + 3.2, hullTop + 1.6, o.minZ + 5, 2.2);
  ctx.g.add(dish(cx, hullTop + 1.6, o.minZ + 3.4, 0.9));
  return { flatTop: hullTop, flatRegion: null as Rect | null };
}

function buildRound(ctx: Ctx) {
  const { room, base, wallTop, yBot, cx, cz } = ctx;
  const r = Math.min(ctx.w, ctx.d) / 2;
  const hullTop = wallTop + HULL_TOP;

  if (room.shape === 'spheroid') {
    const ry = (wallTop - base) / 2 + 0.9;
    const cy = base + 1.8;
    const g = new THREE.SphereGeometry(1, 40, 24);
    scaleUV(g, 2 * Math.PI * r, Math.PI * ry);
    const m = new THREE.Mesh(g, ctx.tone);
    m.scale.set(r, ry, r);
    m.position.set(cx, cy, cz);
    ctx.g.add(m);
    for (const dy of [-0.5, 0.5]) {
      const t = mesh(new THREE.TorusGeometry(r * Math.sqrt(1 - (dy / ry) ** 2) + 0.01, 0.06, 6, 56), ctx.accent, cx, cy + dy + 1.5, cz);
      t.rotation.x = Math.PI / 2;
      ctx.g.add(t);
    }
    ctx.g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), mats.plain, cx, cy + ry + 1.0, cz));
    ctx.g.add(mesh(new THREE.SphereGeometry(0.18, 8, 6), mats.glow, cx, cy + ry + 2.1, cz));
    return { flatTop: hullTop, flatRegion: null as Rect | null };
  }

  if (room.ceiling?.kind === 'dome') {
    buildDomeHouse(ctx);
    return { flatTop: hullTop, flatRegion: null as Rect | null };
  }

  // plain round tower or disc node
  const h = hullTop - yBot;
  const body = new THREE.CylinderGeometry(r, r, h, 56);
  scaleUV(body, 2 * Math.PI * r, h);
  addHull(ctx, body).position.set(cx, yBot + h / 2, cz);
  const lip = mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.35, 56), mats.plain, cx, hullTop - 0.1, cz);
  ctx.g.add(lip);
  const foot = mesh(new THREE.CylinderGeometry(r + 0.2, r + 0.2, 0.35, 56), mats.plain, cx, yBot + 0.18, cz);
  ctx.g.add(foot);
  if (room.height >= 8) {
    // dorm silo: ring seams between the bunk tiers and a crown
    for (let y = base + 3.2; y < wallTop - 0.5; y += 3.1) {
      const t = mesh(new THREE.TorusGeometry(r + 0.03, 0.07, 6, 56), mats.seam, cx, y, cz);
      t.rotation.x = Math.PI / 2;
      ctx.g.add(t);
    }
    ctx.g.add(mesh(new THREE.CylinderGeometry(r - 1, r - 0.6, 1.4, 40), mats.light, cx, hullTop + 0.7, cz));
    ctx.g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), mats.plain, cx, hullTop + 2.9, cz));
    ctx.g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), mats.glow, cx, hullTop + 4.4, cz));
    // status panel facing the dorm door
    ctx.g.add(mesh(new THREE.BoxGeometry(0.14, 1.6, 2.4), mats.viewport, cx + r + 0.02, base + 2.6, cz + 0.001));
  } else {
    ctx.g.add(mesh(new THREE.SphereGeometry(1.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.light, cx, hullTop + 0.15, cz));
    const t = mesh(new THREE.TorusGeometry(1.35, 0.1, 6, 28), ctx.accent, cx, hullTop + 0.17, cz);
    t.rotation.x = Math.PI / 2;
    ctx.g.add(t);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.8), mats.plain, cx + Math.cos(a) * (r - 0.4), hullTop + 0.1, cz + Math.sin(a) * (r - 0.4)).rotateY(-a));
    }
  }
  return { flatTop: hullTop, flatRegion: null as Rect | null };
}

function buildDomeHouse(ctx: Ctx) {
  const { room, base, wallTop, yBot, cx, cz } = ctx;
  const r = Math.min(ctx.w, ctx.d) / 2;
  const apex = base + (room.ceiling?.apex ?? 11);
  const plinth = 3.7;
  const glassH = wallTop - base - plinth;

  const pl = new THREE.CylinderGeometry(r, r, plinth - yBot + base, 64);
  scaleUV(pl, 2 * Math.PI * r, plinth - yBot + base);
  const plm = new THREE.Mesh(pl, ctx.tone);
  plm.position.set(cx, (yBot + base + plinth) / 2, cz);
  ctx.g.add(plm);
  ctx.g.add(mesh(new THREE.CylinderGeometry(r + 0.25, r + 0.25, 0.4, 64), mats.plain, cx, base + plinth, cz));

  ctx.g.add(mesh(new THREE.CylinderGeometry(r - 0.05, r - 0.05, glassH, 64, 1, true), mats.glass, cx, base + plinth + glassH / 2, cz));
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.g.add(mesh(new THREE.BoxGeometry(0.16, glassH, 0.16), mats.plain, cx + Math.cos(a) * (r - 0.05), base + plinth + glassH / 2, cz + Math.sin(a) * (r - 0.05)));
  }
  const rim = mesh(new THREE.TorusGeometry(r, 0.22, 8, 64), mats.plain, cx, wallTop, cz);
  rim.rotation.x = Math.PI / 2;
  ctx.g.add(rim);
  const band = mesh(new THREE.TorusGeometry(r + 0.03, 0.12, 8, 64), ctx.accent, cx, base + 1.2, cz);
  band.rotation.x = Math.PI / 2;
  ctx.g.add(band);

  const H = apex - wallTop;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass);
  dome.scale.set(r, H, r);
  dome.position.set(cx, wallTop, cz);
  dome.renderOrder = 2;
  ctx.g.add(dome);
  for (let i = 0; i < 16; i++) {
    const phi = (i / 16) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = (k / 20) * (Math.PI / 2);
      pts.push(new THREE.Vector3(Math.cos(t) * r * Math.cos(phi), Math.sin(t) * H, Math.cos(t) * r * Math.sin(phi)));
    }
    ctx.g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6), mats.plain, cx, wallTop, cz));
  }
  for (const f of [0.3, 0.6, 0.85]) {
    const t = f * (Math.PI / 2);
    const ring = mesh(new THREE.TorusGeometry(Math.cos(t) * r, 0.06, 6, 56), mats.plain, cx, wallTop + Math.sin(t) * H, cz);
    ring.rotation.x = Math.PI / 2;
    ctx.g.add(ring);
  }
  ctx.g.add(mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.6, 10), mats.plain, cx, apex - 0.05, cz));

  ctx.g.add(mesh(new THREE.CylinderGeometry(r - 0.2, r - 0.2, 0.2, 48), mats.floorGreen, cx, base + 0.05, cz));
  const plants = new THREE.Group();
  const rand = mulberry32(7);
  for (const pz of [-14.3, -8.2]) {
    for (const px of [-75.4, -71.2, -67.0]) {
      plants.add(mesh(new THREE.BoxGeometry(2, 0.9, 4.5), mats.soil, px, base + 0.5, pz));
      for (let k = 0; k < 3; k++) {
        const zz = pz + (k - 1) * 1.4;
        const hgt = 2.4 + rand() * 2.4;
        plants.add(mesh(new THREE.CylinderGeometry(0.08, 0.14, hgt, 6), mats.trunk, px, base + 0.9 + hgt / 2, zz));
        const rr = 0.9 + rand() * 0.7;
        plants.add(mesh(new THREE.IcosahedronGeometry(rr, 1), mats.leaf, px + (rand() - 0.5) * 0.4, base + 0.9 + hgt + rr * 0.5, zz));
      }
    }
  }
  ctx.g.add(plants);
  const lamp = new THREE.PointLight(0x8dffb0, 140, 34, 2);
  lamp.position.set(cx, base + 5.2, cz);
  ctx.g.add(lamp);
}

function buildHangar(ctx: Ctx) {
  const { room, base, cx, cz } = ctx;
  const o = room.outer;
  const yBot = base - HULL_BOTTOM;
  const yTop = base + room.height + HULL_TOP;
  const pt = room.passThrough!;
  const trenchFloor = floorY(pt.level) - 0.55;
  const hw = pt.width / 2;
  const shape = new THREE.Shape();
  const pts: Pt[] = [
    [o.minX, yBot],
    [o.maxX, yBot],
    [o.maxX, yTop],
    [pt.x + hw, yTop],
    [pt.x + hw, trenchFloor],
    [pt.x - hw, trenchFloor],
    [pt.x - hw, yTop],
    [o.minX, yTop],
  ];
  pts.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  const depth = ctx.d - 0.5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 2, curveSegments: 1 });
  geo.translate(0, 0, o.minZ + 0.25);
  projectUV(geo);
  ctx.g.add(new THREE.Mesh(geo, ctx.tone));

  // gantries across the trench, lit deck strip along its floor
  for (let i = 0; i < 4; i++) {
    const z = o.minZ + 2.2 + (i * (ctx.d - 4.4)) / 3;
    ctx.g.add(mesh(new THREE.BoxGeometry(pt.width + 0.9, 0.4, 0.5), mats.plain, pt.x, yTop + 0.1, z));
    ctx.g.add(mesh(new THREE.BoxGeometry(pt.width - 0.6, 0.1, 0.1), ctx.accent, pt.x, yTop - 0.15, z));
  }
  ctx.g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, ctx.d - 1), mats.glow, pt.x - hw + 0.15, trenchFloor + 0.35, cz));
  ctx.g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, ctx.d - 1), mats.glow, pt.x + hw - 0.15, trenchFloor + 0.35, cz));

  // flank lettering, window slits, hazard foot
  const flankW = ctx.d - 2.2;
  for (const s of [-1, 1] as const) {
    const fx = s < 0 ? o.minX - 0.3 : o.maxX + 0.3;
    nameDecal(ctx.g, fx, base + 9.2, cz, s, 0, flankW);
    ctx.g.add(mesh(new THREE.BoxGeometry(0.12, 0.28, ctx.d - 3), mats.window, fx - s * 0.2, base + 6.4, cz));
    ctx.g.add(mesh(new THREE.BoxGeometry(0.12, 0.28, ctx.d - 3), mats.window, fx - s * 0.2, base + 11.6, cz));
    const hz: Inst[] = [];
    for (let i = 0; i < 14; i++) hz.push({ x: fx - s * 0.2, y: base + 0.6, z: o.minZ + 1.6 + i * ((ctx.d - 3.2) / 13), sx: 0.12, sy: 0.7, sz: 0.7, color: new THREE.Color(i % 2 ? 0xe6b422 : 0x20242c) });
    ctx.g.add(instanced(UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), hz));
  }
  // sealed hull door on the starboard flank, level with the floor
  const dz = -35.5;
  ctx.g.add(mesh(new THREE.BoxGeometry(0.3, 5.6, 8.4), mats.plain, o.maxX + 0.06, base + 3.2, dz));
  ctx.g.add(mesh(new THREE.BoxGeometry(0.34, 5.0, 7.8), mats.mid, o.maxX + 0.1, base + 3.2, dz));
  ctx.g.add(mesh(new THREE.BoxGeometry(0.4, 0.14, 7.8), mats.plain, o.maxX + 0.12, base + 3.2, dz));
  ctx.g.add(mesh(new THREE.BoxGeometry(0.4, 5.0, 0.14), mats.plain, o.maxX + 0.12, base + 3.2, dz));

  // bow face accent
  ctx.g.add(mesh(new THREE.BoxGeometry(ctx.w - 0.3, 0.2, 0.1), ctx.accent, cx, base + 12.5, o.maxZ + 0.28));
  return { flatTop: yTop, flatRegion: null as Rect | null };
}

function buildEngine(ctx: Ctx) {
  const { room, base, cx, cz } = ctx;
  const o = room.outer;
  const r = 5.6;
  const cy = base + 2.8;
  const len = ctx.d;
  const body = cylZ(r, r, len, 48);
  scaleUV(body, 2 * Math.PI * r, len);
  const m = new THREE.Mesh(body, ctx.tone);
  m.position.set(cx, cy, cz);
  ctx.g.add(m);
  for (let i = 0; i < 4; i++) {
    const z = o.minZ + 1.2 + i * ((len - 2.4) / 3);
    ctx.g.add(mesh(cylZ(r + 0.18, r + 0.18, 0.55, 48), mats.mid, cx, cy, z));
  }
  for (const z of [o.minZ + 3.4, o.maxZ - 3.4]) {
    const t = mesh(new THREE.TorusGeometry(r + 0.22, 0.12, 8, 64), ctx.accent, cx, cy, z);
    ctx.g.add(t);
  }
  // front cap with a hazard collar where the spine couples on
  ctx.g.add(mesh(cylZ(2.9, 2.9, 0.7, 32), mats.hazard, cx, base + 1.6, o.maxZ + 0.2));
  ctx.g.add(mesh(cylZ(2.5, 2.5, 0.9, 32), mats.plain, cx, base + 1.6, o.maxZ + 0.3));
  // dorsal radiator fins and side pods
  ctx.g.add(mesh(new THREE.BoxGeometry(0.16, 3.4, 8), mats.plain, cx, cy + r + 1.4, cz));
  for (const s of [-1, 1]) {
    const fin = mesh(new THREE.BoxGeometry(0.16, 3.0, 7.2), mats.plain, cx + s * 3.6, cy + r * 0.7 + 1.2, cz);
    fin.rotation.z = -s * 0.5;
    ctx.g.add(fin);
    ctx.g.add(mesh(new THREE.BoxGeometry(0.2, 0.14, 8.1), new THREE.MeshStandardMaterial({ color: 0xff9442, emissive: 0xff7a1f, emissiveIntensity: 0.9 }), cx, cy + r + 3.1, cz));
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, 6, 6, 14), mats.light);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(cx + s * 6.3, cy - 1.2, cz);
    ctx.g.add(pod);
  }
  // nozzles: one large bell and four smaller ones
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x2c3340, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide });
  const nz = o.minZ;
  const bells: [number, number, number, number][] = [[0, 0, 2.2, 2.8]];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bells.push([sx * 2.55, sy * 2.55, 1.3, 1.9]);
  for (const [bx, by, rad, bellLen] of bells) {
    ctx.g.add(mesh(cylZ(rad * 0.6, rad, bellLen, 28, true), bellMat, cx + bx, cy + by, nz - bellLen / 2));
    const disc = new THREE.CircleGeometry(rad * 0.62, 24);
    disc.rotateY(Math.PI);
    ctx.g.add(mesh(disc, mats.glow, cx + bx, cy + by, nz - 0.15));
    ctx.g.add(mesh(new THREE.TorusGeometry(rad, 0.09, 6, 28), mats.mid, cx + bx, cy + by, nz - bellLen));
  }
  const light = new THREE.PointLight(0x66ccff, 220, 50, 2);
  light.position.set(cx, cy, nz - 6);
  ctx.g.add(light);
  return { flatTop: cy + r, flatRegion: null as Rect | null };
}

const LABEL_NAMES: Record<string, string> = {
  commons: 'Commons',
  bay: 'Hibernation & cloning bay',
  'fore-node': 'Fore node',
  'aft-node': 'Aft node',
  bridge: 'Bridge',
  ops: 'Operations',
  cabin: "Captain's cabin",
  bunks: 'Bunk room',
  'npc-dorm': 'NPC dorm',
  greenhouse: 'Greenhouse',
  medical: 'Medical lab',
  hold: 'Hold',
  science: 'Science lab',
  hangar: 'Hangar (deck -2)',
  engine: 'Engine',
};

function buildModule(room: Room, group: THREE.Group, layout: ShipLayout, labels: ExteriorLabel[], groups: Map<ModuleId, THREE.Group>) {
  const base = floorY(room.level);
  const { x, z } = rectCenter(room.outer);
  const { w, d } = rectSize(room.outer);
  const g = new THREE.Group();
  g.name = `module:${room.module}`;
  const accent = new THREE.MeshStandardMaterial({
    color: ACCENT[room.id] ?? 0x8995a8,
    emissive: ACCENT[room.id] ?? 0x8995a8,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  const ctx: Ctx = {
    room,
    layout,
    g,
    base,
    wallTop: base + room.height,
    yBot: base - HULL_BOTTOM,
    cx: x,
    cz: z,
    w,
    d,
    poly: planPolygon(room),
    tone: TONE[room.id] ?? mats.light,
    accent,
    rand: mulberry32(hash(room.id)),
  };

  let res: { flatTop: number; flatRegion: Rect | null };
  if (room.shape === 'hangar') res = buildHangar(ctx);
  else if (room.shape === 'drum') res = buildEngine(ctx);
  else if (room.shape === 'wedge') res = buildWedge(ctx);
  else if (isRound(room)) res = buildRound(ctx);
  else res = buildBoxLike(ctx);

  const noWindows = ['hangar', 'drum'].includes(room.shape) || room.ceiling?.kind === 'dome' || room.id === 'hold';
  if (!noWindows) addWindows(ctx, windowRows(room));
  if (room.id !== 'greenhouse' && room.shape !== 'hangar' && room.shape !== 'drum' && room.shape !== 'spheroid') {
    addBand(ctx, ctx.wallTop - 0.25);
  }
  if (room.id === 'hold') buildHoldDetail(ctx);
  if (res.flatRegion && ['commons', 'hold', 'bunks'].includes(room.id)) {
    greebles(ctx, res.flatTop, res.flatRegion, 2 + Math.floor((rectSize(res.flatRegion).w * rectSize(res.flatRegion).d) / 60));
  }
  if (room.id === 'science') ctx.g.add(dish(x - 2, base + 3.9, z + 3.5, 0.7));

  group.add(g);
  groups.set(room.module, g);
  const labelY = base + (room.ceiling?.apex ?? room.height) + (room.id === 'engine' ? 6 : 2.2);
  const pos = new THREE.Vector3(x, labelY, z);
  const anchor = new THREE.Vector3(x, base + Math.min(room.height, 6) / 2, z);
  labels.push({
    text: LABEL_NAMES[room.id] ?? room.id,
    module: room.module,
    position: pos.clone(),
    anchor: anchor.clone(),
    basePosition: pos,
    baseAnchor: anchor,
  });
}

function buildHoldDetail(ctx: Ctx) {
  const { room, base } = ctx;
  const ribs: Inst[] = [];
  for (const p of facadePoints(ctx.poly, false, 1.1, 0.7)) {
    if (blockedBy(room.level, p.x, p.z, 0.8, ctx.layout)) continue;
    ribs.push({ x: p.x + p.nx * 0.05, y: base + room.height / 2 - 0.1, z: p.z + p.nz * 0.05, sx: 0.14, sy: room.height - 1.0, sz: 0.14 });
  }
  ctx.g.add(instanced(UNIT_BOX, mats.seam, ribs));
  // stacked cargo containers on the roof
  const top = base + room.height + HULL_TOP;
  const cols = [0xe39a3a, 0x4a7fb5, 0xb5483a, 0x6a8f4a];
  const o = room.outer;
  const rand = mulberry32(5);
  for (let i = 0; i < 6; i++) {
    const cx = o.minX + 2.6 + (i % 3) * 3.0;
    const cz = o.minZ + 3.0 + Math.floor(i / 3) * 3.4;
    const stack = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < stack; k++) {
      ctx.g.add(mesh(new THREE.BoxGeometry(2.3, 1.1, 2.9), new THREE.MeshStandardMaterial({ color: cols[(i + k) % 4], roughness: 0.7, metalness: 0.2 }), cx, top + 0.55 + k * 1.1, cz));
    }
  }
}

/* ---------------------------------------------------------- struts and ports */

function strut(group: THREE.Group, name: string, axis: 'x' | 'z', cx: number, cy: number, cz: number, length: number, width: number, opts: { ribs?: boolean; cap?: boolean; hazardEnd?: 1 | -1 } = {}) {
  const rx = width / 2;
  const g = new THREE.Group();
  g.name = name;
  g.position.set(cx, cy, cz);
  if (axis === 'x') g.rotation.y = Math.PI / 2;

  const tubeGeo = cylZ(1, 1, 1, 32);
  scaleUV(tubeGeo, 2 * Math.PI * rx, length);
  const tube = new THREE.Mesh(tubeGeo, mats.mid);
  tube.scale.set(rx, STRUT_RY, length);
  g.add(tube);

  const unit = cylZ(1, 1, 1, 32);
  const ring = (at: number, thick: number, grow: number, mat: THREE.Material = mats.plain) => {
    const m = new THREE.Mesh(unit, mat);
    m.scale.set(rx + grow, STRUT_RY + grow * 0.85, thick);
    m.position.z = at;
    g.add(m);
  };
  ring(length / 2 - 0.3, 0.6, 0.2);
  ring(-length / 2 + 0.3, 0.6, 0.2);
  if (opts.hazardEnd) {
    const e = opts.hazardEnd * (length / 2 - 1.2);
    ring(e, 0.4, 0.14, mats.hazard);
    ring(e + opts.hazardEnd * 0.7, 0.4, 0.14, mats.hazard);
  }
  if (opts.ribs !== false && length > 7) {
    const n = Math.floor(length / 4);
    for (let i = 1; i < n; i++) ring(-length / 2 + (length * i) / n, 0.28, 0.1);
  }
  if (opts.cap) {
    const cap = new THREE.Mesh(unit, mats.plain);
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
  g.add(instanced(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14), mats.window, ports));
  group.add(g);
}

function buildCorridor(c: Corridor, group: THREE.Group) {
  const yc = floorY(c.level) + c.height / 2;
  const { x, z } = rectCenter(c.outer);
  const { w, d } = rectSize(c.outer);
  strut(group, `strut:${c.id}`, c.axis, x, yc, z, c.axis === 'z' ? d : w, c.width, {
    cap: c.id === 'c-lower',
    hazardEnd: c.id === 'c-spine' ? -1 : undefined,
  });
}

function buildPassThroughStrut(group: THREE.Group, layout: ShipLayout) {
  for (const m of layout.modules) {
    for (const room of m.rooms) {
      const pt = room.passThrough;
      if (!pt) continue;
      const o = room.outer;
      strut(group, 'strut:pass-through', 'z', pt.x, floorY(pt.level) + 1.6, (o.minZ + o.maxZ) / 2, o.maxZ - o.minZ, 4);
    }
  }
}

function segmentHit(ox: number, oz: number, dx: number, dz: number, a: Pt, b: Pt): number | null {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - ox) * ez - (a[1] - oz) * ex) / den;
  const u = ((a[0] - ox) * dz - (a[1] - oz) * dx) / den;
  if (t < -0.01 || u < -0.001 || u > 1.001) return null;
  return t;
}

const OUT: Record<Facing, Pt> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Where a dock's face meets the real hull outline, and the outward normal there. */
function dockSurface(dock: Dock, layout: ShipLayout) {
  const room = layout.modules.flatMap((m) => m.rooms).find((r) => r.module === dock.module);
  const [ox, oz] = OUT[dock.facing];
  const fallback = { x: dock.x, z: dock.z, nx: ox, nz: oz };
  if (!room) return fallback;
  const poly = planPolygon(room);
  const c: Pt = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  let best: number | null = null;
  let normal: Pt = [ox, oz];
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const t = segmentHit(dock.x + ox * 6, dock.z + oz * 6, -ox, -oz, p0, p1);
    if (t !== null && (best === null || t < best)) {
      best = t;
      normal = edgeNormal(p0, p1, c);
    }
  }
  if (best === null) return fallback;
  return { x: dock.x + ox * 6 - ox * best, z: dock.z + oz * 6 - oz * best, nx: normal[0], nz: normal[1] };
}

/** A hatch ring with clamps and a dark recess: reads as an unused portal. */
function buildPort(dock: Dock, s: { x: number; z: number; nx: number; nz: number }) {
  const R = dock.width / 2 + 0.1;
  const g = new THREE.Group();
  g.name = `port:${dock.id}`;
  g.userData.module = dock.module;
  g.position.set(s.x + s.nx * 0.12, floorY(dock.level) + 1.6, s.z + s.nz * 0.12);
  g.rotation.y = Math.atan2(s.nx, s.nz);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 10, 36), mats.plain));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.28, 0.06, 6, 36), mats.portGlow));
  g.add(mesh(new THREE.CircleGeometry(R - 0.3, 36), mats.portInner, 0, 0, 0.02));
  const clamps: Inst[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    clamps.push({ x: Math.cos(a) * (R + 0.05), y: Math.sin(a) * (R + 0.05), z: 0.1, sx: 0.5, sy: 0.3, sz: 0.3, rz: a });
  }
  g.add(instanced(UNIT_BOX, mats.hazard, clamps));
  for (const a of [0, Math.PI / 2]) g.add(mesh(new THREE.BoxGeometry(2 * (R - 0.4), 0.07, 0.04), mats.portGlow, 0, 0, 0.05).rotateZ(a));
  return g;
}

function buildPorts(layout: ShipLayout) {
  const ports = new THREE.Group();
  ports.name = 'ports';
  const markers = new THREE.Group();
  markers.name = 'docks';
  const markMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, toneMapped: false });
  for (const dock of layout.docks) {
    if (dock.occupant || dock.kind === 'spine' || dock.kind === 'prow') continue;
    const s = dockSurface(dock, layout);
    ports.add(buildPort(dock, s));
    const m = new THREE.Group();
    m.userData.module = dock.module;
    m.position.set(s.x, floorY(dock.level) + 1.6, s.z);
    m.rotation.y = Math.atan2(s.nx, s.nz);
    m.add(new THREE.Mesh(new THREE.PlaneGeometry(dock.width + 1, 3.6), markMat));
    const arrow = new THREE.Mesh(cylZ(0, 0.7, 2.4, 12), arrowMat);
    arrow.position.z = 3.2;
    arrow.rotation.y = Math.PI;
    m.add(arrow);
    markers.add(m);
  }
  return { ports, markers };
}

function buildLiftTrunk(layout: ShipLayout, group: THREE.Group) {
  for (const lift of layout.lifts) {
    const { x, z } = rectCenter(lift.pad);
    const bot = Math.min(...lift.levels);
    const y0 = floorY(bot) + 3.2;
    const y1 = floorY(Math.max(...lift.levels)) - HULL_BOTTOM;
    group.add(mesh(new THREE.BoxGeometry(2.8, y1 - y0 + 0.2, 2.8), mats.plain, x, (y0 + y1) / 2, z));
    for (let y = y0 + 1; y < y1; y += 1.6) group.add(mesh(new THREE.BoxGeometry(2.95, 0.12, 2.95), mats.seam, x, y, z));
    group.add(mesh(new THREE.BoxGeometry(0.1, y1 - y0, 0.5), mats.glow, x + 1.43, (y0 + y1) / 2, z));
  }
}

export function buildStars() {
  const rand = mulberry32(42);
  const n = 1600;
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

/* ------------------------------------------------------------------ explode */

const EXPLODE_RADIAL = 0.7;
const EXPLODE_DROP = 12;

function moduleCenters(layout: ShipLayout) {
  const centers = new Map<ModuleId, { x: number; z: number; level: number }>();
  for (const m of layout.modules) {
    for (const room of m.rooms) {
      const c = rectCenter(room.outer);
      centers.set(room.module, { x: c.x, z: c.z, level: room.level });
    }
  }
  return centers;
}

interface Connector {
  corridor: Corridor;
  group: THREE.Group;
  tube: THREE.Mesh;
  rings: THREE.Mesh[];
  a: THREE.Vector3;
  b: THREE.Vector3;
  modA: ModuleId;
  modB: ModuleId;
}

function buildConnectors(layout: ShipLayout, root: THREE.Group) {
  const centers = moduleCenters(layout);
  const roomModule = new Map<string, ModuleId>();
  for (const m of layout.modules) for (const room of m.rooms) roomModule.set(room.id, room.module);
  roomModule.set('lift-commons', 'commons');

  const ghostMat = new THREE.MeshStandardMaterial({ color: 0x8fa0ba, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.38, emissive: 0x2a4a6a, emissiveIntensity: 0.6, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, toneMapped: false });
  const unit = cylZ(1, 1, 1, 28);
  const out: Connector[] = [];
  const group = new THREE.Group();
  group.name = 'connectors';
  group.visible = false;
  for (const c of layout.corridors) {
    const y = floorY(c.level) + c.height / 2;
    const { x, z } = rectCenter(c.outer);
    const p1 = c.axis === 'z' ? new THREE.Vector3(x, y, c.outer.minZ) : new THREE.Vector3(c.outer.minX, y, z);
    const p2 = c.axis === 'z' ? new THREE.Vector3(x, y, c.outer.maxZ) : new THREE.Vector3(c.outer.maxX, y, z);
    const mA = roomModule.get(c.joins[0] as string)!;
    const mB = roomModule.get(c.joins[1] as string)!;
    const cA = centers.get(mA)!;
    const cB = centers.get(mB)!;
    const d1A = Math.hypot(p1.x - cA.x, p1.z - cA.z);
    const d2A = Math.hypot(p2.x - cA.x, p2.z - cA.z);
    const d1B = Math.hypot(p1.x - cB.x, p1.z - cB.z);
    const d2B = Math.hypot(p2.x - cB.x, p2.z - cB.z);
    const swap = d1A + d2B > d2A + d1B;
    const a = swap ? p2 : p1;
    const b = swap ? p1 : p2;
    const g = new THREE.Group();
    const tube = new THREE.Mesh(unit, ghostMat);
    g.add(tube);
    const rings = [0, 1].map(() => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), ringMat);
      g.add(r);
      return r;
    });
    group.add(g);
    out.push({ corridor: c, group: g, tube, rings, a, b, modA: mA, modB: mB });
  }
  root.add(group);
  return { connectors: out, group, centers };
}

function explodeOffsets(centers: Map<ModuleId, { x: number; z: number; level: number }>, amount: number) {
  const hub = centers.get('commons')!;
  const out = new Map<ModuleId, THREE.Vector3>();
  for (const [id, c] of centers) {
    const k = EXPLODE_RADIAL * amount;
    out.set(id, new THREE.Vector3((c.x - hub.x) * k, c.level < -1 ? (c.level / 2) * EXPLODE_DROP * amount : 0, (c.z - hub.z) * k));
  }
  return out;
}

export function buildShipExterior(layout: ShipLayout = SHIP_LAYOUT): ShipExterior {
  const root = new THREE.Group();
  root.name = 'ship-exterior';
  const labels: ExteriorLabel[] = [];
  const groups = new Map<ModuleId, THREE.Group>();

  for (const m of layout.modules) for (const room of m.rooms) buildModule(room, root, layout, labels, groups);
  const struts = new THREE.Group();
  struts.name = 'struts';
  for (const c of layout.corridors) buildCorridor(c, struts);
  buildPassThroughStrut(struts, layout);
  root.add(struts);
  buildLiftTrunk(layout, root);

  const { ports, markers } = buildPorts(layout);
  root.add(ports);
  markers.visible = false;
  root.add(markers);

  const { connectors, group: connectorGroup, centers } = buildConnectors(layout, root);
  const ghostScale = new THREE.Vector3();

  const apply = (amount: number) => {
    const off = explodeOffsets(centers, amount);
    for (const [id, g] of groups) g.position.copy(off.get(id)!);
    for (const holder of [ports, markers]) {
      for (const child of holder.children) {
        const o = off.get(child.userData.module as ModuleId);
        if (o) child.position.copy(child.userData.base ??= child.position.clone()).add(o);
      }
    }
    for (const l of labels) {
      const o = off.get(l.module)!;
      l.position.copy(l.basePosition).add(o);
      l.anchor.copy(l.baseAnchor).add(o);
    }
    const exploded = amount > 0.001;
    struts.visible = !exploded;
    connectorGroup.visible = exploded;
    if (exploded) {
      for (const k of connectors) {
        const a = k.a.clone().add(off.get(k.modA)!);
        const b = k.b.clone().add(off.get(k.modB)!);
        const len = a.distanceTo(b);
        k.group.position.copy(a).add(b).multiplyScalar(0.5);
        k.group.lookAt(b);
        k.tube.scale.set(k.corridor.width / 2, STRUT_RY, Math.max(0.01, len));
        k.rings[0].position.z = -len / 2;
        k.rings[1].position.z = len / 2;
        for (const r of k.rings) r.scale.set(k.corridor.width / 2 + 0.2, STRUT_RY + 0.2, 1);
      }
    }
    void ghostScale;
  };

  const bounds = new THREE.Box3().setFromObject(root);
  const boundsAt = (amount: number) => {
    apply(amount);
    const b = new THREE.Box3().setFromObject(root);
    apply(current);
    return b;
  };
  let current = 0;
  return {
    root,
    docks: markers,
    labels,
    bounds,
    setExplode(amount: number) {
      current = amount;
      apply(amount);
    },
    boundsAt,
  };
}
