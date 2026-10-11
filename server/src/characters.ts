/**
 * Saved characters. A character is a ship member with a `character`; it belongs to the browser (`ownerId`, the
 * client's localStorage id) that created it and is listed back to that browser only. Picking one spawns it in its
 * quarters; deleting it frees its crew slot, job and berth.
 */
import { homeSpawnFor } from '../../shared/bunks';
import { MAX_CREW, type SavedCharacter } from '../../shared/protocol';
import { TUBE_COUNT, spawnFor } from '../../shared/lab';
import { assignCloneTank, normalizeMember } from './opening';
import type { MemberRecord, ShipRecord } from './store';

export function ownedCharacters(ship: ShipRecord, clientId: string): MemberRecord[] {
  return Object.values(ship.members)
    .filter((m) => m.character && m.ownerId === clientId)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
}

export function savedCharacters(ship: ShipRecord, clientId: string, isOnline: (id: string) => boolean): SavedCharacter[] {
  return ownedCharacters(ship, clientId).map((m) => {
    normalizeMember(m);
    return {
      id: m.id,
      character: m.character!,
      uniform: m.uniform!,
      isClone: m.isClone!,
      questStep: m.questStep!,
      berth: m.berth!,
      createdAt: m.createdAt!,
      lastPlayedAt: m.lastPlayedAt!,
      online: isOnline(m.id),
    };
  });
}

/**
 * A character created by an older client is keyed by that tab's `sessionStorage` id and owned by itself. The first
 * browser that joins with that id as `legacyPlayerId` takes it over, so an in-progress game survives the upgrade.
 */
export function adoptLegacyMember(ship: ShipRecord, legacyId: string | undefined, clientId: string): boolean {
  if (!legacyId) return false;
  const m = ship.members[legacyId];
  if (!m || m.ownerId !== m.id || m.ownerId === clientId) return false;
  m.ownerId = clientId;
  return true;
}

export type NewMemberResult = { ok: true; member: MemberRecord } | { ok: false; message: string };

/** A fresh crew slot for `clientId`: a hibernator before the voyage starts, a clone in a tank afterwards. */
export function newMember(ship: ShipRecord, clientId: string, now = Date.now()): NewMemberResult {
  if (Object.keys(ship.members).length >= MAX_CREW) {
    return { ok: false, message: `That crew is full (${MAX_CREW}/${MAX_CREW}).` };
  }
  const used = new Set(Object.values(ship.members).map((m) => m.tube));
  let tube = 0;
  while (used.has(tube) && tube < TUBE_COUNT) tube++;
  const member = normalizeMember({
    id: crypto.randomUUID(),
    ownerId: clientId,
    tube,
    character: null,
    ...spawnFor(tube),
    joinedAt: now,
    createdAt: now,
    lastPlayedAt: now,
    isClone: !!ship.gameStarted,
  });
  if (member.isClone) assignCloneTank(ship, member);
  ship.members[member.id] = member;
  return { ok: true, member };
}

export type PickResult = { ok: true; member: MemberRecord } | { ok: false; message: string };

/** Resume a saved character: it wakes in its cabin or bunk room, wherever it was when its owner left. */
export function pickCharacter(ship: ShipRecord, clientId: string, characterId: string, now = Date.now()): PickResult {
  const m = ship.members[characterId];
  if (!m || !m.character || m.ownerId !== clientId) return { ok: false, message: 'That character is not yours or no longer exists.' };
  normalizeMember(m);
  Object.assign(m, homeSpawnFor(m.character.job, m.berth ?? null));
  m.lastPlayedAt = now;
  return { ok: true, member: m };
}

export type DeleteResult = { ok: true; member: MemberRecord } | { ok: false; message: string };

export function deleteCharacter(ship: ShipRecord, clientId: string, characterId: string): DeleteResult {
  const m = ship.members[characterId];
  if (!m || !m.character || m.ownerId !== clientId) return { ok: false, message: 'That character is not yours or no longer exists.' };
  delete ship.members[characterId];
  return { ok: true, member: m };
}

/** A forming clone whose window closed before Create: nothing to keep. */
export function dropFormingMember(ship: ShipRecord, id: string): boolean {
  const m = ship.members[id];
  if (!m || m.character) return false;
  delete ship.members[id];
  return true;
}
