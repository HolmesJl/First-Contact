import { berthFromMemoryStationId, berthLabel, formatUploadTime } from '../../shared/bunks';
import type { PlayerState } from '../../shared/protocol';

const ui = document.getElementById('ui')!;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatArchiveTime(at: number) {
  const d = new Date(at);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export interface BunkConsoleHandlers {
  onUpload(): void;
  onClose(): void;
}

/** Bunk memory console: upload memories and browse archived datapad entries. */
export class BunkConsoleOverlay {
  readonly el = document.createElement('div');

  constructor(
    interactId: string,
    me: PlayerState,
    private handlers: BunkConsoleHandlers,
  ) {
    const berth = berthFromMemoryStationId(interactId);
    const label = berth === null ? 'Bunk console' : berthLabel(berth);
    this.el.className = 'bunk-console-overlay';
    const archive = me.padArchive.length
      ? `<ul class="bunk-archive-list">${me.padArchive
          .map(
            (a) =>
              `<li class="bunk-archive-item"><span class="bunk-archive-time">${esc(formatArchiveTime(a.at))}</span><span class="bunk-archive-kind">${esc(a.kind)}</span><b>${esc(a.title)}</b><p>${esc(a.body)}</p></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No archived entries yet. Archive scan logs, files, or completed quests from your data pad (P).</p>';
    const uploadHint =
      me.berth === berth
        ? `Refresh snapshot · last upload ${me.lastUploadAt ? formatUploadTime(me.lastUploadAt) : 'never'}`
        : me.berth === null
          ? 'Claim this berth and store a memory snapshot'
          : `Move from ${berthLabel(me.berth)} and upload here`;
    this.el.innerHTML = `
      <div class="bunk-console panel">
        <header><h3>Memory console · ${esc(label)}</h3><button type="button" class="btn ghost small bunk-close">Close</button></header>
        <div class="bunk-console-scroll">
          <button type="button" class="btn primary bunk-upload">Upload memories</button>
          <p class="muted bunk-upload-hint">${esc(uploadHint)}</p>
          <h4>Archived</h4>
          ${archive}
        </div>
      </div>`;
    this.el.querySelector('.bunk-close')!.addEventListener('click', () => handlers.onClose());
    this.el.querySelector('.bunk-upload')!.addEventListener('click', () => handlers.onUpload());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) handlers.onClose();
    });
    ui.append(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.handlers.onClose();
  };

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 280);
  }
}
