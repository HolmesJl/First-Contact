/**
 * Dev-only comparison page: /characters.html
 * Current Quaternius characters next to the MakeHuman / MPFB spike characters, each on an
 * idle / walk / jog / sprint toggle with an orbit camera. Not used by the game.
 *
 *   /characters.html?motion=walk&expr=smiling&cam=front|faces|side|top|orbit&clean=1&manual=1
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as mpfb from './scene/mpfbCharacter';
import * as quat from './scene/quaterniusCharacter';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: manual });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b111c);
scene.add(new THREE.HemisphereLight(0xcfdcf5, 0x2c2430, 0.6));
const key = new THREE.DirectionalLight(0xfff1e2, 2.5);
key.position.set(-4.5, 9, 4.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9cc4ff, 0.6);
fill.position.set(6, 2.5, 6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x6fc8ff, 0.9);
rim.position.set(-4, 5, -8);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x151c2a, roughness: 0.7 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ringGeo = new THREE.RingGeometry(0.42, 0.45, 48);
ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a5a8a });

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const status = document.getElementById('status')!;

const assetUrls = import.meta.glob('../dev-assets/mpfb/**/*.{glb,webp,json}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const assetUrl = (rel: string) => {
  const u = assetUrls[`../dev-assets/mpfb/${rel}`];
  if (!u) throw new Error(`missing spike asset ${rel}; run: cd tools && npm run build:mpfb`);
  return u;
};

const manifest = await mpfb.loadMpfb(assetUrl, assetUrl('manifest.json'));
await quat.loadQuaternius(manifest, assetUrl);

type Entry =
  | { kind: 'q'; sex: 'male' | 'female'; rig: quat.QRig; label: HTMLElement; sub: string }
  | { kind: 'new'; sex: 'male' | 'female'; rig: mpfb.MpfbRig; label: HTMLElement; sub: string };

const entries: Entry[] = [];
const labels = document.getElementById('labels')!;
let outfit: 'uniform' | 'bare' = params.get('outfit') === 'bare' ? 'bare' : 'uniform';

const newLooks: Record<string, Partial<mpfb.Look>> = {
  'male-a': { hairStyle: 0, hairColor: '#4a2f1d', eyeColor: '#4f7fb5' },
  'female-a': { hairStyle: 0, hairColor: '#7a4a24', eyeColor: '#3f8a4f' },
};

function addLabel(cls: string, title: string, sub: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = `${title}<small>${sub}</small>`;
  labels.appendChild(el);
  return el;
}

function addRing(x: number) {
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(x, 0.004, 0);
  scene.add(ring);
}

const SPACING = 1.5;
const GAP = 1.2;
const layout: { sex: 'male' | 'female'; kind: 'new' | 'q' }[] = [];
for (const sex of ['male', 'female'] as const) layout.push({ sex, kind: 'new' }, { sex, kind: 'q' });
layout.forEach((slot, i) => {
  const inGroup = i % 2;
  const group = Math.floor(i / 2);
  const x = (group === 0 ? -1 : 1) * (GAP + SPACING / 2) + (inGroup - 0.5) * SPACING;
  const hairColor = slot.sex === 'male' ? '#4a2f1d' : '#7a4a24';
  if (slot.kind === 'q') {
    const rig = quat.buildQuaternius(slot.sex, hairColor);
    rig.root.position.set(x, 0, 0);
    scene.add(rig.root);
    addRing(x);
    const sub = `${(manifest.quaternius[slot.sex].vertices.Body / 1000).toFixed(1)}k body verts`;
    entries.push({ kind: 'q', sex: slot.sex, rig, label: addLabel('old', `Quaternius · ${slot.sex}`, sub), sub });
  } else {
    const preset = manifest.presets.find((p) => p.sex === slot.sex)!;
    const base: mpfb.Look = { skin: 0, skinTint: '#ffffff', uniform: outfit === 'uniform', hairStyle: 0, hairColor: '#4a2f1d', eyeColor: '#4f7fb5', ...newLooks[preset.id] };
    const rig = mpfb.buildMpfb(preset.id, base);
    rig.root.position.set(x, 0, 0);
    scene.add(rig.root);
    addRing(x);
    const sub = `${(preset.vertices.Body / 1000).toFixed(1)}k body verts`;
    entries.push({ kind: 'new', sex: slot.sex, rig, label: addLabel('new', `MPFB · ${slot.sex}`, sub), sub });
  }
});

// ------------------------------------------------------------------ state + UI

let motion: mpfb.Motion = (params.get('motion') as mpfb.Motion) ?? 'idle';
let expression: mpfb.Expression = (params.get('expr') as mpfb.Expression) ?? 'neutral';

let styled = params.get('gait') !== 'raw';
function updateStatus() {
  const speed = (sex: 'male' | 'female') => {
    const p = manifest.presets.find((x) => x.sex === sex)!;
    return p.clips[`${styled ? '' : 'raw_'}${motion}` as mpfb.ClipKey].groundSpeed;
  };
  status.textContent = `${motion}: ground speed M ${speed('male').toFixed(2)} m/s, F ${speed('female').toFixed(2)} m/s · same clips on both sets · ${styled ? 'gendered gait styling' : 'raw performer mocap'}`;
}

function setMotion(m: mpfb.Motion, nextStyled = styled) {
  motion = m;
  styled = nextStyled;
  updateStatus();
  for (const e of entries) {
    if (e.kind === 'new') mpfb.setMotion(e.rig, m, styled);
    else quat.setMotionQ(e.rig, m, styled);
  }
  refreshButtons();
}

function setOutfit(o: typeof outfit) {
  outfit = o;
  for (const e of entries) {
    if (e.kind === 'new') {
      e.rig.look.uniform = o === 'uniform';
      mpfb.applyLook(e.rig);
      mpfb.applyExpression(e.rig);
    } else quat.applyOutfit(e.rig, o === 'uniform');
  }
  refreshButtons();
}

function setExpression(x: mpfb.Expression) {
  expression = x;
  for (const e of entries) if (e.kind === 'new') e.rig.expression = x;
  refreshButtons();
}

const topBar = document.getElementById('top')!;
const bottomBar = document.getElementById('bottom')!;
const buttons: { el: HTMLButtonElement; active: () => boolean }[] = [];

function group(parent: HTMLElement, title: string) {
  const g = document.createElement('div');
  g.className = 'group';
  g.innerHTML = `<span>${title}</span>`;
  parent.appendChild(g);
  return g;
}

function button(parent: HTMLElement, text: string, onClick: () => void, active: () => boolean = () => false) {
  const el = document.createElement('button');
  el.textContent = text;
  el.addEventListener('click', onClick);
  parent.appendChild(el);
  buttons.push({ el, active });
  return el;
}

function refreshButtons() {
  for (const b of buttons) b.el.classList.toggle('on', b.active());
}

const gMotion = group(bottomBar, 'Motion');
for (const m of ['idle', 'walk', 'jog', 'sprint'] as const) button(gMotion, m, () => setMotion(m), () => motion === m);
const gOutfit = group(bottomBar, 'Outfit');
button(gOutfit, 'uniform', () => setOutfit('uniform'), () => outfit === 'uniform');
button(gOutfit, 'bare', () => setOutfit('bare'), () => outfit === 'bare');
const gGait = group(bottomBar, 'Gait');
button(gGait, 'gendered', () => setMotion(motion, true), () => styled);
button(gGait, 'raw mocap', () => setMotion(motion, false), () => !styled);
const gExpr = group(bottomBar, 'Face (MPFB)');
for (const x of ['neutral', 'smiling', 'serious', 'angry', 'flirty'] as const) button(gExpr, x, () => setExpression(x), () => expression === x);

const newEntries = () => entries.filter((e): e is Extract<Entry, { kind: 'new' }> => e.kind === 'new');

const gHair = group(topBar, 'Hair');
button(gHair, 'style', () => {
  for (const e of newEntries()) {
    const n = e.rig.info.hair.length + 1;
    e.rig.look.hairStyle = ((e.rig.look.hairStyle + 2) % n) - 1;
    mpfb.applyLook(e.rig);
  }
});
const hairColor = document.createElement('input');
hairColor.type = 'color';
hairColor.value = '#4a2f1d';
hairColor.addEventListener('input', () => {
  for (const e of newEntries()) {
    e.rig.look.hairColor = hairColor.value;
    mpfb.applyLook(e.rig);
  }
  for (const e of entries) {
    if (e.kind !== 'q') continue;
    const hair = e.rig.meshes.HairShort ?? e.rig.meshes.HairLong;
    (hair.material as THREE.MeshStandardMaterial).color.set(hairColor.value);
    (e.rig.meshes.Brows.material as THREE.MeshStandardMaterial).color.set(hairColor.value).multiplyScalar(0.7);
  }
});
gHair.appendChild(hairColor);
const gEye = group(topBar, 'Eyes (MPFB)');
const eyeColor = document.createElement('input');
eyeColor.type = 'color';
eyeColor.value = '#4f7fb5';
eyeColor.addEventListener('input', () => {
  for (const e of newEntries()) {
    e.rig.look.eyeColor = eyeColor.value;
    mpfb.applyLook(e.rig);
  }
});
gEye.appendChild(eyeColor);
type CamName = 'front' | 'faces' | 'top' | 'males' | 'females' | 'orbit';
let autoOrbit = false;
const CAMS: Record<Exclude<CamName, 'orbit'>, [number[], number[]]> = {
  front: [[0, 1.3, 7.4], [0, 0.95, 0]],
  faces: [[0, 1.62, 5.4], [0, 1.52, 0]],
  top: [[0, 12, 2.5], [0, 0, 0]],
  males: [[-1.95, 1.3, 4.6], [-1.95, 0.95, 0]],
  females: [[1.95, 1.3, 4.6], [1.95, 0.95, 0]],
};
function setCam(name: CamName) {
  if (name === 'orbit') {
    autoOrbit = !autoOrbit;
    controls.autoRotate = autoOrbit;
    controls.autoRotateSpeed = 2.4;
  } else {
    const [p, t] = CAMS[name];
    camera.position.set(p[0], p[1], p[2]);
    controls.target.set(t[0], t[1], t[2]);
    controls.update();
  }
  refreshButtons();
}
let facing: 'front' | 'profile' | 'back' = (params.get('facing') as 'front' | 'profile' | 'back' | null) ?? 'front';
function setFacing(f: typeof facing) {
  facing = f;
  const yaw = { front: 0, profile: Math.PI / 2, back: Math.PI }[f];
  for (const e of entries) e.rig.root.rotation.y = yaw;
  refreshButtons();
}
const gFace = group(bottomBar, 'Facing');
for (const f of ['front', 'profile', 'back'] as const) button(gFace, f, () => setFacing(f), () => facing === f);
const gCam = group(bottomBar, 'Camera');
for (const c of ['front', 'males', 'females', 'faces', 'top'] as const) button(gCam, c, () => setCam(c));
button(gCam, 'auto-orbit', () => setCam('orbit'), () => autoOrbit);
setCam((params.get('cam') as CamName | null) ?? 'front');
const camPos = params.get('camPos')?.split(',').map(Number);
const camTarget = params.get('camTarget')?.split(',').map(Number);
if (camPos?.length === 3 && camTarget?.length === 3) {
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  controls.target.set(camTarget[0], camTarget[1], camTarget[2]);
  controls.update();
}

if (params.has('clean')) document.body.classList.add('clean');

// ------------------------------------------------------------------ loop

const labelPos = new THREE.Vector3();
function placeLabels() {
  for (const e of entries) {
    labelPos.set(e.rig.root.position.x, 0, e.rig.root.position.z + 0.1).project(camera);
    const x = (labelPos.x * 0.5 + 0.5) * innerWidth;
    const y = (-labelPos.y * 0.5 + 0.5) * innerHeight + 6;
    e.label.style.left = `${x}px`;
    e.label.style.top = `${y}px`;
  }
}

function step(dt: number) {
  for (const e of entries) {
    if (e.kind === 'new') mpfb.updateMpfb(e.rig, dt);
    else quat.updateQ(e.rig, dt);
  }
  controls.update();
  placeLabels();
  renderer.render(scene, camera);
}

setMotion(motion, styled);
setExpression(expression);
setOutfit(outfit);
setFacing(facing);

const timer = new THREE.Timer();
if (!manual) {
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    step(Math.min(timer.getDelta(), 0.1));
  });
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

Object.assign(window, {
  __chars: {
    setMotion,
    setExpression,
    setOutfit,
    setCam,
    setFacing,
    setYaw: (rad: number) => {
      for (const e of entries) e.rig.root.rotation.y = rad;
    },
    caption: (title: string, sub = '') => {
      const el = document.getElementById('caption')!;
      el.style.display = title ? 'block' : 'none';
      el.innerHTML = `${title}<small>${sub}</small>`;
    },
    advance: (dt: number) => step(dt),
    camera,
    controls,
    entries,
    ready: true,
  },
});
