import {
  CABIN_DOOR_AFTER_PASS_MS,
  CABIN_DOOR_IDLE_CLOSE_MS,
  CABIN_DOOR_OPEN_MS,
  CABIN_KEYPAD_INTERACT_ID,
  CABIN_KEYPAD_LOCKOUT_MS,
  CABIN_MAX_WRONG_ATTEMPTS,
  cabinDoorExtraObstacles,
  cabinDoorCenter,
  isValidCabinCode,
} from '../../shared/cabinDoor';
import { inRange, positionForInteract, questStepCompleteNotice, type QuestStep } from '../../shared/opening';
import type { MemberRecord, ShipRecord } from './store';

export interface CabinDoorPublic {
  codeSet: boolean;
  open: boolean;
  /** Server time (ms) when the current open/close animation started. */
  animAt: number;
  openFrac: number;
}

interface DoorRuntime {
  openFrac: number;
  animFrom: number;
  animTo: number;
  animStart: number;
  closeAt: number | null;
  lastPassAt: number | null;
}

interface AttemptState {
  wrong: number;
  lockUntil: number;
}

const runtime = new Map<string, DoorRuntime>();
const attempts = new Map<string, AttemptState>();

const attemptKey = (code: string, pid: string) => `${code}:${pid}`;

function rt(ship: ShipRecord): DoorRuntime {
  let r = runtime.get(ship.code);
  if (!r) {
    r = { openFrac: 0, animFrom: 0, animTo: 0, animStart: 0, closeAt: null, lastPassAt: null };
    runtime.set(ship.code, r);
  }
  return r;
}

export function normalizeCabinDoor(ship: ShipRecord) {
  ship.cabinDoorCode ??= null;
  ship.cabinDoorOpen ??= false;
}

function syncOpenFrac(ship: ShipRecord, now: number) {
  const r = rt(ship);
  if (r.animStart > 0 && r.animFrom !== r.animTo) {
    const t = Math.min(1, (now - r.animStart) / CABIN_DOOR_OPEN_MS);
    r.openFrac = r.animFrom + (r.animTo - r.animFrom) * t;
    if (t >= 1) {
      r.openFrac = r.animTo;
      r.animFrom = r.animTo;
    }
  } else {
    r.openFrac = ship.cabinDoorOpen ? 1 : 0;
  }
}

export function cabinDoorObstaclesForShip(ship: ShipRecord, now = Date.now()) {
  syncOpenFrac(ship, now);
  return cabinDoorExtraObstacles(rt(ship).openFrac);
}

export function cabinDoorPublic(ship: ShipRecord, now = Date.now()): CabinDoorPublic {
  normalizeCabinDoor(ship);
  syncOpenFrac(ship, now);
  const r = rt(ship);
  return {
    codeSet: ship.cabinDoorCode !== null,
    open: !!ship.cabinDoorOpen,
    animAt: r.animStart || now,
    openFrac: r.openFrac,
  };
}

function setDoorOpen(ship: ShipRecord, open: boolean, now: number) {
  normalizeCabinDoor(ship);
  const r = rt(ship);
  r.animFrom = r.openFrac;
  r.animTo = open ? 1 : 0;
  r.animStart = now;
  ship.cabinDoorOpen = open;
  if (open) {
    r.closeAt = now + CABIN_DOOR_IDLE_CLOSE_MS;
    r.lastPassAt = null;
  } else {
    r.closeAt = null;
    r.lastPassAt = null;
  }
}

export function openCabinDoor(ship: ShipRecord, now = Date.now()) {
  if (ship.cabinDoorOpen && rt(ship).openFrac >= 0.99) {
    rt(ship).closeAt = now + CABIN_DOOR_IDLE_CLOSE_MS;
    return;
  }
  setDoorOpen(ship, true, now);
}

export function closeCabinDoor(ship: ShipRecord, now = Date.now()) {
  if (!ship.cabinDoorOpen && rt(ship).openFrac <= 0.01) return;
  setDoorOpen(ship, false, now);
}

function playerCrossedDoor(m: MemberRecord, prevX: number, prevZ: number) {
  const { x, z } = cabinDoorCenter();
  const wasCorridor = prevX > x + 0.05;
  const nowCabin = m.x < x - 0.05;
  const wasCabin = prevX < x - 0.05;
  const nowCorridor = m.x > x + 0.05;
  if (Math.abs(m.z - z) > 1.2 || Math.abs(prevZ - z) > 1.2) return false;
  return (wasCorridor && nowCabin) || (wasCabin && nowCorridor);
}

export function trackCabinDoorPass(ship: ShipRecord, member: MemberRecord, prevX: number, prevZ: number, now = Date.now()) {
  if (!ship.cabinDoorOpen) return;
  if (!playerCrossedDoor(member, prevX, prevZ)) return;
  const r = rt(ship);
  r.lastPassAt = now;
  r.closeAt = now + CABIN_DOOR_AFTER_PASS_MS;
}

export function tickCabinDoors(ship: ShipRecord, now = Date.now()) {
  normalizeCabinDoor(ship);
  syncOpenFrac(ship, now);
  if (!ship.cabinDoorOpen) return false;
  const r = rt(ship);
  if (r.closeAt !== null && now >= r.closeAt) {
    closeCabinDoor(ship, now);
    return true;
  }
  return false;
}

function lockoutMessage(until: number, now: number) {
  const s = Math.ceil((until - now) / 1000);
  return `Too many wrong attempts. Try again in ${s}s.`;
}

function checkKeypadRange(member: MemberRecord): string | null {
  const pos = positionForInteract(CABIN_KEYPAD_INTERACT_ID);
  if (!pos) return 'Nothing to interact with.';
  if (!inRange(member.x, member.z, pos.x, pos.z)) return 'Move closer to the keypad.';
  return null;
}

export type CabinKeypadResult =
  | { ok: true; notice?: string; quest?: QuestStep; nextHint?: string; flash?: 'green' | 'red'; dismissMs?: number }
  | { ok: false; message: string; lockoutUntil?: number; dismissMs?: number; flash?: 'green' | 'red' };

export function applyCabinKeypadInteract(ship: ShipRecord, member: MemberRecord): CabinKeypadResult {
  const err = checkKeypadRange(member);
  if (err) return { ok: false, message: err };
  if (!member.character) return { ok: false, message: 'Finish creating your clone first.' };
  normalizeCabinDoor(ship);
  if (!ship.cabinDoorCode) {
    if (member.character.job !== 'Captain') {
      return { ok: false, message: 'Locked. The captain has not set a code.' };
    }
    return { ok: true, notice: undefined };
  }
  return { ok: true };
}

export function applyCabinKeypadSet(
  ship: ShipRecord,
  member: MemberRecord,
  code: string,
  confirm: string,
  now = Date.now(),
): CabinKeypadResult {
  const err = checkKeypadRange(member);
  if (err) return { ok: false, message: err };
  if (!member.character || member.character.job !== 'Captain') {
    return { ok: false, message: 'Only the Captain can set the cabin code.' };
  }
  if (!isValidCabinCode(code) || !isValidCabinCode(confirm)) {
    return { ok: false, message: 'Enter a 4-digit code.' };
  }
  if (code !== confirm) return { ok: false, message: 'Codes do not match.' };
  normalizeCabinDoor(ship);
  if (ship.cabinDoorCode && member.questStep !== 'captain-set-code') {
    return { ok: false, message: 'Use “change code” from inside the cabin.' };
  }
  ship.cabinDoorCode = code;
  openCabinDoor(ship, now);
  let quest: QuestStep | undefined;
  let nextHint: string | undefined;
  if (member.questStep === 'captain-set-code') {
    const prev = member.questStep;
    member.questStep = 'pick-pad';
    quest = 'pick-pad';
    nextHint = questStepCompleteNotice(prev, member.character.job, !!member.isClone) ?? undefined;
  }
  return {
    ok: true,
    notice: 'Cabin door code saved. Door opening.',
    quest,
    nextHint,
    flash: 'green',
    dismissMs: 400,
  };
}

export function applyCabinKeypadEnter(
  ship: ShipRecord,
  member: MemberRecord,
  code: string,
  now = Date.now(),
): CabinKeypadResult {
  const err = checkKeypadRange(member);
  if (err) return { ok: false, message: err };
  if (!member.character) return { ok: false, message: 'No character.' };
  normalizeCabinDoor(ship);
  if (!ship.cabinDoorCode) {
    if (member.character.job === 'Captain') {
      return { ok: false, message: 'Set your cabin code first.' };
    }
    return { ok: false, message: 'Locked. The captain has not set a code.' };
  }
  const ak = attemptKey(ship.code, member.id);
  const st = attempts.get(ak) ?? { wrong: 0, lockUntil: 0 };
  if (st.lockUntil > now) return { ok: false, message: lockoutMessage(st.lockUntil, now), lockoutUntil: st.lockUntil };
  if (!isValidCabinCode(code)) return { ok: false, message: 'Enter 4 digits.', dismissMs: 1200 };

  if (code === ship.cabinDoorCode) {
    st.wrong = 0;
    attempts.set(ak, st);
    openCabinDoor(ship, now);
    return { ok: true, notice: 'Door unlocked.', flash: 'green', dismissMs: 450 };
  }

  st.wrong += 1;
  if (st.wrong >= CABIN_MAX_WRONG_ATTEMPTS) {
    st.lockUntil = now + CABIN_KEYPAD_LOCKOUT_MS;
    st.wrong = 0;
  }
  attempts.set(ak, st);
  if (st.lockUntil > now) {
    return {
      ok: false,
      message: lockoutMessage(st.lockUntil, now),
      lockoutUntil: st.lockUntil,
      flash: 'red',
      dismissMs: 1400,
    };
  }
  return { ok: false, message: 'Incorrect code', flash: 'red', dismissMs: 1400 };
}

export function applyCabinKeypadChange(
  ship: ShipRecord,
  member: MemberRecord,
  current: string,
  code: string,
  confirm: string,
  now = Date.now(),
): CabinKeypadResult {
  const err = checkKeypadRange(member);
  if (err) return { ok: false, message: err };
  if (!member.character || member.character.job !== 'Captain') {
    return { ok: false, message: 'Only the Captain can change the code.' };
  }
  normalizeCabinDoor(ship);
  if (!ship.cabinDoorCode) return { ok: false, message: 'Set a code first.' };
  if (!isValidCabinCode(current)) return { ok: false, message: 'Enter your current 4-digit code.' };
  if (current !== ship.cabinDoorCode) return { ok: false, message: 'Incorrect code', flash: 'red', dismissMs: 1200 };
  if (!isValidCabinCode(code) || !isValidCabinCode(confirm)) {
    return { ok: false, message: 'Enter a new 4-digit code.' };
  }
  if (code !== confirm) return { ok: false, message: 'New codes do not match.' };
  ship.cabinDoorCode = code;
  openCabinDoor(ship, now);
  return { ok: true, notice: 'Cabin code updated. Door opening.', flash: 'green', dismissMs: 400 };
}
