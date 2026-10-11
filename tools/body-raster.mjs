/**
 * Reads a skinned body mesh and rasterises its surface attributes into UV space, so garments can be painted
 * as textures from 3D rules (joint positions, skin weights). Shared by uniform-painter.mjs and armor-painter.mjs.
 *
 * Works on any glTF whose `Body` mesh has POSITION, NORMAL, TEXCOORD_0, JOINTS_0 / WEIGHTS_0 and a UE-style
 * skeleton (pelvis, neck_01, head, upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ...), which is the
 * Quaternius rig.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 1 inside |d| < half, soft edge. */
export const band = (d, half, soft) => 1 - smooth(half - soft, half + soft, Math.abs(d));
/** Soft line: 1 on the line, fading to 0 at `width`. */
export const line = (d, width) => 1 - smooth(0, width, Math.abs(d));
export const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
/** Closest point on segment a-b: `t` is the unclamped parameter, `rad` the vector from the segment to p. */
export const seg = (p, a, b) => {
  const ab = sub(b, a);
  const t = dot(sub(p, a), ab) / dot(ab, ab);
  const q = [a[0] + ab[0] * clamp(t, 0, 1), a[1] + ab[1] * clamp(t, 0, 1), a[2] + ab[2] * clamp(t, 0, 1)];
  return { t, rad: sub(p, q) };
};

/** Per-vertex scalar channels derived from skin weights (index into `scalars`). */
export const SC_SKIN = 0; // head and hands (not the neck)
export const SC_NECK = 1;
export const SC_BOOT = 2; // foot and ball joints
export const SC_ARM = 3; // upper and lower arm
export const SC_LEG = 4; // thigh and calf
export const SC_COUNT = 5;

/** Reads the body: geometry arrays, skeleton joints with world positions and the per-vertex scalar channels. */
export async function readBody(glbPath, meshName = 'Body') {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  const node = doc.getRoot().listNodes().find((n) => n.getMesh()?.getName() === meshName);
  const prim = node.getMesh().listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const nrm = prim.getAttribute('NORMAL').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const jnt = prim.getAttribute('JOINTS_0').getArray();
  const wgt = prim.getAttribute('WEIGHTS_0').getArray();
  const idx = prim.getIndices().getArray();
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const J = {};
  joints.forEach((j, i) => (J[j.getName()] = { i, p: j.getWorldTranslation() }));
  // the game's body glb carries the head joint as "Head"; the painters address it as "head"
  if (!J.head && J.Head) J.head = J.Head;
  const nVert = pos.length / 3;

  let H = 0;
  for (let i = 0; i < nVert; i++) H = Math.max(H, pos[i * 3 + 1]);
  const leftSign = Math.sign(J.upperarm_l.p[0]) || 1;

  const jointIsSkin = joints.map((j) => /^(head|neck_01|hand_|index_|middle_|ring_|pinky_|thumb_)/i.test(j.getName()));
  const jointIsBoot = joints.map((j) => /^(foot_|ball_)/.test(j.getName()));
  const jointIsArm = joints.map((j) => /^(upperarm_|lowerarm_)/.test(j.getName()));
  const jointIsLeg = joints.map((j) => /^(thigh_|calf_)/.test(j.getName()));
  const jointIsNeck = joints.map((j) => j.getName() === 'neck_01');

  const scalars = new Float32Array(nVert * SC_COUNT);
  for (let v = 0; v < nVert; v++) {
    for (let k = 0; k < 4; k++) {
      const w = wgt[v * 4 + k];
      const j = jnt[v * 4 + k];
      if (jointIsSkin[j] && !jointIsNeck[j]) scalars[v * SC_COUNT + SC_SKIN] += w;
      if (jointIsNeck[j]) scalars[v * SC_COUNT + SC_NECK] += w;
      if (jointIsBoot[j]) scalars[v * SC_COUNT + SC_BOOT] += w;
      if (jointIsArm[j]) scalars[v * SC_COUNT + SC_ARM] += w;
      if (jointIsLeg[j]) scalars[v * SC_COUNT + SC_LEG] += w;
    }
  }

  return { doc, node, prim, pos, nrm, uv, jnt, wgt, idx, skin, joints, J, nVert, H, leftSign, scalars };
}

/**
 * Rasterises the body into a RES x RES UV grid: position (P), normal (NR), scalar channels (SC), metres per
 * pixel (MP), coverage (cov) and the pixel distance to the nearest uncovered texel (dist), which is where the UV
 * islands end, i.e. the garment's natural seams.
 */
export function rasterise(body, RES) {
  const { pos, nrm, uv, idx, scalars } = body;
  const N = RES * RES;
  const P = new Float32Array(N * 3);
  const NR = new Float32Array(N * 3);
  const SC = new Float32Array(N * SC_COUNT);
  const MP = new Float32Array(N * 2);
  const cov = new Uint8Array(N);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const vi = [a, b, c];
    const px = vi.map((v) => [uv[v * 2] * (RES - 1), uv[v * 2 + 1] * (RES - 1)]);
    const minX = Math.max(0, Math.floor(Math.min(px[0][0], px[1][0], px[2][0])));
    const maxX = Math.min(RES - 1, Math.ceil(Math.max(px[0][0], px[1][0], px[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(px[0][1], px[1][1], px[2][1])));
    const maxY = Math.min(RES - 1, Math.ceil(Math.max(px[0][1], px[1][1], px[2][1])));
    const d = (px[1][1] - px[2][1]) * (px[0][0] - px[2][0]) + (px[2][0] - px[1][0]) * (px[0][1] - px[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    // metres per pixel along image x / row from the triangle's UV Jacobian
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const du1 = [uv[b * 2] - uv[a * 2], uv[b * 2 + 1] - uv[a * 2 + 1]];
    const du2 = [uv[c * 2] - uv[a * 2], uv[c * 2 + 1] - uv[a * 2 + 1]];
    const det = du1[0] * du2[1] - du2[0] * du1[1];
    if (Math.abs(det) < 1e-14) continue;
    const Tm = [0, 1, 2].map((k) => (e1[k] * du2[1] - e2[k] * du1[1]) / det);
    const Bm = [0, 1, 2].map((k) => (e2[k] * du1[0] - e1[k] * du2[0]) / det);
    const mx = Math.hypot(...Tm) / (RES - 1);
    const my = Math.hypot(...Bm) / (RES - 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((px[1][1] - px[2][1]) * (x - px[2][0]) + (px[2][0] - px[1][0]) * (y - px[2][1])) / d;
        const w1 = ((px[2][1] - px[0][1]) * (x - px[2][0]) + (px[0][0] - px[2][0]) * (y - px[2][1])) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.03 || w1 < -0.03 || w2 < -0.03) continue;
        const o = y * RES + x;
        for (let k = 0; k < 3; k++) {
          P[o * 3 + k] = w0 * pos[a * 3 + k] + w1 * pos[b * 3 + k] + w2 * pos[c * 3 + k];
          NR[o * 3 + k] = w0 * nrm[a * 3 + k] + w1 * nrm[b * 3 + k] + w2 * nrm[c * 3 + k];
        }
        for (let k = 0; k < SC_COUNT; k++) SC[o * SC_COUNT + k] = w0 * scalars[a * SC_COUNT + k] + w1 * scalars[b * SC_COUNT + k] + w2 * scalars[c * SC_COUNT + k];
        MP[o * 2] = Math.max(mx, 1e-5);
        MP[o * 2 + 1] = Math.max(my, 1e-5);
        cov[o] = 1;
      }
    }
  }

  const dist = new Float32Array(N).fill(99);
  for (let i = 0; i < N; i++) if (!cov[i]) dist[i] = 0;
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    const o = y * RES + x;
    if (x > 0) dist[o] = Math.min(dist[o], dist[o - 1] + 1);
    if (y > 0) dist[o] = Math.min(dist[o], dist[o - RES] + 1);
  }
  for (let y = RES - 1; y >= 0; y--) for (let x = RES - 1; x >= 0; x--) {
    const o = y * RES + x;
    if (x < RES - 1) dist[o] = Math.min(dist[o], dist[o + 1] + 1);
    if (y < RES - 1) dist[o] = Math.min(dist[o], dist[o + RES] + 1);
  }

  return { RES, N, P, NR, SC, MP, cov, dist };
}

/** Tangent-space normal map (RGB bytes) from a height field in metres, using the per-texel metres-per-pixel. */
export function heightToNormal(height, raster, gain = 1.0) {
  const { RES, N, cov, MP } = raster;
  const out = Buffer.alloc(N * 3);
  const hAt = (x, y) => height[clamp(y, 0, RES - 1) * RES + clamp(x, 0, RES - 1)];
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const o = y * RES + x;
      let nx = 0, ny = 0;
      if (cov[o]) {
        const dx = (hAt(x + 1, y) - hAt(x - 1, y)) / (2 * MP[o * 2]);
        const dr = (hAt(x, y + 1) - hAt(x, y - 1)) / (2 * MP[o * 2 + 1]);
        nx = -dx * gain;
        ny = dr * gain;
      }
      const l = Math.hypot(nx, ny, 1);
      out[o * 3] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      out[o * 3 + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      out[o * 3 + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Pushes island colours outward by a few pixels so mip-mapping does not pull in empty texels. */
export function padIslands(buf, raster, channels, iterations = 5) {
  const { RES } = raster;
  const filled = Uint8Array.from(raster.cov);
  for (let it = 0; it < iterations; it++) {
    const next = Uint8Array.from(filled);
    for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
      const o = y * RES + x;
      if (filled[o]) continue;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= RES || yy >= RES) continue;
        const q = yy * RES + xx;
        if (filled[q]) {
          for (let k = 0; k < channels; k++) buf[o * channels + k] = buf[q * channels + k];
          next[o] = 1;
          break;
        }
      }
    }
    filled.set(next);
  }
  return buf;
}
