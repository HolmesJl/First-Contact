/** Hibernation and cloning bay (the old clone lab). It is the origin of the ship frame; see shipInterior.ts for the rest. */
export const TUBE_COUNT = 6;
export const TUBE_X = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
export const TUBE_Z = -4.7;
export const TUBE_Y = 1.2;

export const LAB = { minX: -9.3, maxX: 9.3, minZ: -3.6, maxZ: 6.3 };
export const PLAYER_RADIUS = 0.35;

export function spawnFor(tube: number) {
  const x = TUBE_X[tube] ?? 0;
  return { x: x + 0.9, z: -3.1, rot: 0 };
}
