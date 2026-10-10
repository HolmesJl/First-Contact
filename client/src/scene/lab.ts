import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { makeComposer, type View } from './common';
import { Controls, MIN_PITCH } from '../input/controls';
import { InteractSystem } from '../interact';
import { animateRig, buildRig, disposeRig, floatRig, type Rig } from './character';
import { ShipInterior } from './shipInterior';
import { TUBE_X, TUBE_Y, TUBE_Z } from '../../../shared/lab';
import { clampToShip, spaceAt, type Space } from '../../../shared/shipInterior';
import { JOG_SPEED, SPRINT_SPEED, Stamina, WALK_SPEED, type Gait } from '../../../shared/movement';
import { JOB_INFO, type Appearance, type Job, type PlayerState, type SnapEntry } from '../../../shared/protocol';

const SEND_INTERVAL = 1 / 15;
const EYE = 1.45;
/** The camera never goes lower than this above the floor. */
const MIN_CAM_Y = 0.3;
/** Extra pivot height at full look-up, so the player sits low in frame and the view clears them toward door signs. */
const LOOK_UP_LIFT = 0.9;
function previewPose(tube: number): [number, number, number] {
  const x = TUBE_X[tube];
  return [x - 0.12, 0, TUBE_Z + 1.28];
}

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
  onInteractHover?(id: string | null, prompt: string | null): void;
  onInteract?(id: string): void;
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

  private selfId: string;
  private mode: 'creator' | 'walk' = 'creator';
  private creatorTube = 0;
  private preview: (Appearance & { job?: Job }) | null = null;
  private local = { x: 0, z: 0, rot: 0, moving: false, gait: 'jog' as Gait, speed: 0 };
  private sendTimer = 0;
  private lastSent = '';

  private controls: Controls;
  private interact: InteractSystem;
  private camPos = new THREE.Vector3(0, 3, 6);
  private camLook = new THREE.Vector3(0, 1, 0);
  /** Seconds left of the soft camera blend after entering walk mode; afterwards the camera follows rigidly. */
  private camSettle = 0;
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
    this.controls = new Controls(renderer.domElement, {
      isActive: () => this.mode === 'walk',
      onStop: () => this.flushMove(),
    });
    this.interact = new InteractSystem(renderer.domElement, this.camera, this.interior.root, {
      isActive: () => this.mode === 'walk',
      playerPos: () => (this.mode === 'walk' ? { x: this.local.x, z: this.local.z } : null),
      onHover: (id, prompt) => this.hooks.onInteractHover?.(id, prompt),
      onInteract: (id) => this.hooks.onInteract?.(id),
    });
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
    this.controls.clear(false);
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
    this.controls.reset(self.rot);
    this.camSettle = 1;
    this.destroyPreviewStage();
    this.syncPlayer(self);
  }

  private creatorCamera(): [THREE.Vector3, THREE.Vector3] {
    const [px, , pz] = previewPose(this.creatorTube);
    const narrow = this.camera.aspect < 0.9;
    const look = new THREE.Vector3(px - 0.04, 1.02, pz);
    if (narrow) return [new THREE.Vector3(px, 1.65, pz + 4.6), look];
    return [new THREE.Vector3(px + 0.22, 1.48, pz + 3.35), look];
  }

  setJoystick(x: number, y: number) {
    this.controls.setJoystick(x, y);
    if (this.mode === 'walk' && x === 0 && y === 0 && !this.controls.hasMoveInput()) this.flushMove();
  }

  /** Dev-only: snap the local player and sync to the server (walk mode). */
  devTeleport(x: number, z: number) {
    if (this.mode !== 'walk') return;
    const p = clampToShip(x, z, 0);
    this.local.x = p.x;
    this.local.z = p.z;
    this.lastSent = '';
    this.hooks.onMove(this.local.x, this.local.z, this.local.rot, false);
  }

  private flushMove() {
    if (this.mode !== 'walk') return;
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
    this.interact.update();
  }

  private updateLocal(dt: number) {
    const c = this.controls;
    c.update(dt);
    const input = c.sample();
    const moving = input.mag > 0.1;
    const sprinting = this.stamina.update(dt, moving && input.wantsSprint);
    const gait: Gait = sprinting ? 'sprint' : c.walkMode || input.analogWalk ? 'walk' : 'jog';
    const speed = gait === 'sprint' ? SPRINT_SPEED : gait === 'walk' ? WALK_SPEED : JOG_SPEED;
    this.local.rot = c.facing;
    if (moving) {
      const p = clampToShip(this.local.x + input.x * speed * dt, this.local.z + input.z * speed * dt, 0);
      this.local.x = p.x;
      this.local.z = p.z;
    }
    this.local.moving = moving;
    this.local.gait = gait;
    this.local.speed = moving ? input.mag * speed : 0;

    const space = spaceAt(this.local.x, this.local.z, 0);
    if (space && space.id !== this.space?.id) {
      this.space = space;
      this.interior.setFocus(space.id);
      this.hooks.onSpace?.(space);
    }
    this.hooks.onStatus?.({ gait, stamina: this.stamina.value, exhausted: this.stamina.exhausted, walkMode: c.walkMode });

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
      const c = this.controls;
      const lookUp = Math.min(1, Math.max(0, c.pitch / MIN_PITCH));
      look = new THREE.Vector3(this.local.x, EYE + LOOK_UP_LIFT * lookUp, this.local.z);
      const yaw = c.camYaw;
      const cosP = Math.cos(c.pitch);
      pos = new THREE.Vector3(
        look.x + Math.sin(yaw) * cosP * c.dist,
        look.y + Math.sin(c.pitch) * c.dist,
        look.z + Math.cos(yaw) * cosP * c.dist,
      );
      if (pos.y < MIN_CAM_Y) {
        // Floor stop: slide the target up by the same amount so the view keeps its upward tilt.
        look.y += MIN_CAM_Y - pos.y;
        pos.y = MIN_CAM_Y;
      }
    }
    if (this.mode === 'walk' && this.camSettle <= 0) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      this.camSettle = Math.max(0, this.camSettle - dt);
      const k = 1 - Math.exp(-(this.mode === 'walk' ? 7 : 3) * dt);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, k);
    }
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
    this.interact.dispose();
    this.controls.dispose();
    for (const id of [...this.entities.keys()]) this.removePlayer(id);
    this.labels.domElement.remove();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
