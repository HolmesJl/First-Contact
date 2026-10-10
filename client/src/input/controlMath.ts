/**
 * Pure math for the third-person controls. No DOM, no three.js, so it can be unit-checked with `npm run check:controls`.
 *
 * Conventions (match the scene and the wire protocol):
 *  - a character with `facing` = f looks along (sin f, cos f) on the ground plane (x, z); f = 0 looks down +z;
 *  - the camera orbits at (sin yaw, cos yaw) * dist around the character, so yaw = facing + PI puts it directly behind;
 *  - screen-right, seen from behind the character, is (-cos f, sin f); turning right therefore DEcreases facing.
 */

const TAU = Math.PI * 2;

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Signed shortest rotation that takes `from` to `to`, in (-PI, PI]. */
export function shortestDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** THE definition of "behind": the camera yaw that looks at the character's back. Used by spawn, steering and return. */
export function behindYaw(facing: number): number {
  return wrapAngle(facing + Math.PI);
}

/** Camera yaw from the character's facing and the player's orbit offset (0 = directly behind). */
export function cameraYaw(facing: number, orbitOffset: number): number {
  return wrapAngle(behindYaw(facing) + orbitOffset);
}

/** Direction the camera looks along (ground plane), i.e. the opposite of its orbit position. */
export function cameraForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Which movement keys are down, by `KeyboardEvent.code`. Returns x: +1 = right (D), y: +1 = forward (W). */
export function axesFromKeys(down: ReadonlySet<string>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (down.has('KeyW') || down.has('ArrowUp')) y += 1;
  if (down.has('KeyS') || down.has('ArrowDown')) y -= 1;
  if (down.has('KeyD') || down.has('ArrowRight')) x += 1;
  if (down.has('KeyA') || down.has('ArrowLeft')) x -= 1;
  return { x, y };
}

/**
 * World-space ground vector for stick/key axes relative to a facing. Length is the input magnitude clamped to 1,
 * so diagonals are not faster.
 */
export function moveVector(axisX: number, axisY: number, facing: number): { x: number; z: number; mag: number } {
  const len = Math.hypot(axisX, axisY);
  if (len < 1e-6) return { x: 0, z: 0, mag: 0 };
  const k = Math.min(1, len) / len;
  const ix = axisX * k;
  const iy = axisY * k;
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  return { x: s * iy - c * ix, z: c * iy + s * ix, mag: Math.min(1, len) };
}

/** Smoothstep easing, input clamped to 0..1. */
export function smoothstep(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/**
 * Orbit offset after `elapsed` seconds of a return that started at `from` and lasts `duration`. The offset is kept in
 * (-PI, PI], so easing it linearly to 0 is the shortest way round.
 */
export function returnOffset(from: number, elapsed: number, duration: number): number {
  return wrapAngle(from) * (1 - smoothstep(duration > 0 ? elapsed / duration : 1));
}
