import type { Obstacle } from './shipLayout';
import { SHIP_LAYOUT } from './shipLayout';
import { CABIN_KEYPAD, isWalkable, spaceAt } from './shipInterior';

export const CABIN_DOOR_ID = 'cabin-in';
/** Corridor-side keypad (where the Captain first sets the code). */
export const CABIN_KEYPAD_INTERACT_ID = 'cabin-keypad';
/** Cabin-side keypad on the same door: opens the door from inside; the Captain can change the code from either. */
export const CABIN_KEYPAD_IN_INTERACT_ID = 'cabin-keypad-in';
export type CabinKeypadId = typeof CABIN_KEYPAD_INTERACT_ID | typeof CABIN_KEYPAD_IN_INTERACT_ID;
export const CABIN_KEYPAD_IDS: readonly CabinKeypadId[] = [CABIN_KEYPAD_INTERACT_ID, CABIN_KEYPAD_IN_INTERACT_ID];

export function isCabinKeypadId(id: unknown): id is CabinKeypadId {
  return id === CABIN_KEYPAD_INTERACT_ID || id === CABIN_KEYPAD_IN_INTERACT_ID;
}

/** Wall thickness the keypads sit flush against (client walls are this thick). */
export const CABIN_WALL_T = 0.4;
/** Keypad box centre sits this far off the wall centre line: half the wall plus half the 0.1 m deep box. */
export const KEYPAD_WALL_OFFSET = CABIN_WALL_T / 2 + 0.05;

/** Slide far enough that the panel clears the door frame (along-wall pocket). */
export const CABIN_DOOR_SLIDE_M = 1.72;
export const CABIN_DOOR_OPEN_MS = 600;
export const CABIN_DOOR_IDLE_CLOSE_MS = 6000;
export const CABIN_DOOR_AFTER_PASS_MS = 4000;
export const CABIN_KEYPAD_LOCKOUT_MS = 10_000;
export const CABIN_MAX_WRONG_ATTEMPTS = 3;

const ROUND_CABIN = { x: -51.2, z: 18.3, r: 4 };

export function cabinDoorDef() {
  const d = SHIP_LAYOUT.doors.find((x) => x.id === CABIN_DOOR_ID);
  if (!d) throw new Error('missing cabin-in door');
  return d;
}

/** Door centre on the round cabin hull (matches client doorPlacement). */
export function cabinDoorCenter() {
  const d = cabinDoorDef();
  const off = Math.sqrt(Math.max(0, ROUND_CABIN.r ** 2 - (d.z - ROUND_CABIN.z) ** 2));
  const x = ROUND_CABIN.x + Math.sign(d.x - ROUND_CABIN.x) * off;
  return { x, z: d.z, width: d.width, axis: d.axis as 'x' | 'z' };
}

const PANEL_DEPTH = 0.14;

/** Outward normal and wall tangent at the cabin door (slide along tangent, thin along normal). */
export function cabinDoorSlideBasis() {
  const { x, z, width } = cabinDoorCenter();
  const rdx = x - ROUND_CABIN.x;
  const rdz = z - ROUND_CABIN.z;
  const rlen = Math.hypot(rdx, rdz) || 1;
  const nx = rdx / rlen;
  const nz = rdz / rlen;
  const tx = -nz;
  const tz = nx;
  /** Pocket the panel along the hull toward +z on this doorway. */
  const slideSign = 1;
  return { x, z, width, nx, nz, tx, tz, slideSign, depth: PANEL_DEPTH };
}

/** World pose for the sliding panel mesh (yaw aligns panel thickness with wall normal). */
export function cabinDoorPanelPose(openFrac: number) {
  const b = cabinDoorSlideBasis();
  const slide = CABIN_DOOR_SLIDE_M * openFrac * b.slideSign;
  return {
    x: b.x + b.tx * slide,
    z: b.z + b.tz * slide,
    /** Local +X is panel thickness; align with outward wall normal (nx, nz). */
    yaw: Math.atan2(-b.nz, b.nx),
  };
}

/** Sliding panel obstacle; openFrac 0 = closed (blocks), 1 = slid aside (no block). */
export function cabinDoorObstacle(openFrac: number): Obstacle | null {
  if (openFrac >= 0.98) return null;
  const b = cabinDoorSlideBasis();
  const slide = CABIN_DOOR_SLIDE_M * openFrac * b.slideSign;
  const px = b.x + b.tx * slide;
  const pz = b.z + b.tz * slide;
  const halfW = b.width / 2 + 0.04;
  const halfD = b.depth / 2;
  if (Math.abs(b.nx) >= Math.abs(b.nz)) {
    return { rect: true, minX: px - halfD, maxX: px + halfD, minZ: pz - halfW, maxZ: pz + halfW };
  }
  return { rect: true, minX: px - halfW, maxX: px + halfW, minZ: pz - halfD, maxZ: pz + halfD };
}

export function cabinDoorExtraObstacles(openFrac: number): Obstacle[] {
  const o = cabinDoorObstacle(openFrac);
  return o ? [o] : [];
}

export function isValidCabinCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

/** Stand point in the cabin corridor for keypad interact: reachable with the door closed, so not in the panel's way. */
export function cabinKeypadInteractPosition() {
  const { x, z } = CABIN_KEYPAD;
  const closed = cabinDoorExtraObstacles(0);
  const corridorMinX = cabinDoorCenter().x + 0.3;
  const candidates: [number, number][] = [];
  for (let dx = -0.4; dx <= 1.3; dx += 0.12) {
    for (let dz = -1.4; dz <= 0.6; dz += 0.12) {
      if (x + dx >= corridorMinX) candidates.push([x + dx, z + dz]);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
  for (const [px, pz] of candidates) {
    if (isWalkable(px, pz, 0, closed)) return { x: px, z: pz };
  }
  return { x: -46.6, z: 19.0 };
}

/**
 * Cabin-side keypad: the mirror of the corridor one on the same door, at the same height and the same distance along
 * the wall from the door, flush against the inside face of the round cabin hull. The hull curves away from the flat
 * corridor end wall, so it is placed on the hull point at the keypad's z with the hull's inward normal (not simply
 * reflected through the door plane, which would bury it in the wall).
 */
export function cabinKeypadInProp() {
  const { z, y } = CABIN_KEYPAD;
  const dz = z - ROUND_CABIN.z;
  const hullX = ROUND_CABIN.x + Math.sqrt(Math.max(0, ROUND_CABIN.r ** 2 - dz ** 2));
  const nx = (hullX - ROUND_CABIN.x) / ROUND_CABIN.r;
  const nz = dz / ROUND_CABIN.r;
  return {
    x: hullX - nx * KEYPAD_WALL_OFFSET,
    z: z - nz * KEYPAD_WALL_OFFSET,
    y,
    /** Outward hull normal at the keypad (the keypad faces -normal, into the cabin). */
    nx,
    nz,
    /** Yaw so the keypad's thin axis lies along the hull normal. */
    yaw: -Math.atan2(nz, nx),
  };
}

/** Stand point inside the cabin for the inside keypad: walkable with the door closed and clear of the panel. */
export function cabinKeypadInInteractPosition() {
  const { x, z } = cabinKeypadInProp();
  const closed = cabinDoorExtraObstacles(0);
  const cabinMaxX = cabinDoorCenter().x - 0.3;
  const candidates: [number, number][] = [];
  for (let dx = -1.5; dx <= 0.4; dx += 0.12) {
    for (let dz = -1.4; dz <= 0.6; dz += 0.12) {
      if (x + dx <= cabinMaxX) candidates.push([x + dx, z + dz]);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
  // Inside the room proper, not on the doorway threshold strip (which the panel sweeps across).
  for (const [px, pz] of candidates) {
    if (isWalkable(px, pz, 0, closed) && spaceAt(px, pz)?.id === 'cabin') return { x: px, z: pz };
  }
  return { x: -48.6, z: 19.0 };
}

export function cabinKeypadStand(id: CabinKeypadId) {
  return id === CABIN_KEYPAD_IN_INTERACT_ID ? cabinKeypadInInteractPosition() : cabinKeypadInteractPosition();
}

/** Sample point in the door lane that must be blocked when the door is closed. */
export function cabinDoorLaneTestPoint() {
  const { x, z } = cabinDoorCenter();
  return { x: x - 0.25, z };
}
