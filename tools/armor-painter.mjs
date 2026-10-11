/**
 * Paints the Lite Body Armor over a body's UV layout as a layer to composite onto the jumpsuit textures at runtime:
 *   colour   RGBA: plates in a neutral primary, dark ribbed underlay at the joints; alpha = armor coverage
 *   normal   RGBA: tangent-space normals (plate bevels, panel grooves, ribbing); alpha = same coverage
 *   primary  mask: where the primary colour applies (the game tints these texels: pixel *= primary / PRIMARY)
 *   accent   mask: trim painted in ACCENT, recoloured to the job colour exactly like the jumpsuit's accent
 */
import sharp from 'sharp';
import { SC_COUNT, band, clamp, hash, heightToNormal, line, padIslands, rasterise, readBody, smooth } from './body-raster.mjs';
import { armorFrame, armorRegions } from './armor-regions.mjs';

const RES = 1024;
/** Neutral value the plates are painted in; the runtime multiplies by primary / PRIMARY. Keep in sync with client bodyArmor.ts. */
export const PRIMARY = [204, 204, 206];
/** Trim colour, same as the jumpsuit accent so the client recolours both with one rule. */
export const ACCENT = [232, 119, 46];

const UNDERLAY = [38, 40, 45];
const EDGE = [96, 98, 104];
const GROOVE = [120, 122, 128];

export async function paintArmor({ glbPath, meshName = 'Body' }) {
  const body = await readBody(glbPath, meshName);
  const f = armorFrame(body);
  const { H, J, neckY, pelvisY, bootTop, ankleY } = f;
  const raster = rasterise(body, RES);
  const { N, P, NR, SC, cov, dist } = raster;

  const colour = new Float32Array(N * 3);
  const alpha = new Float32Array(N);
  const height = new Float32Array(N);
  const primaryMask = new Float32Array(N);
  const accentMask = new Float32Array(N);
  const sc = new Float32Array(SC_COUNT);

  for (let o = 0; o < N; o++) {
    if (!cov[o]) continue;
    const p = [P[o * 3], P[o * 3 + 1], P[o * 3 + 2]];
    const n = [NR[o * 3], NR[o * 3 + 1], NR[o * 3 + 2]];
    for (let k = 0; k < SC_COUNT; k++) sc[k] = SC[o * SC_COUNT + k];
    const r = armorRegions(f, p, n, sc);
    alpha[o] = r.cover;
    if (r.cover <= 0) continue;
    const [x, y, z] = p;
    const u = x / H, v = y / H;
    const px = o % RES, py = (o / RES) | 0;
    const weave = hash(px, py);

    // flexible underlay between the plates: dark, finely ribbed
    const rib = 0.5 + 0.5 * Math.sin((y / 0.0075) * Math.PI * 2 + x * 40);
    let col = UNDERLAY.map((c) => c * (0.9 + 0.2 * weave) * (0.9 + 0.15 * rib));
    const plate = r.plate;
    const inner = smooth(0.35, 0.7, plate);
    let h = 0.00035 * rib * (1 - inner);

    // plates: neutral primary, bevelled at the edge, lightly brushed
    if (plate > 0.02) {
      const edge = band(plate - 0.5, 0.12, 0.08);
      let pc = PRIMARY.map((c) => c * (0.96 + 0.08 * weave));
      pc = pc.map((c, k) => c + (EDGE[k] - c) * edge * 0.7);
      col = col.map((c, k) => c + (pc[k] - c) * inner);
      primaryMask[o] = inner * (1 - edge * 0.5);
      h += 0.0038 * smooth(0.3, 0.75, plate);
    }

    // panel detail on the big plates
    const frontish = smooth(0.1, 0.5, n[2]);
    const groove = (g, depth = 0.0012, shade = 0.45) => {
      if (g <= 0) return;
      col = col.map((c, k) => c + (GROOVE[k] - c) * g * shade);
      h -= depth * g;
    };
    const stripe = (s) => {
      if (s <= 0) return;
      accentMask[o] = Math.max(accentMask[o], s);
      col = col.map((c, k) => c + (ACCENT[k] - c) * s);
      h += 0.0005 * s;
    };
    if (r.cuirass > 0.5) {
      const c = smooth(0.5, 0.7, r.cuirass);
      const sternumY = pelvisY + 0.165 * H;
      // front: sternum ridge, pectoral split, two abdominal segments; back: spine ridge
      groove(line(u, 0.004) * frontish * smooth(sternumY - 0.02 * H, sternumY, y) * c);
      groove(line(y - sternumY, 0.0035 * H) * frontish * c * (1 - smooth(0.11, 0.14, Math.abs(u))));
      for (const ay of [pelvisY + 0.1 * H, pelvisY + 0.04 * H]) groove(line(y - ay, 0.003 * H) * frontish * c * (1 - smooth(0.09, 0.12, Math.abs(u))), 0.001, 0.35);
      const backish = smooth(0.1, 0.5, -n[2]);
      groove(line(u, 0.004) * backish * c, 0.0014, 0.4);
      // job-colour chevron across the upper chest and shoulder blades
      const chev = band(y - (neckY - 0.075 * H) + Math.abs(u) * 0.12 * H, 0.0055 * H, 0.0012 * H) * c * (1 - smooth(0.1, 0.13, Math.abs(u)));
      stripe(chev * Math.max(frontish, backish) * 0.95);
    }
    if (r.pauldron > 0.5) {
      const c = smooth(0.5, 0.7, r.pauldron);
      // rim stripe just inside the pauldron edge
      stripe(band(r.pauldron - 0.78, 0.07, 0.04) * c * 0.9);
    }
    if (r.boot > 0.5) {
      const c = smooth(0.5, 0.7, r.boot);
      const toe = line(y - (ankleY * 0.45 + 0.01 * H), 0.004 * H) * c;
      groove(toe, 0.0012, 0.5);
      // job-colour band at the boot top
      stripe(band(y - (bootTop - 0.012 * H), 0.005 * H, 0.0012 * H) * c * 0.95);
      // sole: dark and grooved
      const sole = smooth(ankleY * 0.5 + 0.006 * H, ankleY * 0.5 - 0.004 * H, y) * c;
      col = col.map((c2, k) => c2 + (UNDERLAY[k] * 0.9 - c2) * sole);
      primaryMask[o] *= 1 - sole;
      h -= 0.001 * line(y - ankleY * 0.5, 0.003 * H) * c;
    }
    if (r.shin > 0.5) {
      const c = smooth(0.5, 0.7, r.shin);
      stripe(band(y - (J[`calf_${r.side}`].p[1] - 0.045 * H), 0.004 * H, 0.001 * H) * c * frontish * 0.9);
      groove(line(x - J[`calf_${r.side}`].p[0], 0.0045) * c * frontish, 0.001, 0.35);
    }
    if (r.thigh > 0.5) {
      const c = smooth(0.5, 0.7, r.thigh);
      const midY = (J[`thigh_${r.side}`].p[1] + J[`calf_${r.side}`].p[1]) / 2;
      groove(line(y - midY, 0.003 * H) * c, 0.001, 0.35);
    }
    if (r.bracer > 0.5) {
      const c = smooth(0.5, 0.7, r.bracer);
      const wristY = J[`hand_${r.side}`].p[1];
      stripe(band(y - (wristY + 0.045 * H), 0.004 * H, 0.001 * H) * c * 0.9);
    }
    if (r.upperarm > 0.5) {
      const c = smooth(0.5, 0.7, r.upperarm);
      const midY = (J[`upperarm_${r.side}`].p[1] + J[`lowerarm_${r.side}`].p[1]) / 2;
      groove(line(y - midY, 0.0028 * H) * c, 0.001, 0.35);
    }

    // seams of the underlay along the UV island borders
    const seamLine = line(dist[o] - 1.5, 1.6) * (1 - smooth(0.3, 0.6, plate));
    if (seamLine > 0) {
      col = col.map((c) => c * (1 - 0.35 * seamLine));
      h -= 0.0006 * seamLine;
    }

    colour[o * 3] = col[0];
    colour[o * 3 + 1] = col[1];
    colour[o * 3 + 2] = col[2];
    height[o] = h * r.cover;
  }

  const rgba = Buffer.alloc(N * 4);
  for (let o = 0; o < N; o++) {
    for (let k = 0; k < 3; k++) rgba[o * 4 + k] = Math.round(clamp(colour[o * 3 + k], 0, 255));
    rgba[o * 4 + 3] = Math.round(clamp(alpha[o]) * 255);
  }
  const nrm = heightToNormal(height, raster, 1.0);
  const nrgba = Buffer.alloc(N * 4);
  for (let o = 0; o < N; o++) {
    nrgba.set(nrm.subarray(o * 3, o * 3 + 3), o * 4);
    nrgba[o * 4 + 3] = Math.round(clamp(alpha[o]) * 255);
  }
  const mask = (arr) => {
    const b = Buffer.alloc(N);
    for (let o = 0; o < N; o++) b[o] = Math.round(clamp(arr[o] * alpha[o]) * 255);
    return sharp(padIslands(b, raster, 1), { raw: { width: RES, height: RES, channels: 1 } }).webp({ lossless: true, effort: 5 }).toBuffer();
  };
  const img4 = (b, q) => sharp(padIslands(b, raster, 4), { raw: { width: RES, height: RES, channels: 4 } }).webp({ quality: q, effort: 5, alphaQuality: 100 }).toBuffer();
  return {
    color: await img4(rgba, 86),
    normal: await img4(nrgba, 92),
    primary: await mask(primaryMask),
    accent: await mask(accentMask),
  };
}
