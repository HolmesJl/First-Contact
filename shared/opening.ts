import type { Job } from './protocol';
import { CABIN_KEYPAD_INTERACT_ID, cabinKeypadStand, isCabinKeypadId } from './cabinDoor';
import { berthFromMemoryStationId, berthLabel, memoryStationFor, memoryStationId } from './bunks';
import { QUEST_TERMINALS, STATIONS } from './shipInterior';
import { isItemInteractId, itemInteractPosition, itemInteractPrompt } from './items';
import { SCAN_STATIONS, isScanStationId, scanStationById } from './scanning';

export const TRANSIT_YEARS = 60;
export const SHIP_DISPLAY_NAME = 'First Contact';
export const INTERACT_RADIUS = 2.5;

export type QuestStep =
  | 'wake'
  | 'clone-doctor'
  | 'captain-set-code'
  | 'pick-pad'
  | 'upload-memories'
  | 'job-station'
  | 'report'
  | 'captain-helm'
  | 'captain-comms'
  | 'done';

export const JOB_STATION_KIND: Record<Job, string> = {
  Captain: 'star-map',
  Engineer: 'teleporter',
  Military: 'armory',
  Doctor: 'lab-bench',
  Botanist: 'botanist',
};

/** Interact id for each job's duty terminal. */
export const JOB_STATION_INTERACT: Record<Job, string> = {
  Captain: 'star-map',
  Engineer: 'teleporter-pad',
  Military: 'armory',
  Doctor: 'lab-bench',
  Botanist: 'botanist-station',
};

/** Where crew report in to the bridge: the comms console's quest terminal (any job; the star map stays the Captain's). */
export const REPORT_IN_INTERACT_ID = 'bridge-comms';

const STATION_BY_KIND = new Map(STATIONS.map((s) => [s.kind, s]));

export function stationForJob(job: Job) {
  return STATION_BY_KIND.get(JOB_STATION_KIND[job]);
}

export function stationById(id: string) {
  return STATIONS.find((s) => s.id === id);
}

const INTERACT_IDS = new Set<string>(QUEST_TERMINALS.map((t) => t.interactId));

export { QUEST_TERMINALS } from './shipInterior';

export function captainCommsObjective(
  crew: readonly { id: string; character: unknown | null; reportedIn?: boolean }[],
  captainId: string,
): string {
  const others = crew.filter((p) => p.character && p.id !== captainId);
  if (others.length === 0) return 'Establish comms: waiting for crew to wake.';
  const reported = others.filter((p) => p.reportedIn).length;
  return `Establish comms: ${reported}/${others.length} crew reported in.`;
}

export function distance2d(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

export function inRange(px: number, pz: number, x: number, z: number, r = INTERACT_RADIUS) {
  return distance2d(px, pz, x, z) <= r;
}

export function initialQuestStep(isClone: boolean, job: Job | null): QuestStep {
  if (!job) return 'wake';
  if (isClone) return 'clone-doctor';
  if (job === 'Captain') return 'captain-set-code';
  return 'pick-pad';
}

/**
 * The one terminal to light up for a step, or null. The upload step has no single terminal until a berth is claimed;
 * see `uploadObjectiveStationIds` in bunks.ts for the free-berth case.
 */
export function objectiveInteractId(
  step: QuestStep,
  job: Job | null,
  _isClone: boolean,
  berth: number | null = null,
): string | null {
  if (!job) return null;
  switch (step) {
    case 'clone-doctor':
      return 'lab-bench';
    case 'captain-set-code':
      return CABIN_KEYPAD_INTERACT_ID;
    case 'pick-pad':
      return job === 'Captain' ? 'captain-desk' : 'bunk-desk-pad';
    case 'upload-memories':
      return berth === null ? null : memoryStationId(berth);
    case 'job-station':
      return JOB_STATION_INTERACT[job];
    case 'report':
      return REPORT_IN_INTERACT_ID;
    case 'captain-helm':
      return 'star-map';
    default:
      return null;
  }
}

function terminalMeta(interactId: string) {
  return QUEST_TERMINALS.find((t) => t.interactId === interactId);
}

export function questObjective(
  step: QuestStep,
  job: Job | null,
  isClone: boolean,
  hasPad = false,
  berth: number | null = null,
): string {
  if (!job) return step === 'wake' ? 'Wait for the crew to wake the ship.' : '';
  switch (step) {
    case 'wake':
      return 'Wait for the crew to wake the ship.';
    case 'clone-doctor': {
      const t = terminalMeta('lab-bench');
      return `Go to the ${t!.room} and check in at the ${t!.object}.`;
    }
    case 'captain-set-code':
      return "Go to your cabin and set the door code at the keypad.";
    case 'pick-pad': {
      const id = job === 'Captain' ? 'captain-desk' : 'bunk-desk-pad';
      const t = terminalMeta(id)!;
      return `Go to the ${t.room} and pick up your data pad from the ${t.object}.`;
    }
    case 'upload-memories': {
      if (berth !== null) {
        const s = memoryStationFor(berth)!;
        return `Upload your memories at the ${berthLabel(berth)} pad in the ${s.room}.`;
      }
      if (job === 'Captain') return "Upload your memories at the pad on your berth in the Captain's Cabin.";
      const s = memoryStationFor(1)!;
      return `Pick a free bunk in the ${s.room} and upload your memories at its pad. It becomes your bunk.`;
    }
    case 'job-station': {
      if (!hasPad && job !== 'Captain') {
        const t = terminalMeta('bunk-desk-pad')!;
        return `Go to the ${t.room} and pick up your data pad from the ${t.object} first.`;
      }
      const id = JOB_STATION_INTERACT[job];
      const t = terminalMeta(id)!;
      return `Go to the ${t.room} and log in at the ${t.object}.`;
    }
    case 'report': {
      const t = terminalMeta(REPORT_IN_INTERACT_ID)!;
      return `Go to the ${t.room} and report in at the ${t.object}.`;
    }
    case 'captain-helm': {
      const t = terminalMeta('star-map')!;
      return `Go to the ${t.room} and log in at the ${t.object}.`;
    }
    case 'captain-comms':
      return 'Establish comms with your crew (open your data pad).';
    case 'done':
      return 'Go to the Bridge and open your data pad (P) for new orders.';
    default:
      return '';
  }
}

export function interactPrompt(interactId: string): string | null {
  const berth = berthFromMemoryStationId(interactId);
  if (berth !== null) return `Upload memories · ${berthLabel(berth)}`;
  if (isCabinKeypadId(interactId)) return 'Use cabin keypad';
  if (isItemInteractId(interactId)) return itemInteractPrompt(interactId);
  if (isScanStationId(interactId)) return 'Click · Sensor scan';
  switch (interactId) {
    case 'captain-desk':
    case 'bunk-desk-pad':
      return 'Pick up data pad';
    case 'star-map':
      return 'Log in at the helm';
    case REPORT_IN_INTERACT_ID:
      return 'Report in';
    case 'lab-bench':
      return 'Check in with the doctor';
    case 'botanist-station':
      return 'Log in at the Greenhouse station';
    case 'teleporter-pad':
      return 'Log in at the Science Lab station';
    case 'armory':
      return 'Log in at the Operations station';
    default:
      return null;
  }
}

export function interactIdForProp(id: string): string | null {
  if (isScanStationId(id)) return id;
  if (isCabinKeypadId(id)) return id;
  if (berthFromMemoryStationId(id) !== null) return id;
  if (isItemInteractId(id)) return id;
  const scan = SCAN_STATIONS.find((s) => s.propId === id);
  if (scan) return scan.interactId;
  return INTERACT_IDS.has(id) ? id : null;
}

export function positionForInteract(interactId: string): { x: number; z: number } | null {
  if (isCabinKeypadId(interactId)) return cabinKeypadStand(interactId);
  if (isItemInteractId(interactId)) return itemInteractPosition(interactId);
  const scan = scanStationById(interactId);
  if (scan) return scan.stand;
  const berth = berthFromMemoryStationId(interactId);
  if (berth !== null) return memoryStationFor(berth)?.stand ?? null;
  const t = terminalMeta(interactId);
  if (t) return { x: t.x, z: t.z };
  const s = stationById(interactId);
  return s ? { x: s.x, z: s.z } : null;
}

/** Toast after completing a quest step (server + client). */
export function questStepCompleteNotice(step: QuestStep, job: Job, isClone: boolean, berth: number | null = null): string | null {
  const next = nextQuestStep(step, job, isClone);
  if (!next || next === 'done') return 'Opening tasks complete. Go to the Bridge and open your data pad (P) for new orders.';
  return questObjective(next, job, isClone, true, berth);
}

export function nextQuestStep(step: QuestStep, job: Job, isClone: boolean): QuestStep | null {
  switch (step) {
    case 'clone-doctor':
      return 'pick-pad';
    case 'captain-set-code':
      return 'pick-pad';
    case 'pick-pad':
      return 'upload-memories';
    case 'upload-memories':
      return job === 'Captain' ? 'captain-helm' : 'job-station';
    case 'job-station':
      return 'report';
    case 'captain-helm':
      return 'captain-comms';
    case 'report':
      // HOOK: the Captain's follow-up assignments go here. Reporting in at the bridge comms console is where crew
      // receive their next quest; until that exists, reporting in ends the opening.
      return 'done';
    case 'captain-comms':
      return 'done';
    default:
      return null;
  }
}
