import {
  EYE_COLORS,
  FACES,
  HAIR_COLORS,
  HAIR_STYLES,
  JOBS,
  JOB_INFO,
  MAX_CREW,
  NAME_PATTERN,
  defaultHairStyle,
  hairStyleAvailable,
  jobCheck,
  type Appearance,
  type Character,
  type Job,
  type PlayerState,
  type ProfileCharacter,
  type SavedCharacter,
} from '../../shared/protocol';
import type { Gait } from '../../shared/movement';
import type { Space } from '../../shared/shipInterior';
import { captainCommsObjective, questObjective, type QuestStep } from '../../shared/opening';
import { berthLabel, formatUploadTime } from '../../shared/bunks';
import type { ShipMeta } from '../../shared/protocol';
import {
  SCAVENGER_INTRO,
  SCAVENGER_OFF_BRIDGE,
  SCAVENGER_ORDERS_TEXT,
  SCAVENGER_ORDERS_TITLE,
  SCAVENGER_TASKS,
  SCAVENGER_TITLE,
  scavengerAwaiting,
  scavengerComplete,
  scavengerCurrentTask,
  scavengerObjective,
  type ScavengerState,
} from '../../shared/scavenger';
import type { PadArchiveKind } from '../../shared/datapad';

const ui = document.getElementById('ui')!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------------------------------------------------------------- title

export class TitleScreen {
  readonly el = h('div', 'title-screen');
  private error: HTMLElement;
  private buttons: HTMLButtonElement[];
  private continueSection: HTMLElement;
  private continueNote: HTMLElement;
  private saved: CharacterList<ProfileCharacter>;

  constructor(
    invite: string | null,
    handlers: { onHost(): void; onJoin(code: string): void; onBoard(c: ProfileCharacter): void; onDelete(c: ProfileCharacter): void },
  ) {
    this.el.innerHTML = `
      <div class="brand">
        <div class="kicker">Invite-only co-op · 1–6 crew</div>
        <h1>FIRST<br/><span>CONTACT</span></h1>
        <p class="tag">An alien signal. A ship built from its blueprints. Six berths, one Captain, and a very long way to go.</p>
      </div>
      <div class="card panel">
        ${invite ? `<div class="invite-banner">You've been invited aboard ship <b>${esc(invite)}</b></div>` : ''}
        <section class="continue" hidden>
          <h2>Continue</h2>
          <p class="muted continue-note">Your saved characters. Boarding wakes them in their quarters.</p>
          <ul class="pick-list"></ul>
        </section>
        <div class="divider continue-divider" hidden><span>or</span></div>
        <section>
          <h2>Host a voyage</h2>
          <p class="muted">Commission a new ship server and share the invite code with up to five crewmates.</p>
          <button class="btn primary" data-act="host">Launch a new ship</button>
        </section>
        <div class="divider"><span>or</span></div>
        <section>
          <h2>Join a crew</h2>
          <form class="join-row">
            <input class="input code" name="code" maxlength="6" placeholder="INVITE CODE" autocomplete="off" spellcheck="false" value="${esc(invite ?? '')}" />
            <button class="btn ${invite ? 'primary' : ''}" type="submit" data-act="join">Join crew</button>
          </form>
        </section>
        <div class="error" role="alert"></div>
      </div>`;
    this.error = this.el.querySelector('.error')!;
    this.buttons = [...this.el.querySelectorAll('button')];
    this.continueSection = this.el.querySelector('.continue')!;
    this.continueNote = this.el.querySelector('.continue-note')!;
    this.saved = new CharacterList<ProfileCharacter>(this.el.querySelector('.continue .pick-list')!, {
      showShip: true,
      onPick: (c) => {
        this.setBusy(true);
        handlers.onBoard(c);
      },
      onDelete: (c) => {
        this.setBusy(true);
        handlers.onDelete(c);
      },
    });
    const input = this.el.querySelector<HTMLInputElement>('input.code')!;
    input.addEventListener('input', () => (input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    this.el.querySelector('[data-act=host]')!.addEventListener('click', () => handlers.onHost());
    this.el.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (code.length !== 6) return this.showError('Invite codes are 6 characters.');
      handlers.onJoin(code);
    });
    ui.appendChild(this.el);
    if (invite) input.focus();
  }

  /** Saved characters across ships (server-authoritative list). `null` while loading, `[]` when there are none. */
  setSaved(characters: ProfileCharacter[] | null, note?: string) {
    const show = characters === null || characters.length > 0;
    this.continueSection.hidden = !show;
    this.el.querySelector<HTMLElement>('.continue-divider')!.hidden = !show;
    this.el.classList.toggle('has-saved', show);
    this.continueNote.textContent = note ?? 'Your saved characters. Boarding wakes them in their quarters.';
    this.saved.render(characters ?? [], characters === null ? 'Looking for your crew…' : '');
  }

  /** Disable everything while a connection is in flight. `label` goes on the host/join buttons. */
  setBusy(busy: boolean, label?: string) {
    this.buttons.forEach((b) => {
      b.disabled = busy;
      if (!b.dataset.label) b.dataset.label = b.textContent ?? '';
      b.textContent = busy && label ? label : b.dataset.label;
    });
    this.saved.setDisabled(busy);
    if (busy) this.error.textContent = '';
  }

  showError(msg: string) {
    this.error.textContent = msg;
  }

  destroy() {
    this.el.classList.add('leaving');
    setTimeout(() => this.el.remove(), 400);
  }
}

// ---------------------------------------------------------------- character pick list

export function formatLastPlayed(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Rows of saved characters with Board and Delete (inline confirm). Used by the landing screen's Continue section
 * (rows name their ship) and by the per-ship pick screen. The list is whatever the server says this browser owns.
 */
export class CharacterList<T extends SavedCharacter> {
  private items: T[] = [];
  private emptyText = '';
  private confirming: string | null = null;
  private busy = false;

  constructor(
    private ul: HTMLElement,
    private opts: { showShip?: boolean; onPick(c: T): void; onDelete(c: T): void },
  ) {
    ul.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b || this.busy) return;
      const id = b.closest<HTMLElement>('[data-id]')!.dataset.id!;
      const item = this.items.find((c) => c.id === id);
      if (!item) return;
      switch (b.dataset.act) {
        case 'pick':
          this.lock(b, 'Boarding…');
          this.opts.onPick(item);
          break;
        case 'delete':
          this.confirming = id;
          this.renderRows();
          break;
        case 'cancel':
          this.confirming = null;
          this.renderRows();
          break;
        case 'confirm':
          this.confirming = null;
          this.lock(b, 'Deleting…');
          this.opts.onDelete(item);
          break;
      }
    });
  }

  render(items: T[], emptyText = '') {
    this.items = items;
    this.emptyText = emptyText;
    this.busy = false;
    if (this.confirming && !items.some((c) => c.id === this.confirming)) this.confirming = null;
    this.renderRows();
  }

  setDisabled(disabled: boolean) {
    this.busy = disabled;
    this.ul.querySelectorAll('button').forEach((b) => {
      // A blocked Board button stays disabled when the rest of the list is re-enabled.
      b.disabled = disabled || (b.dataset.act === 'pick' && !!b.closest('.pick-row.blocked'));
    });
  }

  private lock(button: HTMLButtonElement, label: string) {
    this.setDisabled(true);
    button.textContent = label;
  }

  private renderRows() {
    if (this.items.length === 0) {
      this.ul.innerHTML = this.emptyText ? `<li class="pick-empty muted">${esc(this.emptyText)}</li>` : '';
      return;
    }
    this.ul.innerHTML = this.items
      .map((c) => {
        const ch = c.character;
        const color = JOB_INFO[ch.job].color;
        const name = `${esc(ch.firstName)} ${esc(ch.lastName)}`;
        const shipCode = this.opts.showShip && 'shipCode' in c ? esc(String((c as unknown as ProfileCharacter).shipCode)) : null;
        const ship = shipCode ? ` · ship ${shipCode}` : '';
        if (this.confirming === c.id) {
          return `<li class="pick-row confirm" data-id="${esc(c.id)}">
            <div class="pick-who"><b>Delete ${name}?</b><div class="muted">Their ${esc(ch.job)} post${c.berth !== null ? ` and ${esc(berthLabel(c.berth))}` : ''}${shipCode ? ` on ship ${shipCode}` : ''} are freed for someone else. This cannot be undone.</div></div>
            <div class="pick-actions"><button type="button" class="btn small danger" data-act="confirm">Delete</button><button type="button" class="btn small" data-act="cancel">Keep</button></div>
          </li>`;
        }
        const where = ch.job === 'Captain' ? "Captain's cabin" : c.berth !== null ? berthLabel(c.berth) : 'bunk room, no bunk claimed';
        const quest = c.questStep === 'done' ? 'opening tasks complete' : 'opening tasks in progress';
        const tags = [c.isClone ? '<span class="tag-off">clone</span>' : '', c.online ? '<span class="tag-you">in play</span>' : ''].join('');
        const blocked = c.blocked ? `<div class="pick-blocked">${esc(c.blocked)}</div>` : '';
        return `<li class="pick-row${c.blocked ? ' blocked' : ''}" data-id="${esc(c.id)}">
          <span class="dot" style="background:${color}"></span>
          <div class="pick-who"><b style="color:${color}">${esc(ch.job)}</b> ${name}${tags}<div class="muted">Last played ${esc(formatLastPlayed(c.lastPlayedAt))}${ship} · ${esc(where)} · ${quest}</div>${blocked}</div>
          <div class="pick-actions"><button type="button" class="btn small primary" data-act="pick" ${c.blocked ? `disabled title="${esc(c.blocked)}"` : ''}>${c.online ? 'Take over' : 'Board'}</button><button type="button" class="btn small ghost" data-act="delete" title="Delete this character">Delete</button></div>
        </li>`;
      })
      .join('');
  }
}

/**
 * Per-ship pick list, shown after joining a ship this browser already has characters on (for example via an invite
 * link): pick one, delete one, or start a new character. Re-renders when the server sends a fresh list.
 */
export class CharacterPickScreen {
  readonly el = h('div', 'pick-screen');
  private list: CharacterList<SavedCharacter>;
  private error: HTMLElement;
  private newBtn: HTMLButtonElement;
  private count: HTMLElement;
  private characters: SavedCharacter[] = [];
  private aboard = 0;

  constructor(
    code: string,
    characters: SavedCharacter[],
    aboard: number,
    private handlers: { onPick(id: string): void; onNew(): void; onDelete(id: string): void },
  ) {
    this.el.innerHTML = `
      <div class="pick-card panel">
        <div class="kicker">Ship <b>${esc(code)}</b> · <span class="pick-count"></span></div>
        <h2>Who is boarding?</h2>
        <p class="muted">Your saved crew on this ship. A returning character wakes in their quarters: the Captain in the cabin, everyone else in the bunk room. Up to ${MAX_CREW} players can be aboard at once, with one Captain.</p>
        <ul class="pick-list"></ul>
        <button class="btn big pick-new">New character</button>
        <div class="error" role="alert"></div>
      </div>`;
    this.error = this.el.querySelector('.error')!;
    this.newBtn = this.el.querySelector('.pick-new')!;
    this.count = this.el.querySelector('.pick-count')!;
    this.list = new CharacterList<SavedCharacter>(this.el.querySelector('.pick-list')!, {
      onPick: (c) => {
        this.lockNew();
        this.handlers.onPick(c.id);
      },
      onDelete: (c) => {
        this.lockNew();
        this.handlers.onDelete(c.id);
      },
    });
    this.newBtn.addEventListener('click', () => {
      this.lockNew('Preparing a clone tank…');
      this.list.setDisabled(true);
      this.handlers.onNew();
    });
    this.render(characters, aboard);
    ui.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  render(characters: SavedCharacter[], aboard: number) {
    this.characters = characters;
    this.aboard = aboard;
    this.count.textContent = `${aboard}/${MAX_CREW} aboard`;
    const full = aboard >= MAX_CREW;
    this.newBtn.disabled = full;
    this.newBtn.textContent = full ? `New character · ship full right now (${MAX_CREW}/${MAX_CREW} aboard)` : 'New character';
    this.list.render(characters, 'No saved characters on this ship.');
  }

  private lockNew(label?: string) {
    this.error.textContent = '';
    this.newBtn.disabled = true;
    if (label) this.newBtn.textContent = label;
  }

  showError(msg: string) {
    this.error.textContent = msg;
    this.render(this.characters, this.aboard);
  }

  destroy() {
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 400);
  }
}

// ---------------------------------------------------------------- intro

export class IntroOverlay {
  readonly el = h('div', 'intro-overlay');
  private caption: HTMLElement;
  private current: string | null = null;

  constructor(onSkip: () => void) {
    this.el.innerHTML = `<div class="letterbox top"></div><div class="letterbox bottom"></div>
      <div class="caption"></div>
      <button class="btn ghost skip">Skip intro <kbd>Space</kbd></button>`;
    this.caption = this.el.querySelector('.caption')!;
    this.el.querySelector('.skip')!.addEventListener('click', onSkip);
    ui.appendChild(this.el);
  }

  setCaption(text: string | null) {
    if (text === this.current) return;
    this.current = text;
    this.caption.classList.remove('show');
    if (text) {
      this.caption.textContent = text;
      void this.caption.offsetWidth;
      this.caption.classList.add('show');
    }
  }

  destroy() {
    this.el.remove();
  }
}

export function flash() {
  const f = h('div', 'flash');
  ui.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}

// ---------------------------------------------------------------- wake lobby

export class WakeIntro {
  readonly el = h('div', 'wake-intro');
  private list: HTMLElement;
  private body: HTMLElement;
  private action: HTMLButtonElement;

  constructor(
    private ship: ShipMeta,
    isClone: boolean,
    handlers: { onStart(): void; onContinue(): void },
  ) {
    this.el.innerHTML = `
      <div class="wake-card panel">
        <div class="wake-fade"></div>
        <h2>${isClone ? 'You are a clone' : 'Hibernation ended'}</h2>
        <div class="wake-body"></div>
        <div class="label">Crew aboard</div>
        <ul class="wake-crew"></ul>
        <button class="btn primary big wake-action"></button>
      </div>`;
    this.body = this.el.querySelector('.wake-body')!;
    this.list = this.el.querySelector('.wake-crew')!;
    this.action = this.el.querySelector('.wake-action')!;
    const years = ship.transitYears;
    if (isClone) {
      this.body.innerHTML = `<p>You are a <b>clone</b>, decanted after the voyage began. Report to Medical before you join the crew. The <b>${esc(ship.shipName)}</b> has been in transit for <b>${years} years</b>.</p>`;
      this.action.textContent = 'Continue to clone lab';
      this.action.onclick = () => handlers.onContinue();
    } else {
      this.body.innerHTML = `<p>The <b>${esc(ship.shipName)}</b> has been en route for <b>${years} years</b>. Your hibernation is over — wake or clone your crew and survive the rest of the way.</p>`;
      this.action.textContent = ship.gameStarted ? 'Continue to clone lab' : 'Start';
      this.action.onclick = () => (ship.gameStarted ? handlers.onContinue() : handlers.onStart());
    }
    ui.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  renderCrew(players: Map<string, PlayerState>, selfId: string) {
    const list = [...players.values()].filter((p) => p.connected).sort((a, b) => a.tube - b.tube);
    this.list.innerHTML = list
      .map((p) => {
        const c = p.character;
        const who = c ? `${c.job} ${esc(c.firstName)} ${esc(c.lastName)}` : `Berth CL-0${p.tube + 1} (forming)`;
        const tags = [p.id === selfId ? 'you' : '', p.isHost ? 'host' : '', p.isClone ? 'clone' : ''].filter(Boolean).join(' · ');
        return `<li><span>${who}</span><span class="muted">${tags}</span></li>`;
      })
      .join('');
  }

  enableContinue(onContinue: () => void) {
    this.action.textContent = 'Continue to clone lab';
    this.action.onclick = onContinue;
  }

  destroy() {
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 500);
  }
}

// ---------------------------------------------------------------- data pad

export class DataPadOverlay {
  readonly el = h('div', 'pad-overlay');
  private body: HTMLElement;
  private footer: HTMLElement;
  /** Name of the saved File expanded in the Files section, if any. */
  private openFile: string | null = null;

  constructor(
    ship: ShipMeta,
    me: PlayerState,
    players: Map<string, PlayerState>,
    onBridge: boolean,
    private handlers: { onReportIn(): void; onAcceptOrders(): void; onArchive(kind: PadArchiveKind, id: string): void; onClose(): void },
  ) {
    this.el.innerHTML = `
      <div class="pad panel">
        <header><h3>Personal data pad</h3><button class="btn ghost small pad-close">Close</button></header>
        <div class="pad-scroll"></div>
        <footer hidden></footer>
      </div>`;
    this.body = this.el.querySelector('.pad-scroll')!;
    this.footer = this.el.querySelector('footer')!;
    this.el.querySelector('.pad-close')!.addEventListener('click', () => handlers.onClose());
    // Crew report in at the bridge comms console, not from the pad; only the Captain's comms step has a pad action.
    this.footer.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.report-in')) handlers.onReportIn();
    });
    this.body.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.pad-accept')) return handlers.onAcceptOrders();
      const arch = (e.target as HTMLElement).closest<HTMLElement>('[data-archive-kind]');
      if (arch) {
        handlers.onArchive(arch.dataset.archiveKind as PadArchiveKind, arch.dataset.archiveId!);
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-file]');
      if (!b) return;
      const name = b.dataset.file!;
      this.openFile = this.openFile === name ? null : name;
      this.body.querySelectorAll<HTMLElement>('.pad-file').forEach((li) => {
        li.classList.toggle('open', li.dataset.file === this.openFile);
      });
    });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) handlers.onClose();
    });
    this.render(ship, me, players, onBridge);
    ui.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  /**
   * Redraw from the latest state (the pad stays open while quest tasks complete or Files are saved). `onBridge` decides
   * whether the Captain's orders block offers Accept or points the player to the Bridge.
   */
  render(ship: ShipMeta, me: PlayerState, players: Map<string, PlayerState>, onBridge = false) {
    const crew = [...players.values()].filter((p) => p.character);
    const job = me.character!.job;
    const others = [...players.values()].filter((p) => p.character && p.id !== me.id);
    const reportedCount = others.filter((p) => p.reportedIn).length;
    const isCaptainComms = job === 'Captain' && me.questStep === 'captain-comms';
    const canOpenComms = isCaptainComms && reportedCount >= 1;
    const task = isCaptainComms
      ? captainCommsObjective([...players.values()], me.id)
      : me.questStep === 'done'
        ? scavengerObjective(me.scavenger)
        : questObjective(me.questStep, job, me.isClone, me.hasPad, me.berth);
    const memory =
      me.berth === null
        ? 'No berth claimed · no memory upload on record'
        : `${esc(berthLabel(me.berth))} · last upload ${me.lastUploadAt ? formatUploadTime(me.lastUploadAt) : 'never'}`;
    const scanLogs = me.padScanLogs.length
      ? `<ul class="pad-scan-logs">${me.padScanLogs
          .map(
            (s) =>
              `<li class="pad-scan-log"><div class="pad-scan-head"><span class="pad-file-time">${esc(formatPadTime(s.at))}</span><b>${esc(s.headline)}</b><button type="button" class="btn ghost small pad-archive" data-archive-kind="scan" data-archive-id="${esc(s.id)}">Archive</button></div><p class="muted">${esc(s.distanceLabel)} · ${esc(s.summary)}</p></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No scan contacts logged yet. Run a successful Bridge sensor scan.</p>';
    const files = me.padFiles.length
      ? `<ul class="pad-files">${me.padFiles
          .map(
            (f) =>
              `<li class="pad-file${this.openFile === f.name ? ' open' : ''}" data-file="${esc(f.name)}"><button type="button" class="pad-file-row" data-file="${esc(f.name)}"><span class="pad-file-time">${esc(formatPadTime(f.at))}</span><span class="pad-file-name">${esc(f.name)}</span></button><button type="button" class="btn ghost small pad-archive" data-archive-kind="file" data-archive-id="${esc(f.name)}">Archive</button><p class="pad-file-text">${esc(f.text)}</p></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No files saved. Open a File from your inventory to keep a copy here.</p>';
    const scavengerArchive =
      me.scavenger && scavengerComplete(me.scavenger)
        ? `<div class="pad-archive-row"><p class="muted">Scavenger hunt complete.</p><button type="button" class="btn ghost small pad-archive" data-archive-kind="scavenger" data-archive-id="scavenger">Archive quest log</button></div>`
        : '';
    this.body.innerHTML = `
      <p class="kicker">Welcome back</p>
      <p>Ship <b>${esc(ship.shipName)}</b> · ${ship.transitYears} years in transit · hull &amp; life support <i>nominal (placeholder)</i></p>
      <h4>Crew aboard</h4>
      <ul>${crew.map((p) => `<li><b>${esc(p.character!.job)}</b> ${esc(p.character!.firstName)} ${esc(p.character!.lastName)}${p.reportedIn ? ' ✓' : ''}</li>`).join('')}</ul>
      <h4>Memory backup</h4>
      <p>${memory}</p>
      <h4>Your task</h4>
      <p>${esc(task)}</p>
      ${scavengerAwaiting(me) ? ordersHtml(onBridge) : ''}
      ${me.scavenger ? scavengerListHtml(me.scavenger) : ''}
      ${scavengerArchive}
      <h4>Scan log</h4>
      ${scanLogs}
      <h4>Files</h4>
      ${files}`;
    this.footer.hidden = !isCaptainComms;
    this.footer.innerHTML = isCaptainComms
      ? `<button class="btn primary report-in" ${canOpenComms ? '' : 'disabled'}>Open comms channel</button>
          ${canOpenComms ? '' : '<p class="muted pad-hint">Opens when at least one crew member reports in at the bridge.</p>'}`
      : '';
  }

  destroy() {
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 300);
  }
}

function formatPadTime(at: number) {
  const d = new Date(at);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Between the opening and the hunt: the Captain's orders are waiting; Accept on the Bridge, directions elsewhere. */
function ordersHtml(onBridge: boolean) {
  return `
      <div class="pad-orders${onBridge ? ' here' : ''}">
        <div class="pad-orders-title">${esc(SCAVENGER_ORDERS_TITLE)}</div>
        <p>${esc(SCAVENGER_ORDERS_TEXT)}</p>
        ${onBridge ? '<button type="button" class="btn primary small pad-accept">Accept orders</button>' : `<p class="muted pad-hint">${esc(SCAVENGER_OFF_BRIDGE)}</p>`}
      </div>`;
}

/** The scavenger hunt on the pad: the Captain's intro, each task with Complete once done, in order. */
function scavengerListHtml(state: ScavengerState) {
  const done = scavengerComplete(state);
  const cur = scavengerCurrentTask(state);
  const rows = SCAVENGER_TASKS.map((t, i) => {
    const at = state.done[t.id];
    const cls = at !== undefined ? 'done' : cur?.id === t.id ? 'current' : 'later';
    const mark = at !== undefined ? `<span class="pad-task-state">Complete</span>` : cur?.id === t.id ? `<span class="pad-task-state now">Current</span>` : '';
    return `<li class="pad-task ${cls}"><span class="pad-task-n">${i + 1}</span><span class="pad-task-text">${esc(t.text)}</span>${mark}</li>`;
  }).join('');
  return `
      <h4>${esc(SCAVENGER_TITLE)}${done ? ' · complete' : ''}</h4>
      <p class="pad-quest-intro">${esc(SCAVENGER_INTRO)}</p>
      <ol class="pad-tasks">${rows}</ol>`;
}

// ---------------------------------------------------------------- hud

export class Hud {
  readonly el = h('div', 'hud');
  private crew: HTMLElement;
  private hint = h('div', 'controls-hint');
  private status = h('div', 'move-status');
  private roomBanner = h('div', 'room-banner');
  private bar: HTMLElement | null = null;
  private gaitLabel: HTMLElement | null = null;
  private loc: HTMLElement | null = null;
  private lastStatus = '';
  private lastRoom = '';
  private roomTimer = 0;
  private objective = h('div', 'objective-line');
  private inventory = h('div', 'inventory-strip');
  private interactPrompt = h('div', 'interact-prompt');
  /** Set by the app: save the character, disconnect and go back to the landing screen. */
  onLogout: (() => void) | null = null;
  /** Set by the app: the host or Captain deletes a saved character from the ship roster (server re-checks). */
  onRosterDelete: ((characterId: string) => void) | null = null;
  private roster: HTMLElement;
  private rosterList: HTMLElement;
  private rosterConfirm: string | null = null;
  private players = new Map<string, PlayerState>();

  constructor(
    private code: string,
    private selfId: string,
  ) {
    const link = inviteLink(code);
    this.el.innerHTML = `
      <div class="panel ship-card">
        <div class="ship-name">FIRST CONTACT <span class="loc">· Lunar orbit · Hibernation &amp; Cloning Bay</span></div>
        <div class="invite">
          <div><div class="label">Invite code</div><div class="code-big">${esc(code)}</div></div>
          <button class="btn small" data-act="copy">Copy invite link</button>
        </div>
        <div class="crew-head"><span class="label">Crew aboard</span><span class="crew-count"></span></div>
        <ul class="crew"></ul>
        <div class="roster" hidden>
          <div class="crew-head"><span class="label">Ship roster</span><span class="crew-count roster-count"></span></div>
          <ul class="crew roster-list"></ul>
        </div>
        <div class="logout-row">
          <button class="btn small ghost" data-act="logout" title="Save and return to the landing screen">Log out</button>
          <span class="logout-confirm" hidden>Back to quarters? <button class="btn small primary" data-act="logout-yes">Log out</button><button class="btn small ghost" data-act="logout-no">Stay</button></span>
        </div>
      </div>`;
    this.crew = this.el.querySelector('.crew')!;
    this.roster = this.el.querySelector('.roster')!;
    this.rosterList = this.el.querySelector('.roster-list')!;
    this.rosterList.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b) return;
      const id = b.closest<HTMLElement>('[data-id]')!.dataset.id!;
      if (b.dataset.act === 'roster-delete') this.rosterConfirm = id;
      else if (b.dataset.act === 'roster-keep') this.rosterConfirm = null;
      else if (b.dataset.act === 'roster-confirm') {
        this.rosterConfirm = null;
        b.textContent = 'Deleting…';
        b.disabled = true;
        this.onRosterDelete?.(id);
        return;
      }
      this.renderRoster();
    });
    const logoutRow = this.el.querySelector<HTMLElement>('.logout-row')!;
    const logoutBtn = this.el.querySelector<HTMLButtonElement>('[data-act=logout]')!;
    const confirm = this.el.querySelector<HTMLElement>('.logout-confirm')!;
    // The confirm replaces the trigger (one "Log out" on screen at a time); Stay swaps back.
    const confirming = (on: boolean) => {
      logoutRow.classList.toggle('confirming', on);
      logoutBtn.hidden = on;
      confirm.hidden = !on;
    };
    logoutBtn.addEventListener('click', () => confirming(true));
    this.el.querySelector('[data-act=logout-no]')!.addEventListener('click', () => confirming(false));
    this.el.querySelector<HTMLButtonElement>('[data-act=logout-yes]')!.addEventListener('click', (e) => {
      (e.currentTarget as HTMLButtonElement).textContent = 'Saving…';
      confirm.querySelectorAll('button').forEach((b) => (b.disabled = true));
      this.onLogout?.();
    });
    this.el.querySelector('[data-act=copy]')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Invite link copied');
      } catch {
        prompt('Copy this invite link:', link);
      }
    });
    this.hint.innerHTML = `<kbd>W</kbd><kbd>S</kbd> move · <kbd>A</kbd><kbd>D</kbd> strafe · <kbd>Shift</kbd> run · <kbd>I</kbd> inventory · right-drag turn · left-drag orbit · scroll zoom`;
    this.hint.hidden = true;
    this.status.hidden = true;
    this.status.innerHTML = `<span class="gait">WALK</span><div class="stamina"><i></i></div>`;
    this.bar = this.status.querySelector('.stamina i');
    this.gaitLabel = this.status.querySelector('.gait');
    this.loc = this.el.querySelector('.loc');
    this.inventory.innerHTML = `<span class="label">Gear</span><div class="slots"><span class="slot empty" title="Communicator">📟</span></div><span class="bunk-line" hidden></span>`;
    ui.append(this.el, this.hint, this.status, this.roomBanner, this.objective, this.inventory, this.interactPrompt);
  }

  /** Claimed berth and last memory upload, next to the gear slots. */
  setBerth(berth: number | null, lastUploadAt: number | null) {
    const line = this.inventory.querySelector<HTMLElement>('.bunk-line');
    if (!line) return;
    if (berth === null) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.innerHTML = `<b>${esc(berthLabel(berth))}</b> · upload ${lastUploadAt ? esc(formatUploadTime(lastUploadAt)) : 'never'}`;
  }

  setObjective(text: string) {
    this.objective.textContent = text;
    this.objective.hidden = !text;
  }

  setInteractPrompt(text: string | null) {
    if (!text) {
      this.interactPrompt.hidden = true;
      return;
    }
    this.interactPrompt.hidden = false;
    this.interactPrompt.innerHTML = `<kbd>Click</kbd> ${esc(text)}`;
  }

  setHasPad(has: boolean) {
    const slot = this.inventory.querySelector('.slot');
    if (!slot) return;
    slot.classList.toggle('empty', !has);
    slot.classList.toggle('filled', has);
  }

  syncPlayerQuest(
    job: Job | null,
    step: QuestStep,
    isClone: boolean,
    hasPad: boolean,
    players?: Map<string, PlayerState>,
    selfId?: string,
    berth: number | null = null,
  ) {
    if (job === 'Captain' && step === 'captain-comms' && players && selfId) {
      this.setObjective(captainCommsObjective([...players.values()], selfId));
      return;
    }
    this.setObjective(questObjective(step, job, isClone, hasPad, berth));
  }

  showControls(show: boolean) {
    this.hint.hidden = !show;
    this.status.hidden = !show;
  }

  /** The local player moved into a room or corridor: update the location line and flash the room name. */
  setSpace(space: Space) {
    if (this.loc) this.loc.textContent = `· ${space.name}`;
    if (space.kind !== 'room' || space.name === this.lastRoom) {
      if (space.kind === 'room') this.lastRoom = space.name;
      return;
    }
    this.lastRoom = space.name;
    this.roomBanner.textContent = space.name;
    this.roomBanner.classList.remove('show');
    void this.roomBanner.offsetWidth;
    this.roomBanner.classList.add('show');
    clearTimeout(this.roomTimer);
    this.roomTimer = window.setTimeout(() => this.roomBanner.classList.remove('show'), 2600);
  }

  setStatus(s: { gait: Gait; stamina: number; exhausted: boolean }) {
    const sig = `${s.gait}|${Math.round(s.stamina * 100)}|${s.exhausted}`;
    if (sig === this.lastStatus) return;
    this.lastStatus = sig;
    if (this.bar) this.bar.style.width = `${Math.round(s.stamina * 100)}%`;
    this.status.classList.toggle('empty', s.exhausted);
    this.status.classList.toggle('full', s.stamina >= 0.995);
    if (this.gaitLabel) this.gaitLabel.textContent = s.gait === 'sprint' ? 'RUN' : 'WALK';
  }

  /**
   * Crew = who is aboard right now (the cap counts these). The host and the Captain also get the ship roster: every
   * saved character, online or not, with Delete on the offline ones. Everyone else manages only their own characters,
   * from the pick lists.
   */
  render(players: Map<string, PlayerState>) {
    this.players = players;
    const list = [...players.values()].filter((p) => p.connected).sort((a, b) => a.tube - b.tube);
    this.el.querySelector('.crew-count')!.textContent = `${list.length}/${MAX_CREW}`;
    this.crew.innerHTML = list
      .map((p) => {
        const c = p.character;
        const color = c ? JOB_INFO[c.job].color : '#6b7a90';
        const name = c ? `<b style="color:${color}">${c.job}</b> ${esc(c.firstName)} ${esc(c.lastName)}` : `<i>Forming in CL-0${p.tube + 1}</i>`;
        const tags = [p.id === this.selfId ? '<span class="tag-you">you</span>' : '', p.isHost ? '<span class="tag-host">host</span>' : '']
          .filter(Boolean)
          .join('');
        return `<li><span class="dot" style="background:${color}"></span><span class="who">${name}</span>${tags}</li>`;
      })
      .join('');
    this.renderRoster();
  }

  private renderRoster() {
    const me = this.players.get(this.selfId);
    const manages = !!me && (me.isHost || me.character?.job === 'Captain');
    const saved = [...this.players.values()].filter((p) => p.character);
    this.roster.hidden = !manages || saved.length === 0;
    if (this.roster.hidden) return;
    if (this.rosterConfirm && !this.players.has(this.rosterConfirm)) this.rosterConfirm = null;
    this.roster.querySelector('.roster-count')!.textContent = `${saved.length} saved`;
    this.rosterList.innerHTML = saved
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.tube - b.tube)
      .map((p) => {
        const c = p.character!;
        const color = JOB_INFO[c.job].color;
        const name = `<b style="color:${color}">${c.job}</b> ${esc(c.firstName)} ${esc(c.lastName)}`;
        if (this.rosterConfirm === p.id) {
          return `<li class="confirm" data-id="${esc(p.id)}"><span class="who">Delete ${esc(c.firstName)} ${esc(c.lastName)}?</span><span class="roster-actions"><button type="button" class="btn small danger" data-act="roster-confirm">Delete</button><button type="button" class="btn small ghost" data-act="roster-keep">Keep</button></span></li>`;
        }
        const tags = [p.id === this.selfId ? '<span class="tag-you">you</span>' : '', p.isHost ? '<span class="tag-host">host</span>' : '', p.connected ? '' : '<span class="tag-off">offline</span>']
          .filter(Boolean)
          .join('');
        const del = !p.connected ? `<button type="button" class="btn small ghost roster-del" data-act="roster-delete" title="Delete this saved character from the ship">Delete</button>` : '';
        return `<li class="${p.connected ? '' : 'offline'}" data-id="${esc(p.id)}"><span class="dot" style="background:${color}"></span><span class="who">${name}</span>${tags}${del}</li>`;
      })
      .join('');
  }

  destroy() {
    this.el.remove();
    this.hint.remove();
    this.status.remove();
    this.roomBanner.remove();
  }
}

export function inviteLink(code: string) {
  return `${location.origin}${location.pathname}?ship=${code}`;
}

let toastTimer = 0;
export function toast(msg: string) {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div', 'toast');
    ui.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2600);
}

export function banner(msg: string, action?: { label: string; run(): void }) {
  document.querySelector('.banner')?.remove();
  const el = h('div', 'banner panel', `<span>${esc(msg)}</span>`);
  if (action) {
    const b = h('button', 'btn small primary');
    b.textContent = action.label;
    b.onclick = action.run;
    el.appendChild(b);
  }
  ui.appendChild(el);
}

// ---------------------------------------------------------------- creator

const FACE_LABELS: Record<(typeof FACES)[number], string> = { neutral: 'Neutral', smiling: 'Smiling', serious: 'Serious', angry: 'Angry', flirty: 'Flirty', calm: 'Calm', determined: 'Determined', smirk: 'Smirk' };

export class CreatorPanel {
  readonly el = h('div', 'creator panel');
  private draft: Character;
  private taken: Job[] = [];
  private busy = false;
  private error: HTMLElement;
  private createBtn: HTMLButtonElement;

  constructor(
    defaultJob: Job,
    private handlers: { onChange(a: Appearance & { job: Job }): void; onCreate(c: Character): void },
  ) {
    this.draft = {
      sex: 'male',
      face: 'neutral',
      hairStyle: defaultHairStyle('male'),
      facialHair: 'none',
      hairColor: HAIR_COLORS.find((c) => c.name === 'Brown')!.hex,
      eyeColor: EYE_COLORS.find((c) => c.name === 'Blue')!.hex,
      job: defaultJob,
      firstName: '',
      lastName: '',
    };
    const seg = (key: string, opts: [string, string][], wrap = false) =>
      `<div class="seg${wrap ? ' wrap' : ''}" data-key="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
    const swatches = (key: string, list: readonly { name: string; hex: string }[]) =>
      `<div class="swatches" data-key="${key}">${list.map((c) => `<button type="button" data-v="${c.hex}" title="${c.name}" style="--c:${c.hex}"></button>`).join('')}</div>`;

    this.el.innerHTML = `
      <header>
        <div class="kicker">Clone lab · Genome console</div>
        <h2>Design your clone</h2>
        <p class="muted">Your body is still forming in the tube. Choose how it turns out.</p>
      </header>
      <div class="scroll">
        <div class="field"><label>Body</label>${seg('sex', [['male', 'Male'], ['female', 'Female']])}</div>
        <div class="field"><label>Face</label>${seg('face', FACES.map((f) => [f, FACE_LABELS[f]]), true)}</div>
        <div class="field"><label>Hair</label>${seg('hairStyle', [])}</div>
        <div class="field" data-only="male"><label>Facial hair</label>${seg('facialHair', [['none', 'None'], ['stubble', 'Stubble'], ['beard', 'Full beard']])}</div>
        <div class="field"><label>Hair color <span class="val" data-val="hairColor"></span></label>${swatches('hairColor', HAIR_COLORS)}</div>
        <div class="field"><label>Eye color <span class="val" data-val="eyeColor"></span></label>${swatches('eyeColor', EYE_COLORS)}</div>
        <div class="field"><label>Starting job</label><div class="jobs"></div></div>
        <div class="field names">
          <div><label for="fn">First name</label><input id="fn" class="input" maxlength="16" autocomplete="off" placeholder="Ada" /></div>
          <div><label for="ln">Last name</label><input id="ln" class="input" maxlength="16" autocomplete="off" placeholder="Okafor" /></div>
        </div>
      </div>
      <footer>
        <div class="error" role="alert"></div>
        <button class="btn primary big create">Create</button>
      </footer>`;
    this.error = this.el.querySelector('.error')!;
    this.createBtn = this.el.querySelector('.create')!;

    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
      if (!b || this.busy) return;
      const key = (b.closest('[data-key]') as HTMLElement).dataset.key as keyof Character;
      if (b.disabled) return;
      (this.draft as unknown as Record<string, string>)[key] = b.dataset.v!;
      if (this.draft.sex === 'female') this.draft.facialHair = 'none';
      if (!hairStyleAvailable(this.draft.sex, this.draft.hairStyle)) this.draft.hairStyle = defaultHairStyle(this.draft.sex);
      this.error.textContent = '';
      this.sync();
      this.handlers.onChange(this.appearance());
    });
    for (const [id, key] of [['fn', 'firstName'], ['ln', 'lastName']] as const) {
      const input = this.el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.addEventListener('input', () => {
        this.draft[key] = input.value;
        this.error.textContent = '';
      });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && this.submit());
    }
    this.createBtn.addEventListener('click', () => this.submit());
    this.sync();
    ui.appendChild(this.el);
    this.handlers.onChange(this.appearance());
  }

  appearance(): Appearance & { job: Job } {
    const { sex, face, hairStyle, facialHair, hairColor, eyeColor, job } = this.draft;
    return { sex, face, hairStyle, facialHair, hairColor, eyeColor, job };
  }

  setTakenJobs(taken: Job[]) {
    this.taken = taken;
    if (jobCheck(taken, this.draft.job)) {
      const free = JOBS.find((j) => !jobCheck(taken, j));
      if (free) this.draft.job = free;
    }
    this.sync();
  }

  private sync() {
    const d = this.draft as unknown as Record<string, string>;
    this.el.querySelector<HTMLElement>('[data-key=hairStyle]')!.innerHTML = HAIR_STYLES[this.draft.sex]
      .map((h) => `<button type="button" data-v="${h.id}">${h.name}</button>`)
      .join('');
    this.el.querySelectorAll<HTMLElement>('[data-key]').forEach((group) => {
      const v = d[group.dataset.key!];
      group.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    });
    this.el.querySelector<HTMLElement>('[data-only=male]')!.hidden = this.draft.sex !== 'male';
    this.el.querySelector('[data-val=hairColor]')!.textContent = HAIR_COLORS.find((c) => c.hex === this.draft.hairColor)?.name ?? '';
    this.el.querySelector('[data-val=eyeColor]')!.textContent = EYE_COLORS.find((c) => c.hex === this.draft.eyeColor)?.name ?? '';

    const jobs = this.el.querySelector<HTMLElement>('.jobs')!;
    jobs.dataset.key = 'job';
    jobs.innerHTML = JOBS.map((j) => {
      const count = this.taken.filter((t) => t === j).length;
      const reason = jobCheck(this.taken, j);
      const info = JOB_INFO[j];
      const aboard = j === 'Captain' ? (count ? 'aboard' : 'open') : count ? `${count} aboard` : 'none aboard';
      return `<button type="button" class="job ${j === this.draft.job ? 'active' : ''}" data-v="${j}" ${reason ? 'disabled' : ''} style="--jc:${info.color}" title="${esc(reason ?? info.blurb)}">
        <span class="job-top"><b>${j}</b><span class="cap">${aboard}</span></span>
        <span class="job-role">${info.role}</span>
        <span class="job-blurb">${reason ? esc(reason) : info.blurb}</span>
      </button>`;
    }).join('');
  }

  private submit() {
    if (this.busy) return;
    const first = this.draft.firstName.trim();
    const last = this.draft.lastName.trim();
    if (!first || !last) return this.showError('Your clone needs a first and last name.');
    if (!NAME_PATTERN.test(first) || !NAME_PATTERN.test(last)) return this.showError("Names are 1–16 letters (spaces, ' and - allowed).");
    const reason = jobCheck(this.taken, this.draft.job);
    if (reason) return this.showError(reason);
    this.busy = true;
    this.createBtn.disabled = true;
    this.createBtn.textContent = 'Decanting clone…';
    this.handlers.onCreate({ ...this.draft, firstName: first, lastName: last });
  }

  showError(msg: string) {
    this.busy = false;
    this.createBtn.disabled = false;
    this.createBtn.textContent = 'Create';
    this.error.textContent = msg;
  }

  destroy() {
    this.el.classList.add('leaving');
    setTimeout(() => this.el.remove(), 400);
  }
}

// ---------------------------------------------------------------- joystick

export function joystick(onMove: (x: number, y: number) => void) {
  const base = h('div', 'joystick', '<div class="knob"></div>');
  const knob = base.firstElementChild as HTMLElement;
  let id: number | null = null;
  const R = 48;
  const set = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / R, -dy / R);
  };
  base.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    base.setPointerCapture(id);
    set(e);
  });
  base.addEventListener('pointermove', (e) => e.pointerId === id && set(e));
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = '';
    onMove(0, 0);
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  ui.appendChild(base);
  return base;
}
