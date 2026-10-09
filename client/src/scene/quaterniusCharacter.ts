import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ClipKey, Manifest, Motion } from './mpfbCharacter';

/**
 * Dev-only loader for the original game characters (Quaternius, CC0) carrying the same retargeted ACCAD clips
 * as the MPFB characters, so a comparison isolates the bodies. Built by tools/build-mpfb-characters.mjs.
 */

export interface QRig {
  sex: 'male' | 'female';
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipKey, THREE.AnimationAction>;
  motion: Motion;
  styled: boolean;
  meshes: Record<string, THREE.SkinnedMesh>;
  skinMap: THREE.Texture | null;
  uniform: boolean;
}

const CLIPS: ClipKey[] = ['idle', 'walk', 'jog', 'sprint', 'raw_idle', 'raw_walk', 'raw_jog', 'raw_sprint'];
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltfs = new Map<string, GLTF>();
const textures = new Map<string, THREE.Texture>();
let manifest: Manifest;
let urlFor: (rel: string) => string;

async function tex(rel: string, linear: boolean) {
  let t = textures.get(rel);
  if (!t) {
    t = await new THREE.TextureLoader().loadAsync(urlFor(rel));
    t.flipY = false;
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textures.set(rel, t);
  }
  return t;
}

export async function loadQuaternius(m: Manifest, resolve: (rel: string) => string) {
  manifest = m;
  urlFor = resolve;
  for (const sex of ['male', 'female'] as const) {
    const info = m.quaternius[sex];
    gltfs.set(sex, await loader.loadAsync(urlFor(info.file)));
    await tex(info.uniform.color, false);
    await tex(info.uniform.normal, true);
  }
}

export function buildQuaternius(sex: 'male' | 'female', hairColor: string): QRig {
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
  const hair = meshes.HairShort ?? meshes.HairLong;
  if (hair) (hair.material as THREE.MeshStandardMaterial).color.set(hairColor);
  if (meshes.Brows) (meshes.Brows.material as THREE.MeshStandardMaterial).color.set(hairColor).multiplyScalar(0.7);
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  for (const key of CLIPS) {
    const clip = gltf.animations.find((a) => a.name === key);
    if (!clip) throw new Error(`quaternius ${sex}: missing clip ${key}`);
    actions[key] = mixer.clipAction(clip);
  }
  actions.idle.play();
  const body = meshes.Body.material as THREE.MeshStandardMaterial;
  const rig: QRig = { sex, root, mixer, actions, motion: 'idle', styled: true, meshes, skinMap: body.map, uniform: true };
  applyOutfit(rig, true);
  return rig;
}

export function applyOutfit(rig: QRig, uniform: boolean) {
  rig.uniform = uniform;
  const info = manifest.quaternius[rig.sex];
  const mat = rig.meshes.Body.material as THREE.MeshStandardMaterial;
  if (uniform) {
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

const key = (rig: QRig, motion: Motion, styled = rig.styled): ClipKey => (styled ? motion : `raw_${motion}`);

export function setMotionQ(rig: QRig, motion: Motion, styled = rig.styled, fade = 0.3) {
  const prev = key(rig, rig.motion);
  const next = key(rig, motion, styled);
  rig.motion = motion;
  rig.styled = styled;
  if (prev === next) return;
  rig.actions[next].reset().play();
  rig.actions[prev].crossFadeTo(rig.actions[next], fade, false);
}

export function updateQ(rig: QRig, dt: number) {
  rig.mixer.update(dt);
}
