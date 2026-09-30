import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { canvasTexture, makeComposer, starfield, type View } from './common';
import { animateRig, buildRig, disposeRig, floatRig, type Rig } from './character';
import { buildShip } from './ship';
import { HOLO_TABLE, TUBE_COUNT, TUBE_X, TUBE_Y, TUBE_Z, clampToLab } from '../../../shared/lab';
import { JOB_INFO, type Appearance, type PlayerState, type SnapEntry } from '../../../shared/protocol';

const WALK_SPEED = 2.2;
const RUN_SPEED = 4.8;
const SEND_INTERVAL = 1 / 15;

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
  spawnFx: number;
}

export interface LabHooks {
  onMove(x: number, z: number, rot: number, moving: boolean): void;
}

interface Tube {
  fluid: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  bubbles: THREE.Points;
  flash: number;
}

export class LabScene implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 400);
  private composer;
  private labels = new CSS2DRenderer();
  private entities = new Map<string, Entity>();
  private tubes: Tube[] = [];
  private holo = new THREE.Group();
  private shipUpdate: (dt: number) => void;
  private time = 0;

  private selfId: string;
  private mode: 'creator' | 'walk' = 'creator';
  private creatorTube = 0;
  private preview: Appearance | null = null;
  private local = { x: 0, z: 0, rot: 0, moving: false, running: false };
  private sendTimer = 0;
  private lastSent = '';

  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private camYaw = 0;
  private camPitch = 0.34;
  private camDist = 3.9;
  private camPos = new THREE.Vector3(0, 3, 6);
  private camLook = new THREE.Vector3(0, 1, 0);
  private drag: { id: number; x: number; y: number } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    container: HTMLElement,
    selfId: string,
    private hooks: LabHooks,
  ) {
    this.selfId = selfId;
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);
    this.buildRoom();
    const { ship, update } = buildShip();
    ship.scale.setScalar(0.028);
    ship.position.set(0, 0.55, 0);
    const holoShip = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x7ce4ff).multiplyScalar(1.3),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    ship.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = holoShip;
    });
    this.holo.add(ship);
    this.shipUpdate = update;
    this.composer = makeComposer(renderer, this.scene, this.camera, { strength: 0.4, radius: 0.35, threshold: 1.1 });
    this.bindInput();
  }

  private buildRoom() {
    const s = this.scene;
    s.background = new THREE.Color(0x04060c);
    s.fog = new THREE.Fog(0x04060c, 14, 34);
    s.add(new THREE.HemisphereLight(0xb8ccf0, 0x1a1420, 0.5));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.5);
    key.position.set(3, 9, 8);
    s.add(key);
    const rim = new THREE.DirectionalLight(0x6fc8ff, 0.5);
    rim.position.set(-4, 5, -8);
    s.add(rim);

    const floorTex = canvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = '#1a2130';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#202939';
      ctx.fillRect(6, 6, 118, 118);
      ctx.fillRect(132, 132, 118, 118);
      ctx.fillStyle = '#1d2535';
      ctx.fillRect(132, 6, 118, 118);
      ctx.fillRect(6, 132, 118, 118);
      ctx.strokeStyle = '#0d1119';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, 256, 256);
      ctx.strokeRect(128, 0, 0.1, 256);
      ctx.beginPath();
      ctx.moveTo(128, 0);
      ctx.lineTo(128, 256);
      ctx.moveTo(0, 128);
      ctx.lineTo(256, 128);
      ctx.stroke();
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(10, 7);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 14), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 0.5;
    s.add(floor);

    const wall = new THREE.MeshStandardMaterial({ color: 0x2a3446, roughness: 0.7, metalness: 0.3, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3b475c, roughness: 0.5, metalness: 0.5, flatShading: true });
    const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46d9ff).multiplyScalar(2.2) });
    const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(1.8) });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      s.add(b);
      return b;
    };

    // Back wall with a viewport onto lunar space.
    box(20.4, 2.9, 0.4, 0, 1.45, -6.2, wall);
    box(20.4, 1.6, 0.4, 0, 5.6, -6.2, wall);
    for (let x = -10; x <= 10; x += 4) box(0.5, 1.9, 0.5, x, 3.85, -6.15, trim);
    box(20.4, 0.08, 0.1, 0, 2.95, -5.98, glowCyan);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x6fa8ff, transparent: true, opacity: 0.06, roughness: 0, metalness: 1 }),
    );
    glass.position.set(0, 3.85, -6.1);
    s.add(glass);
    const outside = starfield(1500, 120, 1.4);
    outside.position.set(0, 0, -130);
    s.add(outside);
    const moon = new THREE.Mesh(
      new THREE.IcosahedronGeometry(9, 3),
      new THREE.MeshStandardMaterial({ color: 0xa4a4ac, roughness: 1, flatShading: true, fog: false, emissive: 0x1a1a22 }),
    );
    moon.position.set(14, 8, -60);
    s.add(moon);

    for (const side of [-1, 1]) {
      box(0.4, 7, 14, side * 10.2, 3.5, 0.5, wall);
      for (let z = -5; z <= 6; z += 2.75) box(0.25, 6.4, 0.35, side * 9.95, 3.2, z, trim);
      box(0.06, 0.08, 13, side * 9.93, 0.25, 0.5, glowCyan);
      box(0.06, 0.06, 13, side * 9.93, 5.2, 0.5, glowAmber);
      for (const z of [-1.4, 2.8]) {
        box(0.9, 0.95, 1.8, side * 9.45, 0.48, z, trim);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), new THREE.MeshBasicMaterial({ map: consoleTexture(z > 0), toneMapped: false }));
        screen.position.set(side * 9.72, 1.6, z);
        screen.rotation.y = -side * Math.PI / 2;
        s.add(screen);
      }
    }
    box(20.4, 0.6, 0.4, 0, 0.3, 7.3, wall);
    box(20.4, 0.06, 0.1, 0, 0.62, 7.1, glowCyan);

    for (let x = -8; x <= 8; x += 4) {
      box(0.1, 0.04, 9, x, 0.01, 1.5, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1d6aa0).multiplyScalar(1.2) }));
    }

    for (let i = 0; i < TUBE_COUNT; i++) this.buildTube(i, trim, glowCyan);
    this.buildHoloTable(trim);
  }

  private buildTube(i: number, trim: THREE.Material, glow: THREE.Material) {
    const s = this.scene;
    const x = TUBE_X[i];
    const g = new THREE.Group();
    g.position.set(x, 0, TUBE_Z);
    s.add(g);

    const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.6, 1.3), trim);
    base.position.y = 0.3;
    g.add(base);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.02), glow);
    strip.position.set(0, 0.45, 0.66);
    g.add(strip);

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.22),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(256, 80, (ctx) => {
          ctx.fillStyle = '#071018';
          ctx.fillRect(0, 0, 256, 80);
          ctx.strokeStyle = '#46d9ff';
          ctx.lineWidth = 4;
          ctx.strokeRect(4, 4, 248, 72);
          ctx.fillStyle = '#9fe9ff';
          ctx.font = '700 44px "Orbitron", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`CL-0${i + 1}`, 128, 42);
        }),
      }),
    );
    plate.position.set(0, 0.24, 0.655);
    g.add(plate);

    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.2, 16), trim);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(side * 1.15, TUBE_Y, 0);
      g.add(cap);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.025, 6, 32), glow);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(side * 1.04, TUBE_Y, 0);
      g.add(ring);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, TUBE_Y - 0.6, 0.3), trim);
      post.position.set(side * 1.15, (TUBE_Y + 0.6) / 2 - 0.1, 0);
      g.add(post);
    }

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 2.1, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xbfefff, transparent: true, opacity: 0.09, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.rotation.z = Math.PI / 2;
    glass.position.y = TUBE_Y;
    glass.renderOrder = 2;
    g.add(glass);
    const fluid = new THREE.MeshBasicMaterial({ color: 0x28c8ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
    const fluidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 2.08, 24), fluid);
    fluidMesh.rotation.z = Math.PI / 2;
    fluidMesh.position.y = TUBE_Y;
    fluidMesh.renderOrder = 1;
    g.add(fluidMesh);

    const light = new THREE.PointLight(0x3fd0ff, 0.8, 3.5, 1.6);
    light.position.set(0, TUBE_Y, 0.7);
    g.add(light);

    const n = 28;
    const bp = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) bp.set([(Math.random() - 0.5) * 2, TUBE_Y + (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7], k * 3);
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const bubbles = new THREE.Points(
      bgeo,
      new THREE.PointsMaterial({ color: 0xc8f4ff, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    g.add(bubbles);

    this.tubes.push({ fluid, light, bubbles, flash: 0 });
  }

  private buildHoloTable(trim: THREE.Material) {
    const g = new THREE.Group();
    g.position.set(HOLO_TABLE.x, 0, HOLO_TABLE.z);
    this.scene.add(g);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(HOLO_TABLE.r, HOLO_TABLE.r + 0.15, 0.85, 20), trim);
    base.position.y = 0.425;
    g.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(HOLO_TABLE.r - 0.05, 0.03, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46d9ff).multiplyScalar(2.5) }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.86;
    g.add(rim);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 0.7, 1.4, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3fbfff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 1.55;
    g.add(beam);

    const holoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fd8ff).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.55 });
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), holoMat);
    moon.position.set(0.45, 0.55, 0);
    this.holo.add(moon);
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.006, 4, 64), holoMat);
    orbit.rotation.x = Math.PI / 2;
    orbit.position.y = 0.55;
    this.holo.add(orbit);
    this.holo.position.y = 1.15;
    g.add(this.holo);
  }

  // ---- players ----

  syncPlayer(p: PlayerState) {
    const isSelf = p.id === this.selfId;
    let inTube = !p.character;
    if (!p.connected && p.character && !isSelf) {
      this.removePlayer(p.id);
      return;
    }
    const app: Appearance | null = p.character ?? (isSelf && this.mode === 'creator' ? this.preview : null);
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
    const e: Entity = { id: p.id, key, inTube, rig, label: null, tx: p.x, tz: p.z, trot: p.rot, moving: p.moving, speed: 0, spawnFx: 0 };
    if (inTube) {
      rig.root.rotation.z = -Math.PI / 2;
      rig.root.position.set(TUBE_X[p.tube] - 0.93, TUBE_Y, TUBE_Z);
      (rig.root.getObjectByName('shadow') as THREE.Object3D).visible = false;
      if (!isSelf) e.label = this.makeLabel(null, p.connected ? 'Forming…' : 'In stasis', false);
      if (e.label) {
        e.label.position.set(TUBE_X[p.tube] + 0.0, TUBE_Y + 0.95, TUBE_Z);
        this.scene.add(e.label);
      }
    } else {
      const pos = isSelf && this.mode === 'walk' && !wasInTube ? this.local : p;
      rig.root.position.set(pos.x, 0, pos.z);
      rig.root.rotation.y = pos.rot;
      e.label = this.makeLabel(p.character!.job, `${p.character!.firstName} ${p.character!.lastName}`, isSelf);
      e.label.position.y = 2.08;
      rig.root.add(e.label);
      if (wasInTube) {
        e.spawnFx = 1;
        this.tubes[p.tube].flash = 1;
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
      e.speed = Math.hypot(x - e.tx, z - e.tz) * 15;
      e.tx = x;
      e.tz = z;
      e.trot = rot;
      e.moving = !!moving;
    }
  }

  // ---- modes ----

  enterCreator(tube: number, self: PlayerState) {
    this.mode = 'creator';
    this.creatorTube = tube;
    this.syncPlayer(self);
    const [pos, look] = this.creatorCamera();
    this.camPos.copy(pos).add(new THREE.Vector3(0, 1.5, 4));
    this.camLook.copy(look);
  }

  setPreview(app: Appearance, self: PlayerState) {
    this.preview = app;
    this.syncPlayer(self);
  }

  enterWalk(self: PlayerState) {
    this.local = { x: self.x, z: self.z, rot: self.rot, moving: false, running: false };
    this.mode = 'walk';
    this.camYaw = 0;
    this.syncPlayer(self);
  }

  private creatorCamera(): [THREE.Vector3, THREE.Vector3] {
    const x = TUBE_X[this.creatorTube];
    const narrow = this.camera.aspect < 0.9;
    if (narrow) return [new THREE.Vector3(x, 2.1, TUBE_Z + 5.2), new THREE.Vector3(x, 0.55, TUBE_Z)];
    return [new THREE.Vector3(x + 0.3, 1.75, TUBE_Z + 3.4), new THREE.Vector3(x + 1.05, 1.18, TUBE_Z)];
  }

  // ---- input ----

  private bindInput() {
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      if (this.mode === 'walk' && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    const kd = onKey(true);
    const ku = onKey(false);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);

    const canvas = this.renderer.domElement;
    const pd = (e: PointerEvent) => {
      if (this.mode !== 'walk') return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      this.camYaw -= (e.clientX - this.drag.x) * 0.006;
      this.camPitch = Math.min(1.2, Math.max(0.12, this.camPitch + (e.clientY - this.drag.y) * 0.004));
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    };
    const pu = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    const wheel = (e: WheelEvent) => {
      if (this.mode !== 'walk') return;
      this.camDist = Math.min(9, Math.max(2.2, this.camDist + Math.sign(e.deltaY) * 0.5));
    };
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerup', pu);
    canvas.addEventListener('pointercancel', pu);
    canvas.addEventListener('wheel', wheel, { passive: true });
    this.cleanup.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu);
      canvas.removeEventListener('pointercancel', pu);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }

  // ---- loop ----

  update(dt: number) {
    this.time += dt;
    this.holo.rotation.y += dt * 0.35;
    this.shipUpdate(dt);

    this.tubes.forEach((t, i) => {
      t.flash = Math.max(0, t.flash - dt * 0.8);
      const pulse = 0.06 + Math.sin(this.time * 1.6 + i) * 0.02;
      t.fluid.opacity = pulse + t.flash * 0.6;
      t.light.intensity = 0.8 + Math.sin(this.time * 1.6 + i) * 0.15 + t.flash * 10;
      const pos = t.bubbles.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        let y = pos.getY(k) + dt * (0.18 + (k % 5) * 0.05);
        if (y > TUBE_Y + 0.45) y = TUBE_Y - 0.45;
        pos.setY(k, y);
      }
      pos.needsUpdate = true;
    });

    if (this.mode === 'walk') this.updateLocal(dt);

    for (const e of this.entities.values()) {
      const r = e.rig;
      if (e.inTube) {
        floatRig(r, dt);
        r.root.position.y = TUBE_Y + Math.sin(r.time * 1.1) * 0.03;
        continue;
      }
      const isSelf = e.id === this.selfId;
      if (isSelf) {
        r.root.position.set(this.local.x, 0, this.local.z);
        r.root.rotation.y = lerpAngle(r.root.rotation.y, this.local.rot, 1 - Math.exp(-14 * dt));
        animateRig(r, dt, this.local.moving, this.local.running ? 2 : 1);
      } else {
        const k = 1 - Math.exp(-12 * dt);
        r.root.position.x += (e.tx - r.root.position.x) * k;
        r.root.position.z += (e.tz - r.root.position.z) * k;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, e.trot, k);
        const lag = Math.hypot(e.tx - r.root.position.x, e.tz - r.root.position.z);
        animateRig(r, dt, e.moving || lag > 0.05, e.speed / WALK_SPEED);
      }
      if (e.spawnFx > 0) {
        e.spawnFx = Math.max(0, e.spawnFx - dt * 0.9);
        const s = 1 - e.spawnFx * 0.25;
        r.root.scale.set(s, s, s);
      }
      if (e.label) e.label.visible = this.camera.position.distanceTo(r.root.position) < 22;
    }

    this.updateCamera(dt);
  }

  private updateLocal(dt: number) {
    let ix = this.joy.x;
    let iy = this.joy.y;
    if (this.keys.has('w') || this.keys.has('arrowup')) iy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) iy -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) ix -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) ix += 1;
    const len = Math.hypot(ix, iy);
    const moving = len > 0.1;
    const running = this.keys.has('shift');
    if (moving) {
      const n = Math.min(1, len) / len;
      ix *= n;
      iy *= n;
      const fx = -Math.sin(this.camYaw);
      const fz = -Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      const mx = fx * iy + rx * ix;
      const mz = fz * iy + rz * ix;
      const speed = running ? RUN_SPEED : WALK_SPEED;
      const p = clampToLab(this.local.x + mx * speed * dt, this.local.z + mz * speed * dt);
      this.local.x = p.x;
      this.local.z = p.z;
      this.local.rot = Math.atan2(mx, mz);
    }
    this.local.moving = moving;
    this.local.running = running;

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
      look = new THREE.Vector3(this.local.x, 1.45, this.local.z);
      const d = this.camDist;
      pos = new THREE.Vector3(
        look.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * d,
        look.y + Math.sin(this.camPitch) * d,
        look.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * d,
      );
      pos.x = Math.min(9.6, Math.max(-9.6, pos.x));
      pos.z = Math.min(7.0, Math.max(-5.6, pos.z));
    }
    const k = 1 - Math.exp(-(this.mode === 'walk' ? 7 : 3) * dt);
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

function consoleTexture(alt: boolean) {
  return canvasTexture(256, 160, (ctx) => {
    ctx.fillStyle = '#04121c';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = alt ? '#ffb347' : '#46d9ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 248, 152);
    ctx.fillStyle = alt ? '#ffcf8a' : '#8fe6ff';
    ctx.font = '600 14px monospace';
    ctx.fillText(alt ? 'GENOME SEQUENCER' : 'CLONE VITALS', 14, 26);
    ctx.beginPath();
    for (let x = 0; x < 228; x += 4) {
      const y = 90 + Math.sin(x * (alt ? 0.11 : 0.07)) * 22 * Math.sin(x * 0.019);
      if (x === 0) ctx.moveTo(14 + x, y);
      else ctx.lineTo(14 + x, y);
    }
    ctx.stroke();
    for (let i = 0; i < 6; i++) ctx.fillRect(14 + i * 38, 136, 28, 6 + (i % 3) * 2);
  });
}
