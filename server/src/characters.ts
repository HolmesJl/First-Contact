/**
 * Saved characters. A character is a ship member with a `character`; it belongs to the browser (`ownerId`, the
 * client's localStorage id) that created it and is listed back to that browser only. Picking one spawns them in the
 * Commons. Saved characters do not hold a crew slot: the cap and the one-Captain rule apply to who is aboard now.
 */
import { homeSpawnFor } from '../../shared/bunks';
import { MAX_CREW, boardCheck, shipFullMessage, type Job, type ProfileCharacter, type SavedCharacter } from '../../shared/protocol';
import { TUBE_COUNT, spawnFor } from '../../shared/lab';
import { assignCloneTank, normalizeMember, normalizeShip } from './opening';
import type { MemberRecord, ShipRecord } from './store';

/** Who is aboard a ship right now (connected sockets), as the boarding rules see it. */
export interface Presence {
  onlineIds: ReadonlySet<string>;
}

export function presenceOf(ship: ShipRecord, onlineIds: ReadonlySet<string>): Presence & { aboard: number; onlineJobs: Job[] } {
  const onlineJobs: Job[] = [];
  for (const id of onlineIds) {
    const job = ship.members[id]?.character?.job;
    if (job) onlineJobs.push(job);
  }
  return { onlineIds, aboard: onlineIds.size, onlineJobs };
}

export function ownedCharacters(ship: ShipRecord, clientId: string): MemberRecord[] {
  return Object.values(ship.members)
    .filter((m) => m.character && m.ownerId === clientId)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
}

export function savedCharacters(ship: ShipRecord, clientId: string, onlineIds: ReadonlySet<string>): SavedCharacter[] {
  const p = presenceOf(ship, onlineIds);
  return ownedCharacters(ship, clientId).map((m) => {
    normalizeMember(m);
    const online = onlineIds.has(m.id);
    return {
      id: m.id,
      character: m.character!,
      uniform: m.uniform!,
      isClone: m.isClone!,
      questStep: m.questStep!,
      berth: m.berth!,
      createdAt: m.createdAt!,
      lastPlayedAt: m.lastPlayedAt!,
      online,
      blocked: boardCheck(p.aboard, p.onlineJobs, m.character!.job, online),
    };
  });
}

/** Every character this browser owns on any ship, most recently played first; the landing screen's Continue list. */
export function profileCharacters(ships: Iterable<ShipRecord>, clientId: string, onlineOn: (code: string) => ReadonlySet<string>): ProfileCharacter[] {
  const out: ProfileCharacter[] = [];
  for (const ship of ships) {
    normalizeShip(ship);
    for (const c of savedCharacters(ship, clientId, onlineOn(ship.code))) {
      out.push({ ...c, shipCode: ship.code, shipName: ship.shipName! });
    }
  }
  return out.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
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

/**
 * A fresh crew slot for `clientId`: a hibernator before the voyage starts, a clone in a tank afterwards. Needs a free
 * place aboard (online cap); tubes are shared with whoever is aboard, not with saved characters that walked off long
 * ago.
 */
export function newMember(ship: ShipRecord, clientId: string, presence: Presence, now = Date.now()): NewMemberResult {
  if (presence.onlineIds.size >= MAX_CREW) return { ok: false, message: shipFullMessage() };
  const used = new Set([...presence.onlineIds].map((id) => ship.members[id]?.tube).filter((t): t is number => t !== undefined));
  let tube = 0;
  while (used.has(tube) && tube < TUBE_COUNT - 1) tube++;
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

/**
 * Resume a saved character: it appears in the Commons. Refused while
 * the ship is full or, for a Captain, while another Captain is aboard (taking over your own online character is fine).
 */
export function pickCharacter(ship: ShipRecord, clientId: string, characterId: string, presence: Presence, now = Date.now()): PickResult {
  const m = ship.members[characterId];
  if (!m || !m.character || m.ownerId !== clientId) return { ok: false, message: 'That character is not yours or no longer exists.' };
  const p = presenceOf(ship, presence.onlineIds);
  const blocked = boardCheck(p.aboard, p.onlineJobs, m.character.job, presence.onlineIds.has(m.id));
  if (blocked) return { ok: false, message: blocked };
  normalizeMember(m);
  Object.assign(m, homeSpawnFor(m.character.job, m.berth ?? null));
  m.lastPlayedAt = now;
  return { ok: true, member: m };
}

/** The ship's host (the browser that launched it) and any Captain aboard may manage the whole roster. */
export function canManageRoster(ship: ShipRecord, clientId: string, actor: MemberRecord | null): boolean {
  if (clientId === ship.hostId) return true;
  return actor?.character?.job === 'Captain';
}

export type DeleteResult = { ok: true; member: MemberRecord } | { ok: false; message: string };

/**
 * Delete a saved character: its owner always may; the host or an online Captain (`actor`) may delete anyone's. The
 * caller kicks the character's window if it is in play.
 */
export function deleteCharacter(ship: ShipRecord, clientId: string, characterId: string, actor: MemberRecord | null = null): DeleteResult {
  const m = ship.members[characterId];
  if (!m || !m.character) return { ok: false, message: 'That character no longer exists.' };
  if (m.ownerId !== clientId && !canManageRoster(ship, clientId, actor)) {
    return { ok: false, message: 'That character is not yours or no longer exists.' };
  }
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
