import './style.css';
import * as THREE from 'three';
import { Net } from './net';
import { IntroScene } from './scene/intro';
import { LabScene } from './scene/lab';
import { preloadCharacters } from './scene/character';
import type { View } from './scene/common';
import { CharacterPickScreen, CreatorPanel, DataPadOverlay, Hud, IntroOverlay, TitleScreen, WakeIntro, banner, flash, joystick, toast } from './ui';
import { CabinKeypadOverlay, isCabinKeypadId } from './cabinKeypad';
import { cabinKeypadHoverPrompt } from '../../shared/cabinDoorUi';
import { berthFromMemoryStationId, berthOwners, memoryStationHoverPrompt, uploadObjectiveStationIds } from '../../shared/bunks';
import { MemoryUploadOverlay } from './memoryUpload';
import { InventoryOverlay } from './inventory';
import { objectiveInteractId, questObjective } from '../../shared/opening';
import { berthFromClosetId, isItemInteractId, isWorldFileId, itemInteractPrompt, stockPanelById } from '../../shared/items';
import { scavengerHighlightId, scavengerIssueBlock, scavengerObjective } from '../../shared/scavenger';
import type { ClientMsg, InventoryAction, Job, PlayerState, ProfileCharacter, ServerMsg, ShipMeta } from '../../shared/protocol';

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

/**
 * Stable per-browser id; the server keys saved characters on it (friends-only game, no accounts). Older builds used a
 * per-tab id in sessionStorage; it is sent once as `legacyPlayerId` so a character made before this change is adopted.
 */
function clientId() {
  let id = localStorage.getItem('fc.clientId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('fc.clientId', id);
  }
  return id;
}
const legacyPlayerId = () => sessionStorage.getItem('fc.playerId') ?? undefined;

let net: Net | null = null;
let lab: LabScene | null = null;
let hud: Hud | null = null;
let creator: CreatorPanel | null = null;
let picker: CharacterPickScreen | null = null;
let wakeIntro: WakeIntro | null = null;
let pad: DataPadOverlay | null = null;
let cabinKeypad: CabinKeypadOverlay | null = null;
let memoryUpload: MemoryUploadOverlay | null = null;
let inventory: InventoryOverlay | null = null;
let selfId = '';
let shipCode = '';
let shipMeta: ShipMeta | null = null;
let hadPad = false;
const players = new Map<string, PlayerState>();

const invite = new URLSearchParams(location.search).get('ship')?.toUpperCase() ?? null;
const title = new TitleScreen(invite, {
  onHost: () => connect({ t: 'host', clientId: clientId() }),
  onJoin: (code) => connect({ t: 'join', clientId: clientId(), code, legacyPlayerId: legacyPlayerId() }),
  onBoard: (c) => connect({ t: 'join', clientId: clientId(), code: c.shipCode }, c.id),
  onDelete: (c) =>
    deleteSaved(c)
      .catch((err: Error) => title.showError(err.message))
      .finally(() => {
        title.setBusy(false);
        void refreshSaved();
      }),
});
resize();
void refreshSaved();

/** One request on a throwaway socket: send `first`, resolve with the first reply `pick` accepts, close. */
function lobbyRequest<T>(first: ClientMsg, pick: (m: ServerMsg, send: (msg: ClientMsg) => void) => T | undefined, ms = 6000): Promise<T> {
  const n = new Net();
  return n.ready.then(
    () =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          n.close();
          reject(new Error('The ship server did not answer.'));
        }, ms);
        n.onClose = () => {
          clearTimeout(timer);
          reject(new Error('Lost connection to the ship server.'));
        };
        n.on((m) => {
          if (m.t === 'error') {
            clearTimeout(timer);
            n.close();
            reject(new Error(m.message));
            return;
          }
          const out = pick(m, (msg) => n.send(msg));
          if (out === undefined) return;
          clearTimeout(timer);
          n.close();
          resolve(out);
        });
        n.send(first);
      }),
  );
}

/** The landing screen's Continue list: every character this browser owns, on any ship, as the server sees it. */
async function refreshSaved() {
  title.setSaved(null);
  try {
    const characters = await lobbyRequest({ t: 'hello', clientId: clientId() }, (m) => (m.t === 'profile' ? m.characters : undefined));
    title.setSaved(characters);
  } catch {
    title.setSaved([]);
  }
}

/** Delete from the landing screen: join the character's ship just long enough to delete it. */
function deleteSaved(c: ProfileCharacter) {
  let asked = false;
  return lobbyRequest({ t: 'join', clientId: clientId(), code: c.shipCode }, (m, send) => {
    if (m.t !== 'characters') return undefined;
    if (asked) return true;
    asked = true;
    send({ t: 'deleteCharacter', characterId: c.id });
    return undefined;
  });
}

/**
 * Connect and enter a ship. With `boardId` (landing-screen Board) the saved character is picked as soon as the server
 * confirms it is still ours; otherwise the per-ship pick list or the new-character flow takes over.
 */
async function connect(first: ClientMsg, boardId?: string) {
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
    if (m.t === 'characters') {
      // The server lists this browser's saved characters on the ship. Nothing saved: straight into the lab as before.
      if (picker) {
        picker.render(m.characters, m.aboard);
      } else if (boardId && m.characters.some((c) => c.id === boardId)) {
        n.send({ t: 'pickCharacter', characterId: boardId });
      } else if (boardId) {
        off();
        n.close();
        title.setBusy(false);
        title.showError('That character is no longer on the ship.');
        void refreshSaved();
      } else if (m.characters.length === 0) {
        n.send({ t: 'newCharacter' });
      } else {
        title.destroy();
        picker = new CharacterPickScreen(m.code, m.characters, m.aboard, {
          onPick: (characterId) => n.send({ t: 'pickCharacter', characterId }),
          onNew: () => n.send({ t: 'newCharacter' }),
          onDelete: (characterId) => n.send({ t: 'deleteCharacter', characterId }),
        });
      }
    } else if (m.t === 'welcome') {
      off();
      net = n;
      net.on(handle);
      net.onClose = () => banner('Lost connection to the ship.', { label: 'Reconnect', run: () => location.reload() });
      sessionStorage.removeItem('fc.playerId');
      picker?.destroy();
      picker = null;
      onWelcome(m);
    } else if (m.t === 'error') {
      if (picker) {
        if (!m.fatal) return picker.showError(m.message);
        off();
        n.close();
        picker.destroy();
        picker = null;
        banner(m.message, { label: 'Reload', run: () => location.reload() });
        return;
      }
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
  shipMeta = m.ship;
  players.clear();
  m.players.forEach((p) => players.set(p.id, p));
  history.replaceState(null, '', `?ship=${m.code}`);
  title.destroy();

  const me = players.get(selfId)!;
  if (me.character) {
    void startLab().then(() => enterWalk(me));
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
    void startLab().then(() => showWakeLobby());
  });
}

function showWakeLobby() {
  if (!shipMeta) return;
  const me = players.get(selfId)!;
  wakeIntro = new WakeIntro(shipMeta, me.isClone, {
    onStart: () => net?.send({ t: 'startGame' }),
    onContinue: () => beginCreator(),
  });
  wakeIntro.renderCrew(players, selfId);
  if (shipMeta.gameStarted) wakeIntro.enableContinue(() => beginCreator());
}

function beginCreator() {
  wakeIntro?.destroy();
  wakeIntro = null;
  const me = players.get(selfId)!;
  if (!lab) return;
  if (me.character) {
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

/** Jobs of the players aboard right now (the only ones the Captain rule looks at). */
function takenJobs(): Job[] {
  return [...players.values()].filter((p) => p.id !== selfId && p.connected && p.character).map((p) => p.character!.job);
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
    onInteractHover: (id, prompt) => {
      if (isCabinKeypadId(id) && shipMeta) {
        const me = players.get(selfId);
        hud?.setInteractPrompt(cabinKeypadHoverPrompt(shipMeta.cabinDoor.codeSet, me?.character?.job ?? null));
        return;
      }
      const berth = id === null ? null : berthFromMemoryStationId(id);
      if (berth !== null) {
        const owner = berthOwners(players.values()).get(berth) ?? null;
        hud?.setInteractPrompt(memoryStationHoverPrompt(berth, owner, players.get(selfId) ?? null));
        return;
      }
      if (id !== null && isItemInteractId(id)) {
        hud?.setInteractPrompt(itemInteractPrompt(id, players.get(selfId)?.berth ?? null));
        return;
      }
      hud?.setInteractPrompt(prompt);
    },
    onInteract: (id) => {
      const { x, z } = lab!.localPos();
      if (isItemInteractId(id)) {
        const me = players.get(selfId);
        if (!me?.character) return;
        const panel = stockPanelById(id);
        if (panel) {
          // The panel opens locally; the click is reported so the quest hears about it (the materials pad task).
          inventory?.open({ panel });
          net?.send({ t: 'interact', id, x, z });
          return;
        }
        const closetBerth = berthFromClosetId(id);
        if (closetBerth !== null) {
          if (me.berth === null) return toast('Claim a bunk first: upload your memories at its pad.');
          if (me.berth !== closetBerth) return toast(`${closetBerth === 0 ? "The Captain's trunk" : `Closet ${closetBerth}`} is not yours.`);
          return inventory?.open({ closet: closetBerth });
        }
        // World Files: the server copies the File into a carry slot.
        if (isWorldFileId(id)) net?.send({ t: 'interact', id, x, z });
        return;
      }
      if (isCabinKeypadId(id)) {
        const me = players.get(selfId);
        if (!me?.character || !shipMeta) return;
        if (!shipMeta.cabinDoor.codeSet && me.character.job !== 'Captain') {
          toast('Locked. The captain has not set a code.');
          return;
        }
        const keypad = id;
        cabinKeypad?.destroy();
        cabinKeypad = new CabinKeypadOverlay({
          onSubmitSet: (code, confirm) => net?.send({ t: 'cabinKeypad', action: 'set', code, confirm, x, z, keypad }),
          onSubmitEnter: (code) => net?.send({ t: 'cabinKeypad', action: 'enter', code, x, z, keypad }),
          onSubmitChange: (current, code, confirm) =>
            net?.send({ t: 'cabinKeypad', action: 'change', current, code, confirm, x, z, keypad }),
          onClose: () => {
            cabinKeypad = null;
          },
        });
        cabinKeypad.open(shipMeta, me.character.job);
        return;
      }
      net?.send({ t: 'interact', id, x, z });
    },
  });
  view = lab;
  if (import.meta.env.DEV)
    (window as unknown as {
      __fc: {
        lab: LabScene;
        teleport(x: number, z: number, rot?: number): void;
        cabinDoorFrac(f: number): void;
        interact(id: string): void;
      };
    }).__fc = {
      lab,
      teleport: (x, z, rot) => lab?.devTeleport(x, z, rot),
      cabinDoorFrac: (f) => lab?.setCabinDoor({ codeSet: true, open: f > 0.5, animAt: Date.now(), openFrac: f }, true),
      interact: (id) => {
        const { x, z } = lab!.localPos();
        net?.send({ t: 'interact', id, x, z });
      },
    };
  resize();
  hud = new Hud(shipCode, selfId);
  hud.onLogout = logout;
  hud.onRosterDelete = (characterId) => net?.send({ t: 'deleteCharacter', characterId });
  hud.render(players);
  inventory?.destroy();
  inventory = new InventoryOverlay({
    send: (action: InventoryAction) => {
      const { x, z } = lab!.localPos();
      net?.send({ t: 'inv', action, x, z });
    },
    playerPos: () => lab?.localPos() ?? null,
  });
  if (shipMeta) inventory.setStock(shipMeta.stock);
  syncHudSelf();

  const me = players.get(selfId)!;
  for (const p of players.values()) if (p.id !== selfId) lab.syncPlayer(p);
  if (me.character) lab.syncPlayer(me);
  if (shipMeta) lab.setCabinDoor(shipMeta.cabinDoor, true);
  syncBerthOwners();
}

function syncBerthOwners() {
  lab?.setBerthOwners(berthOwners(players.values()));
}

function syncHudSelf() {
  const me = players.get(selfId);
  if (!me || !hud) return;
  hud.setHasPad(me.hasPad);
  hud.setBerth(me.berth, me.lastUploadAt);
  hud.syncPlayerQuest(me.character?.job ?? null, me.questStep, me.isClone, me.hasPad, players, selfId, me.berth);
  // After the opening, the HUD line and the lit station belong to the scavenger hunt (or the prompt to fetch it).
  const scavenging = !!me.character && me.questStep === 'done';
  if (scavenging) hud.setObjective(scavengerObjective(me.scavenger));
  const terminal = !me.character ? null : scavenging ? scavengerHighlightId(me.scavenger) : objectiveInteractId(me.questStep, me.character.job, me.isClone, me.berth);
  const stations = me.character && me.questStep === 'upload-memories' ? uploadObjectiveStationIds(me, players.values()) : [];
  lab?.setQuestHighlight(terminal, stations);
  lab?.setOwnBerth(me.berth);
  inventory?.setInventory(me.inventory);
  if (pad && shipMeta) pad.render(shipMeta, me, players);
}

function toggleInventory() {
  const me = players.get(selfId);
  if (!me?.character || !lab || !inventory) return;
  if (inventory.isOpen) inventory.close();
  else inventory.open();
}

function enterWalk(me: PlayerState) {
  lab!.enterWalk(me);
  hud?.showControls(true);
  hadPad = me.hasPad;
  syncHudSelf();
  if (matchMedia('(pointer: coarse)').matches) joystick((x, y) => lab?.setJoystick(x, y));
}

/**
 * Save and leave: the server writes the save file before acknowledging, then the page reloads without the invite
 * parameter. A fresh page is the cleanest way back to the landing screen (scene, controls, HUD and overlays all go),
 * and the Continue list is the first thing it shows.
 */
async function logout() {
  if (!net) return;
  const n = net;
  n.onClose = null;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2500);
    const off = n.on((m) => {
      if (m.t !== 'loggedOut') return;
      clearTimeout(timer);
      off();
      resolve();
    });
    n.send({ t: 'logout' });
  });
  n.close();
  location.replace(location.pathname);
}

function openPad() {
  const me = players.get(selfId);
  if (!me?.character || !me.hasPad || !shipMeta) return;
  // Opening the pad on the Bridge once the opening quest is done is how the Captain's scavenger hunt is handed out.
  if (!scavengerIssueBlock(me, lab?.currentSpaceId() ?? null)) net?.send({ t: 'scavengerIssue' });
  pad?.destroy();
  pad = new DataPadOverlay(shipMeta, me, players, {
    onReportIn: () => net?.send({ t: 'reportIn' }),
    onClose: () => {
      pad?.destroy();
      pad = null;
    },
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!players.get(selfId)?.character || !lab) return;
    e.preventDefault();
    toggleInventory();
    return;
  }
  if (e.key !== 'p' && e.key !== 'P' && e.key !== 'Tab') return;
  const me = players.get(selfId);
  if (!me?.character || !me.hasPad || !lab) return;
  e.preventDefault();
  if (pad) {
    pad.destroy();
    pad = null;
  } else openPad();
});

function handle(m: ServerMsg) {
  switch (m.t) {
    case 'playerUpdated': {
      const p = m.player;
      const prev = players.get(p.id);
      players.set(p.id, p);
      hud?.render(players);
      if (p.id === selfId) syncHudSelf();
      wakeIntro?.renderCrew(players, selfId);
      if (!lab) return;
      lab.syncPlayer(p);
      syncBerthOwners();
      // Another player's claim can free or take a bunk the upload objective was pointing at.
      if (p.id !== selfId && players.get(selfId)?.questStep === 'upload-memories') syncHudSelf();
      if (p.id === selfId) {
        if (p.hasPad && !hadPad) {
          hadPad = true;
          toast('Data pad added to communicator slot.');
          openPad();
        }
        syncHudSelf();
        if (p.character && creator) {
          creator.destroy();
          creator = null;
          enterWalk(p);
          toast(`Welcome aboard, ${p.character.job} ${p.character.lastName}.`);
        }
      } else {
        creator?.setTakenJobs(takenJobs());
      }
      if (prev && p.questStep === 'done' && prev.questStep !== 'done' && p.id === selfId) {
        toast('Objective complete.');
      }
      break;
    }
    case 'playerLeft': {
      // A deleted character or a forming clone whose window closed: their crew slot, job and bunk are free again.
      players.delete(m.id);
      hud?.render(players);
      wakeIntro?.renderCrew(players, selfId);
      lab?.removePlayer(m.id);
      syncBerthOwners();
      creator?.setTakenJobs(takenJobs());
      syncHudSelf();
      break;
    }
    case 'shipState':
      shipMeta = m.ship;
      lab?.setCabinDoor(m.ship.cabinDoor);
      inventory?.setStock(m.ship.stock);
      wakeIntro?.enableContinue(() => beginCreator());
      break;
    case 'closet':
      inventory?.setCloset(m.slots);
      break;
    case 'invResult':
      if (m.message) toast(m.message);
      // Loot and quest hand-outs open the inventory so the player sees what arrived; opened Files show their text.
      if (m.ok && m.gained && inventory && !inventory.isOpen) inventory.open();
      if (m.ok && m.file) inventory?.showFile(m.file.name, m.file.text);
      break;
    case 'notice':
      toast(m.message);
      break;
    case 'snap':
      lab?.applySnapshot(m.p);
      break;
    case 'cabinDoor':
      if (shipMeta) shipMeta = { ...shipMeta, cabinDoor: m.door };
      lab?.setCabinDoor(m.door);
      break;
    case 'memoryUpload':
      memoryUpload?.close();
      memoryUpload = new MemoryUploadOverlay(m.berth, m.at, m.claimed, m.from, () => {
        memoryUpload = null;
      });
      break;
    case 'cabinKeypadResult':
      if (cabinKeypad) {
        cabinKeypad.showResult(m.ok, m.message, m.flash, m.dismissMs ?? 1200, m.lockoutUntil);
        if (m.ok) cabinKeypad = null;
      } else if (!m.ok && m.message) toast(m.message);
      break;
    case 'createError':
      creator?.showError(m.message);
      break;
    case 'error':
      if (m.fatal && net) net.onClose = null;
      if (!m.fatal) toast(m.message);
      else banner(m.message, m.fatal ? { label: 'Reload', run: () => location.reload() } : undefined);
      break;
    case 'welcome':
    case 'characters':
    case 'profile':
    case 'loggedOut':
      break;
  }
}
