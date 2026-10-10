import './style.css';
import * as THREE from 'three';
import { Net } from './net';
import { IntroScene } from './scene/intro';
import { LabScene } from './scene/lab';
import { preloadCharacters } from './scene/character';
import type { View } from './scene/common';
import { CreatorPanel, Hud, IntroOverlay, TitleScreen, banner, flash, joystick, toast } from './ui';
import type { ClientMsg, Job, PlayerState, ServerMsg } from '../../shared/protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const intro = new IntroScene(renderer);
let view: View = intro;
const characters = preloadCharacters();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  intro.resize(w, h);
  lab?.resize(w, h);
}
window.addEventListener('resize', resize);

const timer = new THREE.Timer();
let introOverlay: IntroOverlay | null = null;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  view.update(dt);
  view.render();
  introOverlay?.setCaption(intro.caption());
});

// Per-tab identity so two windows in one browser are two crewmates; survives reloads.
function playerId() {
  let id = sessionStorage.getItem('fc.playerId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('fc.playerId', id);
  }
  return id;
}

let net: Net | null = null;
let lab: LabScene | null = null;
let hud: Hud | null = null;
let creator: CreatorPanel | null = null;
let selfId = '';
let shipCode = '';
let hostId = '';
const players = new Map<string, PlayerState>();

const invite = new URLSearchParams(location.search).get('ship')?.toUpperCase() ?? null;
const title = new TitleScreen(invite, {
  onHost: () => connect({ t: 'host', playerId: playerId() }),
  onJoin: (code) => connect({ t: 'join', playerId: playerId(), code }),
});
resize();

async function connect(first: ClientMsg) {
  title.setBusy(true, 'Connecting…');
  const n = new Net();
  try {
    await n.ready;
  } catch (err) {
    title.setBusy(false);
    title.showError((err as Error).message);
    return;
  }
  const off = n.on((m) => {
    if (m.t === 'welcome') {
      off();
      net = n;
      net.on(handle);
      net.onClose = () => banner('Lost connection to the ship.', { label: 'Reconnect', run: () => location.reload() });
      onWelcome(m);
    } else if (m.t === 'error') {
      off();
      n.close();
      title.setBusy(false);
      title.showError(m.message);
    }
  });
  n.send(first);
}

function onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>) {
  selfId = m.you;
  shipCode = m.code;
  hostId = m.hostId;
  players.clear();
  m.players.forEach((p) => players.set(p.id, p));
  history.replaceState(null, '', `?ship=${m.code}`);
  title.destroy();

  const me = players.get(selfId)!;
  if (me.character) {
    void startLab();
    return;
  }

  introOverlay = new IntroOverlay(() => intro.skip());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter') intro.skip();
  };
  window.addEventListener('keydown', onKey);
  intro.play(() => {
    window.removeEventListener('keydown', onKey);
    introOverlay?.destroy();
    introOverlay = null;
    flash();
    void startLab();
  });
}

function takenJobs(): Job[] {
  return [...players.values()].filter((p) => p.id !== selfId && p.character).map((p) => p.character!.job);
}

async function startLab() {
  if (lab) return;
  try {
    await characters;
  } catch {
    banner('Could not load the crew models. Check your connection.', { label: 'Reload', run: () => location.reload() });
    return;
  }
  lab = new LabScene(renderer, document.getElementById('app')!, selfId, {
    onMove: (x, z, rot, moving) => net?.send({ t: 'move', x, z, rot, moving }),
    onSpace: (space) => hud?.setSpace(space),
    onStatus: (status) => hud?.setStatus(status),
  });
  view = lab;
  if (import.meta.env.DEV) (window as unknown as { __fc: unknown }).__fc = { lab };
  resize();
  hud = new Hud(shipCode, selfId, hostId);
  hud.render(players);

  const me = players.get(selfId)!;
  for (const p of players.values()) if (p.id !== selfId) lab.syncPlayer(p);

  if (me.character) {
    lab.syncPlayer(me);
    enterWalk(me);
    return;
  }

  lab.enterCreator(me.tube, me);
  const taken = takenJobs();
  const defaultJob: Job = taken.includes('Captain') ? 'Engineer' : 'Captain';
  creator = new CreatorPanel(defaultJob, {
    onChange: (a) => lab?.setPreview(a, players.get(selfId)!),
    onCreate: (character) => net?.send({ t: 'create', character }),
  });
  creator.setTakenJobs(taken);
}

function enterWalk(me: PlayerState) {
  lab!.enterWalk(me);
  hud?.showControls(true);
  if (matchMedia('(pointer: coarse)').matches) joystick((x, y) => lab?.setJoystick(x, y));
}

function handle(m: ServerMsg) {
  switch (m.t) {
    case 'playerUpdated': {
      const p = m.player;
      players.set(p.id, p);
      hud?.render(players);
      if (!lab) return;
      lab.syncPlayer(p);
      if (p.id === selfId && p.character && creator) {
        creator.destroy();
        creator = null;
        enterWalk(p);
        toast(`Welcome aboard, ${p.character.job} ${p.character.lastName}.`);
      } else if (p.id !== selfId) {
        creator?.setTakenJobs(takenJobs());
      }
      break;
    }
    case 'snap':
      lab?.applySnapshot(m.p);
      break;
    case 'createError':
      creator?.showError(m.message);
      break;
    case 'error':
      if (m.fatal && net) net.onClose = null;
      banner(m.message, m.fatal ? { label: 'Reload', run: () => location.reload() } : undefined);
      break;
    case 'welcome':
      break;
  }
}
