/** Layout sanity check: `npm run check:layout`. Overlaps, blocked doors and ports, unreachable stations. */
import { SHIP_LAYOUT } from './shipLayout';
import { INTERACT_RADIUS, QUEST_TERMINALS } from './opening';
import { BERTHS, PROPS, SPAWNS, STATIONS, areaFor, clampToShip, isWalkable, portClearZone, thresholdRect, visiblePorts, type Prop } from './shipInterior';

const problems: string[] = [];
const fail = (m: string) => problems.push(m);

const bounds = (p: Prop) => ({ minX: p.x - p.sx / 2, maxX: p.x + p.sx / 2, minZ: p.z - p.sz / 2, maxZ: p.z + p.sz / 2 });
const overlap = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>, gap = 0) =>
  a.minX < b.maxX - gap && a.maxX > b.minX + gap && a.minZ < b.maxZ - gap && a.maxZ > b.minZ + gap;

const solids = PROPS.filter((p) => p.solid !== false);
for (let i = 0; i < solids.length; i++)
  for (let j = i + 1; j < solids.length; j++) {
    const a = solids[i];
    const b = solids[j];
    if (a.room === b.room && overlap(bounds(a), bounds(b), 0.02) && !(a.y || b.y)) fail(`overlap: ${a.id} / ${b.id}`);
  }

for (const d of SHIP_LAYOUT.doors) {
  const t = thresholdRect(d);
  if (!t) continue;
  const lane = d.axis === 'x' ? { minX: t.minX, maxX: t.maxX, minZ: d.z - 2.6, maxZ: d.z + 2.6 } : { minX: d.x - 2.6, maxX: d.x + 2.6, minZ: t.minZ, maxZ: t.maxZ };
  for (const p of solids) if (overlap(bounds(p), lane)) fail(`prop ${p.id} blocks door lane ${d.id}`);
}
for (const dock of visiblePorts()) {
  const z = portClearZone(dock);
  for (const p of solids) if (overlap(bounds(p), z)) fail(`prop ${p.id} blocks port ${dock.id}`);
}

for (const s of SPAWNS) if (!isWalkable(s.x, s.z)) fail(`spawn ${s.id} is not walkable`);
for (const b of BERTHS) if (!isWalkable(b.x, b.z)) fail(`berth ${b.index} spot is not walkable`);

const STEP = 0.2;
const area = areaFor(0);
const key = (ix: number, iz: number) => `${ix},${iz}`;
const seen = new Set<string>();
const start = SPAWNS[0];
const queue: [number, number][] = [[Math.round(start.x / STEP), Math.round(start.z / STEP)]];
seen.add(key(...queue[0]));
while (queue.length) {
  const [ix, iz] = queue.pop()!;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = ix + dx;
    const nz = iz + dz;
    const k = key(nx, nz);
    if (seen.has(k)) continue;
    const x = nx * STEP;
    const z = nz * STEP;
    if (!isWalkable(x, z)) continue;
    seen.add(k);
    queue.push([nx, nz]);
  }
}
const reachable = (x: number, z: number, r: number) => {
  for (let ix = Math.floor((x - r) / STEP); ix <= Math.ceil((x + r) / STEP); ix++)
    for (let iz = Math.floor((z - r) / STEP); iz <= Math.ceil((z + r) / STEP); iz++)
      if (seen.has(key(ix, iz)) && Math.hypot(ix * STEP - x, iz * STEP - z) <= r) return true;
  return false;
};
for (const s of STATIONS) if (!reachable(s.x, s.z, s.radius)) fail(`station ${s.id} unreachable`);
for (const s of SPAWNS) if (!reachable(s.x, s.z, 0.3)) fail(`spawn ${s.id} unreachable from pod 1`);
for (const b of BERTHS) if (!reachable(b.x, b.z, 0.3)) fail(`berth ${b.index} unreachable`);
for (const d of SHIP_LAYOUT.doors) if (!d.sealed && d.level === 0 && !reachable(d.x, d.z, 0.5)) fail(`door ${d.id} unreachable`);

const p = clampToShip(-9.4, 3.5);
if (!isWalkable(p.x, p.z)) fail('clamp returned an unwalkable point');

for (const t of QUEST_TERMINALS) {
  if (!isWalkable(t.x, t.z)) fail(`quest terminal ${t.interactId} at (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) not walkable`);
  const station = STATIONS.find((s) => s.id === t.propId);
  if (!station) {
    fail(`quest terminal ${t.interactId} has no station prop ${t.propId}`);
    continue;
  }
  const dist = Math.hypot(t.x - station.x, t.z - station.z);
  if (dist > INTERACT_RADIUS)
    fail(`quest terminal ${t.interactId} is ${dist.toFixed(2)}m from ${t.propId} (max ${INTERACT_RADIUS}m)`);
}

console.log(`${area.shapes.length} walk shapes, ${area.obstacles.length} obstacles, ${PROPS.length} props, ${STATIONS.length} stations, ${seen.size} reachable cells`);
if (problems.length) {
  throw new Error(`layout problems:\n${problems.join('\n')}`);
}
console.log('layout ok');
