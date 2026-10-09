/**
 * Character motion and uniform assets.
 *   client/public/models/clips-<sex>.glb      ACCAD clips (idle, walk, jog, sprint) as animation-only GLBs, applied to the
 *                                             game's body-<sex>.glb by bone name
 *   client/public/models/motion.json          ground speed of each clip (the game retimes clips to the observed speed)
 *   client/public/models/uniform/*            crew uniform colour / normal / accent-mask textures
 *   client/dev-assets/characters/<sex>.glb    bodies carrying every clip incl. raw performer motion, for /characters.html
 *
 *   tools/blender/setup.sh                      (once: portable Blender + ACCAD BVH into tools/.cache)
 *   cd tools && npm install && npm run build:clips [-- --skip-blender]
 *
 * Stage 1 (Blender, headless): blender/quaternius_retarget.py imports client/public/models/body-<sex>.glb,
 *   retargets the gendered ACCAD clips (blender/clips.py, blender/retarget_export.py) and exports
 *   tools/.cache/clips/<sex>.glb with the clips as animations.
 * Stage 2 (this file): paints the uniform onto the body UVs (uniform-painter.mjs), compresses the GLBs (meshopt,
 *   WebP textures) and writes a manifest with per-clip motion metadata.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { paintUniform } from './uniform-painter.mjs';

const HERE = import.meta.dirname;
const CACHE = path.join(HERE, '.cache');
const WORK = path.join(CACHE, 'clips');
const OUT = path.resolve(HERE, '../client/dev-assets/characters');
const PUBLIC = path.resolve(HERE, '../client/public/models');
const UNIFORM_OUT = path.join(PUBLIC, 'uniform');
const BLENDER = process.env.BLENDER ?? path.join(CACHE, 'blender/blender');
const ACCAD_DIR = process.env.ACCAD_DIR ?? path.join(CACHE, 'accad');
const ACCENT = [232, 119, 46]; // the accent painted into the uniform textures; the game recolours it per job
const skipBlender = process.argv.includes('--skip-blender');

function blender(script, args) {
  const res = spawnSync(BLENDER, ['-b', '--python', path.join(HERE, 'blender', script), '--', ...args], { env: { ...process.env, ACCAD_DIR }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = (res.stdout + res.stderr).split('\n').filter((l) => /\[spike\]|Traceback|Error/.test(l) || /^\s+File /.test(l));
  console.log(lines.join('\n'));
  if (res.status !== 0 || /Traceback/.test(res.stdout + res.stderr)) throw new Error(`blender ${script} failed (${res.status})`);
}

/** Animation-only GLB: rotations for every bone plus the pelvis track, no meshes, skins or raw performer clips. */
async function writeClips(src, dest) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  for (const n of root.listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
    if (n.getName() === 'head') n.setName('Head');
  }
  root.listMeshes().forEach((m) => m.dispose());
  root.listSkins().forEach((k) => k.dispose());
  root.listMaterials().forEach((m) => m.dispose());
  root.listTextures().forEach((t) => t.dispose());
  for (const a of root.listAnimations()) {
    const drop = (ch) => {
      ch.getSampler()?.dispose();
      ch.dispose();
    };
    if (a.getName().startsWith('raw_')) {
      a.listChannels().forEach(drop);
      a.dispose();
      continue;
    }
    for (const ch of a.listChannels()) {
      const kind = ch.getTargetPath();
      if (kind === 'scale' || (kind === 'translation' && ch.getTargetNode()?.getName() !== 'pelvis')) drop(ch);
    }
  }
  await doc.transform(resample({ tolerance: 5e-4 }), prune({ keepLeaves: true }), dedup());
  await io.write(dest, doc);
  console.log(`${path.basename(dest)}  ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
}

fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(UNIFORM_OUT, { recursive: true, force: true });
fs.mkdirSync(UNIFORM_OUT, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const motion = {};
const manifest = { generated: new Date().toISOString().slice(0, 10), characters: {} };

for (const sex of ['male', 'female']) {
  const src = path.join(WORK, `${sex}.glb`);
  if (!skipBlender) {
    console.log(`== ${sex}`);
    blender('quaternius_retarget.py', [sex, src]);
  }
  const doc = await io.read(src);
  const body = doc.getRoot().listNodes().find((n) => n.getMesh()?.getName() === 'Body');
  const skinImage = body.getMesh().listPrimitives()[0].getMaterial().getBaseColorTexture().getImage();
  const paint = (image) => paintUniform({ glbPath: src, skinImage: image, accent: ACCENT, chestLift: sex === 'female' ? 0.04 : 0 });
  const uniform = await paint(Buffer.from(skinImage));
  const meta = JSON.parse(fs.readFileSync(path.join(WORK, `${sex}.motion.json`), 'utf8'));
  motion[sex] = Object.fromEntries(['idle', 'walk', 'jog', 'sprint'].map((k) => [k, { groundSpeed: meta[k].groundSpeed, duration: meta[k].duration }]));
  fs.writeFileSync(path.join(UNIFORM_OUT, `${sex}.webp`), uniform.color);
  fs.writeFileSync(path.join(UNIFORM_OUT, `${sex}-normal.webp`), uniform.normal);
  fs.writeFileSync(path.join(UNIFORM_OUT, `${sex}-accent.webp`), uniform.accent);
  if (sex === 'male') {
    const shaven = await paint(fs.readFileSync(path.join(PUBLIC, 'skin-male-shaven.jpg')));
    fs.writeFileSync(path.join(UNIFORM_OUT, 'male-shaven.webp'), shaven.color);
  }
  await writeClips(src, path.join(PUBLIC, `clips-${sex}.glb`));

  await doc.transform(prune({ keepAttributes: true, keepLeaves: true }), dedup({ keepUniqueNames: true }), resample({ tolerance: 5e-4 }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }));
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = path.join(OUT, `${sex}.glb`);
  await io.write(glb, doc);

  const vertices = {};
  for (const m of doc.getRoot().listMeshes()) vertices[m.getName()] = m.listPrimitives().reduce((a, p) => a + p.getAttribute('POSITION').getCount(), 0);
  manifest.characters[sex] = {
    file: `${sex}.glb`,
    uniform: { color: `uniform/${sex}.webp`, normal: `uniform/${sex}-normal.webp` },
    vertices,
    clips: Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'scale')),
    bytes: fs.statSync(glb).size,
  };
  console.log(`${sex}.glb  ${(fs.statSync(glb).size / 1024).toFixed(0)} KB  ${JSON.stringify(vertices)}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(PUBLIC, 'motion.json'), JSON.stringify(motion, null, 1));
fs.writeFileSync(
  path.join(PUBLIC, 'LICENSE-accad.txt'),
  `Motion in clips-male.glb and clips-female.glb: ACCAD Open Motion Project (Advanced Computing Center for the Arts and Design,
The Ohio State University), motion capture of Female 1 and Male 1, CC BY 3.0 (https://accad.osu.edu/research/motion-lab/mocap-system-and-data).
Cut into loops, re-timed and retargeted to the Quaternius skeleton by tools/build-character-clips.mjs.
Credit: "Motion capture data from ACCAD, The Ohio State University".
`,
);
fs.writeFileSync(
  path.join(OUT, 'LICENSES.txt'),
  `Dev character assets generated by tools/build-character-clips.mjs

Bodies, eyes, brows and hair: Quaternius "Universal Base Characters", CC0 1.0 (https://quaternius.com/packs/universalbasecharacters.html).
Skeleton, skin weights and UVs are the originals; the skin and uniform textures are recoloured/painted.

Motion: ACCAD Open Motion Project (Advanced Computing Center for the Arts and Design, The Ohio State University),
motion capture of Female 1 and Male 1 (take names Female1_*, Male1_*), licensed CC BY 3.0
(https://accad.osu.edu/research/motion-lab/mocap-system-and-data). Clips were cut into loops, re-timed and
retargeted to the Quaternius skeleton. Credit: "Motion capture data from ACCAD, The Ohio State University".
`,
);
console.log('manifest.json written');
