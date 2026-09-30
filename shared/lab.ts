/** Clone lab layout shared by server (spawn/clamping) and client (rendering/collision). */
export const TUBE_COUNT = 6;
export const TUBE_X = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
export const TUBE_Z = -4.7;
export const TUBE_Y = 1.2;

export const LAB = { minX: -9.3, maxX: 9.3, minZ: -3.6, maxZ: 6.3 };
export const HOLO_TABLE = { x: 0, z: 1.6, r: 1.25 };
export const PLAYER_RADIUS = 0.35;

export function spawnFor(tube: number) {
  const x = TUBE_X[tube] ?? 0;
  return { x: x + 0.9, z: -3.1, rot: 0 };
}

export function clampToLab(x: number, z: number) {
  let cx = Math.min(LAB.maxX, Math.max(LAB.minX, x));
  let cz = Math.min(LAB.maxZ, Math.max(LAB.minZ, z));
  let dx = cx - HOLO_TABLE.x;
  let dz = cz - HOLO_TABLE.z;
  let d = Math.hypot(dx, dz);
  const min = HOLO_TABLE.r + PLAYER_RADIUS;
  if (d < min) {
    if (d < 1e-4) {
      dx = 0;
      dz = 1;
      d = 1;
    }
    cx = HOLO_TABLE.x + (dx / d) * min;
    cz = HOLO_TABLE.z + (dz / d) * min;
  }
  return { x: cx, z: cz };
}
