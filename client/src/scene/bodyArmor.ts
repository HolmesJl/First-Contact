import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Sex } from '../../../shared/protocol';
import { canvasTexture, hexToRgb, recolour, uniformImage, uniformNormalImage } from './uniform';

/**
 * Lite Body Armor, worn over the jumpsuit. tools/build-armor.mjs paints the armor into each body's UV layout as a
 * layer (colour + normal with coverage alpha, a primary-colour mask and a trim mask) and builds plate shells
 * (cuirass, pauldrons, boots, shins, thighs, bracers) from the body surface, skinned to the same skeleton.
 *
 * Wearing it = the body material swaps to the armor layer composited over the (job-coloured) jumpsuit, tinted to
 * the primary colour with the trim recoloured to the job colour, plus the shells bound to the character's bones.
 */

export interface ArmorOptions {
  /** Plate colour; defaults to DEFAULT_ARMOR_PRIMARY (the starter armor's medium grey). */
  primary?: string;
}

/** Plate colour of the starter-quest armor: a medium grey that still reads as plate under the ship lighting. */
export const DEFAULT_ARMOR_PRIMARY = '#8a8f96';

/** The painted band colour (the jumpsuit accent); recolouring replaces it with the job colour. */
const PAINTED_ACCENT = [232, 119, 46];
/** Neutral value the plates are painted in (tools/armor-painter.mjs PRIMARY); the tint multiplies by primary / this. */
const PAINTED_PRIMARY = [204, 204, 206];

interface ArmorAsset {
  shells: { name: string; geometry: THREE.BufferGeometry; jointNames: string[]; boneInverses: THREE.Matrix4[] }[];
  color: ImageData;
  normal: ImageData;
  primary: Uint8ClampedArray;
  accent: Uint8ClampedArray;
}

const assets = new Map<Sex, ArmorAsset>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
const normalTextures = new Map<Sex, THREE.Texture>();
let loading: Promise<void> | null = null;

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });

function pixels(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

const redChannel = (img: ImageData) => {
  const out = new Uint8ClampedArray(img.data.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4];
  return out;
};

/** Loads the armor shells and texture layers for both sexes. `base` is the models folder URL, as for the bodies. */
export function loadBodyArmor(base: string) {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    await Promise.all(
      (['male', 'female'] as const).map(async (sex) => {
        const [gltf, color, normal, primary, accent] = await Promise.all([
          loader.loadAsync(`${base}armor/${sex}.glb`),
          loadImage(`${base}armor/${sex}.webp`),
          loadImage(`${base}armor/${sex}-normal.webp`),
          loadImage(`${base}armor/${sex}-primary.webp`),
          loadImage(`${base}armor/${sex}-accent.webp`),
        ]);
        const shells: ArmorAsset['shells'] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (m.isSkinnedMesh) shells.push({ name: m.name, geometry: m.geometry, jointNames: m.skeleton.bones.map((b) => b.name), boneInverses: m.skeleton.boneInverses });
        });
        assets.set(sex, { shells, color: pixels(color), normal: pixels(normal), primary: redChannel(pixels(primary)), accent: redChannel(pixels(accent)) });
      }),
    );
  })();
  return loading;
}

export const bodyArmorReady = () => assets.size === 2;

/** Alpha-composites `layer` over `base` in place. */
function composite(base: ImageData, layer: ImageData) {
  const b = base.data;
  const l = layer.data;
  for (let i = 0; i < b.length; i += 4) {
    const a = l[i + 3] / 255;
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) b[i + k] += (l[i + k] - b[i + k]) * a;
  }
}

function armorNormal(sex: Sex) {
  let t = normalTextures.get(sex);
  if (!t) {
    const img = uniformNormalImage(sex);
    composite(img, assets.get(sex)!.normal);
    t = canvasTexture(img, false);
    normalTextures.set(sex, t);
  }
  return t;
}

/**
 * The body material wearing the armor: the armor layer (plates tinted to `primaryHex`, the upper-arm bands
 * recoloured to `accentHex`) over the jumpsuit in the same job colour. Shared between characters with the same look.
 */
export function armorBodyMaterial(skin: THREE.MeshStandardMaterial, sex: Sex, shaven: boolean, accentHex: string, primaryHex = DEFAULT_ARMOR_PRIMARY) {
  const key = `${sex}|${shaven}|${accentHex}|${primaryHex}`;
  let m = materials.get(key);
  if (m) return m;
  const asset = assets.get(sex);
  if (!asset) throw new Error('loadBodyArmor() must resolve before dressing characters');
  const layer = new ImageData(new Uint8ClampedArray(asset.color.data), asset.color.width, asset.color.height);
  const tint = hexToRgb(primaryHex).map((v, k) => v / PAINTED_PRIMARY[k]);
  for (let i = 0; i < asset.primary.length; i++) {
    const w = asset.primary[i] / 255;
    if (w === 0) continue;
    for (let k = 0; k < 3; k++) {
      const c = layer.data[i * 4 + k];
      layer.data[i * 4 + k] = c + (c * tint[k] - c) * w;
    }
  }
  recolour(layer, asset.accent, PAINTED_ACCENT, accentHex);
  const img = uniformImage(sex, shaven, accentHex);
  composite(img, layer);
  m = skin.clone();
  m.map = canvasTexture(img, true);
  m.normalMap = armorNormal(sex);
  m.normalScale.set(1.4, 1.4);
  m.roughness = 0.6;
  materials.set(key, m);
  return m;
}

/**
 * Adds the plate shells next to `body`, bound to its bones by name. The shells keep their own inverse bind matrices
 * (the game body's bind pose, in metres): the dev gallery's bodies are quantized and bake a rescale into theirs.
 * Returns the meshes so they can be removed again.
 */
export function attachArmorShells(body: THREE.SkinnedMesh, sex: Sex, material: THREE.Material) {
  const asset = assets.get(sex);
  if (!asset) throw new Error('loadBodyArmor() must resolve before dressing characters');
  const byName = new Map<string, number>();
  body.skeleton.bones.forEach((b, i) => byName.set(b.name.toLowerCase(), i));
  const out: THREE.SkinnedMesh[] = [];
  for (const shell of asset.shells) {
    const bones = shell.jointNames.map((name) => {
      const i = byName.get(name.toLowerCase());
      if (i === undefined) throw new Error(`armor: body has no bone ${name}`);
      return body.skeleton.bones[i];
    });
    const mesh = new THREE.SkinnedMesh(shell.geometry, material);
    mesh.name = shell.name;
    mesh.frustumCulled = false;
    mesh.castShadow = body.castShadow;
    mesh.receiveShadow = body.receiveShadow;
    mesh.bind(new THREE.Skeleton(bones, shell.boneInverses), body.bindMatrix);
    body.parent!.add(mesh);
    out.push(mesh);
  }
  return out;
}

export function detachArmorShells(shells: THREE.SkinnedMesh[]) {
  for (const s of shells) {
    s.removeFromParent();
    s.skeleton.dispose();
  }
}
