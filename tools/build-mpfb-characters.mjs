/**
 * Spike pipeline: MakeHuman / MPFB characters + ACCAD motion capture -> client/dev-assets/mpfb.
 *
 *   tools/blender/setup.sh            (once: downloads Blender, MPFB, asset packs, ACCAD mocap into tools/.cache)
 *   cd tools && npm install && npm run build:mpfb [-- --skip-blender]
 *
 * Stage 1 (Blender, headless): tools/blender/generate_character.py builds each preset in
 *   tools/blender/presets.json; tools/blender/retarget_export.py retargets the gendered mocap clips and
 *   writes tools/.cache/mpfb/<preset>.glb (geometry, rig, ARKit shape keys, animations, no textures).
 * Stage 2 (this file): compresses the GLBs (meshopt) and produces the shared textures (skins with painted
 *   underwear, neutral hair/brow/eye textures for tinting) as WebP, plus a manifest the dev page reads.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = import.meta.dirname;
const CACHE = path.join(HERE, '.cache');
const WORK = path.join(CACHE, 'mpfb');
const OUT = path.resolve(HERE, '../client/dev-assets/mpfb');
const BLENDER = process.env.BLENDER ?? path.join(CACHE, 'blender/blender');
const MPFB_DATA = process.env.MPFB_DATA ?? path.join(os.homedir(), '.config/blender/4.2/extensions/.user/user_default/mpfb/data');
const ACCAD_DIR = process.env.ACCAD_DIR ?? path.join(CACHE, 'accad');
const skipBlender = process.argv.includes('--skip-blender');

const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'blender/presets.json'), 'utf8'));

// One skin tone per sex (design decision: players pick sex, face, hair style, hair colour and eye colour only).
const SKINS = {
  male: [['caucasian', 'young_caucasian_male', 'Default']],
  female: [['caucasian', 'young_caucasian_female', 'Default']],
};

function blender(script, blend, args) {
  const cmd = [BLENDER, '-b', ...(blend ? [blend] : []), '--python', path.join(HERE, 'blender', script), '--', ...args];
  const res = spawnSync(cmd[0], cmd.slice(1), { env: { ...process.env, ACCAD_DIR }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = (res.stdout + res.stderr).split('\n').filter((l) => /\[spike\]|Traceback|Error/.test(l) || /^\s+File /.test(l));
  console.log(lines.join('\n'));
  if (res.status !== 0 || /Traceback/.test(res.stdout + res.stderr)) throw new Error(`blender ${script} failed (${res.status})`);
}

if (!skipBlender) {
  fs.mkdirSync(WORK, { recursive: true });
  for (const id of Object.keys(cfg.presets)) {
    console.log(`== ${id}`);
    blender('generate_character.py', null, [id, WORK]);
    blender('retarget_export.py', path.join(WORK, `${id}.blend`), [id, path.join(WORK, `${id}.glb`)]);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['skins', 'hair', 'eyes', 'brows']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const webp = (img, q = 80) => img.webp({ quality: q, effort: 5 }).toBuffer();
const write = (rel, buf) => {
  fs.writeFileSync(path.join(OUT, rel), buf);
  return rel;
};

// ------------------------------------------------------------------ textures

async function skinTexture(file, maskFile, sex) {
  const SIZE = 1024;
  const { data } = await sharp(file).removeAlpha().resize(SIZE, SIZE).raw().toBuffer({ resolveWithObject: true });
  const mask = await sharp(maskFile).removeAlpha().greyscale().resize(SIZE, SIZE).blur(0.8).raw().toBuffer();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const m = mask[i] / 255;
    if (m <= 0.01) continue;
    const lum = (data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3;
    const shade = Math.min(1.25, Math.max(0.55, lum / 175));
    const [r, g, b] = sex === 'male' ? [38, 48, 74] : [44, 52, 82];
    data[i * 3] += (r * shade - data[i * 3]) * m;
    data[i * 3 + 1] += (g * shade - data[i * 3 + 1]) * m;
    data[i * 3 + 2] += (b * shade - data[i * 3 + 2]) * m;
  }
  return webp(sharp(data, { raw: { width: SIZE, height: SIZE, channels: 3 } }), 82);
}

/** Neutral light-grey hair strands with the original alpha so material.color can tint to any colour. */
async function hairTexture(file) {
  const { data, info } = await sharp(file).resize(512, 512).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
  }
  const gain = 205 / Math.max(1, sum / Math.max(1, n));
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.min(255, ((data[i] + data[i + 1] + data[i + 2]) / 3) * gain);
    data[i] = data[i + 1] = data[i + 2] = lum;
  }
  return webp(sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }), 80);
}

async function whiteAlpha(file, size) {
  const { data, info } = await sharp(file).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 235;
  return webp(sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }), 80);
}

/** Iris pixels are reduced to their luminance so the page can recolour them by multiplication. */
async function eyeTexture(file) {
  const size = 512;
  const { data, info } = await sharp(file).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const centers = [[0.705, 0.2975], [0.29, 0.7075]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(...centers.map(([cx, cy]) => Math.hypot(x / size - cx, y / size - cy)));
      if (d > 0.118) continue;
      const i = (y * size + x) * 4;
      const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) * 2.1;
      const k = Math.min(1, (0.118 - d) / 0.01);
      data[i] += (lum - data[i]) * k;
      data[i + 1] += (lum - data[i + 1]) * k;
      data[i + 2] += (lum - data[i + 2]) * k;
    }
  }
  return webp(sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }), 85);
}

const manifest = { generated: new Date().toISOString().slice(0, 10), vertexBudget: cfg.vertexBudget, skins: {}, hair: {}, presets: [], eye: { file: '', irisCenters: [[0.705, 0.2975], [0.29, 0.7075]], irisRadius: 0.118 } };

for (const sex of ['male', 'female']) {
  const first = Object.keys(cfg.presets).find((k) => cfg.presets[k].sex === sex);
  const mask = path.join(WORK, `${first}.underwear.png`);
  manifest.skins[sex] = [];
  for (const [id, folder, label] of SKINS[sex]) {
    const dir = path.join(MPFB_DATA, 'skins', folder);
    const png = fs.readdirSync(dir).find((f) => f.endsWith('.png'));
    const file = write(`skins/${sex}-${id}.webp`, await skinTexture(path.join(dir, png), mask, sex));
    manifest.skins[sex].push({ id, label, file });
  }
}

manifest.eye.file = write('eyes/eyes.webp', await eyeTexture(path.join(MPFB_DATA, 'eyes/materials/brown_eye.png')));
const browIds = new Set(Object.values(cfg.presets).map((p) => p.brows));
const hairIds = new Set(Object.values(cfg.presets).flatMap((p) => p.hair));
manifest.brows = {};
for (const b of browIds) manifest.brows[b] = write(`brows/${b}.webp`, await whiteAlpha(path.join(MPFB_DATA, `eyebrows/${b}/${b}.png`), 256));
manifest.lashes = write('brows/eyelashes01.webp', await sharp(path.join(MPFB_DATA, 'eyelashes/eyelashes01/eyelashes01.png')).resize(256, 256).webp({ quality: 85 }).toBuffer());
for (const h of hairIds) {
  const dir = path.join(MPFB_DATA, 'hair', h);
  const png = fs.readdirSync(dir).find((f) => f.endsWith('_diffuse.png') || f === 'afro_diffuse.png');
  manifest.hair[h] = write(`hair/${h}.webp`, await hairTexture(path.join(dir, png)));
}

// ------------------------------------------------------------------ geometry

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const [id, p] of Object.entries(cfg.presets)) {
  const doc = await io.read(path.join(WORK, `${id}.glb`));
  const root = doc.getRoot();
  const roles = {};
  for (const mat of root.listMaterials()) {
    const name = mat.getName();
    const base = name.split('.')[0];
    mat.setMetallicFactor(0).setRoughnessFactor(base === 'Eyes' ? 0.15 : base === 'Skin' ? 0.62 : 0.8);
    mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(null);
    if (base === 'Hair' || base === 'Brows' || base === 'Lashes') {
      mat.setAlphaMode('MASK').setAlphaCutoff(base === 'Hair' ? 0.4 : 0.3).setDoubleSided(true);
    }
    roles[name] = base;
  }
  const counts = {};
  let morphTargets = 0;
  for (const mesh of root.listMeshes()) {
    const verts = mesh.listPrimitives().reduce((s, pr) => s + pr.getAttribute('POSITION').getCount(), 0);
    counts[mesh.getName()] = verts;
    if (mesh.getName() === 'Body') morphTargets = mesh.listPrimitives()[0].listTargets().length;
  }
  const steps = [prune({ keepAttributes: true, keepLeaves: true }), dedup({ keepUniqueNames: true }), resample({ tolerance: 5e-4 })];
  if (!process.env.NO_COMPRESS) steps.push(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...steps);
  const glb = path.join(OUT, `${id}.glb`);
  await io.write(glb, doc);
  const motion = JSON.parse(fs.readFileSync(path.join(WORK, `${id}.motion.json`), 'utf8'));
  manifest.presets.push({
    id,
    sex: p.sex,
    label: p.label,
    file: `${id}.glb`,
    brows: p.brows,
    hair: p.hair,
    vertices: counts,
    bodyMorphTargets: morphTargets,
    clips: Object.fromEntries(Object.entries(motion).filter(([k]) => k !== 'scale')),
    bytes: fs.statSync(glb).size,
  });
  console.log(`${id}.glb  ${(fs.statSync(glb).size / 1024).toFixed(0)} KB  ${JSON.stringify(counts)}  body morphs ${morphTargets}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(
  path.join(OUT, 'LICENSES.txt'),
  `Spike assets generated by tools/build-mpfb-characters.mjs

Character meshes, rigs, skins, eyes, eyebrows, eyelashes and hair: MakeHuman community "makehuman_system_assets"
and MPFB base mesh, released CC0 1.0 (https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html).
ARKit face-unit targets: MakeHuman "faceunits01" asset pack (CC0).
The MPFB add-on itself (GPL-3.0) was used only as a tool; none of its code ships.

Motion: ACCAD Open Motion Project (Advanced Computing Center for the Arts and Design, The Ohio State University),
motion capture of Female 1, Male 1 (take names Female1_*, Male1_*), licensed CC BY 3.0
(https://accad.osu.edu/research/motion-lab/mocap-system-and-data). Clips were cut into loops, re-timed and
retargeted to the MPFB game_engine skeleton. Credit: "Motion capture data from ACCAD, The Ohio State University".
`,
);
console.log('manifest.json written');
