/**
 * Builds the runtime character assets in client/public/models from Quaternius' CC0 packs:
 *   - Universal Base Characters [Standard]  (bodies, eyes, brows, hair, beard)
 *   - Universal Animation Library [Standard] (idle / walk / jog / swim-idle clips)
 *
 *   cd tools && npm install && npm run build:characters
 *
 * Sources are downloaded into tools/.cache (gitignored) from a public GitHub mirror of the
 * free packs. Output is committed, so running this is only needed when changing the pipeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, mergeDocuments, prune, resample } from '@gltf-transform/functions';
import sharp from 'sharp';

const HERE = import.meta.dirname;
const SRC = path.join(HERE, '.cache/quaternius');
const OUT = path.resolve(HERE, '../client/public/models');

const MIRROR = 'https://raw.githubusercontent.com/NafisRayan/Animate-Rigged-Humanoid-No-Blender/main/';
const UBC = 'Universal Base Characters[Standard]/Universal Base Characters[Standard]/';
const UAL = 'Universal Animation Library[Standard]/Universal Animation Library[Standard]/';
const BASE = `${UBC}Base Characters/Godot - UE/`;
const HAIR_DIR = `${UBC}Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/`;

const SOURCES = {
  'Superhero_Male_FullBody.gltf': BASE,
  'Superhero_Male_FullBody.bin': BASE,
  'Superhero_Female_FullBody.gltf': BASE,
  'Superhero_Female_FullBody.bin': BASE,
  'T_Eye_Brown.png': BASE,
  'T_Superhero_Male_Ligh.png': `${UBC}Base Characters/Textures/`,
  'T_Superhero_Female_Light_BaseColor.png': `${UBC}Base Characters/Textures/`,
  'T_Hair_1_BaseColor.png': `${UBC}Hairstyles/Textures/`,
  'T_Hair_2_BaseColor.png': `${UBC}Hairstyles/Textures/`,
  'License_Standard.txt': UBC,
  'UAL1_Standard.glb': `${UAL}Unreal-Godot/`,
};
for (const h of ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'Hair_Beard', 'Hair_Buns', 'Hair_BuzzedFemale']) {
  SOURCES[`${h}.gltf`] = HAIR_DIR;
  SOURCES[`${h}.bin`] = HAIR_DIR;
}

// Only the hairstyles that sit properly on the head of that sex (checked against the bind pose; see docs):
// the pack's Long and Buns are cut for the female head, Parted and Buzzed for the male head.
const HAIR = {
  male: [
    ['HairParted', 'Hair_SimpleParted.gltf'],
    ['HairBuzzed', 'Hair_Buzzed.gltf'],
    ['Beard', 'Hair_Beard.gltf'],
  ],
  female: [
    ['HairBuzzed', 'Hair_BuzzedFemale.gltf'],
    ['HairBuns', 'Hair_Buns.gltf'],
    ['HairLong', 'Hair_Long.gltf'],
  ],
};

const KEEP_CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'];

const io = new NodeIO();

async function fetchSources() {
  fs.mkdirSync(SRC, { recursive: true });
  for (const [file, dir] of Object.entries(SOURCES)) {
    const dest = path.join(SRC, file === 'License_Standard.txt' ? 'License_UBC.txt' : file);
    if (fs.existsSync(dest)) continue;
    const url = MIRROR + encodeURI(dir + file).replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    process.stdout.write(`fetch ${file}… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  }
}

/** Reads a .gltf without any of its textures; textures are rebuilt from processed images below. */
async function readUntextured(file) {
  const json = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  const resources = {};
  for (const b of json.buffers) resources[b.uri] = fs.readFileSync(path.join(SRC, decodeURIComponent(b.uri)));
  return io.readJSON({ json, resources });
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Skin albedo: the grey underwear regions painted into the texture become navy, and for the male
 * body a clean-shaven variant is produced by painting the baked stubble back to skin tone.
 */
async function skinTexture(file, { shave = false } = {}) {
  const { data, info } = await sharp(path.join(SRC, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const px = (x, y) => (y * W + x) * 3;

  let ref = [0, 0, 0];
  if (shave) {
    let n = 0;
    for (let y = 400; y < 440; y++)
      for (let x = 150; x < 200; x++) {
        const i = px(x, y);
        ref[0] += data[i];
        ref[1] += data[i + 1];
        ref[2] += data[i + 2];
        n++;
      }
    ref = ref.map((v) => v / n);
  }
  const refLum = (ref[0] + ref[1] + ref[2]) / 3;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < W; x++) {
      const i = px(x, y);
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      if (sat < 0.12 && max > 110) {
        const shade = max / 205;
        r = 34 * shade;
        g = 44 * shade;
        b = 70 * shade;
      } else if (shave && x < 760 && y < 760) {
        const jaw = 1 - smooth(0.78, 1.0, Math.hypot((x - 380) / 330, (y - 600) / 190));
        const cheeks = 1 - smooth(0.75, 1.0, Math.hypot((x - 380) / 340, (y - 520) / 120));
        const nose = 1 - smooth(0.6, 1.0, Math.hypot((x - 380) / 90, (y - 470) / 50));
        const lips = 1 - smooth(0.7, 1.15, Math.hypot((x - 380) / 88, (y - 546) / 30));
        const m = Math.max(jaw, cheeks * smooth(430, 480, y)) * (1 - lips) * (1 - nose);
        if (m > 0) {
          const lum = (r + g + b) / 3;
          const k = Math.min(1, m * 0.92);
          const detail = 0.88 + 0.12 * Math.min(1.3, lum / refLum);
          r += (ref[0] * detail - r) * k;
          g += (ref[1] * detail - g) * k;
          b += (ref[2] * detail - b) * k;
        }
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return sharp(data, { raw: { width: W, height: info.height, channels: 3 } })
    .resize(1024, 1024)
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

/** Neutral light-grey hair albedo so material.color can tint it to any hair color. */
async function hairTexture(file) {
  return sharp(path.join(SRC, file))
    .removeAlpha()
    .greyscale()
    .resize(512, 512)
    .normalise({ lower: 2, upper: 99 })
    .linear(0.32, 160)
    .jpeg({ quality: 82 })
    .toBuffer();
}

function singleBuffer(doc) {
  const root = doc.getRoot();
  const [keep, ...rest] = root.listBuffers();
  for (const a of root.listAccessors()) a.setBuffer(keep);
  rest.forEach((b) => b.dispose());
}

function disposeTree(node) {
  node.listChildren().forEach(disposeTree);
  node.dispose();
}

async function buildBody(sex, textures) {
  const Sex = sex[0].toUpperCase() + sex.slice(1);
  const doc = await readUntextured(`Superhero_${Sex}_FullBody.gltf`);
  const root = doc.getRoot();
  const armature = root.listNodes().find((n) => n.getName() === 'Armature');
  const bodySkin = root.listSkins()[0];
  const jointByName = new Map(bodySkin.listJoints().map((j) => [j.getName(), j]));

  for (const node of armature.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matName = mesh.listPrimitives()[0].getMaterial()?.getName() ?? '';
    const name = /Eyes/.test(matName) ? 'Eyes' : /Hair/.test(matName) ? 'Brows' : 'Body';
    node.setName(name);
    mesh.setName(name);
  }

  for (const [label, file] of HAIR[sex]) {
    const src = await readUntextured(file);
    const srcScene = src.getRoot().listScenes()[0];
    const map = mergeDocuments(doc, src);
    const scene = map.get(srcScene);
    let hair = null;
    scene.traverse((n) => {
      if (n.getMesh()) hair = n;
    });
    const srcSkin = hair.getSkin();
    const skin = doc.createSkin(label).setInverseBindMatrices(srcSkin.getInverseBindMatrices()).setSkeleton(bodySkin.getSkeleton());
    for (const j of srcSkin.listJoints()) skin.addJoint(jointByName.get(j.getName()));
    hair.setSkin(skin).setName(label);
    hair.getMesh().setName(label);
    hair.getParentNode()?.removeChild(hair);
    scene.removeChild(hair);
    armature.addChild(hair);
    scene.listChildren().forEach(disposeTree);
    scene.dispose();
    srcSkin.dispose();
  }
  singleBuffer(doc);

  const skinTex = doc.createTexture('Skin').setImage(textures.skin[sex]).setMimeType('image/jpeg');
  const eyeTex = doc.createTexture('Eyes').setImage(textures.eyes).setMimeType('image/png');
  const hairTex = (n) => doc.createTexture(`Hair${n}`).setImage(textures[`hair${n}`]).setMimeType('image/jpeg');
  const hairMat = (n) => doc.createMaterial(`Hair${n}`).setBaseColorTexture(hairTex(n)).setRoughnessFactor(0.8).setMetallicFactor(0).setDoubleSided(true);
  const mats = {
    Skin: doc.createMaterial('Skin').setBaseColorTexture(skinTex).setRoughnessFactor(0.72).setMetallicFactor(0),
    Eyes: doc.createMaterial('Eyes').setBaseColorTexture(eyeTex).setRoughnessFactor(0.25).setMetallicFactor(0),
    Hair1: hairMat(1),
    Hair2: hairMat(2),
  };
  for (const mesh of root.listMeshes()) {
    const name = mesh.getName();
    for (const prim of mesh.listPrimitives()) {
      for (const s of prim.listSemantics()) if (/^(TEXCOORD_[1-9]|COLOR_\d)$/.test(s)) prim.setAttribute(s, null);
      const hairSet = /Hair_2/.test(prim.getMaterial()?.getName() ?? '') ? mats.Hair2 : mats.Hair1;
      prim.setMaterial(name === 'Body' ? mats.Skin : name === 'Eyes' ? mats.Eyes : hairSet);
    }
  }
  await doc.transform(prune(), dedup());
  const out = path.join(OUT, `body-${sex}.glb`);
  await io.write(out, doc);
  return out;
}

async function buildAnimations() {
  const doc = await io.read(path.join(SRC, 'UAL1_Standard.glb'));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (KEEP_CLIPS.includes(a.getName())) continue;
    // Samplers outlive their animation otherwise, which keeps every keyframe accessor alive.
    a.listSamplers().forEach((s) => s.dispose());
    a.listChannels().forEach((c) => c.dispose());
    a.dispose();
  }
  for (const n of root.listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  root.listMeshes().forEach((m) => m.dispose());
  root.listSkins().forEach((s) => s.dispose());
  root.listMaterials().forEach((m) => m.dispose());
  root.listTextures().forEach((t) => t.dispose());
  for (const a of root.listAnimations()) {
    for (const ch of a.listChannels()) {
      const bone = ch.getTargetNode()?.getName() ?? '';
      const keepPosition = bone === 'pelvis' || bone === 'root';
      if (ch.getTargetPath() === 'scale' || (ch.getTargetPath() === 'translation' && !keepPosition)) {
        ch.getSampler()?.dispose();
        ch.dispose();
      }
    }
  }
  await doc.transform(resample({ tolerance: 1e-3 }), prune({ keepLeaves: true }), dedup());
  const out = path.join(OUT, 'animations.glb');
  await io.write(out, doc);
  return out;
}

await fetchSources();
fs.mkdirSync(OUT, { recursive: true });
const textures = {
  skin: {
    male: await skinTexture('T_Superhero_Male_Ligh.png'),
    female: await skinTexture('T_Superhero_Female_Light_BaseColor.png'),
  },
  eyes: await sharp(path.join(SRC, 'T_Eye_Brown.png')).png({ compressionLevel: 9 }).toBuffer(),
  hair1: await hairTexture('T_Hair_1_BaseColor.png'),
  hair2: await hairTexture('T_Hair_2_BaseColor.png'),
};
const shaven = await skinTexture('T_Superhero_Male_Ligh.png', { shave: true });
fs.writeFileSync(path.join(OUT, 'skin-male-shaven.jpg'), shaven);

const outputs = [await buildBody('male', textures), await buildBody('female', textures), await buildAnimations(), path.join(OUT, 'skin-male-shaven.jpg')];
fs.copyFileSync(path.join(SRC, 'License_UBC.txt'), path.join(OUT, 'LICENSE-quaternius.txt'));
for (const f of outputs) console.log(`${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
