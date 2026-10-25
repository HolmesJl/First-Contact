import { inRange, positionForInteract } from '../../shared/opening';
import {
  APPROACH_DISTANCE_KM,
  HELM_INTERACT_ID,
  distanceNeedsTransit,
  formatDistanceKm,
  motionForMode,
  normalizeNavigation,
  parseDistanceKm,
  syncNavigationMotion,
  warpDurationMs,
  type ShipNavigation,
  type WarpMode,
} from '../../shared/navigation';
import { shipScanResults } from './scanning';
import type { MemberRecord, ShipRecord } from './store';

export function shipNavigation(ship: ShipRecord): ShipNavigation {
  ship.navigation = normalizeNavigation(ship.navigation);
  return ship.navigation!;
}

export function navigationMeta(ship: ShipRecord) {
  return shipNavigation(ship);
}

function isCaptain(member: MemberRecord): boolean {
  return member.character?.job === 'Captain';
}

function helmRange(member: MemberRecord, x: number, z: number): { ok: true } | { ok: false; message: string } {
  if (!member.character) return { ok: false, message: 'You need a character to use the helm.' };
  if (!isCaptain(member)) return { ok: false, message: 'Only the Captain can command the helm.' };
  const pos = positionForInteract(HELM_INTERACT_ID);
  if (!pos || !inRange(x, z, pos.x, pos.z)) return { ok: false, message: 'Move closer to the helm console.' };
  return { ok: true };
}

export type HelmStartResult = { ok: true; endsAt: number } | { ok: false; message: string };
export type HelmResumeResult = { ok: true } | { ok: false; message: string };
export type HelmCruiseModeResult = { ok: true } | { ok: false; message: string };

export function applyHelmResume(ship: ShipRecord, member: MemberRecord, x: number, z: number): HelmResumeResult {
  const gate = helmRange(member, x, z);
  if (!gate.ok) return gate;
  const nav = shipNavigation(ship);
  if (nav.transit) return { ok: false, message: 'Finish or wait out the current divert first.' };
  nav.firstContactCourse = true;
  nav.cruiseMode = 'warp';
  syncNavigationMotion(nav);
  return { ok: true };
}

export function applyHelmCruiseMode(
  ship: ShipRecord,
  member: MemberRecord,
  mode: WarpMode,
  x: number,
  z: number,
): HelmCruiseModeResult {
  const gate = helmRange(member, x, z);
  if (!gate.ok) return gate;
  const nav = shipNavigation(ship);
  if (!nav.firstContactCourse || nav.transit) {
    return { ok: false, message: 'Cruise speed only changes while on the First Contact heading.' };
  }
  nav.cruiseMode = mode;
  syncNavigationMotion(nav);
  return { ok: true };
}

export function applyHelmStart(
  ship: ShipRecord,
  member: MemberRecord,
  scanId: string,
  mode: WarpMode,
  x: number,
  z: number,
): HelmStartResult {
  const gate = helmRange(member, x, z);
  if (!gate.ok) return gate;
  const nav = shipNavigation(ship);
  if (nav.transit) return { ok: false, message: 'A transit is already in progress.' };
  const entry = shipScanResults(ship).find((r) => r.id === scanId);
  if (!entry) return { ok: false, message: 'Unknown destination.' };
  if (!distanceNeedsTransit(entry.distanceLabel)) {
    return { ok: false, message: 'That contact is already within approach range (<20 km).' };
  }
  const km = parseDistanceKm(entry.distanceLabel);
  if (km === null) return { ok: false, message: 'Invalid distance on that contact.' };
  const now = Date.now();
  const duration = warpDurationMs(km, mode);
  nav.firstContactCourse = false;
  nav.transit = { scanId, mode, startedAt: now, endsAt: now + duration };
  syncNavigationMotion(nav);
  return { ok: true, endsAt: nav.transit.endsAt };
}

export interface TransitCompleteRow {
  scanId: string;
  notice: string;
}

export function finishDueTransits(ship: ShipRecord, now = Date.now()): TransitCompleteRow[] {
  const nav = shipNavigation(ship);
  if (!nav.transit || now < nav.transit.endsAt) return [];
  const { scanId } = nav.transit;
  nav.transit = null;
  nav.firstContactCourse = false;
  syncNavigationMotion(nav);
  const results = shipScanResults(ship);
  const entry = results.find((r) => r.id === scanId);
  if (entry) entry.distanceLabel = formatDistanceKm(APPROACH_DISTANCE_KM - 0.001);
  return [{ scanId, notice: 'Arrived on approach — holding at 20 km. Resume heading to First Contact when ready.' }];
}
