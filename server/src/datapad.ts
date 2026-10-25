import {
  MAX_PAD_ARCHIVE,
  normalizePadArchive,
  normalizePadScanLogs,
  type PadArchiveItem,
  type PadArchiveKind,
  type PadScanLog,
} from '../../shared/datapad';
import { SCAVENGER_INTRO, SCAVENGER_TASKS, SCAVENGER_TITLE, scavengerComplete } from '../../shared/scavenger';
import type { PadFile } from '../../shared/items';
import { normalizePadFiles } from '../../shared/items';
import type { MemberRecord } from './store';

export function normalizeMemberDatapad(m: MemberRecord) {
  m.padScanLogs = normalizePadScanLogs(m.padScanLogs);
  m.padArchive = normalizePadArchive(m.padArchive);
  m.padFiles = normalizePadFiles(m.padFiles);
}

export function appendPadScanLog(m: MemberRecord, entry: PadScanLog) {
  normalizeMemberDatapad(m);
  const prev = m.padScanLogs ?? [];
  m.padScanLogs = [entry, ...prev.filter((x) => x.id !== entry.id)].slice(0, 30);
}

export type PadArchiveResult = { ok: true; player: MemberRecord } | { ok: false; message: string };

export function applyPadArchive(member: MemberRecord, kind: PadArchiveKind, id: string, now = Date.now()): PadArchiveResult {
  normalizeMemberDatapad(member);
  let item: PadArchiveItem | null = null;

  if (kind === 'scan') {
    const log = member.padScanLogs!.find((x) => x.id === id);
    if (!log) return { ok: false, message: 'That scan log is not on your datapad.' };
    item = {
      id: log.id,
      kind: 'scan',
      at: log.at,
      title: log.headline,
      body: `Distance ${log.distanceLabel}\n${log.summary}`,
    };
    member.padScanLogs = member.padScanLogs!.filter((x) => x.id !== id);
  } else if (kind === 'file') {
    const file = member.padFiles!.find((f) => f.name === id);
    if (!file) return { ok: false, message: 'That file is not on your datapad.' };
    item = { id: `file:${file.name}`, kind: 'file', at: file.at, title: file.name, body: file.text };
    member.padFiles = member.padFiles!.filter((f) => f.name !== id);
  } else if (kind === 'scavenger') {
    if (id !== 'scavenger') return { ok: false, message: 'Unknown archive target.' };
    if (!member.scavenger || !scavengerComplete(member.scavenger)) {
      return { ok: false, message: 'Finish the scavenger hunt before archiving it.' };
    }
    const doneAt = Math.max(...SCAVENGER_TASKS.map((t) => member.scavenger!.done[t.id] ?? 0));
    const lines = SCAVENGER_TASKS.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
    item = {
      id: `scavenger:${member.id}`,
      kind: 'scavenger',
      at: doneAt || now,
      title: SCAVENGER_TITLE,
      body: `${SCAVENGER_INTRO}\n\n${lines}`,
    };
    member.scavenger = null;
  }

  if (!item) return { ok: false, message: 'Nothing to archive.' };
  member.padArchive = [item, ...member.padArchive!.filter((x) => x.id !== item!.id)].slice(0, MAX_PAD_ARCHIVE);
  return { ok: true, player: member };
}
