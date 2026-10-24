import { inRange } from '../../shared/opening';
import {
  BRIDGE_SCAN_INTERACT_ID,
  SCAN_DURATION_MS,
  SCAN_STATIONS,
  applyPositiveScan,
  nextScanFindType,
  normalizeScanResults,
  normalizeScanningSkill,
  pickScanDistanceLabel,
  scanStationById,
  scanSucceeded,
  type ScanResultEntry,
  type ScanningSkill,
} from '../../shared/scanning';
import type { MemberRecord, ShipRecord } from './store';

const activeScans = new Map<string, { shipCode: string; endsAt: number }>();

const scanKey = (shipCode: string, memberId: string) => `${shipCode}:${memberId}`;

function scanRoll(): number {
  const forced = process.env.SCAN_FORCE_ROLL;
  if (forced !== undefined && forced !== '') {
    const n = Number(forced);
    if (Number.isFinite(n)) return Math.min(0.999999, Math.max(0, n));
  }
  return Math.random();
}

export function memberScanningSkill(m: MemberRecord): ScanningSkill {
  normalizeMemberSkills(m);
  return m.skills!.scanning!;
}

function normalizeMemberSkills(m: MemberRecord) {
  m.skills ??= { scanning: normalizeScanningSkill(null) };
  m.skills.scanning = normalizeScanningSkill(m.skills.scanning);
}

export function normalizeShipScanResults(ship: ShipRecord) {
  ship.scanResults = normalizeScanResults(ship.scanResults);
}

export function shipScanResults(ship: ShipRecord): ScanResultEntry[] {
  normalizeShipScanResults(ship);
  return ship.scanResults!;
}

export function isScanInProgress(shipCode: string, memberId: string): boolean {
  const row = activeScans.get(scanKey(shipCode, memberId));
  return !!row && row.endsAt > Date.now();
}

export type ScanStartResult =
  | { ok: true; endsAt: number }
  | { ok: false; message: string };

export function applyScanStart(ship: ShipRecord, member: MemberRecord, x: number, z: number): ScanStartResult {
  if (!member.character) return { ok: false, message: 'You need a character to scan.' };
  const station = scanStationById(BRIDGE_SCAN_INTERACT_ID);
  if (!station) return { ok: false, message: 'Scan station unavailable.' };
  if (!inRange(x, z, station.stand.x, station.stand.z)) return { ok: false, message: 'Move closer to the scan console.' };
  const key = scanKey(ship.code, member.id);
  if (isScanInProgress(ship.code, member.id)) return { ok: false, message: 'A scan is already in progress.' };
  const endsAt = Date.now() + SCAN_DURATION_MS;
  activeScans.set(key, { shipCode: ship.code, endsAt });
  return { ok: true, endsAt };
}

export interface ScanCompletePayload {
  memberId: string;
  hit: boolean;
  find: ScanResultEntry | null;
  skill: ScanningSkill;
  leveledUp: boolean;
}

/** Finish due scans for a ship; caller should persist and notify players. */
export function finishDueScans(ship: ShipRecord, now = Date.now()): ScanCompletePayload[] {
  const out: ScanCompletePayload[] = [];
  for (const [key, row] of activeScans) {
    if (row.shipCode !== ship.code || row.endsAt > now) continue;
    activeScans.delete(key);
    const memberId = key.slice(ship.code.length + 1);
    const member = ship.members[memberId];
    if (!member?.character) continue;
    out.push(completeScanForMember(ship, member, now));
  }
  return out;
}

function completeScanForMember(ship: ShipRecord, member: MemberRecord, now: number): ScanCompletePayload {
  normalizeMemberSkills(member);
  const skillBefore = member.skills!.scanning!;
  const roll = scanRoll();
  const hit = scanSucceeded(skillBefore.level, roll);
  let skill = skillBefore;
  let leveledUp = false;
  let find: ScanResultEntry | null = null;
  if (hit) {
    const prog = applyPositiveScan(skillBefore);
    skill = prog.skill;
    leveledUp = prog.leveledUp;
    member.skills!.scanning = skill;
    const prev = ship.scanResults?.length ? ship.scanResults[ship.scanResults.length - 1] : null;
    find = {
      id: crypto.randomUUID(),
      type: nextScanFindType(prev?.type ?? null),
      distanceLabel: pickScanDistanceLabel(scanRoll()),
      foundAt: now,
      foundBy: `${member.character!.firstName} ${member.character!.lastName}`,
    };
    normalizeShipScanResults(ship);
    ship.scanResults = [...(ship.scanResults ?? []), find].slice(-30);
  }
  return { memberId: member.id, hit, find, skill, leveledUp };
}

export function cancelScan(shipCode: string, memberId: string) {
  activeScans.delete(scanKey(shipCode, memberId));
}

/** For layout checks: stand points of every scan station. */
export function scanStationStandPoints() {
  return SCAN_STATIONS.map((s) => ({ interactId: s.interactId, propId: s.propId, stand: s.stand, room: s.room }));
}
