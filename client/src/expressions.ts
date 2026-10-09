/**
 * Dev-only contact sheet: /expressions.html
 * Every face (the five selectable ones, then prototypes) on the male and female head, front view.
 * Prototypes are plain morph-weight sets (PROTOTYPE_EXPRESSIONS in scene/character.ts); the sheet is how
 * we decide which ones to promote into shared/protocol.ts FACES.
 */
import * as THREE from 'three';
import * as characters from './scene/character';
import { EYE_COLORS, FACES, HAIR_COLORS, type Appearance, type Sex } from '../../shared/protocol';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b111c);
scene.add(new THREE.HemisphereLight(0xb8ccf0, 0x1a1420, 0.7));
const key = new THREE.DirectionalLight(0xfff0e0, 1.9);
key.position.set(2, 3, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6fc8ff, 0.5);
rim.position.set(-4, 3, -4);
scene.add(rim);

const colour = (list: readonly { name: string; hex: string }[], name: string) => list.find((c) => c.name === name)!.hex;
const look: Record<Sex, Appearance> = {
  male: { sex: 'male', face: 'neutral', hairStyle: 'parted', facialHair: 'none', hairColor: colour(HAIR_COLORS, 'Dark brown'), eyeColor: colour(EYE_COLORS, 'Brown') },
  female: { sex: 'female', face: 'neutral', hairStyle: 'long', facialHair: 'none', hairColor: colour(HAIR_COLORS, 'Chestnut'), eyeColor: colour(EYE_COLORS, 'Hazel') },
};

await characters.preloadCharacters();

type Panel = { sex: Sex; name: string; kind: 'face' | 'old' | 'new'; rig: characters.Rig };
const panels: Panel[] = [];
const names: { name: string; kind: Panel['kind']; weights?: characters.ExpressionWeights }[] = [
  ...FACES.map((f) => ({ name: f, kind: 'face' as const })),
  ...Object.entries(characters.PROTOTYPE_EXPRESSIONS).map(([name, weights]) => ({ name, kind: name.includes('before') ? ('old' as const) : ('new' as const), weights })),
];

let slot = 0;
for (const sex of ['male', 'female'] as const) {
  names.forEach((n) => {
    const rig = characters.buildRig({ ...look[sex], face: n.kind === 'face' ? (n.name as Appearance['face']) : 'neutral' });
    rig.root.position.set(slot * 3, 0, 0);
    scene.add(rig.root);
    characters.animateRig(rig, 0, false);
    if (n.weights) characters.setRigExpression(rig, n.weights);
    panels.push({ sex, name: n.name, kind: n.kind, rig });
    slot++;
  });
}

const COLS = 6;
const labels = document.getElementById('labels')!;
const headPos = new THREE.Vector3();
const cam = new THREE.PerspectiveCamera(17, 1, 0.05, 50);
const perSex = names.length;
const rowsPerSex = Math.ceil(perSex / COLS);
const HEADER = 34;
const render = () => {
  labels.innerHTML = '';
  const w = innerWidth;
  const h = innerHeight;
  const cw = w / COLS;
  const ch = (h - HEADER * 2) / (rowsPerSex * 2);
  cam.aspect = cw / ch;
  cam.updateProjectionMatrix();
  panels.forEach((p, i) => {
    const sexIdx = p.sex === 'male' ? 0 : 1;
    const local = i - sexIdx * perSex;
    const col = local % COLS;
    const row = Math.floor(local / COLS) + sexIdx * rowsPerSex;
    const x = col * cw;
    const top = HEADER * (sexIdx + 1) + row * ch;
    p.rig.root.updateMatrixWorld(true);
    p.rig.head.getWorldPosition(headPos);
    cam.position.set(headPos.x, headPos.y + 0.06, headPos.z + 1.5);
    cam.lookAt(headPos.x, headPos.y + 0.06, headPos.z);
    renderer.setViewport(x, h - top - ch, cw, ch);
    renderer.setScissor(x, h - top - ch, cw, ch);
    renderer.render(scene, cam);
    const el = document.createElement('div');
    el.className = p.kind;
    el.textContent = p.name;
    el.style.left = `${x + cw / 2}px`;
    el.style.top = `${top + ch - 26}px`;
    labels.appendChild(el);
  });
  for (const [i, sex] of (['male', 'female'] as const).entries()) {
    const el = document.createElement('div');
    el.className = 'sex';
    el.textContent = sex;
    el.style.left = '14px';
    el.style.top = `${HEADER * i + i * rowsPerSex * ch + 6}px`;
    labels.appendChild(el);
  }
};
render();
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  render();
});
Object.assign(window, { ready: true });
