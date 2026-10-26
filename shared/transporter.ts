import {
  LEGACY_UNREFINED_ID,
  migrateUnrefinedMaterialId,
  REFINED_MATERIALS,
  SHIP_MATERIALS,
  UNREFINED_MATERIALS,
  materialName,
} from './items';
import { PROPS, SPACE_NAMES, floorTransporterTerminalMount, labTransporterPillarMount, questTerminalPosition } from './shipInterior';
import type { Facing } from './shipLayout';
import type { Job } from './protocol';
import { SURFACE_ANOMALY_LABEL, scanContactAwayMissionStub, type ScanLootLine, type ScanOutcomeKind, type ScanResultEntry } from './scanning';

export const TRANSPORTER_DURATION_MS = 5000;
export const TRANSPORTER_POSITIVES_FOR_LEVEL = 100;
export const MAX_TRANSPORTER_LEVEL = 5;

/** Total units across all raw materials in the refinery. Tune for balance. */
export const REFINERY_CAPACITY = 100;
/** Total units across all ship materials in the cargo hold. Tune for balance. */
export const CARGO_HOLD_CAPACITY = 100;

export const LAB_TRANSPORTER_INTERACT_ID = 'lab-transporter';
export const CARGO_TRANSPORTER_INTERACT_ID = 'cargo-transporter';
export const LAB_TRANSPORTER_PROP_ID = 'teleporter-pad';
export const CARGO_TRANSPORTER_PROP_ID = 'beam-in-pad';

/** Quest terminal interact id on the Science Lab pad (opening quest); transporter uses {@link LAB_TRANSPORTER_INTERACT_ID}. */
export const LAB_QUEST_TERMINAL_INTERACT_ID = 'teleporter-pad';

export type TransporterPadId = typeof LAB_TRANSPORTER_INTERACT_ID | typeof CARGO_TRANSPORTER_INTERACT_ID;

export interface TransporterSkill {
  level: number;
  positiveBeams: number;
}

export interface TransporterStation {
  interactId: TransporterPadId;
  propId: string;
  room: string;
  x: number;
  y: number;
  z: number;
  face: Facing;
  stand: { x: number; z: number };
  /** World Y rotation when the console does not use {@link face} alone (pillar-mounted lab pad). */
  yaw?: number;
  /** Raw from atmosphere finds, or ship materials from debris. */
  lootKind: 'raw' | 'ship';
  destination: 'refinery' | 'cargoHold';
}

function placePad(propId: string, interactId: TransporterPadId, lootKind: 'raw' | 'ship', destination: 'refinery' | 'cargoHold'): TransporterStation {
  const prop = PROPS.find((p) => p.id === propId);
  if (!prop) throw new Error(`transporter: missing prop ${propId}`);
  if (propId === LAB_TRANSPORTER_PROP_ID) {
    const m = labTransporterPillarMount(prop);
    return {
      interactId,
      propId,
      room: SPACE_NAMES[prop.room] ?? prop.room,
      x: m.x,
      y: m.y,
      z: m.z,
      face: m.face,
      stand: m.stand,
      yaw: m.yaw,
      lootKind,
      destination,
    };
  }
  const { x, z, y, face, stand } =
    prop.kind === 'pad' ? floorTransporterTerminalMount(prop) : questTerminalPosition(propId);
  return {
    interactId,
    propId,
    room: SPACE_NAMES[prop.room] ?? prop.room,
    x,
    y,
    z,
    face,
    stand,
    lootKind,
    destination,
  };
}

export const TRANSPORTER_STATIONS: readonly TransporterStation[] = [
  placePad(LAB_TRANSPORTER_PROP_ID, LAB_TRANSPORTER_INTERACT_ID, 'raw', 'refinery'),
  placePad(CARGO_TRANSPORTER_PROP_ID, CARGO_TRANSPORTER_INTERACT_ID, 'ship', 'cargoHold'),
];

export const transporterStationById = (id: string) => TRANSPORTER_STATIONS.find((s) => s.interactId === id);
export const isTransporterStationId = (id: string) => transporterStationById(id) !== undefined;

export const defaultTransporterSkill = (): TransporterSkill => ({ level: 1, positiveBeams: 0 });

export function normalizeTransporterSkill(raw: unknown): TransporterSkill {
  const d = defaultTransporterSkill();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  let level = typeof o.level === 'number' && Number.isInteger(o.level) ? o.level : d.level;
  let positiveBeams = typeof o.positiveBeams === 'number' && Number.isInteger(o.positiveBeams) ? o.positiveBeams : d.positiveBeams;
  level = Math.min(MAX_TRANSPORTER_LEVEL, Math.max(1, level));
  positiveBeams = Math.min(TRANSPORTER_POSITIVES_FOR_LEVEL - 1, Math.max(0, positiveBeams));
  return { level, positiveBeams };
}

const UNREFINED_IDS = new Set(UNREFINED_MATERIALS.map((m) => m.id));
const REFINED_IDS = new Set(REFINED_MATERIALS.map((m) => m.id));
const SHIP_IDS = new Set(SHIP_MATERIALS.map((m) => m.id));

/** Seed unrefined types (excludes seeds — scan loot only). */
const REFINERY_SEED_UNREFINED = UNREFINED_MATERIALS.filter((m) => m.id !== 'seeds');

/**
 * Starting qty per unrefined type on a new ship. Six types × 14 = 84 total, under {@link REFINERY_CAPACITY} (100).
 */
export const REFINERY_START_PER_RAW = 14;

export function defaultRefineryUnrefinedStock(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of REFINERY_SEED_UNREFINED) out[m.id] = REFINERY_START_PER_RAW;
  return out;
}

export function defaultRefineryRefinedStock(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of REFINED_MATERIALS) out[m.id] = 0;
  return out;
}

/** @deprecated Use {@link defaultRefineryUnrefinedStock}. */
export function defaultRefineryStock(): Record<string, number> {
  return defaultRefineryUnrefinedStock();
}

export function defaultCargoHoldStock(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of SHIP_MATERIALS) out[m.id] = 15;
  return out;
}

export interface RefineryStocks {
  unrefined: Record<string, number>;
  refined: Record<string, number>;
}

export function normalizeRefineryUnrefinedStock(raw: unknown): Record<string, number> {
  const out = defaultRefineryUnrefinedStock();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const qty = Math.max(0, Math.floor(v));
      const id = migrateUnrefinedMaterialId(k);
      if (UNREFINED_IDS.has(id)) out[id] = qty;
      else if (!REFINED_IDS.has(k) && !REFINED_IDS.has(id) && k in LEGACY_UNREFINED_ID) {
        out[id] = qty;
      }
    }
  }
  return out;
}

export function normalizeRefineryRefinedStock(raw: unknown): Record<string, number> {
  const out = defaultRefineryRefinedStock();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (REFINED_IDS.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
    }
  }
  return out;
}

/** Migrate legacy single `refineryStock` blob into unrefined + refined split. */
export function splitLegacyRefineryStock(legacy: unknown, refinedRaw: unknown): RefineryStocks {
  const unrefined = defaultRefineryUnrefinedStock();
  const refined = normalizeRefineryRefinedStock(refinedRaw);
  if (legacy && typeof legacy === 'object') {
    for (const [k, v] of Object.entries(legacy as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const qty = Math.max(0, Math.floor(v));
      const migrated = migrateUnrefinedMaterialId(k);
      if (UNREFINED_IDS.has(migrated)) unrefined[migrated] = qty;
      else if (REFINED_IDS.has(k)) refined[k] = (refined[k] ?? 0) + qty;
      else if (UNREFINED_IDS.has(k)) unrefined[k] = qty;
    }
  }
  return { unrefined, refined };
}

/** @deprecated Use {@link normalizeRefineryUnrefinedStock}. */
export function normalizeRefineryStock(raw: unknown): Record<string, number> {
  return normalizeRefineryUnrefinedStock(raw);
}

export function refineryTotalUnits(unrefined: Record<string, number>, refined: Record<string, number>): number {
  return stockTotal(unrefined) + stockTotal(refined);
}

export function refineryHasRoom(
  unrefined: Record<string, number>,
  refined: Record<string, number>,
  addQty: number,
): boolean {
  return refineryTotalUnits(unrefined, refined) + addQty <= REFINERY_CAPACITY;
}

export function normalizeCargoHoldStock(raw: unknown): Record<string, number> {
  const out = defaultCargoHoldStock();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (SHIP_IDS.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
    }
  }
  return out;
}

export function stockTotal(stock: Record<string, number>): number {
  return Object.values(stock).reduce((sum, n) => sum + n, 0);
}


export function cargoHoldHasRoom(stock: Record<string, number>, addQty: number): boolean {
  return stockTotal(stock) + addQty <= CARGO_HOLD_CAPACITY;
}

export function transporterSuccessChance(level: number): number {
  const lv = Math.min(MAX_TRANSPORTER_LEVEL, Math.max(1, level));
  return lv / MAX_TRANSPORTER_LEVEL;
}

export function transporterSucceeded(level: number, roll: number): boolean {
  return roll < transporterSuccessChance(level);
}

export interface TransporterProgressResult {
  skill: TransporterSkill;
  leveledUp: boolean;
}

export function applyPositiveBeam(skill: TransporterSkill): TransporterProgressResult {
  const s = normalizeTransporterSkill(skill);
  if (s.level >= MAX_TRANSPORTER_LEVEL) return { skill: s, leveledUp: false };
  let positiveBeams = s.positiveBeams + 1;
  let level = s.level;
  let leveledUp = false;
  if (positiveBeams >= TRANSPORTER_POSITIVES_FOR_LEVEL) {
    level = Math.min(MAX_TRANSPORTER_LEVEL, level + 1);
    positiveBeams = 0;
    leveledUp = true;
  }
  return { skill: { level, positiveBeams }, leveledUp };
}

const LAB_ALLOWED_JOBS: readonly Job[] = ['Captain', 'Engineer'];

/** Science Lab transporter Start gate at Transporter level 1. */
export function canStartLabTransporter(job: Job, _isClone: boolean): boolean {
  return LAB_ALLOWED_JOBS.includes(job);
}

export const TRANSPORTER_SKILL_DENIED = 'You do not have the skills to use this transporter.';
/** Player-facing copy when the pre-beam Transporter skill roll fails (lab and cargo). */
export const TRANSPORTER_SKILL_MISS_MESSAGE = 'Beam failed — skill check missed. Try again.';
export const REFINERY_FULL_MESSAGE = 'No room in the refinery';
export const CARGO_HOLD_FULL_MESSAGE = 'No room in the cargo hold';

export function scanOutcomeLabel(outcome: ScanOutcomeKind): string {
  switch (outcome) {
    case 'debris':
      return 'Space debris';
    case 'rings':
      return 'Planet rings';
    case 'atmosphere':
      return 'Planet';
    case 'distress':
      return 'Ship in distress';
    case 'firstContact':
      return 'Possible First Contact';
  }
}

/** Lines the transporter UI can offer for this pad from a scan contact. */
export function beamableLootForPad(
  pad: TransporterStation,
  entry: ScanResultEntry,
): ScanLootLine[] {
  if (scanContactAwayMissionStub(entry) && entry.outcome !== 'atmosphere') return [];
  if (pad.lootKind === 'raw' && entry.outcome !== 'atmosphere') return [];
  if (pad.lootKind === 'ship' && entry.outcome !== 'debris') return [];
  return entry.loot.filter((l) => {
    if (l.remaining <= 0) return false;
    const mid = migrateUnrefinedMaterialId(l.materialId);
    return pad.lootKind === 'raw' ? UNREFINED_IDS.has(mid) : SHIP_IDS.has(l.materialId);
  });
}

export function formatLootSummary(entry: ScanResultEntry): string {
  if (entry.outcome === 'distress' || entry.outcome === 'firstContact') return 'Away mission';
  const parts: string[] = [];
  if (entry.outcome === 'atmosphere' && entry.awayMissionCapable) parts.push(SURFACE_ANOMALY_LABEL);
  const materialParts = entry.loot.map((l) => `${l.remaining} ${materialName(l.materialId)}`);
  if (materialParts.length) parts.push(materialParts.join(' · '));
  if (!parts.length) return 'Nothing left to collect';
  return parts.join(' · ');
}
