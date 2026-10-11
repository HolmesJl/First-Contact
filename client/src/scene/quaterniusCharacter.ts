import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_ARMOR_PRIMARY, armorBodyMaterial, attachArmorShells, detachArmorShells, loadBodyArmor } from './bodyArmor';
import { loadUniforms } from './uniform';

/**
 * Dev-only loader for the Quaternius characters carrying retargeted ACCAD mocap clips (built by
 * tools/build-character-clips.mjs into client/dev-assets/characters). Used by the gallery at /characters.html;
 * the game itself still plays the stock Quaternius clips from client/public/models.
 */

export type Sex = 'male' | 'female';
export type Motion = 'idle' | 'walk' | 'jog' | 'sprint';
export type Outfit = 'uniform' | 'bare' | 'armor';
export type ClipKey = Motion | `raw_${Motion}`;

interface ClipInfo {
  groundSpeed: number;
  duration: number;
}

export interface Manifest {
  characters: Record<Sex, { file: string; uniform: { color: string; normal: string }; vertices: Record<string, number>; clips: Record<ClipKey, ClipInfo> }>;
}

export interface Rig {
  sex: Sex;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipKey, THREE.AnimationAction>;
  motion: Motion;
  styled: boolean;
  meshes: Record<string, THREE.SkinnedMesh>;
  skinMap: THREE.Texture | null;
  skinMat: THREE.MeshStandardMaterial;
  outfit: Outfit;
  armorShells: THREE.SkinnedMesh[];
}

const CLIPS: ClipKey[] = ['idle', 'walk', 'jog', 'sprint', 'raw_idle', 'raw_walk', 'raw_jog', 'raw_sprint'];
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltfs = new Map<Sex, GLTF>();
const textures = new Map<string, THREE.Texture>();
let manifest: Manifest;
let urlFor: (rel: string) => string;
const publicUrl = (rel: string) => `${import.meta.env.BASE_URL}models/${rel}`;

async function tex(rel: string, linear: boolean) {
  let t = textures.get(rel);
  if (!t) {
    t = await new THREE.TextureLoader().loadAsync(publicUrl(rel));
    t.flipY = false;
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(rel, t);
  }
  return t;
}

export async function loadCharacters(m: Manifest, resolve: (rel: string) => string) {
  manifest = m;
  urlFor = resolve;
  for (const sex of ['male', 'female'] as const) {
    const info = m.characters[sex];
    gltfs.set(sex, await loader.loadAsync(urlFor(info.file)));
    await tex(info.uniform.color, false);
    await tex(info.uniform.normal, true);
  }
  await Promise.all([loadUniforms(publicUrl('')), loadBodyArmor(publicUrl(''))]);
}

export function buildCharacter(sex: Sex, hairColor: string): Rig {
  const gltf = gltfs.get(sex)!;
  const model = SkeletonUtils.clone(gltf.scene);
  const meshes: Record<string, THREE.SkinnedMesh> = {};
  model.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh) return;
    s.frustumCulled = false;
    s.material = (s.material as THREE.Material).clone();
    meshes[s.name] = s;
  });
  setHairColor({ meshes } as Rig, hairColor);
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  for (const key of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === key);
    if (!clip) throw new Error(`${sex}: missing clip ${key}`);
    actions[key] = mixer.clipAction(clip);
  }
  actions.idle.play();
  const body = meshes.Body.material as THREE.MeshStandardMaterial;
  const rig: Rig = { sex, root, mixer, actions, motion: 'idle', styled: true, meshes, skinMap: body.map, skinMat: body, outfit: 'uniform', armorShells: [] };
  applyOutfit(rig, 'uniform');
  return rig;
}

export function setHairColor(rig: Pick<Rig, 'meshes'>, hex: string) {
  const hair = rig.meshes.HairParted ?? rig.meshes.HairLong;
  if (hair) (hair.material as THREE.MeshStandardMaterial).color.set(hex);
  if (rig.meshes.Brows) (rig.meshes.Brows.material as THREE.MeshStandardMaterial).color.set(hex).multiplyScalar(0.7);
}

/** `accentHex`: the job colour for the armor's arm bands (the painted jumpsuit keeps its baked accent in this viewer). */
export function applyOutfit(rig: Rig, outfit: Outfit, accentHex = '#e8772e', primaryHex = DEFAULT_ARMOR_PRIMARY) {
  rig.outfit = outfit;
  const info = manifest.characters[rig.sex];
  detachArmorShells(rig.armorShells);
  rig.armorShells = [];
  if (outfit === 'armor') {
    const m = armorBodyMaterial(rig.skinMat, rig.sex, false, accentHex, primaryHex);
    rig.meshes.Body.material = m;
    rig.armorShells = attachArmorShells(rig.meshes.Body, rig.sex, m);
    return;
  }
  rig.meshes.Body.material = rig.skinMat;
  const mat = rig.skinMat;
  if (outfit === 'uniform') {
    mat.map = textures.get(info.uniform.color)!;
    mat.normalMap = textures.get(info.uniform.normal)!;
    mat.normalScale.set(1.4, 1.4);
    mat.roughness = 0.78;
  } else {
    mat.map = rig.skinMap;
    mat.normalMap = null;
    mat.roughness = 0.6;
  }
  mat.needsUpdate = true;
}

const key = (rig: Rig, motion: Motion, styled = rig.styled): ClipKey => (styled ? motion : `raw_${motion}`);

export function setMotion(rig: Rig, motion: Motion, styled = rig.styled, fade = 0.3) {
  const prev = key(rig, rig.motion);
  const next = key(rig, motion, styled);
  rig.motion = motion;
  rig.styled = styled;
  if (prev === next) return;
  rig.actions[next].reset().play();
  rig.actions[prev].crossFadeTo(rig.actions[next], fade, false);
}

export function groundSpeed(sex: Sex, motion: Motion, styled: boolean) {
  return manifest.characters[sex].clips[key({ styled } as Rig, motion, styled)].groundSpeed;
}

export function update(rig: Rig, dt: number) {
  rig.mixer.update(dt);
}
