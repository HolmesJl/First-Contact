import type { Job } from './protocol';

export const REFINE_DURATION_MS = 5000;
export const ENGINEER_POSITIVES_FOR_LEVEL = 100;
export const MAX_ENGINEER_LEVEL = 5;

export interface EngineerSkill {
  level: number;
  positiveRefines: number;
}

export const defaultEngineerSkill = (): EngineerSkill => ({ level: 1, positiveRefines: 0 });

export function normalizeEngineerSkill(raw: unknown): EngineerSkill {
  const d = defaultEngineerSkill();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  let level = typeof o.level === 'number' && Number.isInteger(o.level) ? o.level : d.level;
  let positiveRefines =
    typeof o.positiveRefines === 'number' && Number.isInteger(o.positiveRefines) ? o.positiveRefines : d.positiveRefines;
  level = Math.min(MAX_ENGINEER_LEVEL, Math.max(1, level));
  positiveRefines = Math.min(ENGINEER_POSITIVES_FOR_LEVEL - 1, Math.max(0, positiveRefines));
  return { level, positiveRefines };
}

export function engineerSuccessChance(level: number): number {
  const lv = Math.min(MAX_ENGINEER_LEVEL, Math.max(1, level));
  return lv / MAX_ENGINEER_LEVEL;
}

export function engineerSucceeded(level: number, roll: number): boolean {
  return roll < engineerSuccessChance(level);
}

export interface EngineerProgressResult {
  skill: EngineerSkill;
  leveledUp: boolean;
}

export function applyPositiveRefine(skill: EngineerSkill): EngineerProgressResult {
  const s = normalizeEngineerSkill(skill);
  if (s.level >= MAX_ENGINEER_LEVEL) return { skill: s, leveledUp: false };
  let positiveRefines = s.positiveRefines + 1;
  let level = s.level;
  let leveledUp = false;
  if (positiveRefines >= ENGINEER_POSITIVES_FOR_LEVEL) {
    level = Math.min(MAX_ENGINEER_LEVEL, level + 1);
    positiveRefines = 0;
    leveledUp = true;
  }
  return { skill: { level, positiveRefines }, leveledUp };
}

/** Captain, Engineer, and Engineer-job clones may run the Refinery at level 1. */
export function canOperateRefinery(job: Job): boolean {
  return job === 'Captain' || job === 'Engineer';
}

export const REFINERY_SKILL_DENIED = 'You do not have the skills to run the refinery.';
export const REFINERY_SKILL_MISS_MESSAGE = 'Refine failed — skill check missed. Try again.';

export type RefineMode = 'one' | 'all';

export const MACRO_MINERAL_IDS = ['phosphorus', 'sulfur', 'chloride', 'sodium'] as const;
export type MacroMineralId = (typeof MACRO_MINERAL_IDS)[number];

const ARMORY_MACROS = new Set<string>(['phosphorus', 'sulfur']);
const MEDICAL_MACROS = new Set<string>(['chloride', 'sodium']);

export function macroDestination(macroId: string): 'armory' | 'medical' | null {
  if (ARMORY_MACROS.has(macroId)) return 'armory';
  if (MEDICAL_MACROS.has(macroId)) return 'medical';
  return null;
}

/** v1: even weights across the four macros when rolling which macro drops. */
export function pickMacroMineral(roll: number): MacroMineralId {
  const idx = Math.floor(roll * MACRO_MINERAL_IDS.length) % MACRO_MINERAL_IDS.length;
  return MACRO_MINERAL_IDS[idx];
}
