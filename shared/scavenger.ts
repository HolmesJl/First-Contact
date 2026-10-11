/**
 * Quest 2: the scavenger hunt. Thin glue over the item events in items.ts: the Captain's task list is issued from the
 * data pad on the Bridge once a player's opening quest is done, and each task completes, in order, when the matching
 * item event arrives. Progress lives on the member record (server) and is mirrored in PlayerState.scavenger.
 */
import { MATERIALS_PAD_INTERACT_ID, type ItemEvent } from './items';
import type { QuestStep } from './opening';

export const SCAVENGER_INTRO = 'The captain has given the crew the following task:';
export const SCAVENGER_TITLE = 'Scavenger hunt';
/** Name of the Science Lab File task 2 asks for (see FILE_SPECS in items.ts). */
export const SCAVENGER_FILE_NAME = 'Read Me: module replicator';

export const SCAVENGER_TASK_IDS = ['eat-fruit', 'read-me', 'check-materials', 'first-gear'] as const;
export type ScavengerTaskId = (typeof SCAVENGER_TASK_IDS)[number];

export interface ScavengerTask {
  id: ScavengerTaskId;
  /** Jennifer's task text, shown verbatim on the pad and as the HUD objective. */
  text: string;
  /** Interactable to light up while the task is current. */
  interactId: string;
}

export const SCAVENGER_TASKS: readonly ScavengerTask[] = [
  { id: 'eat-fruit', text: 'Go to eatery and find an apple and eat it.', interactId: 'eatery-panel' },
  { id: 'read-me', text: 'Go to the Science Lab and collect the Read Me File on how to use the module replicator.', interactId: 'file-module-replicator' },
  { id: 'check-materials', text: 'Go to the cargo hold and check ship materials inventory.', interactId: MATERIALS_PAD_INTERACT_ID },
  { id: 'first-gear', text: 'In the cargo hold, collect and equip your first set of gear.', interactId: 'hold-shelves' },
];

export interface ScavengerState {
  /** Server time (ms) the pad issued the quest. */
  issuedAt: number;
  /** Completion time (ms) per task; tasks complete in list order. */
  done: Partial<Record<ScavengerTaskId, number>>;
  /** Set when the last task completes. */
  completedAt: number | null;
}

export function normalizeScavenger(v: unknown): ScavengerState | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.issuedAt !== 'number' || !Number.isFinite(s.issuedAt)) return null;
  const done: ScavengerState['done'] = {};
  const raw = (s.done && typeof s.done === 'object' ? s.done : {}) as Record<string, unknown>;
  // Order is enforced on repair too: a task only counts as done if every task before it is.
  for (const t of SCAVENGER_TASKS) {
    const at = raw[t.id];
    if (typeof at !== 'number' || !Number.isFinite(at)) break;
    done[t.id] = at;
  }
  const all = SCAVENGER_TASKS.every((t) => done[t.id] !== undefined);
  const completedAt = all ? (typeof s.completedAt === 'number' ? s.completedAt : done[SCAVENGER_TASKS[SCAVENGER_TASKS.length - 1].id]!) : null;
  return { issuedAt: s.issuedAt, done, completedAt };
}

export const scavengerTaskDone = (state: ScavengerState | null, id: ScavengerTaskId) => !!state && state.done[id] !== undefined;

/** The first task not yet complete, or null when the quest is done (or not issued). */
export function scavengerCurrentTask(state: ScavengerState | null): ScavengerTask | null {
  if (!state) return null;
  return SCAVENGER_TASKS.find((t) => state.done[t.id] === undefined) ?? null;
}

export const scavengerComplete = (state: ScavengerState | null) => !!state && scavengerCurrentTask(state) === null;

/** Why the pad cannot issue the quest right now, or null when it can. `spaceId` is where the player stands. */
export function scavengerIssueBlock(p: { questStep: QuestStep; hasPad: boolean; scavenger: ScavengerState | null }, spaceId: string | null): string | null {
  if (p.scavenger) return 'The scavenger hunt is already on your pad.';
  if (!p.hasPad) return 'You need your data pad.';
  if (p.questStep !== 'done') return 'Finish the opening tasks first.';
  if (spaceId !== 'bridge') return 'Open your data pad on the Bridge to receive the next task.';
  return null;
}

/** HUD objective line while the opening is done: the current scavenger task, a prompt to fetch it, or the wrap-up. */
export function scavengerObjective(state: ScavengerState | null): string {
  if (!state) return 'Opening tasks complete. Open your data pad (P) on the Bridge for the captain\'s next task.';
  const cur = scavengerCurrentTask(state);
  if (!cur) return 'Scavenger hunt complete.';
  const n = SCAVENGER_TASKS.indexOf(cur) + 1;
  return `${SCAVENGER_TITLE} ${n}/${SCAVENGER_TASKS.length}: ${cur.text}`;
}

/** Interactable to highlight for the current task, or null. */
export function scavengerHighlightId(state: ScavengerState | null): string | null {
  return scavengerCurrentTask(state)?.interactId ?? null;
}

/** Does this item event satisfy the task? (Only the current task is ever asked.) */
export function scavengerEventCompletes(task: ScavengerTaskId, ev: ItemEvent): boolean {
  switch (task) {
    case 'eat-fruit':
      return ev.kind === 'used' && ev.item === 'fruit';
    case 'read-me':
      return ev.kind === 'fileOpened' && ev.name === SCAVENGER_FILE_NAME;
    case 'check-materials':
      return ev.kind === 'panelOpened' && ev.station === MATERIALS_PAD_INTERACT_ID;
    case 'first-gear':
      return ev.kind === 'equipped' && ev.item === 'lite-body-armor';
  }
}

/**
 * Apply an item event to the quest: completes the current task if the event matches. Returns the completed task, or
 * null when nothing changed. Mutates `state`.
 */
export function scavengerAdvance(state: ScavengerState | null, ev: ItemEvent, now = Date.now()): ScavengerTask | null {
  if (!state) return null;
  const cur = scavengerCurrentTask(state);
  if (!cur || !scavengerEventCompletes(cur.id, ev)) return null;
  state.done[cur.id] = now;
  if (scavengerCurrentTask(state) === null) state.completedAt = now;
  return cur;
}

/** Toast after a task completes. */
export function scavengerTaskNotice(state: ScavengerState, task: ScavengerTask): string {
  const n = SCAVENGER_TASKS.indexOf(task) + 1;
  const next = scavengerCurrentTask(state);
  if (!next) return `Task ${n} complete. Scavenger hunt complete!`;
  return `Task ${n} complete. Next: ${next.text}`;
}
