/**
 * Cabin door server cycle check: `npm run check:door`. The door blocks while closed, opens on a correct code, lets a
 * swept move through while open, auto-closes after the idle timeout and blocks again.
 */
import { CABIN_DOOR_IDLE_CLOSE_MS, CABIN_DOOR_OPEN_MS, cabinDoorCenter } from '../../shared/cabinDoor';
import { clampMoveToShip } from '../../shared/shipInterior';
import { cabinDoorObstaclesForShip, cabinDoorPublic, openCabinDoor, tickCabinDoors } from './cabinDoor';
import type { ShipRecord } from './store';

const problems: string[] = [];
const fail = (m: string) => problems.push(m);

const ship: ShipRecord = { code: 'CHECK', hostId: 'host', createdAt: 0, members: {}, cabinDoorCode: '1234', cabinDoorOpen: false };
const door = cabinDoorCenter();
const corridor = { x: door.x + 0.6, z: door.z };
const cabin = { x: door.x - 0.6, z: door.z };
const crossing = (now: number) => clampMoveToShip(corridor.x, corridor.z, cabin.x, cabin.z, 0, cabinDoorObstaclesForShip(ship, now));

let now = 1_000_000;
if (crossing(now).x - door.x < 0.3) fail('closed door: server clamp let a move through the doorway');
if (cabinDoorPublic(ship, now).open) fail('door reports open before any code was entered');

openCabinDoor(ship, now);
const opening = cabinDoorPublic(ship, now);
if (!opening.open) fail('door does not report open after openCabinDoor');
if (opening.openFrac !== 0) fail('door openFrac should start at 0 when it begins opening (clients animate toward `open`)');
if (crossing(now).x - door.x < 0.3) fail('door at the start of its open animation let a move through');

now += CABIN_DOOR_OPEN_MS + 50;
if (cabinDoorObstaclesForShip(ship, now).length !== 0) fail('fully open door still has an obstacle');
const through = crossing(now);
if (Math.hypot(through.x - cabin.x, through.z - cabin.z) > 1e-6) fail('open door blocks the doorway on the server');
if (tickCabinDoors(ship, now)) fail('door auto-closed before the idle timeout');

now = 1_000_000 + CABIN_DOOR_IDLE_CLOSE_MS + 1;
if (!tickCabinDoors(ship, now)) fail('door did not auto-close after the idle timeout');
if (cabinDoorPublic(ship, now).open) fail('door reports open after auto-close');
if (cabinDoorObstaclesForShip(ship, now + CABIN_DOOR_OPEN_MS / 4).length !== 1) fail('closing door has no obstacle once the panel is moving');

now += CABIN_DOOR_OPEN_MS + 50;
if (cabinDoorPublic(ship, now).openFrac !== 0) fail('door not fully closed after the close animation');
if (crossing(now).x - door.x < 0.3) fail('re-closed door let a move through the doorway');

if (problems.length) throw new Error(`cabin door problems:\n${problems.join('\n')}`);
console.log('cabin door ok');
