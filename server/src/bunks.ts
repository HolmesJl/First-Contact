import { berthAllowedForJob, berthFromMemoryStationId, berthLabel, memoryStationFor } from '../../shared/bunks';
import { inRange, nextQuestStep, questStepCompleteNotice, type QuestStep } from '../../shared/opening';
import type { MemorySnapshot } from '../../shared/protocol';
import type { MemberRecord, ShipRecord } from './store';

export type MemoryUploadResult =
  | { ok: true; berth: number; at: number; claimed: boolean; notice?: string; quest?: QuestStep; nextHint?: string }
  | { ok: false; message: string };

export function berthOwner(ship: ShipRecord, berth: number): MemberRecord | null {
  return Object.values(ship.members).find((m) => m.berth === berth) ?? null;
}

/** Stations follow the opening order: nothing to upload until the data pad is in hand. Free use from then on. */
function beforeUploadHint(step: QuestStep): string | null {
  switch (step) {
    case 'wake':
      return 'Wait for the crew to wake the ship.';
    case 'clone-doctor':
      return 'Check in with Medical first.';
    case 'captain-set-code':
      return 'Set your cabin door code at the keypad first.';
    case 'pick-pad':
      return 'Pick up your data pad first.';
    default:
      return null;
  }
}

function takeSnapshot(member: MemberRecord, now: number): MemorySnapshot {
  return { version: 1, at: now, questStep: member.questStep ?? 'wake', inventory: null };
}

/**
 * Use a memory upload station: claim the berth if it is free and the player has none, then record a snapshot.
 * Server-authoritative: one player per berth, the Captain's berth only for the Captain, crew bunks only for crew.
 */
export function applyMemoryUpload(ship: ShipRecord, member: MemberRecord, interactId: string, now = Date.now()): MemoryUploadResult {
  const berth = berthFromMemoryStationId(interactId);
  const station = berth === null ? undefined : memoryStationFor(berth);
  if (berth === null || !station) return { ok: false, message: 'Nothing to interact with.' };
  if (!inRange(member.x, member.z, station.stand.x, station.stand.z)) return { ok: false, message: 'Move closer.' };
  if (!member.character) return { ok: false, message: 'Finish creating your clone first.' };

  const job = member.character.job;
  const label = berthLabel(berth);
  member.berth ??= null;

  const order = beforeUploadHint(member.questStep ?? 'wake');
  if (order) return { ok: false, message: order };

  if (!berthAllowedForJob(berth, job)) {
    return { ok: false, message: berth === 0 ? "That is the Captain's berth." : 'The Captain sleeps in the cabin, not the bunk room.' };
  }
  const owner = berthOwner(ship, berth);
  if (owner && owner.id !== member.id) {
    const name = owner.character ? `${owner.character.firstName} ${owner.character.lastName}` : 'another crew member';
    return { ok: false, message: `${label} belongs to ${name}.` };
  }
  if (member.berth !== null && member.berth !== berth) {
    return { ok: false, message: `Your bunk is ${berthLabel(member.berth)}. Upload there.` };
  }

  const claimed = member.berth === null;
  member.berth = berth;

  const name = `${member.character.firstName} ${member.character.lastName}`;
  let quest: QuestStep | undefined;
  let nextHint: string | undefined;
  if (member.questStep === 'upload-memories') {
    const prev = member.questStep;
    member.questStep = nextQuestStep(prev, job, !!member.isClone) ?? 'done';
    quest = member.questStep;
    nextHint = questStepCompleteNotice(prev, job, !!member.isClone, berth) ?? undefined;
  }
  // Snapshot after the step advance so a restored clone does not have to redo the upload objective.
  member.memory = takeSnapshot(member, now);
  return {
    ok: true,
    berth,
    at: now,
    claimed,
    notice: claimed ? `${name} claimed ${label}.` : undefined,
    quest,
    nextHint,
  };
}
