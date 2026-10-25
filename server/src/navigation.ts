import { inRange, positionForInteract } from '../../shared/opening';
import {
  APPROACH_DISTANCE_KM,
  HELM_INTERACT_ID,
  distanceNeedsTransit,
  formatDistanceKm,
  motionForMode,
  normalizeNavigation,
  parseDistanceKm,
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

export type HelmStartResult = { ok: true; endsAt: number } | { ok: false; message: string };

export function applyHelmStart(
  ship: ShipRecord,
  member: MemberRecord,
  scanId: string,
  mode: WarpMode,
  x: number,
  z: number,
): HelmStartResult {
  if (!member.character) return { ok: false, message: 'You need a character to use the helm.' };
  if (!isCaptain(member)) return { ok: false, message: 'Only the Captain can start a warp.' };
  const pos = positionForInteract(HELM_INTERACT_ID);
  if (!pos || !inRange(x, z, pos.x, pos.z)) return { ok: false, message: 'Move closer to the helm console.' };
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
  nav.transit = { scanId, mode, startedAt: now, endsAt: now + duration };
  nav.motion = motionForMode(mode);
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
  nav.motion = 'still';
  const results = shipScanResults(ship);
  const entry = results.find((r) => r.id === scanId);
  if (entry) entry.distanceLabel = formatDistanceKm(APPROACH_DISTANCE_KM - 0.001);
  return [{ scanId, notice: 'Arrived on approach — holding at 20 km.' }];
}
