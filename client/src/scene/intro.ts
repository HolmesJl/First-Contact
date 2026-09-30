import * as THREE from 'three';
import { canvasTexture, makeComposer, rng, smoothstep, starfield, type View } from './common';
import { buildShip } from './ship';

export const INTRO_LENGTH = 16;

export const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0.4, to: 4.2, text: 'A signal arrived from the far edge of the galaxy.' },
  { from: 4.6, to: 8.6, text: 'Coordinates. Blueprints for a ship. The secret of perfect cloning.' },
  { from: 9.0, to: 12.4, text: 'Lunar orbit. The colony ship FIRST CONTACT waits for her crew.' },
  { from: 12.8, to: 15.8, text: 'Report to the clone lab.' },
];

const EARTH_R = 20;
const SPACE = new THREE.Color(0x02030a);
const SKY = new THREE.Color(0x2f6fb8);
const MOON_POS = new THREE.Vector3(150, 18, -290);
const SHIP_POS = new THREE.Vector3(118, 26, -245);

function earthTexture() {
  const r = rng(7);
  return canvasTexture(1024, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#16407a');
    g.addColorStop(0.5, '#1f64ad');
    g.addColorStop(1, '#16407a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);
    for (let c = 0; c < 9; c++) {
      const cx = r() * 1024;
      const cy = 90 + r() * 330;
      for (let i = 0; i < 38; i++) {
        const x = cx + (r() - 0.5) * 220;
        const y = cy + (r() - 0.5) * 140;
        const rad = 12 + r() * 38;
        ctx.fillStyle = r() > 0.75 ? '#b59a5e' : r() > 0.4 ? '#3d8a44' : '#2f6e3a';
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#eef4f8';
    ctx.fillRect(0, 0, 1024, 26);
    ctx.fillRect(0, 486, 1024, 26);
  });
}

function cloudTexture() {
  const r = rng(99);
  return canvasTexture(1024, 512, (ctx) => {
    ctx.clearRect(0, 0, 1024, 512);
    for (let i = 0; i < 260; i++) {
      const x = r() * 1024;
      const y = 40 + r() * 430;
      const rad = 8 + r() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
}

function moonTexture() {
  const r = rng(3);
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#9a9a9e';
    ctx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 140; i++) {
      const x = r() * 512;
      const y = r() * 256;
      const rad = 2 + r() * 16;
      ctx.fillStyle = `rgba(${r() > 0.5 ? '60,60,68' : '190,190,196'},${0.25 + r() * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function atmosphere(radius: number, color: number) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(uColor * i * 1.6, i); }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}

function buildRocket() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8352a, roughness: 0.5, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 10), white);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 10), red);
  nose.position.y = 0.6;
  g.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.14), red);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 0.15, -0.36, Math.sin(a) * 0.15);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.55, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.rotation.x = Math.PI;
  flame.position.y = -0.72;
  g.add(flame);
  return { group: g, flame };
}

class Exhaust {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(private count = 500) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color(0xffb070).multiplyScalar(1.6),
        map: canvasTexture(64, 64, (ctx) => {
          const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 64, 64);
        }),
        size: 0.14,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }
  emit(at: THREE.Vector3, dir: THREE.Vector3, n: number) {
    for (let k = 0; k < n; k++) {
      const i = this.next++ % this.count;
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set(
        [dir.x * 3 + (Math.random() - 0.5) * 0.8, dir.y * 3 + (Math.random() - 0.5) * 0.8, dir.z * 3 + (Math.random() - 0.5) * 0.8],
        i * 3,
      );
      this.life[i] = 1;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.life[i] -= dt * 0.9;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class IntroScene implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 3000);
  private composer;
  private earth: THREE.Mesh;
  private clouds: THREE.Mesh;
  private moon: THREE.Mesh;
  private atmo: THREE.Mesh;
  private rocket = buildRocket();
  private exhaust = new Exhaust();
  private shipUpdate: (dt: number) => void;
  private path: THREE.CatmullRomCurve3;
  private mode: 'idle' | 'play' = 'idle';
  private onDone: (() => void) | null = null;
  t = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color(0x02030a);
    this.scene.add(starfield(5000, 1500, 1.7));

    const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    sun.position.set(-1, 0.45, 0.35).multiplyScalar(100);
    this.scene.add(sun, new THREE.AmbientLight(0x3a4a70, 0.35));
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c8).multiplyScalar(6) }));
    sunDisc.position.copy(sun.position).multiplyScalar(12);
    this.scene.add(sunDisc);

    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 64, 48), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.85 }));
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R * 1.012, 64, 48),
      new THREE.MeshStandardMaterial({ map: cloudTexture(), transparent: true, depthWrite: false }),
    );
    // Tilt so the launch pad at the top of the globe sits at mid-latitudes rather than on the ice cap.
    this.earth.rotation.x = this.clouds.rotation.x = 1.05;
    this.atmo = atmosphere(EARTH_R * 1.07, 0x4aa3ff);
    this.scene.add(this.earth, this.clouds, this.atmo);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(9, 40, 28), new THREE.MeshStandardMaterial({ map: moonTexture(), roughness: 1, flatShading: true }));
    this.moon.position.copy(MOON_POS);
    this.scene.add(this.moon);

    const { ship, update } = buildShip();
    ship.position.copy(SHIP_POS);
    ship.rotation.set(0.05, -0.6, 0.08);
    this.scene.add(ship);
    this.shipUpdate = update;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x555a60, flatShading: true }));
    pad.position.set(0, EARTH_R + 0.01, 0);
    this.scene.add(pad);

    const dock = SHIP_POS.clone().add(new THREE.Vector3(-4, 2.4, 3.5));
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, EARTH_R + 0.55, 0),
      new THREE.Vector3(0, EARTH_R + 4, 0),
      new THREE.Vector3(3, EARTH_R + 14, -10),
      new THREE.Vector3(35, 44, -90),
      new THREE.Vector3(85, 38, -190),
      dock.clone().add(new THREE.Vector3(-12, 3, 18)),
      dock,
    ]);

    this.scene.add(this.rocket.group, this.exhaust.points);
    this.composer = makeComposer(renderer, this.scene, this.camera, { strength: 0.9, radius: 0.6, threshold: 0.85 });
    this.idle();
  }

  idle() {
    this.mode = 'idle';
    this.t = 0;
    this.rocket.group.visible = false;
  }

  play(onDone: () => void) {
    this.mode = 'play';
    this.t = 0;
    this.onDone = onDone;
    this.rocket.group.visible = true;
  }

  skip() {
    if (this.mode !== 'play') return;
    this.finish();
  }

  private finish() {
    const cb = this.onDone;
    this.onDone = null;
    this.idle();
    cb?.();
  }

  caption() {
    if (this.mode !== 'play') return null;
    return CAPTIONS.find((c) => this.t >= c.from && this.t <= c.to)?.text ?? null;
  }

  update(dt: number) {
    this.t += dt;
    this.earth.rotation.y += dt * 0.01;
    this.clouds.rotation.y += dt * 0.014;
    this.moon.rotation.y += dt * 0.004;
    this.shipUpdate(dt);
    this.exhaust.update(dt);

    if (this.mode === 'idle') {
      this.atmo.visible = true;
      this.scene.background = SPACE;
      const a = this.t * 0.02;
      this.camera.position.set(-38 + Math.sin(a) * 6, 16 + Math.sin(a * 0.7) * 3, 52);
      this.camera.lookAt(35, 4, -120);
      return;
    }

    const t = this.t;
    const u = Math.min(1, easeInOut(Math.min(1, t / 13.2)) ** 1.15);
    const pos = this.path.getPointAt(u);
    const tan = this.path.getTangentAt(u);
    const rocket = this.rocket.group;
    rocket.position.copy(pos);
    rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    const burning = t > 0.6 && u < 0.97;
    this.rocket.flame.visible = burning;
    this.rocket.flame.scale.setScalar(0.8 + Math.random() * 0.4);
    if (burning) this.exhaust.emit(pos.clone().addScaledVector(tan, -0.75), tan.clone().negate(), t < 4 ? 4 : 2);
    rocket.visible = u < 0.995;
    rocket.scale.setScalar(u > 0.93 ? Math.max(0.01, 1 - (u - 0.93) / 0.06) : 1);

    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const camA = new THREE.Vector3(3.2, EARTH_R + 1.3, 4.6);
    const lookA = pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    const camB = pos.clone().addScaledVector(tan, -3.2).addScaledVector(up, 0.7).addScaledVector(side, 1.1);
    const lookB = pos.clone().addScaledVector(tan, 8);
    const camC = SHIP_POS.clone().add(new THREE.Vector3(-30, 9, 28));
    const lookC = SHIP_POS.clone().lerp(pos, 0.25);

    const wA = 1 - smoothstep(2.8, 4.6, t);
    const wC = smoothstep(9.2, 11.6, t);
    const wB = Math.max(0, 1 - wA - wC);
    this.camera.position.set(0, 0, 0).addScaledVector(camA, wA).addScaledVector(camB, wB).addScaledVector(camC, wC);
    if (t > 11.6) this.camera.position.add(new THREE.Vector3(1, 0.2, -0.6).multiplyScalar((t - 11.6) * 1.4));
    const look = new THREE.Vector3().addScaledVector(lookA, wA).addScaledVector(lookB, wB).addScaledVector(lookC, wC);
    this.camera.lookAt(look);
    this.atmo.visible = this.camera.position.length() > EARTH_R * 1.08;
    this.scene.background = this.atmo.visible ? SPACE : SKY.clone().lerp(SPACE, smoothstep(EARTH_R + 1, EARTH_R * 1.08, this.camera.position.length()));

    if (t >= INTRO_LENGTH) this.finish();
  }

  render() {
    this.composer.render();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }
}

function easeInOut(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
