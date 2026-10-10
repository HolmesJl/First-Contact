import * as THREE from 'three';
import { TUBE_Y } from '../../../../shared/lab';
import type { Facing } from '../../../../shared/shipLayout';
import type { Prop } from '../../../../shared/shipInterior';
import { interactIdForProp } from '../../../../shared/opening';
import { canvasTexture } from '../common';
import { buildShip } from '../ship';
import { Batch, MAT, labelSprite, screenMaterial } from './kit';

export const FACE_VEC: Record<Facing, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export interface PodFx {
  fluid: THREE.MeshBasicMaterial;
  bubbles: THREE.Points;
  flash: number;
}

export interface PropAnim {
  pods: PodFx[];
  holo: { group: THREE.Group; update(dt: number): void } | null;
}

export interface PropContext {
  batch: Batch;
  group: THREE.Group;
  /** Centre of the room, to pick a default facing. */
  center: { x: number; z: number };
  anim: PropAnim;
  sprites: THREE.Sprite[];
}

const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const hashId = (id: string) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function faceOf(p: Prop, center: { x: number; z: number }): Facing {
  if (p.face) return p.face;
  const dx = center.x - p.x;
  const dz = center.z - p.z;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : dz > 0 ? 'S' : 'N';
}

/** Adds a screen plane on the front face of a prop. */
function screen(ctx: PropContext, p: Prop, f: Facing, y: number, w: number, h: number, hue: 'cyan' | 'amber' | 'green' | 'red' = 'cyan') {
  const [fx, fz] = FACE_VEC[f];
  const half = (fx !== 0 ? p.sx : p.sz) / 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMaterial(p.label ?? p.id, hue));
  mesh.position.set(p.x + fx * (half + 0.012), y, p.z + fz * (half + 0.012));
  mesh.rotation.y = Math.atan2(fx, fz);
  ctx.group.add(mesh);
}

/** Length of a prop across its front (perpendicular to the facing). */
const across = (p: Prop, f: Facing) => (FACE_VEC[f][0] !== 0 ? p.sz : p.sx);
/** Depth of a prop along its facing. */
const depth = (p: Prop, f: Facing) => (FACE_VEC[f][0] !== 0 ? p.sx : p.sz);

export function buildProp(p: Prop, ctx: PropContext) {
  const f = faceOf(p, ctx.center);
  const [fx, fz] = FACE_VEC[f];
  const b = ctx.batch;
  const y0 = p.y ?? 0;
  const label = p.label && p.kind !== 'pod';

  switch (p.kind) {
    case 'pod':
      buildPod(p, ctx);
      break;
    case 'tank':
      buildTank(p, ctx, 0x28c8ff);
      break;
    case 'bio-tank':
      buildTank(p, ctx, 0x4cff9a);
      break;
    case 'holo':
      buildHolo(p, ctx);
      break;
    case 'console': {
      b.box(p.sx, p.h * 0.72, p.sz, p.x, y0, p.z, p.station ? 'station' : 'metal');
      b.box(p.sx * 0.96, 0.05, p.sz * 0.96, p.x, y0 + p.h * 0.72, p.z, 'dark');
      // Slanted-looking screen block on top of the front half.
      b.box(fx !== 0 ? p.sx * 0.35 : p.sx * 0.86, p.h * 0.28, fz !== 0 ? p.sz * 0.35 : p.sz * 0.86, p.x + fx * (depth(p, f) * 0.2), y0 + p.h * 0.77, p.z + fz * (depth(p, f) * 0.2), 'dark');
      screen(ctx, p, f, y0 + p.h * 0.6, Math.min(1.5, across(p, f) * 0.8), p.h * 0.34, p.station ? 'cyan' : 'amber');
      break;
    }
    case 'machine': {
      b.box(p.sx, p.h, p.sz, p.x, y0, p.z, p.id.includes('printer') || p.id.includes('refinery') ? 'metal' : 'station');
      b.box(p.sx * 0.7, 0.12, p.sz * 0.7, p.x, y0 + p.h, p.z, 'dark');
      for (let i = 0; i < 3; i++) b.box(fx !== 0 ? 0.03 : p.sx * 0.7, 0.04, fz !== 0 ? 0.03 : p.sz * 0.7, p.x + fx * (depth(p, f) / 2 + 0.012), y0 + p.h * (0.3 + i * 0.12), p.z + fz * (depth(p, f) / 2 + 0.012), 'dark');
      b.box(fx !== 0 ? 0.04 : 0.5, 0.06, fz !== 0 ? 0.04 : 0.5, p.x + fx * (depth(p, f) / 2 + 0.02), y0 + p.h * 0.85, p.z + fz * (depth(p, f) / 2 + 0.02), p.station ? 'glowCyan' : 'glowAmber');
      break;
    }
    case 'bed': {
      const warm = p.id === 'captain-bed';
      b.box(p.sx, 0.3, p.sz, p.x, y0, p.z, 'dark');
      b.box(p.sx - 0.08, 0.2, p.sz - 0.08, p.x, y0 + 0.3, p.z, warm ? 'fabricWarm' : 'mattress');
      const pw = across(p, f) - 0.25;
      const head = depth(p, f) / 2 - 0.25;
      b.box(fx !== 0 ? 0.35 : pw, 0.1, fz !== 0 ? 0.35 : pw, p.x - fx * head, y0 + 0.5, p.z - fz * head, 'light');
      b.box(fx !== 0 ? 0.08 : across(p, f), 0.7, fz !== 0 ? 0.08 : across(p, f), p.x - fx * (depth(p, f) / 2), y0, p.z - fz * (depth(p, f) / 2), 'dark');
      break;
    }
    case 'bunk': {
      const slabs = [0.35, 1.4, 2.45];
      for (const y of slabs) {
        b.box(p.sx, 0.07, p.sz, p.x, y, p.z, 'dark');
        b.box(p.sx * 0.9, 0.14, p.sz * 0.94, p.x, y + 0.07, p.z, 'mattress');
        b.box(p.sx, 0.28, 0.05, p.x, y + 0.07, p.z + p.sz / 2 - 0.025, 'dark');
        b.box(p.sx, 0.28, 0.05, p.x, y + 0.07, p.z - p.sz / 2 + 0.025, 'dark');
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.07, p.h, 0.07, p.x + (sx * (p.sx - 0.07)) / 2, 0, p.z + (sz * (p.sz - 0.07)) / 2, 'frame');
      // Ladder on the open side.
      const lx = p.x + fx * (p.sx / 2 + 0.05);
      for (const dz of [-0.2, 0.2]) b.box(0.05, 3.0, 0.05, lx, 0, p.z + dz - 0.2, 'light');
      for (let y = 0.3; y < 2.9; y += 0.35) b.box(0.05, 0.04, 0.45, lx, y, p.z - 0.2, 'light');
      break;
    }
    case 'closet': {
      const trunk = p.h < 1.5;
      b.box(p.sx, p.h, p.sz, p.x, y0, p.z, trunk ? 'crate' : 'metal');
      if (trunk) {
        b.box(p.sx + 0.04, 0.05, p.sz + 0.04, p.x, y0 + p.h * 0.55, p.z, 'dark');
        b.box(fx !== 0 ? 0.04 : 0.2, 0.14, fz !== 0 ? 0.04 : 0.2, p.x + fx * (depth(p, f) / 2 + 0.02), y0 + p.h * 0.55 - 0.07, p.z + fz * (depth(p, f) / 2 + 0.02), 'light');
      } else {
        for (const y of [0.85, 1.7]) b.box(fx !== 0 ? 0.03 : p.sx, 0.03, fz !== 0 ? 0.03 : p.sz, p.x + fx * (depth(p, f) / 2 + 0.01), y, p.z + fz * (depth(p, f) / 2 + 0.01), 'dark');
        for (const y of [0.45, 1.3, 2.15]) b.box(fx !== 0 ? 0.04 : 0.12, 0.2, fz !== 0 ? 0.04 : 0.12, p.x + fx * (depth(p, f) / 2 + 0.02), y, p.z + fz * (depth(p, f) / 2 + 0.02), 'glowCyan');
      }
      break;
    }
    case 'desk': {
      b.box(p.sx, 0.07, p.sz, p.x, y0 + p.h - 0.07, p.z, 'light');
      for (const s of [-1, 1]) b.box(fx !== 0 ? p.sx : 0.06, p.h - 0.07, fz !== 0 ? p.sz : 0.06, p.x + (fx !== 0 ? 0 : (s * (p.sx - 0.06)) / 2), y0, p.z + (fz !== 0 ? 0 : (s * (p.sz - 0.06)) / 2), 'dark');
      b.box(0.32, 0.025, 0.22, p.x, y0 + p.h, p.z, p.station ? 'glowCyan' : 'dark');
      break;
    }
    case 'planter': {
      b.box(p.sx, 0.9, p.sz, p.x, 0, p.z, 'metal');
      b.box(p.sx - 0.2, 0.05, p.sz - 0.2, p.x, 0.9, p.z, 'soil');
      b.box(p.sx + 0.06, 0.06, p.sz + 0.06, p.x, 0.86, p.z, 'dark');
      const r = rand(hashId(p.id));
      for (let i = 0; i < 16; i++) {
        const px = p.x + (r() - 0.5) * (p.sx - 0.5);
        const pz = p.z + (r() - 0.5) * (p.sz - 0.5);
        const s = 0.16 + r() * 0.18;
        b.sphere(s, px, 0.98 + s * 0.8, pz, r() > 0.5 ? 'plant' : 'plantLight', 0);
        b.box(0.04, s * 1.2, 0.04, px, 0.95, pz, 'plant');
      }
      b.box(p.sx - 0.3, 0.03, 0.05, p.x, 0.62, p.z + p.sz / 2 + 0.01, 'glowGreen');
      break;
    }
    case 'crate': {
      b.box(p.sx, p.h, p.sz, p.x, y0, p.z, 'crate');
      b.box(p.sx + 0.03, 0.06, p.sz + 0.03, p.x, y0 + p.h * 0.15, p.z, 'dark');
      b.box(p.sx + 0.03, 0.06, p.sz + 0.03, p.x, y0 + p.h * 0.8, p.z, 'dark');
      break;
    }
    case 'rack': {
      const isArmory = p.id === 'armory';
      b.box(p.sx, p.h, p.sz, p.x, y0, p.z, isArmory ? 'red' : 'dark');
      const n = 4;
      for (let i = 1; i < n; i++) {
        b.box(fx !== 0 ? 0.03 : p.sx * 0.96, 0.04, fz !== 0 ? 0.03 : p.sz * 0.96, p.x + fx * (depth(p, f) / 2 + 0.012), y0 + (p.h * i) / n, p.z + fz * (depth(p, f) / 2 + 0.012), isArmory ? 'glowRed' : 'rib');
      }
      if (!isArmory) for (let i = 0; i < 6; i++) b.box(0.3, 0.3, 0.25, p.x - p.sx / 2 + 0.4 + i * (p.sx / 6.4), y0 + p.h * (0.3 + (i % 2) * 0.28), p.z + fz * (depth(p, f) / 2 + 0.14), 'crate');
      break;
    }
    case 'bench': {
      b.box(p.sx, 0.1, p.sz, p.x, y0 + p.h - 0.1, p.z, 'light');
      b.box(p.sx - 0.1, p.h - 0.1, p.sz - 0.1, p.x, y0, p.z, 'dark');
      for (let i = 0; i < 3; i++) b.cyl(0.08, 0.08, 0.28, p.x, y0 + p.h, p.z - p.sz * 0.3 + i * p.sz * 0.3, i % 2 ? 'glowCyan' : 'glass', 10);
      break;
    }
    case 'sofa': {
      b.box(p.sx, 0.45, p.sz, p.x, y0, p.z, 'fabric');
      b.box(fx !== 0 ? 0.25 : p.sx, 0.5, fz !== 0 ? 0.25 : p.sz, p.x - fx * (depth(p, f) / 2 - 0.125), y0 + 0.45, p.z - fz * (depth(p, f) / 2 - 0.125), 'fabric');
      for (const s of [-1, 1]) b.box(fx !== 0 ? p.sx : 0.18, 0.3, fz !== 0 ? p.sz : 0.18, p.x + (fx !== 0 ? 0 : (s * (p.sx - 0.18)) / 2), y0 + 0.45, p.z + (fz !== 0 ? 0 : (s * (p.sz - 0.18)) / 2), 'fabric');
      break;
    }
    case 'chair': {
      if (p.round && p.h <= 0.6) {
        b.cyl(p.sx / 2, p.sx / 2 * 0.9, p.h, p.x, y0, p.z, 'fabricWarm', 14);
      } else if (p.round) {
        b.cyl(0.08, 0.1, 0.5, p.x, y0, p.z, 'dark', 10);
        b.cyl(p.sx / 2, p.sx / 2, 0.14, p.x, y0 + 0.5, p.z, 'fabric', 18);
        b.box(fx !== 0 ? 0.12 : p.sx, 0.7, fz !== 0 ? 0.12 : p.sx, p.x - fx * (p.sx / 2 - 0.06), y0 + 0.6, p.z - fz * (p.sx / 2 - 0.06), 'fabric');
        for (const s of [-1, 1]) b.box(fx !== 0 ? 0.5 : 0.1, 0.07, fz !== 0 ? 0.5 : 0.1, p.x + (fx !== 0 ? 0 : s * (p.sx / 2)), y0 + 0.78, p.z + (fz !== 0 ? 0 : s * (p.sx / 2)), 'dark');
      } else {
        b.box(p.sx, 0.4, p.sz, p.x, y0, p.z, 'fabric');
        b.box(fx !== 0 ? 0.15 : p.sx, 0.4, fz !== 0 ? 0.15 : p.sz, p.x - fx * (depth(p, f) / 2 - 0.075), y0 + 0.4, p.z - fz * (depth(p, f) / 2 - 0.075), 'fabric');
      }
      break;
    }
    case 'table': {
      if (p.round) {
        b.cyl(0.07, 0.07, p.h - 0.06, p.x, y0, p.z, 'dark', 10);
        b.cyl(p.sx / 2, p.sx / 2, 0.06, p.x, y0 + p.h - 0.06, p.z, 'light', 20);
      } else {
        b.box(p.sx, 0.07, p.sz, p.x, y0 + p.h - 0.07, p.z, 'light');
        b.box(p.sx - 0.2, p.h - 0.07, p.sz - 0.2, p.x, y0, p.z, 'dark');
        if (p.station) b.box(p.sx - 0.3, 0.02, p.sz - 0.3, p.x, y0 + p.h, p.z, 'glowCyan');
      }
      break;
    }
    case 'counter': {
      b.box(p.sx, p.h - 0.06, p.sz, p.x, y0, p.z, 'metal');
      b.box(p.sx + 0.1, 0.06, p.sz + 0.12, p.x, y0 + p.h - 0.06, p.z, 'light');
      b.box(fx !== 0 ? 0.03 : p.sx - 0.2, 0.05, fz !== 0 ? 0.03 : p.sz - 0.2, p.x + fx * (depth(p, f) / 2 + 0.012), y0 + 0.3, p.z + fz * (depth(p, f) / 2 + 0.012), 'glowAmber');
      break;
    }
    case 'pad': {
      const r = p.sx / 2;
      b.cyl(r, r + 0.1, p.h, p.x, y0, p.z, 'metal', 32);
      b.ring(r - 0.12, 0.04, p.x, y0 + p.h + 0.01, p.z, p.id === 'teleporter-pad' ? 'glowCyan' : 'glowAmber', 40);
      b.cyl(r * 0.45, r * 0.45, 0.02, p.x, y0 + p.h, p.z, 'dark', 24);
      if (p.id === 'teleporter-pad') {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5;
          b.box(0.18, 2.2, 0.18, p.x + Math.cos(a) * (r + 0.2), 0, p.z + Math.sin(a) * (r + 0.2), 'metal');
          b.box(0.22, 0.1, 0.22, p.x + Math.cos(a) * (r + 0.2), 2.2, p.z + Math.sin(a) * (r + 0.2), 'glowCyan');
        }
      }
      break;
    }
    case 'arch': {
      for (const s of [-1, 1]) b.box(0.14, 2.6, 0.14, p.x, 0, p.z + s * (p.sz / 2 - 0.07), 'frame');
      b.box(0.3, 0.16, p.sz, p.x, 2.5, p.z, 'frame');
      b.box(0.04, 0.05, p.sz - 0.3, p.x, 2.42, p.z, 'glowCyan');
      break;
    }
    case 'reactor': {
      const r = p.sx / 2;
      b.cyl(r, r + 0.15, 0.4, p.x, 0, p.z, 'metal', 28);
      b.cyl(r * 0.55, r * 0.55, p.h - 0.4, p.x, 0.4, p.z, 'glowAmber', 24);
      b.ring(r * 0.75, 0.07, p.x, 1.2, p.z, 'frame', 28);
      b.ring(r * 0.75, 0.07, p.x, 2.2, p.z, 'frame', 28);
      b.cyl(r, r, 0.2, p.x, p.h, p.z, 'metal', 28);
      break;
    }
    case 'board': {
      b.box(fx !== 0 ? 0.08 : p.sx, p.h, fz !== 0 ? 0.08 : p.sz, p.x, y0, p.z, p.id === 'hold-net' ? 'fabric' : 'dark');
      if (p.id !== 'hold-net') screen(ctx, p, f, y0 + p.h * 0.5, Math.min(3.2, across(p, f) * 0.85), p.h * 0.6, 'amber');
      break;
    }
    case 'rug': {
      const mat = p.id.includes('eatery') ? 'rugWarm' : p.id.includes('rr') || p.id === 'cabin-rug' ? 'rugGreen' : 'rug';
      if (p.round) b.cyl(p.sx / 2, p.sx / 2, 0.02, p.x, 0.005, p.z, 'rugWarm', 28);
      else b.box(p.sx, 0.02, p.sz, p.x, 0.005, p.z, mat);
      break;
    }
    case 'lift': {
      b.box(p.sx, 0.06, p.sz, p.x, 0, p.z, 'hazard');
      b.box(p.sx - 0.5, 0.075, p.sz - 0.5, p.x, 0, p.z, 'redDark');
      const g = p.sx / 2 - 0.05;
      b.box(p.sx - 0.1, 0.09, 0.04, p.x, 0, p.z + g, 'glowRed');
      b.box(p.sx - 0.1, 0.09, 0.04, p.x, 0, p.z - g, 'glowRed');
      b.box(0.04, 0.09, p.sz - 0.1, p.x + g, 0, p.z, 'glowRed');
      b.box(0.04, 0.09, p.sz - 0.1, p.x - g, 0, p.z, 'glowRed');
      b.box(0.1, 0.09, p.sz - 0.6, p.x, 0, p.z, 'glowRed');
      b.box(p.sx - 0.6, 0.09, 0.1, p.x, 0, p.z, 'glowRed');
      break;
    }
  }

  if (label) {
    const kind = p.kind === 'lift' ? 'warn' : p.station ? 'station' : 'prop';
    const s = labelSprite(p.label!, kind, p.station ? 0.26 : 0.22);
    const top = y0 + p.h;
    s.position.set(p.x, Math.min(Math.max(top + 0.32, 1.25), 3.3), p.z);
    s.userData.interactId = p.id;
    ctx.group.add(s);
    ctx.sprites.push(s);
  }

  if (interactIdForProp(p.id)) {
    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(p.sx + 0.5, Math.max(p.h, 1.1), p.sz + 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    pick.position.set(p.x, y0 + Math.max(p.h, 1.1) / 2, p.z);
    pick.userData.interactId = p.id;
    ctx.group.add(pick);
  }
}

// ---------------------------------------------------------------- animated props

function buildPod(p: Prop, ctx: PropContext) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  ctx.group.add(g);
  const b = new Batch();
  b.box(2.5, 0.6, 1.3, 0, 0, 0, 'metal');
  b.box(2.3, 0.05, 0.02, 0, 0.45, 0.66, 'glowCyan');
  for (const side of [-1, 1]) {
    const cap = new THREE.CylinderGeometry(0.64, 0.64, 0.2, 16);
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(side * 1.15, TUBE_Y, 0);
    b.add(cap, 'metal', m);
    b.add(new THREE.TorusGeometry(0.57, 0.025, 6, 32), 'glowCyan', new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(side * 1.04, TUBE_Y, 0));
    b.box(0.18, TUBE_Y - 0.6, 0.3, side * 1.15, 0.5, 0, 'metal');
  }
  b.build(g);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.22),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 80, (c) => {
        c.fillStyle = '#071018';
        c.fillRect(0, 0, 256, 80);
        c.strokeStyle = '#46d9ff';
        c.lineWidth = 4;
        c.strokeRect(4, 4, 248, 72);
        c.fillStyle = '#9fe9ff';
        c.font = '700 44px "Orbitron", monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(p.label ?? '', 128, 42);
      }),
    }),
  );
  plate.position.set(0, 0.24, 0.655);
  g.add(plate);

  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 2.1, 24, 1, true), MAT.glass);
  glass.rotation.z = Math.PI / 2;
  glass.position.y = TUBE_Y;
  glass.renderOrder = 2;
  g.add(glass);
  const fluid = new THREE.MeshBasicMaterial({ color: 0x28c8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
  const fluidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 2.08, 24), fluid);
  fluidMesh.rotation.z = Math.PI / 2;
  fluidMesh.position.y = TUBE_Y;
  fluidMesh.renderOrder = 1;
  g.add(fluidMesh);

  const n = 28;
  const bp = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) bp.set([(Math.random() - 0.5) * 2, TUBE_Y + (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7], k * 3);
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  const bubbles = new THREE.Points(bgeo, new THREE.PointsMaterial({ color: 0xc8f4ff, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false }));
  g.add(bubbles);
  ctx.anim.pods.push({ fluid, bubbles, flash: 0 });
}

function buildTank(p: Prop, ctx: PropContext, color: number) {
  const r = p.sx / 2;
  const b = ctx.batch;
  b.cyl(r + 0.1, r + 0.14, 0.3, p.x, 0, p.z, 'metal', 24);
  b.cyl(r + 0.08, r + 0.08, 0.2, p.x, p.h - 0.2, p.z, 'metal', 24);
  b.ring(r + 0.02, 0.03, p.x, 0.32, p.z, p.kind === 'tank' ? 'glowCyan' : 'glowGreen', 28);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, p.h - 0.5, 24, 1, true), MAT.glass);
  glass.position.set(p.x, 0.3 + (p.h - 0.5) / 2, p.z);
  ctx.group.add(glass);
  const fluid = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.94, r * 0.94, p.h - 0.55, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fluid.position.copy(glass.position);
  ctx.group.add(fluid);
}

function buildHolo(p: Prop, ctx: PropContext) {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  ctx.group.add(g);
  const r = p.sx / 2;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, 0.85, 24), MAT.metal);
  base.position.y = 0.425;
  g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r - 0.05, 0.03, 6, 48), MAT.glowCyan);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.86;
  g.add(rim);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 0.7, 1.4, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3fbfff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 1.55;
  g.add(beam);

  const holo = new THREE.Group();
  const { ship, update } = buildShip();
  ship.scale.setScalar(0.028);
  ship.position.set(0, 0.55, 0);
  const holoShip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7ce4ff).multiplyScalar(1.3), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  ship.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = holoShip;
  });
  holo.add(ship);
  const wire = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fd8ff).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.55 });
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), wire);
  moon.position.set(0.45, 0.55, 0);
  holo.add(moon);
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.006, 4, 64), wire);
  orbit.rotation.x = Math.PI / 2;
  orbit.position.y = 0.55;
  holo.add(orbit);
  holo.position.y = 1.15;
  g.add(holo);
  ctx.anim.holo = {
    group: holo,
    update(dt) {
      holo.rotation.y += dt * 0.35;
      update(dt);
    },
  };
}
