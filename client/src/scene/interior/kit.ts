import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../common';

/** Greybox materials: greys and steel, cyan for interactables, deep red for sealed or locked things. */

const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.15, ...o });
const glow = (hex: number, k = 1.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false });

export const floorTexture = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    tex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#4a5468';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#566178';
      ctx.fillRect(3, 3, 122, 122);
      ctx.strokeStyle = '#2f3746';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 125, 125);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.5, 0.5);
    return tex;
  };
})();

export const MAT = {
  wall: std(0x8691a5, { roughness: 0.9, metalness: 0.05 }),
  ceiling: std(0x59637a, { side: THREE.FrontSide, roughness: 0.9 }),
  shell: std(0x717d92, { side: THREE.DoubleSide, roughness: 0.85 }),
  floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  frame: std(0xb4bfd1, { metalness: 0.3, roughness: 0.55 }),
  rib: std(0x9aa6bb, { metalness: 0.3, roughness: 0.6 }),
  metal: std(0x8793a8, { metalness: 0.25, roughness: 0.6 }),
  dark: std(0x39414f, { metalness: 0.2, roughness: 0.65 }),
  light: std(0xc3ccdb, { metalness: 0.15, roughness: 0.6 }),
  station: std(0x3d8aa3, { metalness: 0.2, roughness: 0.55, emissive: 0x082a36 }),
  fabric: std(0x6a748a, { roughness: 1, metalness: 0 }),
  fabricWarm: std(0x8a7561, { roughness: 1, metalness: 0 }),
  mattress: std(0xc4ccd9, { roughness: 1, metalness: 0 }),
  crate: std(0x8c8471, { roughness: 0.9, metalness: 0.1 }),
  soil: std(0x3a2d24, { roughness: 1, metalness: 0 }),
  plant: std(0x3f8a4e, { roughness: 0.9, metalness: 0, flatShading: true }),
  plantLight: std(0x6fbf5f, { roughness: 0.9, metalness: 0, flatShading: true }),
  red: std(0x6a1a24, { metalness: 0.3, roughness: 0.6 }),
  redDark: std(0x1c0a0e, { metalness: 0.2, roughness: 0.7 }),
  rug: std(0x4a5a74, { roughness: 1, metalness: 0 }),
  rugWarm: std(0x7a6452, { roughness: 1, metalness: 0 }),
  rugGreen: std(0x40604d, { roughness: 1, metalness: 0 }),
  hazard: std(0x8a6a1c, { roughness: 0.7, metalness: 0.2 }),
  glowCyan: glow(0x46d9ff, 1.25),
  glowAmber: glow(0xffb347, 1.2),
  glowRed: glow(0xff2a3a, 1.2),
  glowWhite: glow(0xdfeaff, 1.05),
  glowGreen: glow(0x7dff9b, 1.1),
  glass: new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
  glassDome: new THREE.MeshStandardMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.1, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  fluidGreen: new THREE.MeshBasicMaterial({ color: 0x4cff9a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
} satisfies Record<string, THREE.Material>;

export type MatKey = keyof typeof MAT;

/** Merges many boxes and cylinders into one mesh per material. */
export class Batch {
  private lists = new Map<MatKey, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, mat: MatKey, matrix?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    let list = this.lists.get(mat);
    if (!list) this.lists.set(mat, (list = []));
    list.push(g);
  }

  /** Box with its bottom at `y`, rotated `ry` radians about the vertical through its centre. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: MatKey, ry = 0) {
    this.m.makeTranslation(x, y + h / 2, z);
    if (ry) this.m.multiply(this.r.makeRotationY(ry));
    this.add(new THREE.BoxGeometry(w, h, d), mat, this.m);
  }

  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, mat: MatKey, seg = 20) {
    this.m.makeTranslation(x, y + h / 2, z);
    this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat, this.m);
  }

  sphere(r: number, x: number, y: number, z: number, mat: MatKey, detail = 1) {
    this.m.makeTranslation(x, y, z);
    this.add(new THREE.IcosahedronGeometry(r, detail), mat, this.m);
  }

  /** A thin beam between two points (square section `t`). */
  beam(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t: number, mat: MatKey) {
    const a = new THREE.Vector3(x1, y1, z1);
    const b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
    this.m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(new THREE.BoxGeometry(len, t, t), mat, this.m);
  }

  /** Torus lying flat (axis up). */
  ring(radius: number, tube: number, x: number, y: number, z: number, mat: MatKey, seg = 32) {
    this.m.makeTranslation(x, y, z).multiply(this.r.makeRotationX(Math.PI / 2));
    this.add(new THREE.TorusGeometry(radius, tube, 6, seg), mat, this.m);
  }

  build(into: THREE.Object3D, opts: { shadow?: boolean } = {}) {
    for (const [mat, list] of this.lists) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, MAT[mat]);
      mesh.matrixAutoUpdate = false;
      into.add(mesh);
      void opts;
    }
    this.lists.clear();
  }
}

// ---------------------------------------------------------------- label sprites and screens

const spriteCache = new Map<string, THREE.SpriteMaterial>();

/** A small always-facing text label. `kind` picks the border: station (cyan), sign (white), warn (red). */
export function labelSprite(text: string, kind: 'station' | 'prop' | 'sign' | 'warn' = 'prop', scale = 0.3): THREE.Sprite {
  const key = `${kind}|${text}`;
  let mat = spriteCache.get(key);
  let aspect = 4;
  if (!mat) {
    const font = '600 30px Inter, system-ui, sans-serif';
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 36;
    const h = 52;
    const tex = canvasTexture(w, h, (ctx) => {
      ctx.font = font;
      const border = kind === 'station' ? '#46d9ff' : kind === 'warn' ? '#ff4b5c' : kind === 'sign' ? '#e6edf8' : '#8a97ad';
      ctx.fillStyle = 'rgba(6,10,18,0.78)';
      ctx.beginPath();
      ctx.roundRect(1, 1, w - 2, h - 2, 12);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = kind === 'station' ? '#c9f4ff' : kind === 'warn' ? '#ffc1c8' : '#f1f5fb';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, w / 2, h / 2 + 1);
    });
    tex.minFilter = THREE.LinearFilter;
    mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    mat.userData.aspect = w / h;
    spriteCache.set(key, mat);
  }
  aspect = mat.userData.aspect as number;
  const s = new THREE.Sprite(mat);
  s.scale.set(scale * aspect, scale, 1);
  s.renderOrder = 5;
  return s;
}

const screenCache = new Map<string, THREE.MeshBasicMaterial>();

/** A console screen: a dark panel with the label and a few bars. */
export function screenMaterial(text: string, hue: 'cyan' | 'amber' | 'green' | 'red' = 'cyan') {
  const key = `${hue}|${text}`;
  let m = screenCache.get(key);
  if (m) return m;
  const colors = { cyan: ['#46d9ff', '#8fe6ff'], amber: ['#ffb347', '#ffcf8a'], green: ['#6dff9a', '#b5ffcb'], red: ['#ff4b5c', '#ffb0b8'] }[hue];
  const tex = canvasTexture(256, 160, (ctx) => {
    ctx.fillStyle = '#04121c';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = colors[0];
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, 250, 154);
    ctx.fillStyle = colors[1];
    ctx.font = '700 17px monospace';
    const words = text.split(' ');
    let line = '';
    let y = 30;
    for (const w of words) {
      if (ctx.measureText(`${line} ${w}`).width > 226 && line) {
        ctx.fillText(line, 14, y);
        line = w;
        y += 22;
      } else line = line ? `${line} ${w}` : w;
    }
    ctx.fillText(line, 14, y);
    ctx.strokeStyle = colors[0];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 228; x += 4) {
      const yy = 118 + Math.sin(x * 0.08) * 14 * Math.sin(x * 0.021 + text.length);
      if (x === 0) ctx.moveTo(14 + x, yy);
      else ctx.lineTo(14 + x, yy);
    }
    ctx.stroke();
  });
  m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  screenCache.set(key, m);
  return m;
}
