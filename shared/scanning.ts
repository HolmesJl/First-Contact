import {
  APPROACH_DISTANCE_KM,
  KM_PER_LIGHT_YEAR,
  SCAN_DISTANCE_CAP_KM,
  formatDistanceKm,
  parseDistanceKm,
} from './navigation';
import { PROPS, SPACE_NAMES, deskPadMount } from './shipInterior';
import type { Facing } from './shipLayout';
import { migrateUnrefinedMaterialId, SHIP_MATERIALS } from './items';

export const SCAN_DURATION_MS = 5000;
export const SCAN_POSITIVES_FOR_LEVEL = 100;
export const MAX_SCAN_LEVEL = 5;

export const BRIDGE_SCAN_INTERACT_ID = 'bridge-scan';
export const BRIDGE_SCAN_PROP_ID = 'scan-1';

/** Second-roll outcome after a successful sensor find. Relative weights are TBD for balance. */
export const SCAN_OUTCOME_KINDS = ['debris', 'rings', 'atmosphere', 'distress', 'firstContact'] as const;
export type ScanOutcomeKind = (typeof SCAN_OUTCOME_KINDS)[number];

/** Temporary outcome weights (most common → rarest). Jennifer to tune. */
export const SCAN_OUTCOME_WEIGHTS: Record<ScanOutcomeKind, number> = {
  debris: 50,
  rings: 20,
  atmosphere: 18,
  distress: 8,
  firstContact: 4,
};

export interface ScanLootLine {
  materialId: string;
  /** Rolled at find time. */
  qty: number;
  /** Decremented when beamed aboard. */
  remaining: number;
}

export interface ScanResultEntry {
  id: string;
  outcome: ScanOutcomeKind;
  distanceLabel: string;
  foundAt: number;
  foundBy: string;
  loot: ScanLootLine[];
  /** Planet atmosphere: Surface Anomaly (away mission stub). Distress / first contact use outcome instead. */
  awayMissionCapable?: boolean;
  /** Catalog name for Planet (atmosphere) finds; see planet-designations.md. */
  planetDesignation?: string;
}

/** Shown on scan + transporter contact summary when {@link ScanResultEntry.awayMissionCapable} on an atmosphere find. */
export const SURFACE_ANOMALY_LABEL = 'Surface Anomaly - Atmosphere detected, Away Mission possible';

export const LV_427_DESIGNATION = 'LV-427';

/** Common / uncommon planet names from planet-designations.md (LV-427 rolled separately). */
export const PLANET_DESIGNATIONS_COMMON: readonly string[] = [
  'Alpha-Vega',
  'Beta-Centauri IV',
  'Gamma-Orion',
  'Delta-Procyon',
  'Epsilon-Draconis',
  'Kappa-Lyrae',
  'Sigma-Cygni',
  'Tau-Eridani',
  'XO-112',
  'XO-224',
  'XO-318',
  'XO-441',
  'XO-507',
  'XR-88',
  'XR-203',
  'HD-4821',
  'HD-9104',
  'Kepler-119c',
  'Gliese-581d',
  'Ross-128b',
  'Wolf-359c',
  'Terra-Nova',
  'New Caledonia',
  'Port Meridian',
  'Ashfall',
  'Coldharbor',
];

/** Share of Planet finds that assign LV-427; Jennifer TBD (target ~2–5%). */
export const LV_427_PLANET_CHANCE = 0.035;

export interface ScanningSkill {
  level: number;
  positiveScans: number;
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
  const mount = deskPadMount(prop);
  return {
    interactId: BRIDGE_SCAN_INTERACT_ID,
    propId: prop.id,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x: mount.x,
    y: mount.y,
    z: mount.z,
    face: mount.face,
    stand: mount.stand,
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

function normalizeLoot(raw: unknown): ScanLootLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ScanLootLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.materialId !== 'string' || typeof r.qty !== 'number' || typeof r.remaining !== 'number') continue;
    const qty = Math.max(0, Math.floor(r.qty));
    let remaining = Math.max(0, Math.floor(r.remaining));
    if (remaining > qty) remaining = qty;
    if (qty <= 0) continue;
    out.push({ materialId: migrateUnrefinedMaterialId(r.materialId), qty, remaining });
  }
  return out;
}

export function normalizeScanResults(raw: unknown): ScanResultEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScanResultEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const outcome = r.outcome;
    if (typeof r.id !== 'string' || !SCAN_OUTCOME_KINDS.includes(outcome as ScanOutcomeKind)) continue;
    if (typeof r.distanceLabel !== 'string' || typeof r.foundAt !== 'number' || typeof r.foundBy !== 'string') continue;
    const loot = normalizeLoot(r.loot);
    const awayMissionCapable = r.awayMissionCapable === true;
    const planetDesignation =
      outcome === 'atmosphere' && typeof r.planetDesignation === 'string' && r.planetDesignation.trim()
        ? r.planetDesignation.trim()
        : undefined;
    if (outcome === 'distress' || outcome === 'firstContact') {
      out.push({
        id: r.id,
        outcome: outcome as ScanOutcomeKind,
        distanceLabel: r.distanceLabel,
        foundAt: r.foundAt,
        foundBy: r.foundBy,
        loot: [],
      });
      continue;
    }
    out.push({
      id: r.id,
      outcome: outcome as ScanOutcomeKind,
      distanceLabel: r.distanceLabel,
      foundAt: r.foundAt,
      foundBy: r.foundBy,
      loot,
      ...(awayMissionCapable ? { awayMissionCapable: true } : {}),
      ...(planetDesignation ? { planetDesignation } : {}),
    });
  }
  return out.slice(-30);
}

export function shipHasLv427Planet(scanResults: ScanResultEntry[] | undefined): boolean {
  return (scanResults ?? []).some((e) => e.outcome === 'atmosphere' && e.planetDesignation === LV_427_DESIGNATION);
}

/** Pick a planet designation when an atmosphere contact is created. Rolls in [0, 1). */
export function pickPlanetDesignation(
  catalogRoll: number,
  lv427Roll: number,
  existingScanResults: ScanResultEntry[] | undefined,
): string {
  if (lv427Roll < LV_427_PLANET_CHANCE && !shipHasLv427Planet(existingScanResults)) {
    return LV_427_DESIGNATION;
  }
  const i = Math.floor(catalogRoll * PLANET_DESIGNATIONS_COMMON.length) % PLANET_DESIGNATIONS_COMMON.length;
  return PLANET_DESIGNATIONS_COMMON[i];
}

export function isLv427Designation(designation: string): boolean {
  return designation === LV_427_DESIGNATION;
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

const DEBRIS_WEIGHTS: { id: string; w: number }[] = [
  { id: 'paneling', w: 3 },
  { id: 'struts', w: 3 },
  { id: 'conduit', w: 3 },
  { id: 'alloys', w: 1 },
  { id: 'cables', w: 1 },
  { id: 'battery', w: 1 },
];

const ATMOSPHERE_MATERIAL_WEIGHTS: { id: string; w: number }[] = [
  { id: 'lithium_bilge', w: 2 },
  { id: 'plastic_resin', w: 2 },
  { id: 'copper_ore', w: 2 },
  { id: 'iron_ore', w: 2 },
  { id: 'tin_ore', w: 2 },
  { id: 'minerals', w: 2 },
  { id: 'seeds', w: 1 },
];

/** Share of atmosphere loot rolls that surface an anomaly (Jennifer TBD; target ~5–10%). */
const SURFACE_ANOMALY_CHANCE = 0.08;

const RINGS_WEIGHTS: { id: string; w: number }[] = [
  { id: 'hydrogen', w: 2 },
  { id: 'oxygen', w: 2 },
  { id: 'carbon', w: 2 },
  { id: 'nitrogen', w: 2 },
  { id: 'sulfur', w: 1 },
  { id: 'phosphorus', w: 1 },
];

function pickWeighted(table: { id: string; w: number }[], roll: number): string {
  const total = table.reduce((a, r) => a + r.w, 0);
  let x = roll * total;
  for (const row of table) {
    x -= row.w;
    if (x < 0) return row.id;
  }
  return table[table.length - 1].id;
}

function rollQty(roll: number): number {
  return 1 + Math.floor(roll * 5);
}

function rollLootLines(table: { id: string; w: number }[], rollA: number, rollB: number, rollC: number, rollD: number): ScanLootLine[] {
  const typeCount = rollA < 0.35 ? 1 : 2;
  const ids = new Set<string>();
  const lines: ScanLootLine[] = [];
  let r = rollB;
  while (ids.size < typeCount) {
    ids.add(pickWeighted(table, r));
    r = (r * 0.73 + 0.19) % 1;
  }
  let qr = rollC;
  for (const id of ids) {
    const qty = rollQty(qr);
    lines.push({ materialId: id, qty, remaining: qty });
    qr = (qr * 0.61 + 0.27) % 1;
  }
  return lines;
}

/** Pick one of the five outcome kinds. `roll` in [0, 1). */
export function pickScanOutcome(roll: number): ScanOutcomeKind {
  const total = SCAN_OUTCOME_KINDS.reduce((a, k) => a + SCAN_OUTCOME_WEIGHTS[k], 0);
  let x = roll * total;
  for (const kind of SCAN_OUTCOME_KINDS) {
    x -= SCAN_OUTCOME_WEIGHTS[kind];
    if (x < 0) return kind;
  }
  return 'debris';
}

/** Distance label for a new contact; from &lt;20 km up to 5.0 LY (scan cap). */
export function pickScanDistanceLabel(roll: number): string {
  const forced = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCAN_FORCE_DISTANCE;
  if (forced) {
    const km = parseDistanceKm(forced);
    if (km !== null) return formatDistanceKm(km);
  }
  if (roll < 0.08) return `<${APPROACH_DISTANCE_KM} km`;
  if (roll < 0.45) {
    const km = APPROACH_DISTANCE_KM + 1 + Math.floor(((roll - 0.08) / 0.37) * (12_000 - APPROACH_DISTANCE_KM));
    return formatDistanceKm(km);
  }
  const ly = 0.01 + ((roll - 0.45) / 0.55) * (5.0 - 0.01);
  const km = Math.min(SCAN_DISTANCE_CAP_KM, ly * KM_PER_LIGHT_YEAR);
  return formatDistanceKm(km);
}

export interface ScanLootRoll {
  loot: ScanLootLine[];
  awayMissionCapable?: boolean;
}

function rollAtmosphereLoot(rolls: [number, number, number, number, number]): ScanLootRoll {
  const hasAnomaly = rolls[4] < SURFACE_ANOMALY_CHANCE;
  const typeCount = rolls[0] < 0.35 ? 1 : 2;
  const materialSlots = hasAnomaly ? Math.max(0, typeCount - 1) : typeCount;
  if (materialSlots <= 0) {
    return { loot: [], ...(hasAnomaly ? { awayMissionCapable: true } : {}) };
  }
  const loot = rollLootLines(ATMOSPHERE_MATERIAL_WEIGHTS, rolls[0], rolls[1], rolls[2], rolls[3]).slice(0, materialSlots);
  return { loot, ...(hasAnomaly ? { awayMissionCapable: true } : {}) };
}

/** `rolls` are in [0, 1). Atmosphere uses a fifth roll for Surface Anomaly (ignored for other outcomes). */
export function rollScanLoot(
  outcome: ScanOutcomeKind,
  rolls: [number, number, number, number],
  anomalyRoll?: number,
): ScanLootRoll {
  switch (outcome) {
    case 'debris':
      return { loot: rollLootLines(DEBRIS_WEIGHTS, rolls[0], rolls[1], rolls[2], rolls[3]) };
    case 'atmosphere':
      return rollAtmosphereLoot([rolls[0], rolls[1], rolls[2], rolls[3], anomalyRoll ?? 1]);
    case 'rings':
      return { loot: rollLootLines(RINGS_WEIGHTS, rolls[0], rolls[1], rolls[2], rolls[3]) };
    default:
      return { loot: [] };
  }
}

export function scanContactAwayMissionStub(entry: ScanResultEntry): boolean {
  return entry.outcome === 'distress' || entry.outcome === 'firstContact' || (entry.outcome === 'atmosphere' && entry.awayMissionCapable === true);
}

export function scanFindTitle(entry: ScanResultEntry): string {
  switch (entry.outcome) {
    case 'debris':
      return 'Space debris';
    case 'rings':
      return 'Planet rings';
    case 'atmosphere':
      return entry.planetDesignation ? `Planet · ${entry.planetDesignation}` : 'Planet';
    case 'distress':
      return 'Ship in distress';
    case 'firstContact':
      return 'Possible First Contact';
  }
}

/** Primary scan / transporter contact line (type + planet name when known). */
export function scanContactHeadline(entry: ScanResultEntry): string {
  return scanFindTitle(entry);
}

/** Ship material ids used in debris loot (for tests). */
export const DEBRIS_MATERIAL_IDS = SHIP_MATERIALS.map((m) => m.id);
