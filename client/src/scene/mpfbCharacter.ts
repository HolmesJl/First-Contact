import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Spike loader for the MakeHuman / MPFB characters built by tools/build-mpfb-characters.mjs.
 * Dev-only: used by characters.html, not by the game. Faces are driven by ARKit-named shape keys.
 */

export type Motion = 'idle' | 'walk' | 'jog' | 'sprint';
export type ClipKey = Motion | `raw_${Motion}`;
export type Expression = 'neutral' | 'smiling' | 'serious' | 'angry' | 'flirty';

export interface ClipInfo {
  frames: number;
  duration: number;
  groundSpeed: number;
  source: string;
}

export interface PresetInfo {
  id: string;
  sex: 'male' | 'female';
  label: string;
  file: string;
  brows: string;
  hair: string[];
  vertices: Record<string, number>;
  bodyMorphTargets: number;
  clips: Record<ClipKey, ClipInfo>;
  bytes: number;
  uniform: { color: string; normal: string };
}

export interface Manifest {
  vertexBudget: number;
  skins: Record<'male' | 'female', { id: string; label: string; file: string }[]>;
  normals: Record<'male' | 'female', string>;
  quaternius: Record<'male' | 'female', { file: string; uniform: { color: string; normal: string }; vertices: Record<string, number>; clips: Record<ClipKey, ClipInfo> }>;
  hair: Record<string, string>;
  brows: Record<string, string>;
  lashes: string;
  eye: { file: string; irisCenters: [number, number][]; irisRadius: number };
  presets: PresetInfo[];
}

export interface Look {
  skin: number;
  skinTint: string;
  uniform: boolean;
  hairStyle: number;
  hairColor: string;
  eyeColor: string;
}

export interface MpfbRig {
  info: PresetInfo;
  root: THREE.Group;
  head: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipKey, THREE.AnimationAction>;
  motion: Motion;
  styled: boolean;
  look: Look;
  expression: Expression;
  meshes: Record<string, THREE.SkinnedMesh>;
  blink: number;
  wink: number;
  blinkIn: number;
  winkIn: number;
}

type UrlFor = (rel: string) => string;

const EXPRESSIONS: Record<Expression, Record<string, number>> = {
  neutral: {},
  smiling: { mouthSmileLeft: 0.85, mouthSmileRight: 0.85, cheekSquintLeft: 0.5, cheekSquintRight: 0.5, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, browInnerUp: 0.25 },
  serious: { mouthPressLeft: 0.6, mouthPressRight: 0.6, browDownLeft: 0.3, browDownRight: 0.3, mouthFrownLeft: 0.1, mouthFrownRight: 0.1 },
  angry: { browDownLeft: 1, browDownRight: 1, mouthFrownLeft: 0.7, mouthFrownRight: 0.7, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, noseSneerLeft: 0.4, noseSneerRight: 0.4, mouthPressLeft: 0.3, mouthPressRight: 0.3 },
  flirty: { mouthSmileLeft: 0.9, mouthSmileRight: 0.25, browOuterUpLeft: 1, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.4, eyeSquintRight: 0.3, cheekSquintLeft: 0.3 },
};

const MOTIONS: ClipKey[] = ['idle', 'walk', 'jog', 'sprint', 'raw_idle', 'raw_walk', 'raw_jog', 'raw_sprint'];

let manifest: Manifest | null = null;
let urlFor: UrlFor = (r) => r;
const gltfs = new Map<string, GLTF>();
const textures = new Map<string, THREE.Texture>();
const hairMats = new Map<string, THREE.MeshStandardMaterial>();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

export async function loadMpfb(resolve: UrlFor, manifestUrl: string): Promise<Manifest> {
  urlFor = resolve;
  manifest = (await (await fetch(manifestUrl)).json()) as Manifest;
  await Promise.all(manifest.presets.map(async (p) => gltfs.set(p.id, await loader.loadAsync(urlFor(p.file)))));
  await Promise.all(Object.values(manifest.normals).map((f) => texture(f, true)));
  await Promise.all(manifest.presets.flatMap((p) => [texture(p.uniform.color), texture(p.uniform.normal, true)]));
  const files = [manifest.eye.file, manifest.lashes, ...Object.values(manifest.hair), ...Object.values(manifest.brows), ...Object.values(manifest.skins).flatMap((s) => s.map((x) => x.file))];
  await Promise.all(files.map((f) => texture(f)));
  return manifest;
}

async function texture(rel: string, linear = false) {
  let t = textures.get(rel);
  if (!t) {
    t = await texLoader.loadAsync(urlFor(rel));
    t.flipY = false;
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(rel, t);
  }
  return t;
}

function tex(rel: string) {
  const t = textures.get(rel);
  if (!t) throw new Error(`texture not loaded: ${rel}`);
  return t;
}

/** Recolours the iris (stored as luminance) by multiplication; sclera and pupil are untouched. */
function eyeTexture(hex: string) {
  const key = `eye:${hex}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const m = manifest!;
  const img = tex(m.eye.file).image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const c = new THREE.Color(hex);
  const [tr, tg, tb] = [c.r, c.g, c.b].map((v) => Math.pow(v, 1 / 2.2) * 255);
  const R = m.eye.irisRadius;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const d = Math.min(...m.eye.irisCenters.map(([cx, cy]) => Math.hypot(x / canvas.width - cx, y / canvas.height - cy)));
      if (d > R) continue;
      const i = (y * canvas.width + x) * 4;
      const lum = data.data[i] / 150;
      const k = Math.min(1, (R - d) / 0.01);
      data.data[i] += (tr * lum - data.data[i]) * k;
      data.data[i + 1] += (tg * lum - data.data[i + 1]) * k;
      data.data[i + 2] += (tb * lum - data.data[i + 2]) * k;
    }
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, t);
  return t;
}

function hairMaterial(file: string, hex: string) {
  const key = `${file}:${hex}`;
  let m = hairMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex(file), color: hex, roughness: 0.55, metalness: 0, alphaTest: 0.42, side: THREE.DoubleSide, alphaToCoverage: true });
    hairMats.set(key, m);
  }
  return m;
}

export function buildMpfb(id: string, look: Look): MpfbRig {
  const m = manifest!;
  const info = m.presets.find((p) => p.id === id)!;
  const gltf = gltfs.get(id)!;
  const model = SkeletonUtils.clone(gltf.scene);
  const meshes: Record<string, THREE.SkinnedMesh> = {};
  model.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh) return;
    s.frustumCulled = false;
    s.castShadow = false;
    meshes[s.name] = s;
  });

  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  for (const mo of MOTIONS) {
    const clip = gltf.animations.find((a) => a.name === mo);
    if (!clip) throw new Error(`${id}: missing clip ${mo}`);
    actions[mo] = mixer.clipAction(clip);
    actions[mo].time = 0;
  }
  actions.idle.play();

  const rig: MpfbRig = {
    info,
    root,
    head: model.getObjectByName('head') ?? model,
    mixer,
    actions,
    motion: 'idle',
    styled: true,
    look: { ...look },
    expression: 'neutral',
    meshes,
    blink: 0,
    wink: 0,
    blinkIn: 1 + Math.random() * 3,
    winkIn: 2 + Math.random() * 3,
  };
  applyLook(rig);
  applyExpression(rig);
  return rig;
}

export function applyLook(rig: MpfbRig) {
  const m = manifest!;
  const { info, look, meshes } = rig;
  const skins = m.skins[info.sex];
  const skin = look.uniform
    ? new THREE.MeshPhysicalMaterial({ map: tex(info.uniform.color), normalMap: tex(info.uniform.normal), normalScale: new THREE.Vector2(1.4, 1.4), color: look.skinTint, roughness: 0.78, metalness: 0, specularIntensity: 0.25 })
    : new THREE.MeshPhysicalMaterial({ map: tex(skins[look.skin % skins.length].file), normalMap: tex(m.normals[info.sex]), normalScale: new THREE.Vector2(1.2, 1.2), color: look.skinTint, roughness: 0.45, metalness: 0, specularIntensity: 0.5 });
  meshes.Body.material = skin;
  const eyes = new THREE.MeshStandardMaterial({ map: eyeTexture(look.eyeColor), roughness: 0.12, metalness: 0 });
  meshes.Eyes.material = eyes;
  const brow = new THREE.MeshStandardMaterial({ map: tex(m.brows[info.brows]), color: new THREE.Color(look.hairColor).multiplyScalar(0.75), roughness: 0.8, alphaTest: 0.3, side: THREE.DoubleSide, alphaToCoverage: true });
  meshes.Brows.material = brow;
  meshes.Lashes.material = new THREE.MeshStandardMaterial({ map: tex(m.lashes), color: 0x111111, roughness: 0.8, alphaTest: 0.3, side: THREE.DoubleSide, alphaToCoverage: true });
  const styles = info.hair;
  const wanted = look.hairStyle >= 0 ? styles[look.hairStyle % styles.length] : null;
  for (const style of styles) {
    const mesh = meshes[`Hair_${style}`];
    if (!mesh) continue;
    mesh.visible = style === wanted;
    mesh.material = hairMaterial(m.hair[style], look.hairColor);
  }
}

export function applyExpression(rig: MpfbRig) {
  const base = EXPRESSIONS[rig.expression];
  for (const name of ['Body', 'Brows', 'Lashes']) {
    const mesh = rig.meshes[name];
    const dict = mesh?.morphTargetDictionary;
    if (!mesh || !dict || !mesh.morphTargetInfluences) continue;
    mesh.morphTargetInfluences.fill(0);
    const uni = dict.Uniform;
    if (uni !== undefined) mesh.morphTargetInfluences[uni] = rig.look.uniform ? 1 : 0;
    for (const [shape, w] of Object.entries(base)) {
      const i = dict[shape];
      if (i !== undefined) mesh.morphTargetInfluences[i] = w;
    }
    const lid = (shape: string, v: number) => {
      const i = dict[shape];
      if (i !== undefined) mesh.morphTargetInfluences![i] = Math.max(mesh.morphTargetInfluences![i], v);
    };
    lid('eyeBlinkLeft', Math.max(rig.blink, rig.expression === 'flirty' ? rig.wink : 0));
    lid('eyeBlinkRight', rig.blink);
  }
}

const clipKey = (rig: MpfbRig, motion: Motion, styled = rig.styled): ClipKey => (styled ? motion : `raw_${motion}`);

export function setMotion(rig: MpfbRig, motion: Motion, styled = rig.styled, fade = 0.3) {
  const prevKey = clipKey(rig, rig.motion);
  const nextKey = clipKey(rig, motion, styled);
  rig.motion = motion;
  rig.styled = styled;
  if (prevKey === nextKey) return;
  const next = rig.actions[nextKey];
  next.reset().play();
  rig.actions[prevKey].crossFadeTo(next, fade, false);
}

export function updateMpfb(rig: MpfbRig, dt: number) {
  rig.mixer.update(dt);
  rig.blinkIn -= dt;
  if (rig.blinkIn <= 0) {
    rig.blink = Math.min(1, rig.blink + dt * 14);
    if (rig.blinkIn < -0.14) rig.blinkIn = 2.5 + Math.random() * 3.5;
  } else rig.blink = Math.max(0, rig.blink - dt * 10);
  if (rig.expression === 'flirty') {
    rig.winkIn -= dt;
    if (rig.winkIn <= 0) {
      rig.wink = Math.min(1, rig.wink + dt * 8);
      if (rig.winkIn < -0.45) rig.winkIn = 3.5 + Math.random() * 3;
    } else rig.wink = Math.max(0, rig.wink - dt * 6);
  } else rig.wink = 0;
  applyExpression(rig);
}

export function disposeMpfb(rig: MpfbRig) {
  rig.mixer.stopAllAction();
  rig.mixer.uncacheRoot(rig.mixer.getRoot());
}
