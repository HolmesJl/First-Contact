import {
  JOB_STATION_INTERACT,
  JOB_STATION_KIND,
  SHIP_DISPLAY_NAME,
  TRANSIT_YEARS,
  inRange,
  initialQuestStep,
  positionForInteract,
  questStepCompleteNotice,
  type QuestStep,
} from '../../shared/opening';
import { SPAWNS, STATIONS } from '../../shared/shipInterior';
import { spawnFor } from '../../shared/lab';
import type { Character, Job } from '../../shared/protocol';
import type { MemberRecord, ShipRecord } from './store';

export function shipMeta(ship: ShipRecord) {
  normalizeShip(ship);
  return {
    gameStarted: ship.gameStarted!,
    gameStartedAt: ship.gameStartedAt ?? null,
    shipName: ship.shipName!,
    transitYears: ship.transitYears!,
  };
}

export function normalizeMember(m: MemberRecord): MemberRecord {
  m.isClone ??= false;
  m.hasPad ??= false;
  m.reportedIn ??= false;
  m.questStep ??= 'wake';
  m.cloneTank ??= null;
  return m;
}

export function normalizeShip(ship: ShipRecord): ShipRecord {
  ship.gameStarted ??= false;
  ship.gameStartedAt ??= null;
  ship.shipName ??= SHIP_DISPLAY_NAME;
  ship.transitYears ??= TRANSIT_YEARS;
  for (const m of Object.values(ship.members)) normalizeMember(m);
  return ship;
}

export function assignCloneTank(ship: ShipRecord, member: MemberRecord) {
  const used = new Set(
    Object.values(ship.members)
      .filter((m) => m.cloneTank !== null)
      .map((m) => m.cloneTank!),
  );
  let tank = 0;
  while (used.has(tank) && tank < 4) tank++;
  member.cloneTank = tank < 4 ? tank : 0;
}

export function spawnAfterCreate(member: MemberRecord) {
  if (member.isClone && member.cloneTank !== null) {
    const sp = SPAWNS.find((s) => s.kind === 'tank' && s.id === `tank-${member.cloneTank! + 1}`);
    if (sp) return { x: sp.x, z: sp.z, rot: sp.rot };
  }
  return spawnFor(member.tube);
}

export function startGame(ship: ShipRecord): boolean {
  if (ship.gameStarted) return false;
  ship.gameStarted = true;
  ship.gameStartedAt = Date.now();
  return true;
}

function stationKindForInteract(id: string): string | null {
  if (id === 'captain-desk' || id === 'bunk-desk-pad') return null;
  const s = STATIONS.find((x) => x.id === id);
  return s?.kind ?? null;
}

function padInteractId(job: Job) {
  return job === 'Captain' ? 'captain-desk' : 'bunk-desk-pad';
}

function wrongOrderHint(member: MemberRecord, interactId: string): string | null {
  const job = member.character!.job;
  const step = member.questStep!;

  if (interactId === padInteractId(job)) {
    if (step !== 'pick-pad') return 'You do not need that pad right now.';
    return null;
  }

  const kind = stationKindForInteract(interactId);
  if (!kind) return null;

  if (step === 'clone-doctor' && kind === 'lab-bench') return null;

  if (step === 'pick-pad') {
    return job === 'Captain'
      ? "Pick up your data pad from the Captain's cabin desk first."
      : 'Pick up your data pad from the desk in the bunk room first.';
  }

  if (step === 'job-station' && kind === JOB_STATION_KIND[job]) {
    if (!member.hasPad) return 'You need your data pad first — get it from the bunk room desk.';
    return null;
  }

  if (job === 'Captain' && step === 'captain-helm' && kind === 'star-map') return null;

  if (step === 'report' || step === 'done') return 'You already finished this station check-in.';
  if (step === 'captain-comms') return 'Log in at the helm first, or use your data pad for comms.';

  return 'Complete your current objective first.';
}

export type InteractResult =
  | { ok: true; openPad?: boolean; notice?: string; quest?: QuestStep; nextHint?: string }
  | { ok: false; message: string };

export function applyInteract(ship: ShipRecord, member: MemberRecord, interactId: string): InteractResult {
  const pos = positionForInteract(interactId);
  if (!pos) return { ok: false, message: 'Nothing to interact with.' };
  if (!inRange(member.x, member.z, pos.x, pos.z)) return { ok: false, message: 'Move closer.' };
  if (!member.character) return { ok: false, message: 'Finish creating your clone first.' };

  const job = member.character.job;
  const isClone = !!member.isClone;
  const hint = wrongOrderHint(member, interactId);
  if (hint) return { ok: false, message: hint };

  if (interactId === 'captain-desk' || interactId === 'bunk-desk-pad') {
    if (member.questStep !== 'pick-pad') return { ok: false, message: hint ?? 'Not yet.' };
    if (interactId !== padInteractId(job)) return { ok: false, message: 'That pad is not for you.' };
    member.hasPad = true;
    const next = job === 'Captain' ? 'captain-helm' : 'job-station';
    const prev = member.questStep!;
    member.questStep = next;
    return {
      ok: true,
      openPad: true,
      notice: 'Data pad added to your communicator slot.',
      quest: next,
      nextHint: questStepCompleteNotice(prev, job, isClone) ?? undefined,
    };
  }

  const kind = stationKindForInteract(interactId);
  if (!kind) return { ok: false, message: 'Nothing happens yet.' };

  if (isClone && member.questStep === 'clone-doctor' && kind === 'lab-bench') {
    const prev = member.questStep;
    member.questStep = 'pick-pad';
    return {
      ok: true,
      quest: 'pick-pad',
      notice: `${member.character.firstName} ${member.character.lastName} checked in with Medical.`,
      nextHint: questStepCompleteNotice(prev, job, isClone) ?? undefined,
    };
  }

  if (job === 'Captain' && member.questStep === 'captain-helm' && kind === 'star-map') {
    const prev = member.questStep;
    member.questStep = 'captain-comms';
    return {
      ok: true,
      quest: 'captain-comms',
      notice: 'Captain logged in at the helm.',
      nextHint: questStepCompleteNotice(prev, job, isClone) ?? undefined,
    };
  }

  if (job !== 'Captain' && member.questStep === 'job-station' && interactId === JOB_STATION_INTERACT[job]) {
    if (!member.hasPad) return { ok: false, message: 'You need your data pad first — get it from the bunk room desk.' };
    const prev = member.questStep;
    member.questStep = 'report';
    return { ok: true, quest: 'report', nextHint: questStepCompleteNotice(prev, job, isClone) ?? undefined };
  }

  return { ok: false, message: hint ?? 'Nothing happens yet.' };
}

function otherCrew(ship: ShipRecord, captainId: string) {
  return Object.values(ship.members).filter((x) => x.character && x.id !== captainId);
}

export function applyReportIn(ship: ShipRecord, member: MemberRecord): InteractResult {
  if (!member.character) return { ok: false, message: 'No character.' };
  if (!member.hasPad) return { ok: false, message: 'You need your data pad.' };

  const job = member.character.job;
  const isClone = !!member.isClone;

  if (job === 'Captain' && member.questStep === 'captain-comms') {
    const others = otherCrew(ship, member.id);
    const reported = others.filter((x) => x.reportedIn);
    if (reported.length < 1) {
      return { ok: false, message: 'Nobody has reported in yet. Wait for your crew to wake and report.' };
    }
    member.questStep = 'done';
    const partial = reported.length < others.length;
    const notice = partial
      ? 'Comms channel open. Resuming the voyage with partial crew.'
      : 'Comms channel open. All awake crew have reported in.';
    return { ok: true, quest: member.questStep, notice };
  }

  if (member.questStep !== 'report') return { ok: false, message: 'Report in when your pad says to.' };
  member.reportedIn = true;
  member.questStep = 'done';
  const notice = `${job} ${member.character.firstName} ${member.character.lastName} reported in.`;
  maybeCompleteCaptain(ship);
  const nextHint = questStepCompleteNotice('report', job, isClone);
  return { ok: true, quest: member.questStep, notice, nextHint: nextHint ?? undefined };
}

export function maybeCompleteCaptain(ship: ShipRecord): MemberRecord | null {
  for (const m of Object.values(ship.members)) {
    if (!m.character || m.character.job !== 'Captain') continue;
    if (m.questStep !== 'captain-comms') continue;
    const others = otherCrew(ship, m.id);
    if (others.length >= 1 && others.every((x) => x.reportedIn)) {
      m.questStep = 'done';
      return m;
    }
  }
  return null;
}

export function onCharacterCreated(member: MemberRecord, character: Character) {
  member.questStep = initialQuestStep(!!member.isClone, character.job);
}
