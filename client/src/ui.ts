import {
  EYE_COLORS,
  FACES,
  HAIR_COLORS,
  HAIR_STYLES,
  JOBS,
  JOB_CAPS,
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
} from '../../shared/protocol';
import type { Gait } from '../../shared/movement';
import type { Space } from '../../shared/shipInterior';

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

  constructor(invite: string | null, handlers: { onHost(): void; onJoin(code: string): void }) {
    this.el.innerHTML = `
      <div class="brand">
        <div class="kicker">Invite-only co-op · 1–6 crew</div>
        <h1>FIRST<br/><span>CONTACT</span></h1>
        <p class="tag">An alien signal. A ship built from its blueprints. Six berths, one Captain, and a very long way to go.</p>
      </div>
      <div class="card panel">
        ${invite ? `<div class="invite-banner">You've been invited aboard ship <b>${esc(invite)}</b></div>` : ''}
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

  setBusy(busy: boolean, label?: string) {
    this.buttons.forEach((b) => {
      b.disabled = busy;
      if (!b.dataset.label) b.dataset.label = b.textContent ?? '';
      b.textContent = busy && label ? label : b.dataset.label;
    });
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

  constructor(
    private code: string,
    private selfId: string,
    private hostId: string,
  ) {
    const link = inviteLink(code);
    this.el.innerHTML = `
      <div class="panel ship-card">
        <div class="ship-name">FIRST CONTACT <span class="loc">· Lunar orbit · Hibernation &amp; Cloning Bay</span></div>
        <div class="invite">
          <div><div class="label">Invite code</div><div class="code-big">${esc(code)}</div></div>
          <button class="btn small" data-act="copy">Copy invite link</button>
        </div>
        <div class="crew-head"><span class="label">Crew</span><span class="crew-count"></span></div>
        <ul class="crew"></ul>
      </div>`;
    this.crew = this.el.querySelector('.crew')!;
    this.el.querySelector('[data-act=copy]')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Invite link copied');
      } catch {
        prompt('Copy this invite link:', link);
      }
    });
    this.hint.innerHTML = `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>C</kbd> walk/jog · drag to look · scroll to zoom`;
    this.hint.hidden = true;
    this.status.hidden = true;
    this.status.innerHTML = `<span class="gait">JOG</span><div class="stamina"><i></i></div>`;
    this.bar = this.status.querySelector('.stamina i');
    this.gaitLabel = this.status.querySelector('.gait');
    this.loc = this.el.querySelector('.loc');
    ui.append(this.el, this.hint, this.status, this.roomBanner);
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

  setStatus(s: { gait: Gait; stamina: number; exhausted: boolean; walkMode: boolean }) {
    const sig = `${s.gait}|${Math.round(s.stamina * 100)}|${s.exhausted}`;
    if (sig === this.lastStatus) return;
    this.lastStatus = sig;
    if (this.bar) this.bar.style.width = `${Math.round(s.stamina * 100)}%`;
    this.status.classList.toggle('empty', s.exhausted);
    this.status.classList.toggle('full', s.stamina >= 0.995);
    if (this.gaitLabel) this.gaitLabel.textContent = s.gait.toUpperCase();
  }

  render(players: Map<string, PlayerState>) {
    const list = [...players.values()].sort((a, b) => a.tube - b.tube);
    this.el.querySelector('.crew-count')!.textContent = `${list.length}/${MAX_CREW}`;
    this.crew.innerHTML = list
      .map((p) => {
        const c = p.character;
        const color = c ? JOB_INFO[c.job].color : '#6b7a90';
        const name = c ? `<b style="color:${color}">${c.job}</b> ${esc(c.firstName)} ${esc(c.lastName)}` : `<i>Forming in CL-0${p.tube + 1}</i>`;
        const tags = [p.id === this.selfId ? '<span class="tag-you">you</span>' : '', p.id === this.hostId ? '<span class="tag-host">host</span>' : '']
          .filter(Boolean)
          .join('');
        return `<li class="${p.connected ? '' : 'offline'}"><span class="dot" style="background:${color}"></span><span class="who">${name}</span>${tags}${p.connected ? '' : '<span class="tag-off">offline</span>'}</li>`;
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
    private handlers: { onChange(a: Appearance): void; onCreate(c: Character): void },
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
      if (key !== 'job') this.handlers.onChange(this.appearance());
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

  appearance(): Appearance {
    const { sex, face, hairStyle, facialHair, hairColor, eyeColor } = this.draft;
    return { sex, face, hairStyle, facialHair, hairColor, eyeColor };
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
      return `<button type="button" class="job ${j === this.draft.job ? 'active' : ''}" data-v="${j}" ${reason ? 'disabled' : ''} style="--jc:${info.color}" title="${esc(reason ?? info.blurb)}">
        <span class="job-top"><b>${j}</b><span class="cap">${count}/${JOB_CAPS[j]}</span></span>
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
