import type { ScanOutcomeKind, ScanResultEntry } from './scanning';
import { scanFindTitle } from './scanning';
import { formatLootSummary } from './transporter';

/** Personal datapad log line from a successful Bridge scan (newest first on the pad). */
export interface PadScanLog {
  id: string;
  /** Server time (ms) the find was logged. */
  at: number;
  outcome: ScanOutcomeKind;
  distanceLabel: string;
  headline: string;
  summary: string;
  /** Links to the ship-wide {@link ScanResultEntry.id}. */
  scanResultId: string;
}

export type PadArchiveKind = 'scan' | 'file' | 'scavenger';

/** Item moved off the active datapad into the bunk memory console archive. */
export interface PadArchiveItem {
  id: string;
  kind: PadArchiveKind;
  /** Date received (messages / scan logs) or date completed (quests). */
  at: number;
  title: string;
  body: string;
}

export const MAX_PAD_SCAN_LOGS = 30;
export const MAX_PAD_ARCHIVE = 120;

export function padScanLogFromFind(find: ScanResultEntry, at: number): PadScanLog {
  return {
    id: crypto.randomUUID(),
    at,
    outcome: find.outcome,
    distanceLabel: find.distanceLabel,
    headline: scanFindTitle(find),
    summary: formatLootSummary(find),
    scanResultId: find.id,
  };
}

export function normalizePadScanLogs(v: unknown): PadScanLog[] {
  if (!Array.isArray(v)) return [];
  const out: PadScanLog[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) continue;
    if (typeof o.outcome !== 'string' || typeof o.distanceLabel !== 'string') continue;
    if (typeof o.headline !== 'string' || typeof o.summary !== 'string') continue;
    if (typeof o.scanResultId !== 'string' || !o.scanResultId) continue;
    if (out.some((x) => x.id === o.id)) continue;
    out.push({
      id: o.id,
      at: o.at,
      outcome: o.outcome as ScanOutcomeKind,
      distanceLabel: o.distanceLabel,
      headline: o.headline,
      summary: o.summary,
      scanResultId: o.scanResultId,
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_PAD_SCAN_LOGS);
}

export function normalizePadArchive(v: unknown): PadArchiveItem[] {
  if (!Array.isArray(v)) return [];
  const kinds = new Set<PadArchiveKind>(['scan', 'file', 'scavenger']);
  const out: PadArchiveItem[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) continue;
    if (typeof o.title !== 'string' || typeof o.body !== 'string') continue;
    const kind = o.kind as PadArchiveKind;
    if (!kinds.has(kind)) continue;
    if (out.some((x) => x.id === o.id)) continue;
    out.push({ id: o.id, kind, at: o.at, title: o.title, body: o.body });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_PAD_ARCHIVE);
}
