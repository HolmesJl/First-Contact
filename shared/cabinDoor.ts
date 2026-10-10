import type { Obstacle } from './shipLayout';
import { SHIP_LAYOUT } from './shipLayout';
import { CABIN_KEYPAD, isWalkable } from './shipInterior';

export const CABIN_DOOR_ID = 'cabin-in';
export const CABIN_KEYPAD_INTERACT_ID = 'cabin-keypad';

export const CABIN_DOOR_SLIDE_M = 1.05;
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

/** Sliding panel obstacle; openFrac 0 = closed (blocks), 1 = slid aside (no block). */
export function cabinDoorObstacle(openFrac: number): Obstacle | null {
  if (openFrac >= 0.98) return null;
  const { x, z, width } = cabinDoorCenter();
  const slide = CABIN_DOOR_SLIDE_M * openFrac;
  const panelX = x + slide;
  const halfW = width / 2 + 0.04;
  const depth = 0.14;
  return {
    rect: true,
    minX: panelX - depth / 2,
    maxX: panelX + depth / 2,
    minZ: z - halfW,
    maxZ: z + halfW,
  };
}

export function cabinDoorExtraObstacles(openFrac: number): Obstacle[] {
  const o = cabinDoorObstacle(openFrac);
  return o ? [o] : [];
}

export function isValidCabinCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

/** Stand point in the cabin corridor for keypad interact. */
export function cabinKeypadInteractPosition() {
  const { x, z } = CABIN_KEYPAD;
  const candidates: [number, number][] = [];
  for (let dx = -0.4; dx <= 1.3; dx += 0.12) {
    for (let dz = -1.4; dz <= 0.6; dz += 0.12) {
      candidates.push([x + dx, z + dz]);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
  for (const [px, pz] of candidates) {
    if (isWalkable(px, pz)) return { x: px, z: pz };
  }
  return { x: -46.6, z: 19.0 };
}

/** Sample point in the door lane that must be blocked when the door is closed. */
export function cabinDoorLaneTestPoint() {
  const { x, z } = cabinDoorCenter();
  return { x: x - 0.25, z };
}
