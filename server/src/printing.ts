import { materialName, SHIP_MATERIALS, stockPanelById } from '../../shared/items';
import { inRange } from '../../shared/opening';
import { CARGO_HOLD_FULL_MESSAGE, cargoHoldHasRoom } from '../../shared/transporter';
import { canOperateRefinery } from '../../shared/refining';
import { getRefineryStocks, normalizeShipRefinery } from './refining';
import type { MemberRecord, ShipRecord } from './store';

const SHIP_BY_ID = new Map(SHIP_MATERIALS.map((m) => [m.id, m]));

export type PrintResult = { ok: true; message: string } | { ok: false; message: string };

export function applyPrint(
  ship: ShipRecord,
  member: MemberRecord,
  shipMaterialId: string,
  x: number,
  z: number,
): PrintResult {
  if (!member.character) return { ok: false, message: 'You need a character to print.' };
  const panel = stockPanelById('printer-panel');
  if (!panel || !inRange(x, z, panel.stand.x, panel.stand.z)) return { ok: false, message: 'Move closer to the printer panel.' };
  if (!canOperateRefinery(member.character.job)) return { ok: false, message: 'You do not have the skills to use the printer.' };

  const def = SHIP_BY_ID.get(shipMaterialId);
  if (!def?.recipe?.length) return { ok: false, message: 'Unknown print job.' };

  normalizeShipRefinery(ship);
  const { refined } = getRefineryStocks(ship);
  for (const need of def.recipe) {
    if ((refined[need.of] ?? 0) < need.qty) {
      return { ok: false, message: `Need ${need.qty}× ${materialName(need.of)} (refined).` };
    }
  }

  ship.cargoHoldStock ??= {};
  if (!cargoHoldHasRoom(ship.cargoHoldStock, 1)) return { ok: false, message: CARGO_HOLD_FULL_MESSAGE };

  for (const need of def.recipe) {
    refined[need.of] = (refined[need.of] ?? 0) - need.qty;
  }
  ship.cargoHoldStock[shipMaterialId] = (ship.cargoHoldStock[shipMaterialId] ?? 0) + 1;

  return { ok: true, message: `Printed 1 ${def.name} → Cargo Hold.` };
}
