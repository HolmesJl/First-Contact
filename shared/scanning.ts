import { PROPS, SPACE_NAMES, standPointOnFace } from './shipInterior';
import type { Facing } from './shipLayout';

export const SCAN_DURATION_MS = 5000;
export const SCAN_POSITIVES_FOR_LEVEL = 100;
export const MAX_SCAN_LEVEL = 5;

export const BRIDGE_SCAN_INTERACT_ID = 'bridge-scan';
export const BRIDGE_SCAN_PROP_ID = 'scan-1';

export const SCAN_FIND_TYPES = ['debris field', 'mineral signature', 'unknown contact'] as const;
export type ScanFindType = (typeof SCAN_FIND_TYPES)[number];

export const SCAN_DISTANCE_LABELS = ['nearby', '0.4 AU out', '1.2 AU out', 'deep range'] as const;

export interface ScanningSkill {
  level: number;
  positiveScans: number;
}

export interface ScanResultEntry {
  id: string;
  type: ScanFindType;
  distanceLabel: string;
  foundAt: number;
  foundBy: string;
}

export interface ScanStation {
  interactId: string;
  propId: string;
  room: string;
  x: number;
  y: number;
  z: number;
  face: Facing;
  stand: { x: number; z: number };
}

function placeBridgeScanStation(): ScanStation {
  const prop = PROPS.find((p) => p.id === BRIDGE_SCAN_PROP_ID);
  if (!prop) throw new Error(`scan station: missing prop ${BRIDGE_SCAN_PROP_ID}`);
  const face = prop.face ?? 'S';
  const f = { N: { dx: 0, dz: -1 }, S: { dx: 0, dz: 1 }, E: { dx: 1, dz: 0 }, W: { dx: -1, dz: 0 } }[face];
  const half = Math.abs(f.dx) > 0 ? prop.sx / 2 : prop.sz / 2;
  const stand = standPointOnFace(prop, 0.22);
  return {
    interactId: BRIDGE_SCAN_INTERACT_ID,
    propId: prop.id,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x: prop.x + f.dx * (half + 0.04),
    y: (prop.y ?? 0) + prop.h + 0.3,
    z: prop.z + f.dz * (half + 0.04),
    face,
    stand: { x: stand.x, z: stand.z },
  };
}

export const SCAN_STATIONS: readonly ScanStation[] = [placeBridgeScanStation()];
export const scanStationById = (id: string) => SCAN_STATIONS.find((s) => s.interactId === id);
export const isScanStationId = (id: string) => scanStationById(id) !== undefined;

export const defaultScanningSkill = (): ScanningSkill => ({ level: 1, positiveScans: 0 });

export function normalizeScanningSkill(raw: unknown): ScanningSkill {
  const d = defaultScanningSkill();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  let level = typeof o.level === 'number' && Number.isInteger(o.level) ? o.level : d.level;
  let positiveScans = typeof o.positiveScans === 'number' && Number.isInteger(o.positiveScans) ? o.positiveScans : d.positiveScans;
  level = Math.min(MAX_SCAN_LEVEL, Math.max(1, level));
  positiveScans = Math.min(SCAN_POSITIVES_FOR_LEVEL - 1, Math.max(0, positiveScans));
  return { level, positiveScans };
}

export function normalizeScanResults(raw: unknown): ScanResultEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScanResultEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const type = r.type;
    if (typeof r.id !== 'string' || !SCAN_FIND_TYPES.includes(type as ScanFindType)) continue;
    if (typeof r.distanceLabel !== 'string' || typeof r.foundAt !== 'number' || typeof r.foundBy !== 'string') continue;
    out.push({
      id: r.id,
      type: type as ScanFindType,
      distanceLabel: r.distanceLabel,
      foundAt: r.foundAt,
      foundBy: r.foundBy,
    });
  }
  return out.slice(-30);
}

/** Success chance for a scan at the given level (1..5). */
export function scanSuccessChance(level: number): number {
  const lv = Math.min(MAX_SCAN_LEVEL, Math.max(1, level));
  return lv / MAX_SCAN_LEVEL;
}

/** `roll` is in [0, 1). */
export function scanSucceeded(level: number, roll: number): boolean {
  return roll < scanSuccessChance(level);
}

export interface ScanProgressResult {
  skill: ScanningSkill;
  leveledUp: boolean;
}

/** Apply one successful find toward the next level (100 positives → +1 level, cap 5). */
export function applyPositiveScan(skill: ScanningSkill): ScanProgressResult {
  const s = normalizeScanningSkill(skill);
  if (s.level >= MAX_SCAN_LEVEL) return { skill: s, leveledUp: false };
  let positiveScans = s.positiveScans + 1;
  let level = s.level;
  let leveledUp = false;
  if (positiveScans >= SCAN_POSITIVES_FOR_LEVEL) {
    level = Math.min(MAX_SCAN_LEVEL, level + 1);
    positiveScans = 0;
    leveledUp = true;
  }
  return { skill: { level, positiveScans }, leveledUp };
}

export function nextScanFindType(previous: ScanFindType | null): ScanFindType {
  if (!previous) return SCAN_FIND_TYPES[0];
  const i = SCAN_FIND_TYPES.indexOf(previous);
  return SCAN_FIND_TYPES[(i + 1) % SCAN_FIND_TYPES.length];
}

export function pickScanDistanceLabel(roll: number): string {
  const i = Math.min(SCAN_DISTANCE_LABELS.length - 1, Math.floor(roll * SCAN_DISTANCE_LABELS.length));
  return SCAN_DISTANCE_LABELS[i];
}
