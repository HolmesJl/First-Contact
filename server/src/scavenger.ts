/**
 * Quest 2 on the server: issue from the data pad on the Bridge, and advance from item events. All rules are in
 * shared/scavenger.ts; this file only binds them to member records and the item event hook.
 */
import { spaceAt } from '../../shared/shipInterior';
import { SCAVENGER_INTRO, scavengerAdvance, scavengerIssueBlock, scavengerTaskNotice, type ScavengerState } from '../../shared/scavenger';
import { itemEvents } from './items';
import type { MemberRecord } from './store';

export type ScavengerIssueResult = { ok: true; state: ScavengerState; notice: string } | { ok: false; message: string };

export function applyScavengerIssue(member: MemberRecord, now = Date.now()): ScavengerIssueResult {
  if (!member.character) return { ok: false, message: 'Finish creating your clone first.' };
  const block = scavengerIssueBlock(
    { questStep: member.questStep ?? 'wake', hasPad: !!member.hasPad, scavenger: member.scavenger ?? null },
    spaceAt(member.x, member.z)?.id ?? null,
  );
  if (block) return { ok: false, message: block };
  const state: ScavengerState = { issuedAt: now, done: {}, completedAt: null };
  member.scavenger = state;
  return { ok: true, state, notice: SCAVENGER_INTRO };
}

/** Subscribe the quest to item events; returns the unsubscribe. Called once at server start. */
export function installScavengerQuest() {
  return itemEvents.on((ev, { member }) => {
    const state = member.scavenger ?? null;
    const task = scavengerAdvance(state, ev);
    if (!task || !state) return;
    return scavengerTaskNotice(state, task);
  });
}
