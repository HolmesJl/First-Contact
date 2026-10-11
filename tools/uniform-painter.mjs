/**
 * Paints a crew jumpsuit onto a skinned body mesh's UV layout: colour texture (skin kept for head and hands)
 * and a matching tangent-space normal map (seams, zipper, pocket flaps, belt, cuffs, boot soles).
 *
 * Works on any glTF whose `Body` mesh has POSITION, NORMAL, TEXCOORD_0, JOINTS_0 / WEIGHTS_0 and a UE-style
 * skeleton (pelvis, neck_01, head, upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ...), which is the
 * Quaternius rig. Everything is derived from joint positions and skin weights, so the same code dresses both sexes.
 */
import sharp from 'sharp';
import { band, clamp, hash, heightToNormal, len, line, padIslands, rasterise, readBody, seg, smooth, sub } from './body-raster.mjs';

const RES = 1024;

/** `chestLift`: raises the chest pocket and name tag (fraction of body height), so they clear a bust. */
export async function paintUniform({ glbPath, skinImage, accent = [232, 119, 46], meshName = 'Body', chestLift = 0 }) {
  const body = await readBody(glbPath, meshName);
  const { J, H, leftSign } = body;
  const raster = rasterise(body, RES);
  const { N, P, NR, SC, cov, dist } = raster;

  const neckY = J.neck_01.p[1];
  const pelvisY = J.pelvis.p[1];
  const ankleY = (J.foot_l.p[1] + J.foot_r.p[1]) / 2;
  const bootTop = ankleY + 0.075 * H;
  const beltY = pelvisY + 0.022 * H;

  // ---- source skin
  const base = await sharp(skinImage).removeAlpha().resize(RES, RES).raw().toBuffer();

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
  for (let o = 0; o < N; o++) {
    const c = covered[o];
    for (let k = 0; k < 3; k++) out[o * 3 + k] = Math.round(base[o * 3 + k] * (1 - c) + colour[o * 3 + k] * c);
  }
  const nrmOut = heightToNormal(height, raster, 1.0);
  const pad = (buf) => sharp(padIslands(buf, raster, 3), { raw: { width: RES, height: RES, channels: 3 } });
  const color = await pad(out).webp({ quality: 86, effort: 5 }).toBuffer();
  const normal = await pad(nrmOut).webp({ quality: 92, effort: 5 }).toBuffer();
  // Accent coverage (0..255), so a viewer can swap the accent colour: pixel += mask * (new - accent).
  const maskBuf = Buffer.alloc(N);
  for (let o = 0; o < N; o++) maskBuf[o] = Math.round(clamp(accentMask[o] * covered[o]) * 255);
  const accentImg = await sharp(maskBuf, { raw: { width: RES, height: RES, channels: 1 } }).webp({ lossless: true, effort: 5 }).toBuffer();
  return { color, normal, accent: accentImg, height: H };
}
