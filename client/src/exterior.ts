/**
 * Dev-only ship exterior viewer: /exterior.html
 * Query params: view=hero|bow|stern|port|starboard|top|bottom, spin=1, labels=1, docks=1, ui=0.
 * Frame in the layout data: +x starboard, +z bow, stern (-z) at the top of the top view.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildShipExterior, buildStars } from './scene/shipExterior';

interface Preset {
  label: string;
  azimuth: number;
  elevation: number;
  distance: number;
}

/** Azimuth runs from the bow (+z) toward starboard (+x). */
const PRESETS: Record<string, Preset> = {
  hero: { label: 'Hero 3/4', azimuth: 38, elevation: 24, distance: 125 },
  bow: { label: 'Bow', azimuth: 0, elevation: 12, distance: 105 },
  stern: { label: 'Stern', azimuth: 180, elevation: 12, distance: 135 },
  port: { label: 'Port', azimuth: 270, elevation: 10, distance: 130 },
  starboard: { label: 'Starboard', azimuth: 90, elevation: 10, distance: 130 },
  top: { label: 'Top', azimuth: 0, elevation: 89.9, distance: 205 },
  bottom: { label: 'Bottom', azimuth: 0, elevation: -89.9, distance: 205 },
};

const params = new URLSearchParams(location.search);
if (params.get('ui') === '0') document.body.classList.add('clean');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(buildStars());
scene.add(new THREE.HemisphereLight(0xb8ccf0, 0x20222c, 0.55));
const key = new THREE.DirectionalLight(0xfff1de, 2.4);
key.position.set(80, 140, 90);
scene.add(key);
const fill = new THREE.DirectionalLight(0x7fb4ff, 0.7);
fill.position.set(-90, 40, -60);
scene.add(fill);
const under = new THREE.DirectionalLight(0x8fa8d8, 0.8);
under.position.set(20, -120, 30);
scene.add(under);

const ship = buildShipExterior();
scene.add(ship.root);

const target = new THREE.Vector3();
ship.bounds.getCenter(target);
target.y = 0;

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.copy(target);
controls.minDistance = 15;
controls.maxDistance = 400;
controls.autoRotateSpeed = 2.4;

function placeCamera(azimuth: number, elevation: number, distance: number) {
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  camera.position.set(
    target.x + distance * Math.cos(el) * Math.sin(az),
    target.y + distance * Math.sin(el),
    target.z + distance * Math.cos(el) * Math.cos(az),
  );
  controls.target.copy(target);
  camera.lookAt(target);
  controls.update();
}

const viewName = document.getElementById('viewName')!;
const viewsEl = document.getElementById('views')!;
const buttons = new Map<string, HTMLButtonElement>();
let tween: { from: Preset; to: Preset; t: number } | null = null;
let current: Preset = PRESETS.hero;

function currentSpherical(): Preset {
  const off = camera.position.clone().sub(controls.target);
  const distance = off.length();
  return {
    label: '',
    azimuth: THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z)),
    elevation: THREE.MathUtils.radToDeg(Math.asin(off.y / distance)),
    distance,
  };
}

function setView(name: string, animate = true) {
  const p = PRESETS[name];
  if (!p) return;
  buttons.forEach((b, k) => b.classList.toggle('active', k === name));
  viewName.textContent = `${p.label} view · drag to orbit, scroll to zoom, right-drag to pan`;
  if (!animate) {
    tween = null;
    controls.target.copy(target);
    placeCamera(p.azimuth, p.elevation, p.distance);
    current = p;
    return;
  }
  controls.target.copy(target);
  const from = currentSpherical();
  let da = p.azimuth - from.azimuth;
  da = ((((da + 180) % 360) + 360) % 360) - 180;
  tween = { from: { ...from, azimuth: p.azimuth - da }, to: p, t: 0 };
  current = p;
}

for (const [name, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.addEventListener('click', () => setView(name));
  viewsEl.appendChild(b);
  buttons.set(name, b);
}

const spinBtn = document.getElementById('spin') as HTMLButtonElement;
function setSpin(on: boolean) {
  controls.autoRotate = on;
  spinBtn.classList.toggle('on', on);
  if (on) tween = null;
}
spinBtn.addEventListener('click', () => setSpin(!controls.autoRotate));

const labelsEl = document.getElementById('labels')!;
const labelNodes = ship.labels.map((l) => {
  const d = document.createElement('div');
  d.textContent = l.text;
  labelsEl.appendChild(d);
  return d;
});
let labelsOn = false;
const labelsBtn = document.getElementById('labelsBtn') as HTMLButtonElement;
function setLabels(on: boolean) {
  labelsOn = on;
  labelsBtn.classList.toggle('on', on);
  labelsEl.style.display = on ? '' : 'none';
}
labelsBtn.addEventListener('click', () => setLabels(!labelsOn));

const docksBtn = document.getElementById('docksBtn') as HTMLButtonElement;
function setDocks(on: boolean) {
  ship.docks.visible = on;
  docksBtn.classList.toggle('on', on);
}
docksBtn.addEventListener('click', () => setDocks(!ship.docks.visible));

setLabels(params.get('labels') === '1');
setDocks(params.get('docks') === '1');
setView(params.get('view') && PRESETS[params.get('view')!] ? params.get('view')! : 'hero', false);
if (params.get('spin') === '1') setSpin(true);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
camera.aspect = innerWidth / innerHeight;
camera.updateProjectionMatrix();

const tmp = new THREE.Vector3();
const ease = (t: number) => t * t * (3 - 2 * t);
const timer = new THREE.Timer();

function frame(time?: number) {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.9);
    const k = ease(tween.t);
    const { from, to } = tween;
    placeCamera(
      from.azimuth + (to.azimuth - from.azimuth) * k,
      from.elevation + (to.elevation - from.elevation) * k,
      from.distance + (to.distance - from.distance) * k,
    );
    if (tween.t >= 1) tween = null;
  } else {
    controls.update(dt);
  }
  if (labelsOn) {
    ship.labels.forEach((l, i) => {
      tmp.copy(l.position).project(camera);
      const node = labelNodes[i];
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      node.style.display = visible ? '' : 'none';
      node.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
      node.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`;
    });
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

/** Hooks for scripted captures (stills and turntable frames). */
(window as unknown as { __exterior: unknown }).__exterior = {
  setView: (name: string) => setView(name, false),
  /** Place the camera on the turntable circle of the current preset at a given azimuth. */
  setAzimuth: (azimuth: number, elevation = 24, distance = 150) => {
    setSpin(false);
    tween = null;
    placeCamera(azimuth, elevation, distance);
    renderer.render(scene, camera);
  },
  current: () => current,
};
