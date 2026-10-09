/**
 * Dev-only gallery: /characters.html
 * The Quaternius male and female carrying retargeted ACCAD motion capture (gendered styling or raw performer
 * motion), in the crew uniform or bare. Not used by the game.
 *
 *   /characters.html?motion=walk&gait=raw&outfit=bare&cam=front|males|females|top&facing=front|profile|back&clean=1&manual=1
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as chars from './scene/quaterniusCharacter';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: manual });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

const assetUrls = import.meta.glob('../dev-assets/characters/**/*.{glb,webp,json}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const assetUrl = (rel: string) => {
  const u = assetUrls[`../dev-assets/characters/${rel}`];
  if (!u) throw new Error(`missing gallery asset ${rel}; run: cd tools && npm run build:clips`);
  return u;
};

const manifest = (await (await fetch(assetUrl('manifest.json'))).json()) as chars.Manifest;
await chars.loadCharacters(manifest, assetUrl);

interface Entry {
  sex: chars.Sex;
  rig: chars.Rig;
  label: HTMLElement;
}
const entries: Entry[] = [];
const labels = document.getElementById('labels')!;
let outfit: 'uniform' | 'bare' = params.get('outfit') === 'bare' ? 'bare' : 'uniform';

const SEXES = ['male', 'female'] as const;
SEXES.forEach((sex, i) => {
  const x = (i - 0.5) * 1.5;
  const rig = chars.buildCharacter(sex, sex === 'male' ? '#4a2f1d' : '#7a4a24');
  rig.root.position.set(x, 0, 0);
  scene.add(rig.root);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(x, 0.004, 0);
  scene.add(ring);
  const el = document.createElement('div');
  el.innerHTML = `${sex}<small>${(manifest.characters[sex].vertices.Body / 1000).toFixed(1)}k body verts</small>`;
  labels.appendChild(el);
  entries.push({ sex, rig, label: el });
});

let motion: chars.Motion = (params.get('motion') as chars.Motion | null) ?? 'idle';
let styled = params.get('gait') !== 'raw';

function updateStatus() {
  const speed = (sex: chars.Sex) => chars.groundSpeed(sex, motion, styled).toFixed(2);
  status.textContent = `${motion}: ground speed M ${speed('male')} m/s, F ${speed('female')} m/s · ${styled ? 'gendered gait styling' : 'raw performer mocap'}`;
}

function setMotion(m: chars.Motion, nextStyled = styled) {
  motion = m;
  styled = nextStyled;
  updateStatus();
  for (const e of entries) chars.setMotion(e.rig, m, styled);
  refreshButtons();
}

function setOutfit(o: typeof outfit) {
  outfit = o;
  for (const e of entries) chars.applyOutfit(e.rig, o === 'uniform');
  refreshButtons();
}

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

type CamName = 'front' | 'top' | 'males' | 'females' | 'orbit';
let autoOrbit = false;
const CAMS: Record<Exclude<CamName, 'orbit'>, [number[], number[]]> = {
  front: [[0, 1.2, 4.6], [0, 0.9, 0]],
  top: [[0, 8, 2], [0, 0, 0]],
  males: [[-0.75, 1.3, 3.2], [-0.75, 0.95, 0]],
  females: [[0.75, 1.3, 3.2], [0.75, 0.95, 0]],
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
for (const c of ['front', 'males', 'females', 'top'] as const) button(gCam, c, () => setCam(c));
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

const labelPos = new THREE.Vector3();
function placeLabels() {
  for (const e of entries) {
    labelPos.set(e.rig.root.position.x, 0, e.rig.root.position.z + 0.1).project(camera);
    e.label.style.left = `${(labelPos.x * 0.5 + 0.5) * innerWidth}px`;
    e.label.style.top = `${(-labelPos.y * 0.5 + 0.5) * innerHeight + 6}px`;
  }
}

function step(dt: number) {
  for (const e of entries) chars.update(e.rig, dt);
  controls.update();
  placeLabels();
  renderer.render(scene, camera);
}

setMotion(motion, styled);
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
