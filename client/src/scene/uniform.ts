import * as THREE from 'three';
import { JOB_INFO, type Job, type Sex } from '../../../shared/protocol';

/**
 * Crew uniform. tools/uniform-painter.mjs paints the jumpsuit into each body's UV layout (colour, normal and an
 * accent mask); here the accent (sleeve bands, shoulder patches, collar) is recoloured per job.
 */

/** The accent colour painted into the textures; recolouring replaces it. */
const PAINTED_ACCENT = [232, 119, 46];
/** Accent used when a job is unknown, and for everyone when UNIFORM_ACCENT_BY_JOB is off. Change this one constant. */
export const DEFAULT_ACCENT = '#ff9f43';
export const UNIFORM_ACCENT_BY_JOB = true;

export const accentFor = (job?: Job) => (UNIFORM_ACCENT_BY_JOB && job ? JOB_INFO[job].color : DEFAULT_ACCENT);

interface Layer {
  color: ImageData;
  /** Same size as the colour image, one byte per pixel in the red channel. */
  mask: Uint8ClampedArray;
}

const images = new Map<string, HTMLImageElement>();
const normals = new Map<Sex, THREE.Texture>();
const layers = new Map<string, Layer>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

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

export async function loadUniforms(base: string) {
  const files = ['male', 'male-shaven', 'female', 'male-accent', 'female-accent'];
  await Promise.all(files.map(async (f) => images.set(f, await loadImage(`${base}uniform/${f}.webp`))));
  for (const sex of ['male', 'female'] as const) {
    const img = await loadImage(`${base}uniform/${sex}-normal.webp`);
    const t = new THREE.Texture(img);
    t.flipY = false;
    t.anisotropy = 4;
    t.needsUpdate = true;
    normals.set(sex, t);
  }
}

function layer(sex: Sex, shaven: boolean): Layer {
  const key = shaven ? `${sex}-shaven` : sex;
  let l = layers.get(key);
  if (!l) {
    const maskData = pixels(images.get(`${sex}-accent`)!).data;
    const mask = new Uint8ClampedArray(maskData.length / 4);
    for (let i = 0; i < mask.length; i++) mask[i] = maskData[i * 4];
    l = { color: pixels(images.get(key)!), mask };
    layers.set(key, l);
  }
  return l;
}

/** A skin material wearing the uniform with the given accent colour. Shared between characters with the same look. */
export function uniformMaterial(skin: THREE.MeshStandardMaterial, sex: Sex, shaven: boolean, accentHex: string) {
  const key = `${sex}|${shaven}|${accentHex}`;
  let m = materials.get(key);
  if (m) return m;
  const { color, mask } = layer(sex, shaven);
  const out = new ImageData(new Uint8ClampedArray(color.data), color.width, color.height);
  const rgb = [1, 3, 5].map((i) => parseInt(accentHex.slice(i, i + 2), 16));
  const delta = rgb.map((v, k) => v - PAINTED_ACCENT[k]);
  for (let i = 0; i < mask.length; i++) {
    const w = mask[i] / 255;
    if (w === 0) continue;
    for (let k = 0; k < 3; k++) out.data[i * 4 + k] += w * delta[k];
  }
  const canvas = document.createElement('canvas');
  canvas.width = color.width;
  canvas.height = color.height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = skin.clone();
  m.map = tex;
  m.normalMap = normals.get(sex)!;
  m.normalScale.set(1.4, 1.4);
  m.roughness = 0.78;
  materials.set(key, m);
  return m;
}
