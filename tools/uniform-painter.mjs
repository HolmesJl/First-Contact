/**
 * Paints a crew jumpsuit onto a skinned body mesh's UV layout: colour texture (skin kept for head and hands)
 * and a matching tangent-space normal map (seams, zipper, pocket flaps, belt, cuffs, boot soles).
 *
 * Works on any glTF whose `Body` mesh has POSITION, NORMAL, TEXCOORD_0, JOINTS_0 / WEIGHTS_0 and a UE-style
 * skeleton (pelvis, neck_01, head, upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ...), which is the
 * Quaternius rig. Everything is derived from joint positions and skin weights, so the same code dresses both sexes.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const RES = 1024;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 1 inside |d| < half, soft edge. */
const band = (d, half, soft) => 1 - smooth(half - soft, half + soft, Math.abs(d));
/** Soft line: 1 on the line, fading to 0 at `width`. */
const line = (d, width) => 1 - smooth(0, width, Math.abs(d));
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** `chestLift`: raises the chest pocket and name tag (fraction of body height), so they clear a bust. */
export async function paintUniform({ glbPath, skinImage, accent = [232, 119, 46], meshName = 'Body', chestLift = 0 }) {
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
  const nVert = pos.length / 3;

  let H = 0;
  for (let i = 0; i < nVert; i++) H = Math.max(H, pos[i * 3 + 1]);
  const leftSign = Math.sign(J.upperarm_l.p[0]) || 1;

  const jointIsSkin = joints.map((j) => /^(head|neck_01|hand_|index_|middle_|ring_|pinky_|thumb_)/.test(j.getName()));
  const jointIsBoot = joints.map((j) => /^(foot_|ball_)/.test(j.getName()));
  const jointIsArm = joints.map((j) => /^(upperarm_|lowerarm_)/.test(j.getName()));
  const jointIsLeg = joints.map((j) => /^(thigh_|calf_)/.test(j.getName()));
  const jointIsNeck = joints.map((j) => j.getName() === 'neck_01');

  // per-vertex scalars: skin (head, hands), neck, boot, arm, leg weights
  const vs = new Float32Array(nVert * 5);
  for (let v = 0; v < nVert; v++) {
    for (let k = 0; k < 4; k++) {
      const w = wgt[v * 4 + k];
      const j = jnt[v * 4 + k];
      if (jointIsSkin[j] && !jointIsNeck[j]) vs[v * 5] += w;
      if (jointIsNeck[j]) vs[v * 5 + 1] += w;
      if (jointIsBoot[j]) vs[v * 5 + 2] += w;
      if (jointIsArm[j]) vs[v * 5 + 3] += w;
      if (jointIsLeg[j]) vs[v * 5 + 4] += w;
    }
  }

  const neckY = J.neck_01.p[1];
  const pelvisY = J.pelvis.p[1];
  const ankleY = (J.foot_l.p[1] + J.foot_r.p[1]) / 2;
  const bootTop = ankleY + 0.075 * H;
  const beltY = pelvisY + 0.022 * H;

  // ---- rasterise attributes into UV space
  const N = RES * RES;
  const P = new Float32Array(N * 3);
  const NR = new Float32Array(N * 3);
  const SC = new Float32Array(N * 5);
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
        for (let k = 0; k < 5; k++) SC[o * 5 + k] = w0 * vs[a * 5 + k] + w1 * vs[b * 5 + k] + w2 * vs[c * 5 + k];
        MP[o * 2] = Math.max(mx, 1e-5);
        MP[o * 2 + 1] = Math.max(my, 1e-5);
        cov[o] = 1;
      }
    }
  }

  // distance (px) to the nearest uncovered pixel: UV island borders are the garment's seams
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

  // ---- source skin
  const base = await sharp(skinImage).removeAlpha().resize(RES, RES).raw().toBuffer();

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const seg = (p, a, b) => {
    const ab = sub(b, a);
    const t = dot(sub(p, a), ab) / dot(ab, ab);
    const q = [a[0] + ab[0] * clamp(t, 0, 1), a[1] + ab[1] * clamp(t, 0, 1), a[2] + ab[2] * clamp(t, 0, 1)];
    return { t, rad: sub(p, q) };
  };

  const FABRIC = [88, 94, 103];
  const SEAM = [54, 57, 64];
  const BOOT = [30, 29, 30];
  const ZIP = [176, 178, 182];
  const colour = new Float32Array(N * 3);
  const height = new Float32Array(N);
  const covered = new Float32Array(N);
  const accentMask = new Float32Array(N);

  for (let o = 0; o < N; o++) {
    if (!cov[o]) continue;
    const x = P[o * 3], y = P[o * 3 + 1], z = P[o * 3 + 2];
    const p = [x, y, z];
    const nz = NR[o * 3 + 2];
    const skinW = SC[o * 5], neckW = SC[o * 5 + 1], bootW = SC[o * 5 + 2], armW = SC[o * 5 + 3], legW = SC[o * 5 + 4];
    const u = x / H, v = y / H;
    const sx = Math.sign(x) || 1;
    const side = sx === leftSign ? 'l' : 'r';

    // coverage: head and hands stay skin, the neck is covered below its base joint (collar)
    const neckSkin = neckW * smooth(neckY - 0.012 * H, neckY + 0.014 * H, y);
    let cover = 1 - clamp(skinW * 1.6 + neckSkin, 0, 1);
    cover = smooth(0.15, 0.85, cover);
    covered[o] = cover;

    let col = [...FABRIC];
    let h = 0;
    const weave = hash(o % RES, (o / RES) | 0);
    h += (weave - 0.5) * 0.00006;
    col = col.map((c) => c * (0.95 + 0.1 * weave));

    // boots: foot weights plus the calf below the boot top
    const boot = clamp(bootW * 1.5 + (legW > 0.2 ? smooth(bootTop + 0.01 * H, bootTop - 0.01 * H, y) : 0), 0, 1) * (y < bootTop + 0.02 * H ? 1 : 0);
    if (boot > 0.02) {
      col = col.map((c, k) => c + (BOOT[k] - c) * boot);
      const rim = line(y - bootTop, 0.006 * H) * boot;
      h += 0.0011 * rim;
      col = col.map((c) => c * (1 - 0.25 * rim) + 22 * rim);
      h -= 0.0010 * line(y - (ankleY * 0.45 + 0.004 * H), 0.004 * H) * boot; // sole groove
      col = col.map((c) => c * (1 - 0.35 * line(y - (ankleY * 0.45 + 0.004 * H), 0.004 * H) * boot));
    }

    // arms: sleeve band and shoulder patch in the accent colour, cuffs
    if (armW > 0.35) {
      const sideName = side;
      const up = seg(p, J[`upperarm_${sideName}`].p, J[`lowerarm_${sideName}`].p);
      const fa = seg(p, J[`lowerarm_${sideName}`].p, J[`hand_${sideName}`].p);
      const onUpper = up.t < 1;
      if (onUpper && up.t > 0) {
        const rl = len(up.rad) + 1e-9;
        const outward = (up.rad[0] * sx * 0.55 + up.rad[1] * 0.83) / rl;
        const patch = band(up.t - 0.36, 0.17, 0.02) * smooth(0.35, 0.6, outward);
        const stripe = band(up.t - 0.36, 0.17, 0.02) * band(outward - 0.88, 0.05, 0.02);
        const bandRing = band(up.t - 0.72, 0.045, 0.01);
        const acc = clamp(Math.max(patch * 0.94, bandRing), 0, 1);
        accentMask[o] = Math.max(accentMask[o], acc);
        col = col.map((c, k) => c + (accent[k] - c) * acc);
        col = col.map((c) => c + (236 - c) * stripe * 0.9);
        h += 0.0006 * (patch + bandRing) - 0.0003 * stripe;
      }
      if (fa.t > 0.86) {
        const cuff = smooth(0.86, 0.9, fa.t);
        col = col.map((c) => c * (1 - 0.35 * cuff));
        h += 0.0009 * line(fa.t - 0.93, 0.05) + 0.0004 * cuff;
      }
    }

    // torso: zipper, belt, chest pocket, name tag, collar
    const frontish = smooth(0.15, 0.55, nz);
    const bodyBand = clamp(1 - armW * 2, 0, 1);
    if (frontish > 0 && v < neckY / H + 0.004 && v > (pelvisY / H - 0.05)) {
      const zip = line(u, 0.0035) * smooth(pelvisY / H - 0.05, pelvisY / H - 0.035, v) * smooth(neckY / H + 0.004, neckY / H - 0.01, v) * frontish;
      if (zip > 0) {
        const teeth = 0.5 + 0.5 * Math.sin((v * H) / 0.0042 * Math.PI * 2);
        col = col.map((c) => c + (ZIP[0] * (0.78 + 0.22 * teeth) - c) * zip * 0.85);
        h += 0.0008 * zip * (0.6 + 0.4 * teeth);
      }
    }
    const beltD = v - beltY / H;
    if (bodyBand > 0.5 && legW < 0.6) {
      const belt = band(beltD, 0.0095, 0.0015);
      col = col.map((c) => c * (1 - 0.3 * belt) + 6 * belt);
      h += 0.0011 * belt - 0.0006 * line(Math.abs(beltD) - 0.0075, 0.0012);
    }
    // chest pocket flap (wearer's left) and name tag (right)
    const pu = (sx === leftSign ? u : -u);
    const flapBox = (cu, cv, hw, hh, d, fill) => {
      // returns outline strength and inside mask for a rectangle on the torso front
      const du = Math.abs(pu - cu) - hw;
      const dv = Math.abs(v - cv) - hh;
      const outside = Math.max(du, dv);
      return { edge: line(outside, d), inside: 1 - smooth(-0.0006, 0.0006, outside), fill };
    };
    if (frontish > 0 && bodyBand > 0.5 && u * sx > 0 && sx === leftSign) {
      const pk = flapBox(0.052, 0.745 + chestLift, 0.024, 0.017, 0.0016);
      col = col.map((c) => c * (1 - 0.3 * pk.edge * frontish));
      h += 0.0008 * pk.edge * frontish;
      const flap = line(v - (0.745 + chestLift + 0.0045), 0.0016) * pk.inside;
      h += 0.0009 * flap * frontish;
      col = col.map((c) => c * (1 - 0.18 * pk.inside * frontish));
    }
    if (frontish > 0 && bodyBand > 0.5 && sx !== leftSign) {
      const tag = flapBox(0.048, 0.752 + chestLift, 0.021, 0.0075, 0.0012);
      col = col.map((c) => c + (230 - c) * tag.inside * frontish * 0.9);
      h += 0.0005 * tag.edge * frontish;
    }
    // thigh pocket flaps
    if (legW > 0.4 && nz > 0.25) {
      const th = seg(p, J[`thigh_${side}`].p, J[`calf_${side}`].p);
      if (th.t > 0 && th.t < 1) {
        const sc = H / 1.7;
        const L = len(sub(J[`calf_${side}`].p, J[`thigh_${side}`].p));
        const lat = th.rad[0] * sx;
        const dt = (th.t - 0.34) * L;
        const rect = Math.max(Math.abs(lat - 0.004) - 0.03 * sc, Math.abs(dt) - 0.036 * sc);
        const edge = line(rect, 0.0016);
        const inside = 1 - smooth(-0.0005, 0.0005, rect);
        col = col.map((c) => c * (1 - 0.3 * edge - 0.12 * inside));
        h += 0.0008 * edge + 0.0009 * line(dt + 0.036 * sc - 0.004, 0.0016) * inside;
      }
    }
    // collar trim
    const collarD = y - (neckY - 0.003 * H);
    const collar = band(collarD, 0.006 * H, 0.0015 * H) * (1 - skinW) * (1 - smooth(0.05, 0.08, Math.abs(u)));
    if (collar > 0) {
      accentMask[o] = Math.max(accentMask[o], collar * 0.9 * 0.85);
      col = col.map((c, k) => c + (accent[k] * 0.85 - c) * collar * 0.9);
      h += 0.0008 * collar;
    }

    // seams along the UV island borders
    const seamLine = line(dist[o] - 1.5, 1.6);
    if (seamLine > 0 && cover > 0.5) {
      col = col.map((c, k) => c + (SEAM[k] - c) * seamLine * 0.8);
      h -= 0.0009 * seamLine;
    }

    colour[o * 3] = col[0];
    colour[o * 3 + 1] = col[1];
    colour[o * 3 + 2] = col[2];
    height[o] = h * cover;
  }

  // ---- compose colour over the skin and write tangent-space normals
  const out = Buffer.alloc(N * 3);
  const nrmOut = Buffer.alloc(N * 3);
  for (let o = 0; o < N; o++) {
    const c = covered[o];
    for (let k = 0; k < 3; k++) out[o * 3 + k] = Math.round(base[o * 3 + k] * (1 - c) + colour[o * 3 + k] * c);
  }
  const hAt = (x, y) => height[clamp(y, 0, RES - 1) * RES + clamp(x, 0, RES - 1)];
  const GAIN = 1.0;
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const o = y * RES + x;
      let nx = 0, ny = 0;
      if (cov[o]) {
        const dx = (hAt(x + 1, y) - hAt(x - 1, y)) / (2 * MP[o * 2]);
        const dr = (hAt(x, y + 1) - hAt(x, y - 1)) / (2 * MP[o * 2 + 1]);
        nx = -dx * GAIN;
        ny = dr * GAIN;
      }
      const l = Math.hypot(nx, ny, 1);
      nrmOut[o * 3] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      nrmOut[o * 3 + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      nrmOut[o * 3 + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
    }
  }
  const pad = async (buf, fillPixel) => {
    // push island colours outward by a few pixels so mip-mapping does not pull in empty texels
    const filled = Uint8Array.from(cov);
    for (let it = 0; it < 5; it++) {
      const next = Uint8Array.from(filled);
      for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
        const o = y * RES + x;
        if (filled[o]) continue;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= RES || yy >= RES) continue;
          const q = yy * RES + xx;
          if (filled[q]) {
            buf[o * 3] = buf[q * 3]; buf[o * 3 + 1] = buf[q * 3 + 1]; buf[o * 3 + 2] = buf[q * 3 + 2];
            next[o] = 1;
            break;
          }
        }
      }
      filled.set(next);
    }
    return sharp(buf, { raw: { width: RES, height: RES, channels: 3 } });
  };
  const color = await (await pad(out)).webp({ quality: 86, effort: 5 }).toBuffer();
  const normal = await (await pad(nrmOut)).webp({ quality: 92, effort: 5 }).toBuffer();
  // Accent coverage (0..255), so a viewer can swap the accent colour: pixel += mask * (new - accent).
  const maskBuf = Buffer.alloc(N);
  for (let o = 0; o < N; o++) maskBuf[o] = Math.round(clamp(accentMask[o] * covered[o]) * 255);
  const accentImg = await sharp(maskBuf, { raw: { width: RES, height: RES, channels: 1 } }).webp({ lossless: true, effort: 5 }).toBuffer();
  return { color, normal, accent: accentImg, height: H };
}
