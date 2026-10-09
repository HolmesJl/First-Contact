/**
 * Dev-only character gallery: /gallery.html?view=close|game&sex=male|female
 * Renders every face expression side by side so character changes can be compared.
 */
import * as THREE from 'three';
import * as characters from './scene/character';
import { EYE_COLORS, FACES, HAIR_COLORS, HAIR_STYLES, type Appearance, type Face } from '../../shared/protocol';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'close';
const sexParam = params.get('sex') ?? 'both';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b111c);
scene.add(new THREE.HemisphereLight(0xb8ccf0, 0x1a1420, 0.5));
const key = new THREE.DirectionalLight(0xfff0e0, 1.5);
key.position.set(3, 9, 8);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6fc8ff, 0.5);
rim.position.set(-4, 5, -8);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.6 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const HAIR = ['Dark brown', 'Copper', 'Black', 'Blonde'].map((n) => HAIR_COLORS.find((c) => c.name === n)!.hex);
const EYES = ['Blue', 'Green', 'Brown', 'Hazel'].map((n) => EYE_COLORS.find((c) => c.name === n)!.hex);
const FACIAL = ['beard', 'stubble', 'none', 'beard'] as const;

function appearance(sex: 'male' | 'female', face: Face, i: number): Appearance {
  return {
    sex,
    face,
    hairStyle: HAIR_STYLES[sex][i % HAIR_STYLES[sex].length].id,
    facialHair: sex === 'male' ? FACIAL[i] : 'none',
    hairColor: HAIR[i],
    eyeColor: EYES[i],
  };
}

interface Cell {
  rig: characters.Rig;
  label: string;
}

const mod = characters as unknown as { preloadCharacters?: () => Promise<void> };
await mod.preloadCharacters?.();

const sexes: ('male' | 'female')[] = sexParam === 'both' ? ['male', 'female'] : [sexParam as 'male' | 'female'];
const cells: Cell[] = [];
sexes.forEach((sex, row) => {
  FACES.forEach((face, i) => {
    const rig = characters.buildRig(appearance(sex, face, i));
    if (view === 'game') rig.root.position.set((i - 1.5) * 0.9, 0, row * -1.4);
    else rig.root.position.set((i - 1.5) * 3 + row * 20, 0, 0);
    scene.add(rig.root);
    cells.push({ rig, label: `${sex} · ${face}` });
  });
});

document.getElementById('title')!.textContent = view === 'game' ? 'Gameplay camera distance' : 'Close-up';

const labels = document.getElementById('labels')!;
const cams: THREE.PerspectiveCamera[] = [];
const gameCam = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 100);

function layout() {
  labels.innerHTML = '';
  const w = innerWidth;
  const h = innerHeight;
  if (view === 'game') {
    gameCam.aspect = w / h;
    gameCam.updateProjectionMatrix();
    return;
  }
  const cols = 4;
  const rows = Math.ceil(cells.length / cols);
  cells.forEach((c, i) => {
    const cx = (i % cols) * (w / cols) + w / cols / 2;
    const cy = Math.floor(i / cols) * (h / rows) + h / rows - 26;
    const d = document.createElement('div');
    d.textContent = c.label;
    d.style.left = `${cx}px`;
    d.style.top = `${cy}px`;
    labels.appendChild(d);
    const cam = cams[i] ?? (cams[i] = new THREE.PerspectiveCamera(30, 1, 0.01, 50));
    cam.aspect = w / cols / (h / rows);
    cam.updateProjectionMatrix();
  });
}
layout();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  layout();
});

const timer = new THREE.Timer();
const headPos = new THREE.Vector3();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 0.1);
  for (const c of cells) characters.animateRig(c.rig, dt, false);
  const w = innerWidth;
  const h = innerHeight;
  if (view === 'game') {
    const d = 3.9;
    const pitch = 0.34;
    const target = new THREE.Vector3(0, 1.45, sexes.length > 1 ? -0.7 : 0);
    gameCam.position.set(target.x, target.y + Math.sin(pitch) * d, target.z + Math.cos(pitch) * d);
    gameCam.lookAt(target);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.render(scene, gameCam);
    return;
  }
  const cols = 4;
  const rows = Math.ceil(cells.length / cols);
  cells.forEach((c, i) => {
    const cw = w / cols;
    const ch = h / rows;
    const x = (i % cols) * cw;
    const y = h - (Math.floor(i / cols) + 1) * ch;
    c.rig.root.updateMatrixWorld(true);
    c.rig.head.getWorldPosition(headPos);
    const cam = cams[i];
    cam.position.set(headPos.x + 0.12, headPos.y + 0.1, headPos.z + 0.95);
    cam.lookAt(headPos.x, headPos.y + 0.04, headPos.z);
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, cam);
  });
});
