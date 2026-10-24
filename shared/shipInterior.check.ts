/** Layout sanity check: `npm run check:layout`. Overlaps, blocked doors and ports, unreachable stations. */
import {
  CABIN_DOOR_SLIDE_M,
  cabinDoorCenter,
  cabinDoorExtraObstacles,
  cabinDoorLaneTestPoint,
  cabinDoorObstacle,
  cabinDoorSlideBasis,
  cabinKeypadInInteractPosition,
  cabinKeypadInProp,
  cabinKeypadInteractPosition,
} from './cabinDoor';
import { JOG_SPEED, SPRINT_SPEED } from './movement';
import { SHIP_LAYOUT } from './shipLayout';
import { INTERACT_RADIUS, REPORT_IN_INTERACT_ID, interactIdForProp, interactPrompt, positionForInteract } from './opening';
import type { Job } from './protocol';
import { MEMORY_STATIONS, homeSpawnFor } from './bunks';
import { QUEST_TERMINALS } from './shipInterior';
import { CLOSETS, MATERIALS_PAD_INTERACT_ID, STARTING_STOCK, STOCK_PANELS, WORLD_FILES } from './items';
import { SCAVENGER_FILE_NAME, SCAVENGER_TASKS } from './scavenger';
import { BRIDGE_SCAN_INTERACT_ID, BRIDGE_SCAN_PROP_ID, SCAN_STATIONS } from './scanning';
import {
  BERTHS,
  CABIN_KEYPAD,
  PROPS,
  SPACE_NAMES,
  SPAWNS,
  STATIONS,
  areaFor,
  clampMoveToShip,
  clampToShip,
  deskPadPlacementProblem,
  deskSurfaceY,
  isWalkable,
  portClearZone,
  spaceAt,
  thresholdRect,
  usesDeskPadMount,
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
  if (!isWalkable(t.stand.x, t.stand.z)) fail(`quest terminal ${t.interactId} stand (${t.stand.x.toFixed(2)}, ${t.stand.z.toFixed(2)}) not walkable`);
  const prop = PROPS.find((p) => p.id === t.propId);
  if (!prop) {
    fail(`quest terminal ${t.interactId} missing prop ${t.propId}`);
    continue;
  }
  const padDist = Math.hypot(t.stand.x - t.x, t.stand.z - t.z);
  if (padDist > INTERACT_RADIUS)
    fail(`quest terminal ${t.interactId} pad is ${padDist.toFixed(2)}m from its stand (max ${INTERACT_RADIUS}m)`);
  const deskErr = deskPadPlacementProblem(prop, { x: t.x, y: t.y, z: t.z }, t.stand, `quest terminal ${t.interactId}`, t.face);
  if (deskErr && usesDeskPadMount(prop)) fail(deskErr);
}

// Crew report-in terminal: on the Bridge, reachable, its stand point derived from the comms console (not the Captain's
// star map), and not sharing a spot with the helm terminal.
{
  const t = QUEST_TERMINALS.find((q) => q.interactId === REPORT_IN_INTERACT_ID);
  const stand = positionForInteract(REPORT_IN_INTERACT_ID);
  if (!t || !stand) fail(`report-in terminal ${REPORT_IN_INTERACT_ID} is not a quest terminal`);
  else {
    const prop = PROPS.find((p) => p.id === t.propId)!;
    if (prop.room !== 'bridge') fail(`report-in terminal prop ${t.propId} is in ${prop.room}, not the bridge`);
    if (t.propId === 'star-map' || prop.job === 'captain') fail(`report-in terminal uses the Captain-only prop ${t.propId}`);
    if (spaceAt(stand.x, stand.z)?.id !== 'bridge') fail(`report-in stand (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}) is not on the bridge`);
    if (!isWalkable(stand.x, stand.z)) fail('report-in stand is not walkable');
    if (!reachable(stand.x, stand.z, 0.3)) fail('report-in stand unreachable from pod 1');
    const b = bounds(prop);
    const gap = Math.hypot(stand.x - Math.min(b.maxX, Math.max(b.minX, stand.x)), stand.z - Math.min(b.maxZ, Math.max(b.minZ, stand.z)));
    if (gap > 1.0) fail(`report-in stand is ${gap.toFixed(2)}m from the ${t.propId} footprint (max 1.0m)`);
    if (Math.hypot(stand.x - prop.x, stand.z - prop.z) > INTERACT_RADIUS) fail('report-in stand out of interact range of its console');
    const helm = positionForInteract('star-map')!;
    if (Math.hypot(stand.x - helm.x, stand.z - helm.z) < 1.0) fail('report-in stand coincides with the helm terminal');
  }
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

// Inside keypad: the mirror of the corridor one on the cabin side of the same door. Its stand point is in the cabin,
// walkable and reachable with the door closed, in interact range of the keypad, and off the panel's closed footprint
// and open pocket; the keypad itself is on the cabin hull next to the door, not in the doorway.
{
  const kin = cabinKeypadInProp();
  const stand = cabinKeypadInInteractPosition();
  const basis = cabinDoorSlideBasis();
  if (spaceAt(stand.x, stand.z)?.id !== 'cabin') fail(`inside keypad stand (${stand.x.toFixed(2)}, ${stand.z.toFixed(2)}) is not in the cabin`);
  if (!isWalkable(stand.x, stand.z, 0, [closedObs])) fail('inside keypad stand not walkable with the door closed');
  if (!reachable(stand.x, stand.z, 0.3)) fail('inside keypad stand unreachable');
  if (stand.x > door.x - 0.3) fail('inside keypad stand is not on the cabin side of the door');
  const standDist = Math.hypot(stand.x - kin.x, stand.z - kin.z);
  if (standDist > 1.2) fail(`inside keypad stand is ${standDist.toFixed(2)}m from the keypad (max 1.2m)`);
  if (standDist > INTERACT_RADIUS) fail('inside keypad stand out of interact range');
  if (kin.x >= door.x) fail('inside keypad is not on the cabin side of the door plane');
  if (Math.abs(kin.z - CABIN_KEYPAD.z) > 0.2) fail('inside keypad is not at the same distance along the wall as the corridor one');
  if (Math.abs(kin.y - CABIN_KEYPAD.y) > 1e-6) fail('inside keypad is not at the corridor keypad height');
  if (Math.abs(kin.z - door.z) < door.width / 2 + 0.15) fail('inside keypad hangs in the doorway');
  if (Math.hypot(kin.x - door.x, kin.z - door.z) > 2.5) fail('inside keypad should be adjacent to the cabin door');
  if (Math.hypot(kin.nx, kin.nz) - 1 > 1e-6) fail('inside keypad hull normal is not unit length');
  // Keep clear of the panel wherever it slides: the pocket runs along the wall tangent from the door plane.
  for (let f = 0; f <= 1; f += 0.1) {
    const o = cabinDoorObstacle(f);
    if (!o || !('rect' in o)) continue;
    if (kin.x > o.minX - 0.05 && kin.x < o.maxX + 0.05 && kin.z > o.minZ - 0.05 && kin.z < o.maxZ + 0.05) fail(`inside keypad collides with the door panel at ${Math.round(f * 100)}% open`);
    if (stand.x > o.minX - 0.3 && stand.x < o.maxX + 0.3 && stand.z > o.minZ - 0.3 && stand.z < o.maxZ + 0.3) fail(`inside keypad stand is in the door panel's way at ${Math.round(f * 100)}% open`);
  }
  const pocketEnd = { x: basis.x + basis.tx * CABIN_DOOR_SLIDE_M * basis.slideSign, z: basis.z + basis.tz * CABIN_DOOR_SLIDE_M * basis.slideSign };
  if (Math.abs(pocketEnd.x - kin.x) < 0.1 && Math.abs(pocketEnd.z - kin.z) < basis.width / 2) fail('inside keypad sits in the panel pocket');
  // Two different interact points: the server range-checks against the one in use.
  if (Math.hypot(stand.x - kp.x, stand.z - kp.z) < 0.5) fail('inside and corridor keypad stands coincide');
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

// Login spawns for saved characters: the Captain in the cabin (door closed), crew at each bunk or the bunk-room spot.
const homeCases: [Job, number | null][] = [
  ['Captain', null],
  ['Captain', 0],
  ['Engineer', null],
  ['Doctor', 0],
  ...BERTHS.filter((b) => b.index > 0).map((b): [Job, number] => ['Botanist', b.index]),
];
for (const [job, berth] of homeCases) {
  const s = homeSpawnFor(job, berth);
  const room = spaceAt(s.x, s.z)?.id;
  const want = job === 'Captain' ? 'cabin' : 'bunks';
  if (room !== want) fail(`home spawn for ${job} berth ${berth} is in ${room}, not ${want}`);
  if (!isWalkable(s.x, s.z, 0, cabinDoorExtraObstacles(0))) fail(`home spawn for ${job} berth ${berth} is not walkable`);
  if (!reachable(s.x, s.z, 0.3)) fail(`home spawn for ${job} berth ${berth} is cut off from the ship`);
}

// Item stations (shared/items.ts): every stock panel, closet handle and world File has a walkable, reachable stand
// point in interact range, in the room it claims; panels and Files sit on (not inside) their props, the wall-mounted
// materials pad hangs on the Cargo Hold's wall, and the scavenger hunt's task targets all resolve.
{
  const inside = (b: ReturnType<typeof bounds>, x: number, z: number, m = 0.01) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  const roomOf = (name: string) => Object.entries(SPACE_NAMES).find(([, n]) => n === name)?.[0] ?? name;
  const checkStand = (what: string, s: { stand: { x: number; z: number }; x: number; z: number; room: string }) => {
    if (!isWalkable(s.stand.x, s.stand.z)) fail(`${what} stand (${s.stand.x.toFixed(2)}, ${s.stand.z.toFixed(2)}) not walkable`);
    if (!reachable(s.stand.x, s.stand.z, 0.3)) fail(`${what} stand unreachable from pod 1`);
    const d = Math.hypot(s.stand.x - s.x, s.stand.z - s.z);
    if (d > INTERACT_RADIUS) fail(`${what} is ${d.toFixed(2)}m from its stand point (max ${INTERACT_RADIUS}m)`);
    if (d > 1.6) fail(`${what} stand is ${d.toFixed(2)}m away; the player should stand beside it`);
    const room = spaceAt(s.stand.x, s.stand.z)?.id;
    if (room !== roomOf(s.room)) fail(`${what} stand is in ${room}, not ${roomOf(s.room)}`);
  };
  for (const p of STOCK_PANELS) {
    checkStand(`stock panel ${p.interactId}`, p);
    if (p.propId) {
      const prop = PROPS.find((x) => x.id === p.propId);
      if (!prop) fail(`stock panel ${p.interactId} missing prop ${p.propId}`);
      else {
        if (inside(bounds(prop), p.x, p.z)) fail(`stock panel ${p.interactId} is inside ${prop.id}`);
        const deskErr = deskPadPlacementProblem(prop, p, p.stand, `stock panel ${p.interactId}`, p.face);
        if (deskErr) fail(deskErr);
      }
    } else {
      const room = SHIP_LAYOUT.modules.flatMap((m) => m.rooms).find((r) => r.id === roomOf(p.room));
      if (!room) fail(`wall panel ${p.interactId} names unknown room ${p.room}`);
      else {
        const o = room.outer;
        const toWall = Math.min(Math.abs(p.x - o.minX), Math.abs(p.x - o.maxX), Math.abs(p.z - o.minZ), Math.abs(p.z - o.maxZ));
        if (toWall > 0.3) fail(`wall panel ${p.interactId} is ${toWall.toFixed(2)}m from the nearest wall of ${room.id}`);
        if (p.x < o.minX || p.x > o.maxX || p.z < o.minZ || p.z > o.maxZ) fail(`wall panel ${p.interactId} is outside ${room.id}`);
      }
      for (const s of solids) if (inside(bounds(s), p.x, p.z, -0.3)) fail(`wall panel ${p.interactId} collides with ${s.id}`);
    }
    for (const s of solids) if (s.id !== p.propId && inside(bounds(s), p.stand.x, p.stand.z, -0.05)) fail(`stock panel ${p.interactId} stand is in ${s.id}`);
  }
  if (!STOCK_PANELS.some((p) => p.interactId === MATERIALS_PAD_INTERACT_ID && p.kind === 'materials' && roomOf(p.room) === 'hold')) fail('materials data pad is not a wall panel in the Cargo Hold');
  const panelIds = new Set(STOCK_PANELS.map((p) => p.interactId));
  if (panelIds.size !== STOCK_PANELS.length) fail('duplicate stock panel ids');

  if (CLOSETS.length !== BERTHS.length) fail(`expected ${BERTHS.length} closets, got ${CLOSETS.length}`);
  for (const c of CLOSETS) {
    checkStand(`closet ${c.interactId}`, c);
    const prop = PROPS.find((x) => x.id === c.propId);
    if (!prop) fail(`closet ${c.interactId} missing prop ${c.propId}`);
    else if (prop.kind !== 'closet') fail(`closet ${c.interactId} is on a ${prop.kind}, not a closet`);
    for (const o of CLOSETS) {
      if (o === c) continue;
      if (Math.hypot(o.x - c.x, o.z - c.z) < 0.3 && Math.abs(o.y - c.y) < 0.3) fail(`closet handles ${c.interactId} / ${o.interactId} overlap`);
    }
  }

  const fileNames = new Set<string>();
  for (const f of WORLD_FILES) {
    checkStand(`file ${f.interactId}`, f);
    const prop = PROPS.find((x) => x.id === f.propId);
    if (!prop) {
      fail(`file ${f.interactId} missing prop ${f.propId}`);
      continue;
    }
    const b = bounds(prop);
    if (!(f.x >= b.minX && f.x <= b.maxX && f.z >= b.minZ && f.z <= b.maxZ)) fail(`file ${f.interactId} is not on top of ${prop.id}`);
    const topY = deskSurfaceY(prop);
    if (Math.abs(f.y - topY) > 0.06) fail(`file ${f.interactId} is ${(f.y - topY).toFixed(2)}m off the ${prop.id} desktop`);
    if (usesDeskPadMount(prop) || prop.kind === 'table') {
      const deskErr = deskPadPlacementProblem(
        prop,
        { x: f.x, y: f.y, z: f.z },
        f.stand,
        `file ${f.interactId}`,
        f.face,
        { requireOperatorRight: false },
      );
      if (deskErr) fail(deskErr);
    }
    if (fileNames.has(f.name)) fail(`two world Files share the name “${f.name}”`);
    fileNames.add(f.name);
    if (f.text.length < 20) fail(`file ${f.interactId} has no real text`);
  }
  if (!WORLD_FILES.some((f) => f.name === SCAVENGER_FILE_NAME && roomOf(f.room) === 'science')) fail(`the scavenger hunt File “${SCAVENGER_FILE_NAME}” is not on a Science Lab desk`);

  for (const t of SCAVENGER_TASKS) {
    const pos = positionForInteract(t.interactId);
    if (!pos) fail(`scavenger task ${t.id} points at unknown interactable ${t.interactId}`);
    else if (!isWalkable(pos.x, pos.z)) fail(`scavenger task ${t.id} stand point is not walkable`);
  }
  if (STARTING_STOCK.fruit !== 25) fail(`eatery starts with ${STARTING_STOCK.fruit} Fruit; items.md says 25`);
  if (STARTING_STOCK['lite-body-armor'] !== 6) fail(`shelves start with ${STARTING_STOCK['lite-body-armor']} armor; the quest says 6`);
}

// Bridge scan station (shared/scanning.ts): stand point on scan-1 console, walkable and in interact range.
{
  const prop = PROPS.find((p) => p.id === BRIDGE_SCAN_PROP_ID);
  if (!prop) fail(`bridge scan station missing prop ${BRIDGE_SCAN_PROP_ID}`);
  else if (prop.room !== 'bridge') fail(`bridge scan prop ${BRIDGE_SCAN_PROP_ID} is in ${prop.room}`);
  if (SCAN_STATIONS.length !== 1) fail(`expected one scan station in v1, got ${SCAN_STATIONS.length}`);
  if (interactIdForProp(BRIDGE_SCAN_INTERACT_ID) !== BRIDGE_SCAN_INTERACT_ID) fail('bridge-scan interact id not recognized by interactIdForProp');
  if (interactIdForProp(BRIDGE_SCAN_PROP_ID) !== BRIDGE_SCAN_INTERACT_ID) fail('scan-1 prop id must map to bridge-scan');
  if (interactPrompt(BRIDGE_SCAN_INTERACT_ID) !== 'Sensor scan') fail('scan station hover prompt missing');
  const stand = positionForInteract(BRIDGE_SCAN_INTERACT_ID);
  if (!stand) fail('bridge-scan has no interact position');
  for (const s of SCAN_STATIONS) {
    if (!isWalkable(s.stand.x, s.stand.z)) fail(`scan station ${s.interactId} stand not walkable`);
    if (!reachable(s.stand.x, s.stand.z, 0.3)) fail(`scan station ${s.interactId} stand unreachable`);
    const dist = Math.hypot(s.stand.x - s.x, s.stand.z - s.z);
    if (dist > INTERACT_RADIUS) fail(`scan station ${s.interactId} is ${dist.toFixed(2)}m from its panel (max ${INTERACT_RADIUS}m)`);
    if (spaceAt(s.stand.x, s.stand.z)?.id !== 'bridge') fail(`scan station ${s.interactId} stand is not on the bridge`);
    const p = PROPS.find((x) => x.id === s.propId);
    if (!p) fail(`scan station ${s.interactId} missing prop ${s.propId}`);
    else {
      const deskErr = deskPadPlacementProblem(p, s, s.stand, `scan station ${s.interactId}`, s.face);
      if (deskErr) fail(deskErr);
    }
  }
}

console.log(`${area.shapes.length} walk shapes, ${area.obstacles.length} obstacles, ${PROPS.length} props, ${STATIONS.length} stations, ${STOCK_PANELS.length} stock panels, ${CLOSETS.length} closets, ${WORLD_FILES.length} files, ${seen.size} reachable cells`);
if (problems.length) {
  throw new Error(`layout problems:\n${problems.join('\n')}`);
}
console.log('layout ok');
