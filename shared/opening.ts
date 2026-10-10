import type { Job } from './protocol';
import { STATIONS } from './shipInterior';

export const TRANSIT_YEARS = 60;
export const SHIP_DISPLAY_NAME = 'First Contact';
export const INTERACT_RADIUS = 2.5;

export type QuestStep =
  | 'wake'
  | 'clone-doctor'
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

const STATION_BY_KIND = new Map(STATIONS.map((s) => [s.kind, s]));

export function stationForJob(job: Job) {
  return STATION_BY_KIND.get(JOB_STATION_KIND[job]);
}

export function stationById(id: string) {
  return STATIONS.find((s) => s.id === id);
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
  if (job === 'Captain') return 'captain-helm';
  return 'job-station';
}

export function questObjective(step: QuestStep, job: Job | null, isClone: boolean): string {
  switch (step) {
    case 'wake':
      return 'Wait for the crew to wake the ship.';
    case 'clone-doctor':
      return 'Visit the Doctor at the medical lab.';
    case 'job-station':
      if (!job) return 'Report to your duty station.';
      if (job === 'Captain') return 'Log in at the helm on the bridge.';
      return `Go to your ${job} station.`;
    case 'report':
      return 'Open your data pad and report in to the bridge.';
    case 'captain-helm':
      return 'Log in at the helm on the bridge.';
    case 'captain-comms':
      return 'Establish communication with all crew (wait for reports).';
    case 'done':
      return 'Opening tasks complete.';
    default:
      return '';
  }
}

/** Human-facing interact prompt for world objects. */
const INTERACT_PROPS = new Set([
  'captain-desk',
  'bunk-desk-pad',
  'star-map',
  'lab-bench',
  'botanist-station',
  'teleporter-pad',
  'armory',
]);

export function interactPrompt(interactId: string): string | null {
  switch (interactId) {
    case 'captain-desk':
    case 'bunk-desk-pad':
      return 'Pick up data pad';
    case 'star-map':
      return 'Log in at helm';
    case 'lab-bench':
      return 'Medical station';
    case 'botanist-station':
      return 'Botanist station';
    case 'teleporter-pad':
      return 'Engineer station';
    case 'armory':
      return 'Operations station';
    default:
      return null;
  }
}

export function interactIdForProp(propId: string): string | null {
  return INTERACT_PROPS.has(propId) ? propId : null;
}

export function positionForInteract(interactId: string): { x: number; z: number } | null {
  if (interactId === 'captain-desk') return { x: -51.2, z: 16.15 };
  if (interactId === 'bunk-desk-pad') return { x: -54.2, z: 7.8 };
  const s = stationById(interactId) ?? STATIONS.find((x) => x.id === interactId);
  return s ? { x: s.x, z: s.z } : null;
}
