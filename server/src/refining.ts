import { stockPanelById, UNREFINED_TO_REFINED } from '../../shared/items';
import { inRange } from '../../shared/opening';
import {
  REFINE_DURATION_MS,
  REFINERY_SKILL_DENIED,
  REFINERY_SKILL_MISS_MESSAGE,
  applyPositiveRefine,
  canOperateRefinery,
  engineerSucceeded,
  macroDestination,
  normalizeEngineerSkill,
  pickMacroMineral,
  type EngineerSkill,
  type RefineMode,
} from '../../shared/refining';
import { splitLegacyRefineryStock, type RefineryStocks } from '../../shared/transporter';
import type { MemberRecord, ShipRecord } from './store';

interface ActiveRefine {
  shipCode: string;
  endsAt: number;
  materialId: string;
  mode: RefineMode;
  /** Waiting for skill resolution at endsAt (roll happens when timer completes). */
  awaitingRoll: boolean;
}

const activeRefines = new Map<string, ActiveRefine>();

const refineKey = (shipCode: string, memberId: string) => `${shipCode}:${memberId}`;

function refineDurationMs(): number {
  if (process.env.REFINE_DURATION_MS !== undefined && process.env.REFINE_DURATION_MS !== '') {
    return Math.max(50, Number(process.env.REFINE_DURATION_MS) || REFINE_DURATION_MS);
  }
  return REFINE_DURATION_MS;
}

function refineRoll(): number {
  const forced = process.env.REFINE_FORCE_ROLL;
  if (forced !== undefined && forced !== '') {
    const n = Number(forced);
    if (Number.isFinite(n)) return Math.min(0.999999, Math.max(0, n));
  }
  return Math.random();
}

function macroRoll(): number {
  return Math.random();
}

export function memberEngineerSkill(m: MemberRecord): EngineerSkill {
  m.skills ??= { scanning: undefined, transporter: undefined, engineer: normalizeEngineerSkill(null) };
  m.skills.engineer = normalizeEngineerSkill(m.skills.engineer);
  return m.skills.engineer!;
}

export function getRefineryStocks(ship: ShipRecord): RefineryStocks {
  if (ship.refineryUnrefined !== undefined || ship.refineryRefined !== undefined) {
    const split = splitLegacyRefineryStock(ship.refineryUnrefined ?? {}, ship.refineryRefined ?? {});
    ship.refineryUnrefined = split.unrefined;
    ship.refineryRefined = split.refined;
  } else {
    const split = splitLegacyRefineryStock(ship.refineryStock ?? {}, {});
    ship.refineryUnrefined = split.unrefined;
    ship.refineryRefined = split.refined;
    delete ship.refineryStock;
  }
  return { unrefined: ship.refineryUnrefined!, refined: ship.refineryRefined! };
}

export function normalizeShipRefinery(ship: ShipRecord) {
  getRefineryStocks(ship);
  ship.armoryStock ??= {};
  ship.medicalStock ??= {};
}

export function isRefineInProgress(shipCode: string, memberId: string): boolean {
  const row = activeRefines.get(refineKey(shipCode, memberId));
  return !!row && row.endsAt > Date.now();
}

export type RefineStartResult = { ok: true; endsAt: number } | { ok: false; message: string; denied?: boolean };

export function applyRefineStart(
  ship: ShipRecord,
  member: MemberRecord,
  materialId: string,
  mode: RefineMode,
  x: number,
  z: number,
): RefineStartResult {
  if (!member.character) return { ok: false, message: 'You need a character to refine materials.' };
  const panel = stockPanelById('refinery-panel');
  if (!panel || !inRange(x, z, panel.stand.x, panel.stand.z)) return { ok: false, message: 'Move closer to the refinery panel.' };
  if (!canOperateRefinery(member.character.job)) return { ok: false, message: REFINERY_SKILL_DENIED, denied: true };
  if (isRefineInProgress(ship.code, member.id)) return { ok: false, message: 'A refine job is already in progress.' };

  normalizeShipRefinery(ship);
  const have = ship.refineryUnrefined![materialId] ?? 0;
  if (have <= 0) return { ok: false, message: 'Nothing left to refine of that type.' };

  const endsAt = Date.now() + refineDurationMs();
  activeRefines.set(refineKey(ship.code, member.id), {
    shipCode: ship.code,
    endsAt,
    materialId,
    mode,
    awaitingRoll: true,
  });
  return { ok: true, endsAt };
}

export function cancelRefine(shipCode: string, memberId: string) {
  activeRefines.delete(refineKey(shipCode, memberId));
}

export interface RefineCompletePayload {
  memberId: string;
  hit: boolean;
  skill: EngineerSkill;
  leveledUp: boolean;
  refineryUnrefined: Record<string, number>;
  refineryRefined: Record<string, number>;
  armoryStock: Record<string, number>;
  medicalStock: Record<string, number>;
  message?: string;
  /** Server started the next unit in refine-all mode. */
  continued?: boolean;
  endsAt?: number;
}

function applyMineralsRefine(ship: ShipRecord): string[] {
  const notes: string[] = [];
  ship.refineryRefined!.trace_minerals = (ship.refineryRefined!.trace_minerals ?? 0) + 1;
  notes.push('Trace Minerals');
  const r1 = macroRoll();
  if (r1 < 0.65) {
    const m1 = pickMacroMineral(macroRoll());
    routeMacro(ship, m1);
    notes.push(m1);
    if (macroRoll() < 0.3) {
      let m2 = pickMacroMineral(macroRoll());
      if (m2 === m1) m2 = pickMacroMineral((macroRoll() + 0.37) % 1);
      routeMacro(ship, m2);
      notes.push(m2);
    }
  }
  return notes;
}

function routeMacro(ship: ShipRecord, macroId: string) {
  const dest = macroDestination(macroId);
  if (dest === 'armory') ship.armoryStock![macroId] = (ship.armoryStock![macroId] ?? 0) + 1;
  else if (dest === 'medical') ship.medicalStock![macroId] = (ship.medicalStock![macroId] ?? 0) + 1;
}

function refineOneUnit(ship: ShipRecord, materialId: string): { ok: boolean; message: string } {
  const unref = ship.refineryUnrefined!;
  const ref = ship.refineryRefined!;
  const have = unref[materialId] ?? 0;
  if (have <= 0) return { ok: false, message: 'Nothing left to refine.' };

  if (materialId === 'minerals') {
    unref[materialId] = have - 1;
    const parts = applyMineralsRefine(ship);
    return { ok: true, message: `Refined Minerals → ${parts.join(', ')}.` };
  }

  if (materialId === 'seeds') {
    return { ok: false, message: 'Plant seeds cannot be refined yet.' };
  }

  const outId = UNREFINED_TO_REFINED[materialId];
  if (!outId) return { ok: false, message: 'Unknown material.' };

  unref[materialId] = have - 1;
  ref[outId] = (ref[outId] ?? 0) + 1;
  return { ok: true, message: `Refined 1 ${materialId} → ${outId}.` };
}

function scheduleNextUnit(ship: ShipRecord, memberId: string, row: ActiveRefine): { continued: boolean; endsAt?: number } {
  if (row.mode !== 'all') return { continued: false };
  const left = ship.refineryUnrefined![row.materialId] ?? 0;
  if (left <= 0) return { continued: false };
  const endsAt = Date.now() + refineDurationMs();
  activeRefines.set(refineKey(ship.code, memberId), { ...row, endsAt, awaitingRoll: true });
  return { continued: true, endsAt };
}

function completeRefineForMember(ship: ShipRecord, member: MemberRecord, row: ActiveRefine): RefineCompletePayload {
  const skillBefore = memberEngineerSkill(member);
  let skill = skillBefore;
  let leveledUp = false;
  normalizeShipRefinery(ship);

  const roll = refineRoll();
  const hit = engineerSucceeded(skillBefore.level, roll);

  if (!hit) {
    const endsAt = Date.now() + refineDurationMs();
    activeRefines.set(refineKey(ship.code, member.id), { ...row, endsAt, awaitingRoll: true });
    return {
      memberId: member.id,
      hit: false,
      skill,
      leveledUp: false,
      refineryUnrefined: ship.refineryUnrefined!,
      refineryRefined: ship.refineryRefined!,
      armoryStock: ship.armoryStock!,
      medicalStock: ship.medicalStock!,
      message: REFINERY_SKILL_MISS_MESSAGE,
      continued: true,
      endsAt,
    };
  }

  const result = refineOneUnit(ship, row.materialId);
  if (result.ok) {
    const prog = applyPositiveRefine(skillBefore);
    skill = prog.skill;
    leveledUp = prog.leveledUp;
    member.skills!.engineer = skill;
  }

  let next: { continued: boolean; endsAt?: number } = { continued: false };
  if (result.ok) next = scheduleNextUnit(ship, member.id, row);

  return {
    memberId: member.id,
    hit: result.ok,
    skill,
    leveledUp,
    refineryUnrefined: ship.refineryUnrefined!,
    refineryRefined: ship.refineryRefined!,
    armoryStock: ship.armoryStock!,
    medicalStock: ship.medicalStock!,
    message: result.message,
    continued: next.continued,
    endsAt: next.endsAt,
  };
}

export function finishDueRefines(ship: ShipRecord, now = Date.now()): RefineCompletePayload[] {
  const out: RefineCompletePayload[] = [];
  for (const [key, row] of activeRefines) {
    if (row.shipCode !== ship.code || row.endsAt > now || !row.awaitingRoll) continue;
    activeRefines.delete(key);
    const memberId = key.slice(ship.code.length + 1);
    const member = ship.members[memberId];
    if (!member?.character) continue;
    const payload = completeRefineForMember(ship, member, row);
    out.push(payload);
    if (payload.continued && payload.endsAt) {
      // Re-insert active job for retry or refine-all continuation (already set in completeRefineForMember)
    }
  }
  return out;
}
