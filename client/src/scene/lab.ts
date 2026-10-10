import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { makeComposer, type View } from './common';
import { animateRig, buildRig, disposeRig, floatRig, type Rig } from './character';
import { ShipInterior } from './shipInterior';
import { TUBE_X, TUBE_Y, TUBE_Z } from '../../../shared/lab';
import { clampToShip, spaceAt, type Space } from '../../../shared/shipInterior';
import { JOG_SPEED, SPRINT_SPEED, Stamina, WALK_SPEED, gaitFromSpeed, type Gait } from '../../../shared/movement';
import { JOB_INFO, type Appearance, type Job, type PlayerState, type SnapEntry } from '../../../shared/protocol';

const SEND_INTERVAL = 1 / 15;
const EYE = 1.45;
const DEFAULT_CAM_PITCH = 0.34;
const CAM_RETURN_SMOOTH_S = 0.45;
const CAM_RETURN_FAST_S = 0.12;

const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);

function previewPose(tube: number): [number, number, number] {
  const x = TUBE_X[tube];
  return [x - 0.12, 0, TUBE_Z + 1.28];
}

/** Keys that trigger browser UI while playing (scroll, focus, quick-find). */
const BROWSER_TRAP_CODES = new Set(['Space', 'Tab', 'Slash', 'Quote', 'Backslash']);

function isUiTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('#ui');
}

type LookDrag = { button: 0 | 2; id: number; x: number; y: number };

interface Entity {
  id: string;
  key: string;
  inTube: boolean;
  rig: Rig;
  label: CSS2DObject | null;
  tx: number;
  tz: number;
  trot: number;
  moving: boolean;
  speed: number;
  lastSnap: number;
  /** Recent snapshot positions [ms, x, z], for the ground speed estimate. */
  track: [number, number, number][];
  spawnFx: number;
}

export interface LabHooks {
  onMove(x: number, z: number, rot: number, moving: boolean): void;
  /** The local player entered a room or corridor. */
  onSpace?(space: Space): void;
  /** Local gait and stamina (0..1), every frame. */
  onStatus?(status: { gait: Gait; stamina: number; exhausted: boolean; walkMode: boolean }): void;
}

export class LabScene implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 400);
  private composer;
  private labels = new CSS2DRenderer();
  private entities = new Map<string, Entity>();
  private interior: ShipInterior;
  private time = 0;
  private space: Space | null = null;
  private stamina = new Stamina();
  private walkMode = false;

  private selfId: string;
  private mode: 'creator' | 'walk' = 'creator';
  private creatorTube = 0;
  private preview: (Appearance & { job?: Job }) | null = null;
  private local = { x: 0, z: 0, rot: 0, moving: false, gait: 'jog' as Gait, speed: 0 };
  private sendTimer = 0;
  private lastSent = '';

  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private camYaw = 0;
  private camPitch = DEFAULT_CAM_PITCH;
  private camDist = 3.9;
  private camPos = new THREE.Vector3(0, 3, 6);
  private camLook = new THREE.Vector3(0, 1, 0);
  private lookDrag: LookDrag | null = null;
  /** Left-drag left the camera off the character's back; ease yaw (and pitch) back. */
  private camReturn: { mode: 'smooth' | 'fast'; fromYaw: number; fromPitch: number; t: number; dur: number } | null = null;
  private cleanup: (() => void)[] = [];
  private focus = new THREE.Vector3();
  private previewStage: THREE.Group | null = null;
  private previewLights: THREE.Light[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    selfId: string,
    private hooks: LabHooks,
  ) {
    this.selfId = selfId;
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);
    this.scene.background = new THREE.Color(0x04060c);
    this.scene.fog = new THREE.Fog(0x04060c, 34, 95);
    this.interior = new ShipInterior();
    this.scene.add(this.interior.root);
    this.composer = makeComposer(renderer, this.scene, this.camera, { strength: 0.4, radius: 0.35, threshold: 1.1 });
    this.bindInput();
  }

  // ---- players ----

  syncPlayer(p: PlayerState) {
    const isSelf = p.id === this.selfId;
    const creatorPreview = isSelf && this.mode === 'creator' && !!this.preview && !p.character;
    let inTube = !p.character && !creatorPreview;
    if (!p.connected && p.character && !isSelf) {
      this.removePlayer(p.id);
      return;
    }
    const app: (Appearance & { job?: Job }) | null = p.character ?? (isSelf && this.mode === 'creator' ? this.preview : null);
    const key = `${inTube ? 'tube' : 'walk'}:${JSON.stringify(app)}:${p.connected}`;
    const existing = this.entities.get(p.id);
    if (existing && existing.key === key) {
      if (!inTube && !isSelf) {
        existing.tx = p.x;
        existing.tz = p.z;
        existing.trot = p.rot;
        existing.moving = p.moving;
      }
      return;
    }
    const wasInTube = existing?.inTube ?? false;
    if (existing) this.removePlayer(p.id);

    const rig = buildRig(app);
    const e: Entity = { id: p.id, key, inTube, rig, label: null, tx: p.x, tz: p.z, trot: p.rot, moving: p.moving, speed: 0, lastSnap: 0, track: [], spawnFx: 0 };
    if (inTube) {
      rig.root.rotation.z = -Math.PI / 2;
      rig.root.position.set(TUBE_X[p.tube] - 0.93, TUBE_Y, TUBE_Z);
      (rig.root.getObjectByName('shadow') as THREE.Object3D).visible = false;
      if (!isSelf) e.label = this.makeLabel(null, p.connected ? 'Forming…' : 'In stasis', false);
      if (e.label) {
        e.label.position.set(TUBE_X[p.tube] + 0.0, TUBE_Y + 0.95, TUBE_Z);
        this.scene.add(e.label);
      }
    } else if (creatorPreview) {
      const [px, , pz] = previewPose(p.tube);
      rig.root.position.set(px, 0, pz);
      rig.root.rotation.y = 0;
      if (this.previewStage) this.previewStage.position.set(px, 0, pz);
    } else {
      const pos = isSelf && this.mode === 'walk' && !wasInTube ? this.local : p;
      rig.root.position.set(pos.x, 0, pos.z);
      rig.root.rotation.y = pos.rot;
      e.label = this.makeLabel(p.character!.job, `${p.character!.firstName} ${p.character!.lastName}`, isSelf);
      e.label.position.y = 2.08;
      rig.root.add(e.label);
      if (wasInTube) {
        e.spawnFx = 1;
        this.interior.flashPod(p.tube);
      }
    }
    this.scene.add(rig.root);
    this.entities.set(p.id, e);
  }

  removePlayer(id: string) {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.label) {
      e.label.removeFromParent();
      e.label.element.remove();
    }
    e.rig.root.removeFromParent();
    disposeRig(e.rig);
    this.entities.delete(id);
  }

  private makeLabel(job: keyof typeof JOB_INFO | null, name: string, self: boolean) {
    const el = document.createElement('div');
    el.className = `nameplate${self ? ' self' : ''}${job ? '' : ' ghost'}`;
    if (job) {
      const j = document.createElement('span');
      j.className = 'np-job';
      j.textContent = job;
      j.style.color = JOB_INFO[job].color;
      el.append(j, ' ');
    }
    const n = document.createElement('span');
    n.textContent = name;
    el.append(n);
    return new CSS2DObject(el);
  }

  applySnapshot(entries: SnapEntry[]) {
    for (const [id, x, z, rot, moving] of entries) {
      if (id === this.selfId) continue;
      const e = this.entities.get(id);
      if (!e || e.inTube) continue;
      // Ground speed over the last ~0.5 s of snapshots. Per-snapshot steps beat against the senders' 15 Hz timer (a step is
      // often zero, then double), which would flicker the gait; a longer baseline does not.
      const now = performance.now();
      e.lastSnap = now;
      if (!moving) {
        e.speed = 0;
        e.track.length = 0;
      } else {
        e.track.push([now, x, z]);
        while (e.track.length > 2 && now - e.track[0][0] > 500) e.track.shift();
        const [t0, x0, z0] = e.track[0];
        if (now - t0 >= 200) e.speed = Math.hypot(x - x0, z - z0) / ((now - t0) / 1000);
      }
      e.tx = x;
      e.tz = z;
      e.trot = rot;
      e.moving = !!moving;
    }
  }

  // ---- modes ----

  enterCreator(tube: number, self: PlayerState) {
    this.mode = 'creator';
    this.endLookDrag();
    this.interior.setFocus('bay');
    this.creatorTube = tube;
    this.buildPreviewStage();
    this.syncPlayer(self);
    const [pos, look] = this.creatorCamera();
    this.camPos.copy(pos);
    this.camLook.copy(look);
  }

  private buildPreviewStage() {
    if (this.previewStage) return;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.018, 8, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fd8ff).multiplyScalar(2.2), transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.35, 2.2, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3fbfff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 1.1;
    g.add(beam);
    this.scene.add(g);
    this.previewStage = g;

    const key = new THREE.DirectionalLight(0xfff4e8, 1.35);
    key.position.set(1.2, 3.2, 4.5);
    const fill = new THREE.DirectionalLight(0xb8dcff, 0.55);
    fill.position.set(-2.5, 2.4, 2);
    const rim = new THREE.PointLight(0x6fc8ff, 0.9, 6, 1.4);
    rim.position.set(0, 1.6, 2.2);
    for (const l of [key, fill, rim]) {
      this.scene.add(l);
      this.previewLights.push(l);
    }
  }

  private destroyPreviewStage() {
    if (this.previewStage) {
      this.previewStage.removeFromParent();
      this.previewStage = null;
    }
    for (const l of this.previewLights) l.removeFromParent();
    this.previewLights.length = 0;
  }

  setPreview(app: Appearance & { job?: Job }, self: PlayerState) {
    this.preview = app;
    this.syncPlayer(self);
  }

  enterWalk(self: PlayerState) {
    this.local = { x: self.x, z: self.z, rot: self.rot, moving: false, gait: 'jog', speed: 0 };
    this.mode = 'walk';
    this.space = null;
    this.camYaw = self.rot;
    this.camPitch = DEFAULT_CAM_PITCH;
    this.camReturn = null;
    this.destroyPreviewStage();
    this.clearMovementInput(true);
    this.syncPlayer(self);
  }

  private endLookDrag(behind: 'smooth' | 'fast' | false = 'smooth') {
    if (!this.lookDrag) return;
    const wasLeft = this.lookDrag.button === 0;
    this.renderer.domElement.style.cursor = '';
    this.lookDrag = null;
    if (!wasLeft || !behind || this.mode !== 'walk') return;
    this.beginCamReturn(behind);
  }

  private beginCamReturn(mode: 'smooth' | 'fast') {
    if (angleDist(this.camYaw, this.local.rot) < 0.02 && Math.abs(this.camPitch - DEFAULT_CAM_PITCH) < 0.02) {
      this.camReturn = null;
      return;
    }
    this.camReturn = {
      mode,
      fromYaw: this.camYaw,
      fromPitch: this.camPitch,
      t: 0,
      dur: mode === 'fast' ? CAM_RETURN_FAST_S : CAM_RETURN_SMOOTH_S,
    };
  }

  /** Drop left-orbit drag when the player steers with WASD so camera can return behind. */
  private cancelLeftOrbitForMovement() {
    if (this.lookDrag?.button !== 0) return;
    this.endLookDrag('fast');
  }

  private tickCamReturn(dt: number) {
    const r = this.camReturn;
    if (!r) return;
    r.t += dt;
    const u = Math.min(1, r.t / r.dur);
    const ease = u * u * (3 - 2 * u);
    const targetYaw = this.local.rot;
    this.camYaw = lerpAngle(r.fromYaw, targetYaw, ease);
    this.camPitch = r.fromPitch + (DEFAULT_CAM_PITCH - r.fromPitch) * ease;
    if (u >= 1) {
      this.camYaw = targetYaw;
      this.camPitch = DEFAULT_CAM_PITCH;
      this.camReturn = null;
    }
  }

  private requestCamBehindFast() {
    if (this.camReturn?.mode === 'fast') return;
    this.beginCamReturn('fast');
  }

  private creatorCamera(): [THREE.Vector3, THREE.Vector3] {
    const [px, , pz] = previewPose(this.creatorTube);
    const narrow = this.camera.aspect < 0.9;
    const look = new THREE.Vector3(px - 0.04, 1.02, pz);
    if (narrow) return [new THREE.Vector3(px, 1.65, pz + 4.6), look];
    return [new THREE.Vector3(px + 0.22, 1.48, pz + 3.35), look];
  }

  // ---- input ----

  private bindInput() {
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';

    const trapBrowserKeys = (e: KeyboardEvent) => {
      if (this.mode !== 'walk') return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const code = e.code;
      if (MOVE_CODES.has(code) || SHIFT_CODES.has(code) || BROWSER_TRAP_CODES.has(code) || code.startsWith('Arrow')) e.preventDefault();
    };

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const code = e.code;
      if (down) {
        if (code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && this.mode === 'walk') this.walkMode = !this.walkMode;
        if (MOVE_CODES.has(code) || SHIFT_CODES.has(code)) this.keys.add(code);
      } else if (MOVE_CODES.has(code) || SHIFT_CODES.has(code)) {
        this.keys.delete(code);
        if (this.mode === 'walk' && !this.hasMoveInput()) this.flushMove();
      }
      trapBrowserKeys(e);
    };
    const kd = onKey(true);
    const ku = onKey(false);
    const clear = () => {
      this.endLookDrag(false);
      this.clearMovementInput(true);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', clear);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clear();
    });

    const onContextMenu = (e: MouseEvent) => {
      if (this.mode !== 'walk') return;
      if (isUiTarget(e.target)) return;
      if (e.target === canvas) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu, true);

    const steer = (dx: number) => {
      this.camReturn = null;
      this.local.rot -= dx * 0.006;
      this.camYaw = this.local.rot;
      this.camPitch = DEFAULT_CAM_PITCH;
    };
    const orbit = (dx: number, dy: number) => {
      this.camReturn = null;
      this.camYaw -= dx * 0.006;
      this.camPitch = Math.min(1.2, Math.max(0.12, this.camPitch + dy * 0.004));
    };

    const pd = (e: PointerEvent) => {
      if (this.mode !== 'walk' || e.target !== canvas) return;
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this.lookDrag = { button: e.button as 0 | 2, id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'none';
    };
    const pmWin = (e: PointerEvent) => {
      const d = this.lookDrag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (d.button === 2) steer(dx);
      else orbit(dx, dy);
      d.x = e.clientX;
      d.y = e.clientY;
    };
    const puWin = (e: PointerEvent) => {
      if (this.lookDrag?.id !== e.pointerId) return;
      this.endLookDrag('smooth');
    };
    const onAux = (e: MouseEvent) => {
      if (this.mode === 'walk' && e.target === canvas && e.button === 1) e.preventDefault();
    };
    const wheel = (e: WheelEvent) => {
      if (this.mode !== 'walk') return;
      this.camDist = Math.min(9, Math.max(2.2, this.camDist + Math.sign(e.deltaY) * 0.5));
    };
    canvas.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pmWin);
    window.addEventListener('pointerup', puWin);
    window.addEventListener('pointercancel', puWin);
    canvas.addEventListener('auxclick', onAux);
    canvas.addEventListener('wheel', wheel, { passive: true });
    this.cleanup.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', clear);
      document.removeEventListener('contextmenu', onContextMenu, true);
      canvas.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pmWin);
      window.removeEventListener('pointerup', puWin);
      window.removeEventListener('pointercancel', puWin);
      canvas.removeEventListener('auxclick', onAux);
      canvas.removeEventListener('wheel', wheel);
      this.endLookDrag();
    });
  }

  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
    if (this.mode === 'walk' && x === 0 && y === 0 && !this.hasMoveInput()) this.flushMove();
  }

  private hasMoveInput() {
    for (const c of MOVE_CODES) if (this.keys.has(c)) return true;
    return Math.hypot(this.joy.x, this.joy.y) > 0.08;
  }

  private clearMovementInput(flush: boolean) {
    this.keys.clear();
    this.joy.x = 0;
    this.joy.y = 0;
    if (flush && this.mode === 'walk') this.flushMove();
  }

  private flushMove() {
    this.local.moving = false;
    this.local.speed = 0;
    this.lastSent = '';
    this.hooks.onMove(this.local.x, this.local.z, this.local.rot, false);
  }

  // ---- loop ----

  update(dt: number) {
    this.time += dt;
    if (this.mode === 'creator' && this.previewStage) this.previewStage.rotation.y += dt * 0.25;
    if (this.mode === 'walk') this.updateLocal(dt);

    for (const e of this.entities.values()) {
      const r = e.rig;
      if (e.inTube) {
        floatRig(r, dt);
        r.root.position.y = TUBE_Y + Math.sin(r.time * 1.1) * 0.03;
        continue;
      }
      const isSelf = e.id === this.selfId;
      if (isSelf && this.mode === 'creator') {
        animateRig(r, dt, false, 0);
        continue;
      }
      if (isSelf) {
        r.root.position.set(this.local.x, 0, this.local.z);
        r.root.rotation.y = lerpAngle(r.root.rotation.y, this.local.rot, 1 - Math.exp(-14 * dt));
        animateRig(r, dt, this.local.moving, this.local.speed);
      } else {
        const k = 1 - Math.exp(-12 * dt);
        r.root.position.x += (e.tx - r.root.position.x) * k;
        r.root.position.z += (e.tz - r.root.position.z) * k;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, e.trot, k);
        const lag = Math.hypot(e.tx - r.root.position.x, e.tz - r.root.position.z);
        animateRig(r, dt, e.moving || lag > 0.05, e.speed);
      }
      if (e.spawnFx > 0) {
        e.spawnFx = Math.max(0, e.spawnFx - dt * 0.9);
        const s = 1 - e.spawnFx * 0.25;
        r.root.scale.set(s, s, s);
      }
      const seen = this.interior.isVisible(spaceAt(r.root.position.x, r.root.position.z)?.id ?? null);
      r.root.visible = seen;
      if (e.label) e.label.visible = seen && this.camera.position.distanceTo(r.root.position) < 22;
    }

    this.updateCamera(dt);
    this.focus.set(this.mode === 'walk' ? this.local.x : this.camLook.x, this.mode === 'walk' ? EYE : 1.2, this.mode === 'walk' ? this.local.z : this.camLook.z);
    this.interior.update(dt, this.focus, this.camera);
  }

  private updateLocal(dt: number) {
    let ix = this.joy.x;
    let iy = this.joy.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.hasMoveInput()) this.cancelLeftOrbitForMovement();
    else if (this.lookDrag?.button === 2) this.requestCamBehindFast();

    const len = Math.hypot(ix, iy);
    const moving = len > 0.1;
    const joyWalk = len < 0.55 && Math.hypot(this.joy.x, this.joy.y) > 0.1 && !this.keys.size;
    const sprinting = this.stamina.update(dt, moving && [...SHIFT_CODES].some((c) => this.keys.has(c)));
    const gait: Gait = sprinting ? 'sprint' : this.walkMode || joyWalk ? 'walk' : 'jog';
    const speed = gait === 'sprint' ? SPRINT_SPEED : gait === 'walk' ? WALK_SPEED : JOG_SPEED;
    if (moving) {
      const n = Math.min(1, len) / len;
      ix *= n;
      iy *= n;
      const fx = Math.sin(this.local.rot);
      const fz = Math.cos(this.local.rot);
      const rx = Math.cos(this.local.rot);
      const rz = -Math.sin(this.local.rot);
      const mx = fx * iy + rx * ix;
      const mz = fz * iy + rz * ix;
      const p = clampToShip(this.local.x + mx * speed * dt, this.local.z + mz * speed * dt, 0);
      this.local.x = p.x;
      this.local.z = p.z;
      this.local.rot = Math.atan2(mx, mz);
    }
    this.local.moving = moving;
    this.local.gait = gait;
    this.local.speed = moving ? Math.min(1, len) * speed : 0;

    const space = spaceAt(this.local.x, this.local.z, 0);
    if (space && space.id !== this.space?.id) {
      this.space = space;
      this.interior.setFocus(space.id);
      this.hooks.onSpace?.(space);
    }
    this.hooks.onStatus?.({ gait, stamina: this.stamina.value, exhausted: this.stamina.exhausted, walkMode: this.walkMode });

    this.sendTimer += dt;
    if (this.sendTimer >= SEND_INTERVAL) {
      this.sendTimer = 0;
      const sig = `${this.local.x.toFixed(3)},${this.local.z.toFixed(3)},${this.local.rot.toFixed(2)},${moving}`;
      if (sig !== this.lastSent) {
        this.lastSent = sig;
        this.hooks.onMove(this.local.x, this.local.z, this.local.rot, moving);
      }
    }
  }

  private updateCamera(dt: number) {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === 'creator') {
      [pos, look] = this.creatorCamera();
      pos.y += Math.sin(this.time * 0.4) * 0.04;
    } else {
      this.tickCamReturn(dt);
      look = new THREE.Vector3(this.local.x, 1.45, this.local.z);
      const d = this.camDist;
      pos = new THREE.Vector3(
        look.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * d,
        look.y + Math.sin(this.camPitch) * d,
        look.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * d,
      );
      pos.y = Math.max(0.5, pos.y);
    }
    const follow = this.camReturn ? 14 : this.mode === 'walk' ? 7 : 3;
    const k = 1 - Math.exp(-follow * dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  render() {
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  dispose() {
    this.endLookDrag();
    this.cleanup.forEach((f) => f());
    for (const id of [...this.entities.keys()]) this.removePlayer(id);
    this.labels.domElement.remove();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function angleDist(a: number, b: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
