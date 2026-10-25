import { inRange } from '../../shared/opening';
import { materialName } from '../../shared/items';
import { normalizeScanResults, type ScanResultEntry } from '../../shared/scanning';
import {
  CARGO_HOLD_FULL_MESSAGE,
  REFINERY_FULL_MESSAGE,
  TRANSPORTER_DURATION_MS,
  TRANSPORTER_SKILL_DENIED,
  applyPositiveBeam,
  beamableLootForPad,
  canStartLabTransporter,
  cargoHoldHasRoom,
  normalizeCargoHoldStock,
  normalizeRefineryStock,
  normalizeTransporterSkill,
  refineryHasRoom,
  transporterStationById,
  transporterSucceeded,
  type TransporterPadId,
  type TransporterSkill,
  LAB_TRANSPORTER_INTERACT_ID,
} from '../../shared/transporter';
import type { MemberRecord, ShipRecord } from './store';

const activeTransports = new Map<string, { shipCode: string; endsAt: number; padId: TransporterPadId; scanId: string; materialId: string; qty: number }>();

const transportKey = (shipCode: string, memberId: string) => `${shipCode}:${memberId}`;

function transportRoll(): number {
  const forced = process.env.TRANSPORT_FORCE_ROLL;
  if (forced !== undefined && forced !== '') {
    const n = Number(forced);
    if (Number.isFinite(n)) return Math.min(0.999999, Math.max(0, n));
  }
  return Math.random();
}

function normalizeMemberTransporter(m: MemberRecord) {
  m.skills ??= { scanning: undefined, transporter: normalizeTransporterSkill(null) };
  m.skills.transporter = normalizeTransporterSkill(m.skills.transporter);
}

export function memberTransporterSkill(m: MemberRecord): TransporterSkill {
  normalizeMemberTransporter(m);
  return m.skills!.transporter!;
}

export function normalizeShipStocks(ship: ShipRecord) {
  ship.refineryStock = normalizeRefineryStock(ship.refineryStock);
  ship.cargoHoldStock = normalizeCargoHoldStock(ship.cargoHoldStock);
}

export function isTransportInProgress(shipCode: string, memberId: string): boolean {
  const row = activeTransports.get(transportKey(shipCode, memberId));
  return !!row && row.endsAt > Date.now();
}

export type TransportStartResult =
  | { ok: true; endsAt: number }
  | { ok: false; message: string; denied?: boolean; toast?: boolean };

export function applyTransportStart(
  ship: ShipRecord,
  member: MemberRecord,
  padId: TransporterPadId,
  scanId: string,
  materialId: string,
  qty: number,
  x: number,
  z: number,
): TransportStartResult {
  if (!member.character) return { ok: false, message: 'You need a character to beam materials.' };
  const pad = transporterStationById(padId);
  if (!pad) return { ok: false, message: 'Transporter unavailable.' };
  if (!inRange(x, z, pad.stand.x, pad.stand.z)) return { ok: false, message: 'Move closer to the transporter pad.' };
  if (isTransportInProgress(ship.code, member.id)) return { ok: false, message: 'A beam is already in progress.' };

  const beamQty = Math.floor(qty);
  if (!Number.isFinite(beamQty) || beamQty <= 0) return { ok: false, message: 'Select a quantity to beam.' };

  if (padId === LAB_TRANSPORTER_INTERACT_ID && !canStartLabTransporter(member.character.job, !!member.isClone)) {
    return { ok: false, message: TRANSPORTER_SKILL_DENIED, denied: true };
  }

  normalizeMemberTransporter(member);
  const skillBefore = member.skills!.transporter!;
  const roll = transportRoll();
  if (!transporterSucceeded(skillBefore.level, roll)) {
    return { ok: false, message: 'Transporter missed the lock. Try again.', toast: true };
  }

  ship.scanResults = normalizeScanResults(ship.scanResults);
  const entry = ship.scanResults?.find((r) => r.id === scanId);
  if (!entry) return { ok: false, message: 'That contact is no longer on the log.' };

  const lootLine = beamableLootForPad(pad, entry).find((l) => l.materialId === materialId);
  if (!lootLine || lootLine.remaining < beamQty) return { ok: false, message: 'Not enough material left at that contact.' };

  normalizeShipStocks(ship);
  if (pad.destination === 'refinery') {
    if (!refineryHasRoom(ship.refineryStock!, beamQty)) return { ok: false, message: REFINERY_FULL_MESSAGE };
  } else if (!cargoHoldHasRoom(ship.cargoHoldStock!, beamQty)) {
    return { ok: false, message: CARGO_HOLD_FULL_MESSAGE };
  }

  const endsAt = Date.now() + TRANSPORTER_DURATION_MS;
  activeTransports.set(transportKey(ship.code, member.id), {
    shipCode: ship.code,
    endsAt,
    padId,
    scanId,
    materialId,
    qty: beamQty,
  });
  return { ok: true, endsAt };
}

export interface TransportCompletePayload {
  memberId: string;
  ok: boolean;
  message?: string;
  skill: TransporterSkill;
  leveledUp: boolean;
  scanResults: ScanResultEntry[];
  refineryStock: Record<string, number>;
  cargoHoldStock: Record<string, number>;
}

function findScanEntry(ship: ShipRecord, scanId: string): ScanResultEntry | undefined {
  ship.scanResults = normalizeScanResults(ship.scanResults);
  return ship.scanResults?.find((r) => r.id === scanId);
}

function completeTransportForMember(ship: ShipRecord, member: MemberRecord, row: NonNullable<ReturnType<typeof activeTransports.get>>): TransportCompletePayload {
  normalizeMemberTransporter(member);
  const pad = transporterStationById(row.padId)!;
  const entry = findScanEntry(ship, row.scanId);
  const skillBefore = member.skills!.transporter!;
  let skill = skillBefore;
  let leveledUp = false;
  let ok = false;
  let message: string | undefined;

  if (!entry) {
    message = 'That contact is no longer on the log.';
  } else {
    const loot = entry.loot.find((l) => l.materialId === row.materialId);
    if (!loot || loot.remaining < row.qty) {
      message = 'Not enough material left at that contact.';
    } else {
      normalizeShipStocks(ship);
      if (pad.destination === 'refinery') {
        if (!refineryHasRoom(ship.refineryStock!, row.qty)) message = REFINERY_FULL_MESSAGE;
        else {
          ship.refineryStock![row.materialId] = (ship.refineryStock![row.materialId] ?? 0) + row.qty;
          ok = true;
        }
      } else if (!cargoHoldHasRoom(ship.cargoHoldStock!, row.qty)) {
        message = CARGO_HOLD_FULL_MESSAGE;
      } else {
        ship.cargoHoldStock![row.materialId] = (ship.cargoHoldStock![row.materialId] ?? 0) + row.qty;
        ok = true;
      }
      if (ok) {
        loot.remaining -= row.qty;
        const prog = applyPositiveBeam(skillBefore);
        skill = prog.skill;
        leveledUp = prog.leveledUp;
        member.skills!.transporter = skill;
        message = `Beamed ${row.qty} ${materialName(row.materialId)} to the ${pad.destination === 'refinery' ? 'refinery' : 'cargo hold'}.`;
      }
    }
  }

  return {
    memberId: member.id,
    ok,
    message,
    skill,
    leveledUp,
    scanResults: ship.scanResults ?? [],
    refineryStock: ship.refineryStock!,
    cargoHoldStock: ship.cargoHoldStock!,
  };
}

export function finishDueTransports(ship: ShipRecord, now = Date.now()): TransportCompletePayload[] {
  const out: TransportCompletePayload[] = [];
  for (const [key, row] of activeTransports) {
    if (row.shipCode !== ship.code || row.endsAt > now) continue;
    activeTransports.delete(key);
    const memberId = key.slice(ship.code.length + 1);
    const member = ship.members[memberId];
    if (!member?.character) continue;
    out.push(completeTransportForMember(ship, member, row));
  }
  return out;
}

export function cancelTransport(shipCode: string, memberId: string) {
  activeTransports.delete(transportKey(shipCode, memberId));
}
