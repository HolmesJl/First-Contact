/** Layout sanity check: `npm run check:layout`. Overlaps, blocked doors and ports, unreachable stations. */
import { cabinDoorCenter, cabinDoorExtraObstacles, cabinDoorLaneTestPoint, cabinDoorObstacle, cabinKeypadInteractPosition } from './cabinDoor';
import { JOG_SPEED, SPRINT_SPEED } from './movement';
import { SHIP_LAYOUT } from './shipLayout';
import { INTERACT_RADIUS } from './opening';
import { MEMORY_STATIONS } from './bunks';
import { QUEST_TERMINALS } from './shipInterior';
import {
  BERTHS,
  CABIN_KEYPAD,
  PROPS,
  SPAWNS,
  STATIONS,
  areaFor,
  clampMoveToShip,
  clampToShip,
  isWalkable,
  portClearZone,
  thresholdRect,
  visiblePorts,
  type Prop,
} from './shipInterior';

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
  const prop = PROPS.find((p) => p.id === t.propId);
  if (!prop) {
    fail(`quest terminal ${t.interactId} missing prop ${t.propId}`);
    continue;
  }
  const dist = Math.hypot(t.x - prop.x, t.z - prop.z);
  if (dist > INTERACT_RADIUS)
    fail(`quest terminal ${t.interactId} is ${dist.toFixed(2)}m from ${t.propId} (max ${INTERACT_RADIUS}m)`);
}

// Memory upload stations: one per berth, pad inside interact range of a walkable, reachable stand point, and no two
// pads so close that the click boxes overlap.
if (MEMORY_STATIONS.length !== BERTHS.length) fail(`expected ${BERTHS.length} memory stations, got ${MEMORY_STATIONS.length}`);
for (const s of MEMORY_STATIONS) {
  if (!isWalkable(s.stand.x, s.stand.z)) fail(`memory station ${s.interactId} stand (${s.stand.x.toFixed(2)}, ${s.stand.z.toFixed(2)}) not walkable`);
  if (!reachable(s.stand.x, s.stand.z, 0.3)) fail(`memory station ${s.interactId} stand unreachable`);
  const dist = Math.hypot(s.stand.x - s.x, s.stand.z - s.z);
  if (dist > INTERACT_RADIUS) fail(`memory station ${s.interactId} pad is ${dist.toFixed(2)}m from its stand point (max ${INTERACT_RADIUS}m)`);
  const prop = PROPS.find((p) => p.id === s.propId);
  if (!prop) fail(`memory station ${s.interactId} missing prop ${s.propId}`);
  else {
    const b = bounds(prop);
    const inside = s.x > b.minX + 0.01 && s.x < b.maxX - 0.01 && s.z > b.minZ + 0.01 && s.z < b.maxZ - 0.01;
    if (inside) fail(`memory station ${s.interactId} pad is inside ${prop.id}`);
  }
  for (const o of MEMORY_STATIONS) {
    if (o === s) continue;
    if (Math.hypot(o.x - s.x, o.z - s.z) < 0.5 && Math.abs(o.y - s.y) < 0.5) fail(`memory stations ${s.interactId} / ${o.interactId} overlap`);
  }
}

const closedObs = cabinDoorObstacle(0)!;
const lane = cabinDoorLaneTestPoint();
if (isWalkable(lane.x, lane.z, 0, [closedObs])) {
  fail('closed cabin door does not block the doorway');
}
const openLane = clampToShip(lane.x, lane.z, 0, [closedObs]);
if (Math.hypot(openLane.x - lane.x, openLane.z - lane.z) < 0.08) {
  fail('closed cabin door obstacle does not push players out of the lane');
}
const kp = cabinKeypadInteractPosition();
const door = cabinDoorCenter();
if (!isWalkable(kp.x, kp.z, 0, [closedObs])) fail(`cabin keypad stand (${kp.x.toFixed(2)}, ${kp.z.toFixed(2)}) not walkable with the door closed`);
if (kp.x < door.x + 0.3) fail('cabin keypad stand is not on the corridor side of the door');
if (Math.hypot(kp.x - CABIN_KEYPAD.x, kp.z - CABIN_KEYPAD.z) > 1.2) {
  fail('cabin keypad interact point too far from keypad prop');
}
if (Math.hypot(kp.x - door.x, kp.z - door.z) > 2.5) {
  fail('cabin keypad should be adjacent to the cabin door');
}

// The closed panel is a thin plate across the doorway: thin along the hull normal (+x), spanning the lane along z.
if (!('rect' in closedObs)) fail('cabin door obstacle should be a rect');
else {
  if (closedObs.maxX - closedObs.minX > 0.3) fail('cabin door obstacle is thick along x (wrong axis?)');
  if (closedObs.maxZ - closedObs.minZ < door.width) fail('cabin door obstacle does not span the doorway along z');
  if (Math.abs((closedObs.minX + closedObs.maxX) / 2 - door.x) > 0.05) fail('cabin door obstacle is off the door plane');
}

// Movement through the doorway: a swept step from either side stops on its own side while closed, and a sequence of
// 15 Hz steps (as an unclamped or hacked client reports them) never gets through, even at the largest step the server
// grants. Both end points are walkable floor so only the panel can stop the move.
const corridorSide = { x: door.x + 0.6, z: door.z };
const cabinSide = { x: door.x - 0.6, z: door.z };
if (!isWalkable(corridorSide.x, corridorSide.z) || !isWalkable(cabinSide.x, cabinSide.z)) fail('cabin doorway sample points are not walkable');
for (const [from, to, name] of [
  [corridorSide, cabinSide, 'corridor to cabin'],
  [cabinSide, corridorSide, 'cabin to corridor'],
] as const) {
  const side = Math.sign(from.x - door.x);
  const single = clampMoveToShip(from.x, from.z, to.x, to.z, 0, [closedObs]);
  if ((single.x - door.x) * side < 0.3) fail(`closed cabin door: one swept step ${name} crossed the panel (x=${single.x.toFixed(3)})`);
  for (const perMsg of [JOG_SPEED / 15, SPRINT_SPEED * 0.4]) {
    let x = door.x + side * 1.2;
    for (let i = 1; i <= 24; i++) {
      const claim = door.x + side * 1.2 - side * i * perMsg;
      x = clampMoveToShip(x, door.z, claim, door.z, 0, [closedObs]).x;
    }
    if ((x - door.x) * side < 0.3) fail(`closed cabin door: ${perMsg.toFixed(2)} m steps ${name} tunnelled through (x=${x.toFixed(3)})`);
    if (!isWalkable(x, door.z, 0, [closedObs])) fail(`closed cabin door: blocked player left on unwalkable floor (${name})`);
  }
}
// Sliding along the closed panel is still allowed (the player is not frozen against it).
const slide = clampMoveToShip(door.x + 0.42, door.z, door.x + 0.2, door.z + 0.4, 0, [closedObs]);
if (slide.z - door.z < 0.3) fail('closed cabin door: player cannot slide along the panel');

// Open: no obstacle at all, so the doorway is fully passable and nothing phantom-blocks the lane.
if (cabinDoorObstacle(1) !== null) fail('open cabin door leaves an obstacle in the doorway');
const openObs = cabinDoorExtraObstacles(1);
if (!isWalkable(lane.x, lane.z, 0, openObs)) fail('open cabin door: lane point is not walkable');
for (const [from, to] of [
  [corridorSide, cabinSide],
  [cabinSide, corridorSide],
] as const) {
  const p = clampMoveToShip(from.x, from.z, to.x, to.z, 0, openObs);
  if (Math.hypot(p.x - to.x, p.z - to.z) > 1e-6) fail(`open cabin door blocks the doorway (${p.x.toFixed(3)}, ${p.z.toFixed(3)})`);
}
// Nearly open (the client's eased panel): the lane centre is clear.
if (!isWalkable(lane.x, lane.z, 0, cabinDoorExtraObstacles(0.9))) fail('cabin door at 90% open still blocks the lane centre');
// Mid-slide the panel sits in the +z half of the doorway and the -z half is open, so the obstacle tracks the slide.
const half = cabinDoorObstacle(0.5)!;
if (!('rect' in half) || half.minZ < door.z - 0.2) fail('cabin door obstacle does not slide along +z with the panel');

// After the auto-close the panel is back at fraction 0: same footprint, blocks again.
if (JSON.stringify(cabinDoorObstacle(0)) !== JSON.stringify(closedObs)) fail('re-closed cabin door obstacle differs from the closed one');
const reclosed = clampMoveToShip(corridorSide.x, corridorSide.z, cabinSide.x, cabinSide.z, 0, cabinDoorExtraObstacles(0));
if (reclosed.x - door.x < 0.3) fail('re-closed cabin door does not block the doorway');

console.log(`${area.shapes.length} walk shapes, ${area.obstacles.length} obstacles, ${PROPS.length} props, ${STATIONS.length} stations, ${seen.size} reachable cells`);
if (problems.length) {
  throw new Error(`layout problems:\n${problems.join('\n')}`);
}
console.log('layout ok');
