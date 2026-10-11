/**
 * Where the Lite Body Armor sits on a body, as soft 0..1 masks evaluated at any surface point from joint positions
 * and skin weights. Shared by armor-painter.mjs (texture: evaluated per texel) and build-armor.mjs (mesh shells:
 * evaluated per vertex), so the painted plate edges and the shell borders line up.
 *
 * Plate = a region that gets a mesh shell as well as paint. The thickness is what gives the armor its heft;
 * tune SHELLS below and rebuild (cd tools && npm run build:armor).
 */
import { SC_ARM, SC_BOOT, SC_LEG, SC_NECK, SC_SKIN, clamp, len, seg, smooth, sub } from './body-raster.mjs';

/** Shells exported as meshes: offset from the body surface in metres, and Laplacian smoothing passes (stiffness). */
export const SHELLS = {
  cuirass: { thickness: 0.022, smoothing: 3 },
  pauldron: { thickness: 0.024, smoothing: 2 },
  boot: { thickness: 0.016, smoothing: 1 },
  shin: { thickness: 0.009, smoothing: 1 },
  thigh: { thickness: 0.009, smoothing: 1 },
  bracer: { thickness: 0.008, smoothing: 1 },
};

/** Soft edge width of every region, as a fraction of body height (~1 cm). */
const EDGE = 0.006;

export function armorFrame(body) {
  const { J, H, leftSign } = body;
  const ankleY = (J.foot_l.p[1] + J.foot_r.p[1]) / 2;
  return {
    H,
    J,
    leftSign,
    neckY: J.neck_01.p[1],
    pelvisY: J.pelvis.p[1],
    ankleY,
    /** Armor boots rise higher than the jumpsuit boots (ankle + 7.5 % H). */
    bootTop: ankleY + 0.115 * H,
    shoulderY: (J.upperarm_l.p[1] + J.upperarm_r.p[1]) / 2,
  };
}

/**
 * p: surface point, n: surface normal, sc: the SC_* scalar channels at that point.
 * Returns the region masks plus `cover` (anything the armor covers; the jumpsuit collar, head and hands stay).
 */
export function armorRegions(f, p, n, sc) {
  const { H, J, leftSign, neckY, pelvisY, bootTop, shoulderY } = f;
  const e = EDGE * H;
  const [x, y] = p;
  const sx = Math.sign(x) || 1;
  const side = sx === leftSign ? 'l' : 'r';
  const skinW = sc[SC_SKIN], neckW = sc[SC_NECK], bootW = sc[SC_BOOT], armW = sc[SC_ARM], legW = sc[SC_LEG];

  // same body coverage as the jumpsuit, minus a collar zone so the suit's job-coloured collar shows above the plate.
  // The zone is a ring around the neck axis (not a height cut: the shoulder tops sit at neck height and must be
  // plated), fading in above the pit of the throat.
  const neckSkin = neckW * smooth(neckY - 0.012 * H, neckY + 0.014 * H, y);
  let cover = smooth(0.15, 0.85, 1 - clamp(skinW * 1.6 + neckSkin, 0, 1));
  const neck = J.neck_01.p;
  const rNeck = Math.hypot(x - neck[0], p[2] - neck[2]);
  const collarZone = (1 - smooth(0.042 * H - e, 0.042 * H + e, rNeck)) * smooth(neckY - 0.03 * H, neckY - 0.018 * H, y);
  cover *= 1 - collarZone;

  const shoulder = J[`upperarm_${side}`].p;
  const vS = sub(p, shoulder);
  const dS = len(vS);
  const outS = (vS[0] * sx * 0.9 + vS[1] * 0.45) / (dS + 1e-9);
  const lateral = (vS[0] * sx) / (dS + 1e-9);
  // pauldron: a cap over the shoulder joint, open towards the armpit
  const pauldron = smooth(0.095 * H + e, 0.095 * H - e, dS) * smooth(-0.45, -0.05, outS) * smooth(shoulderY - 0.09 * H, shoulderY - 0.06 * H, y) * cover;

  // cuirass: torso from the hips up to the collar ring, the pauldrons overlapping its armholes (the armhole only
  // cuts the side of the shoulder, so the plate runs over the shoulder tops to the collar)
  const torso = (1 - smooth(0.25, 0.55, armW)) * (1 - smooth(0.25, 0.6, legW));
  const armhole = 1 - smooth(0.075 * H + e, 0.075 * H - e, dS) * smooth(-0.1, 0.3, lateral);
  const cuirass = torso * armhole * smooth(pelvisY - 0.03 * H - e, pelvisY - 0.03 * H + e, y) * cover * (1 - pauldron);

  // boot: foot weights plus the calf below the (raised) boot top
  const calfBelow = legW > 0.2 ? smooth(bootTop + e, bootTop - e, y) : 0;
  const boot = clamp(bootW * 1.5 + calfBelow, 0, 1) * (y < bootTop + 0.03 * H ? 1 : 0) * cover;

  // limbs: plates along the bone segments, wrapping the front and outer faces (shin, thigh) or all round (bracer)
  let shin = 0, thigh = 0, bracer = 0, upperarm = 0;
  if (legW > 0.2) {
    const calf = seg(p, J[`calf_${side}`].p, J[`foot_${side}`].p);
    const Lc = len(sub(J[`foot_${side}`].p, J[`calf_${side}`].p));
    const fwdC = (calf.rad[2] * 0.85 + calf.rad[0] * sx * 0.5) / (len(calf.rad) + 1e-9);
    shin = smooth(0.06 - e / Lc, 0.06 + e / Lc, calf.t) * smooth(0.98, 0.9, calf.t) * smooth(-0.35, 0.05, fwdC) * (1 - boot) * cover * smooth(0.2, 0.6, legW);
    const th = seg(p, J[`thigh_${side}`].p, J[`calf_${side}`].p);
    const Lt = len(sub(J[`calf_${side}`].p, J[`thigh_${side}`].p));
    const fwdT = (th.rad[2] * 0.75 + th.rad[0] * sx * 0.65) / (len(th.rad) + 1e-9);
    thigh = smooth(0.14 - e / Lt, 0.14 + e / Lt, th.t) * smooth(0.86 + e / Lt, 0.86 - e / Lt, th.t) * smooth(-0.3, 0.05, fwdT) * cover * smooth(0.3, 0.7, legW);
  }
  if (armW > 0.2) {
    const fa = seg(p, J[`lowerarm_${side}`].p, J[`hand_${side}`].p);
    const Lf = len(sub(J[`hand_${side}`].p, J[`lowerarm_${side}`].p));
    bracer = smooth(0.14 - e / Lf, 0.14 + e / Lf, fa.t) * smooth(0.9 + e / Lf, 0.9 - e / Lf, fa.t) * cover * smooth(0.3, 0.7, armW) * (1 - skinW);
    const up = seg(p, J[`upperarm_${side}`].p, J[`lowerarm_${side}`].p);
    const Lu = len(sub(J[`lowerarm_${side}`].p, J[`upperarm_${side}`].p));
    upperarm = smooth(0.3 - e / Lu, 0.3 + e / Lu, up.t) * smooth(0.9 + e / Lu, 0.9 - e / Lu, up.t) * cover * smooth(0.3, 0.7, armW) * (1 - pauldron);
  }

  const plate = Math.max(cuirass, pauldron, boot, shin, thigh, bracer, upperarm);
  return { cover, cuirass, pauldron, boot, shin, thigh, bracer, upperarm, plate, side, sx };
}
