import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Appearance, Face, Sex } from '../../../shared/protocol';

/**
 * Characters are Quaternius' CC0 "Universal Base Characters" with clips from the CC0 "Universal
 * Animation Library" (see client/public/models/LICENSE-quaternius.txt and tools/build-characters.mjs).
 * The base meshes have no facial rig, so expressions are procedural morph targets placed on the
 * painted face using UV landmarks.
 */

type Clip = 'idle' | 'walk' | 'run';
type BodyMorph = 'smile' | 'frown' | 'smirk' | 'press' | 'squint' | 'lids' | 'blink' | 'wink' | 'open' | 'wide';
type BrowMorph = 'browAngry' | 'browRaise' | 'browRaiseL' | 'browWorry' | 'browLower';
export type ExpressionWeights = Partial<Record<BodyMorph | BrowMorph, number>>;

const BODY_MORPHS: BodyMorph[] = ['smile', 'frown', 'smirk', 'press', 'squint', 'lids', 'blink', 'wink', 'open', 'wide'];
const BROW_MORPHS: BrowMorph[] = ['browAngry', 'browRaise', 'browRaiseL', 'browWorry', 'browLower'];

const EXPRESSIONS: Record<Face, ExpressionWeights> = {
  neutral: {},
  smiling: { smile: 1, squint: 0.35, browRaise: 0.7 },
  serious: { press: 0.85, squint: 0.3, browAngry: 0.35 },
  angry: { frown: 1, press: 0.45, squint: 0.85, browAngry: 1 },
  flirty: { smirk: 0.75, smile: 0.2, lids: 0.35, browRaiseL: 0.55, squint: 0.1 },
  calm: { smile: 0.45, squint: 0.1, lids: 0.15 },
  determined: { press: 1, frown: 0.25, squint: 0.4, browAngry: 0.55 },
  smirk: { smirk: 1, squint: 0.15 },
};

/** Candidates for more faces (not selectable yet): each is only a set of morph weights. Promote one by adding it to FACES and EXPRESSIONS. */
export const PROTOTYPE_EXPRESSIONS: Record<string, ExpressionWeights> = {
  'flirty (before)': { smirk: 1, lids: 0.55, browRaiseL: 1 },
  worried: { frown: 0.45, press: 0.2, lids: 0.1, browWorry: 1 },
  tired: { lids: 0.9, frown: 0.25, press: 0.15, browLower: 0.7, browWorry: 0.3 },
  surprised: { browRaise: 1, wide: 1, open: 0.8 },
};

/** Face landmarks in the body texture's UV space (character's right = low U = -x). */
const LANDMARKS: Record<Sex, Record<'mouth' | 'cornerR' | 'cornerL' | 'eyeR' | 'eyeL', [number, number]>> = {
  male: { mouth: [0.1855, 0.2666], cornerR: [0.1538, 0.2676], cornerL: [0.2188, 0.2676], eyeR: [0.1367, 0.1782], eyeL: [0.2368, 0.1782] },
  female: { mouth: [0.1826, 0.2617], cornerR: [0.1514, 0.2617], cornerL: [0.2148, 0.2617], eyeR: [0.127, 0.1758], eyeL: [0.2344, 0.1758] },
};
const FACE_ISLAND = 0.37;

export interface Rig {
  root: THREE.Group;
  head: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<Clip, THREE.AnimationAction>;
  clip: Clip;
  face: { mesh: THREE.SkinnedMesh; names: string[] }[];
  expression: ExpressionWeights;
  flirty: boolean;
  blinkIn: number;
  winkIn: number;
  blink: number;
  wink: number;
  time: number;
}

interface BodyAsset {
  gltf: GLTF;
  skin: THREE.MeshStandardMaterial;
  shaven: THREE.MeshStandardMaterial | null;
  eyes: THREE.MeshStandardMaterial;
}

let bodies: Record<Sex, BodyAsset> | null = null;
let clips: Record<Clip, THREE.AnimationClip> | null = null;
let loading: Promise<void> | null = null;

const hairMats = new Map<string, THREE.MeshStandardMaterial>();
const browMats = new Map<string, THREE.MeshStandardMaterial>();
const eyeMats = new Map<string, THREE.MeshStandardMaterial>();
const shadowGeo = new THREE.CircleGeometry(0.34, 20);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const holoMat = new THREE.MeshStandardMaterial({
  color: 0xa8ecff,
  emissive: 0x2aa8ff,
  emissiveIntensity: 0.55,
  roughness: 0.3,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

const MODEL_URL = `${import.meta.env.BASE_URL}models/`;

export function preloadCharacters() {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    const [male, female, anims, shavenTex] = await Promise.all([
      loader.loadAsync(`${MODEL_URL}body-male.glb`),
      loader.loadAsync(`${MODEL_URL}body-female.glb`),
      loader.loadAsync(`${MODEL_URL}animations.glb`),
      new THREE.TextureLoader().loadAsync(`${MODEL_URL}skin-male-shaven.jpg`),
    ]);
    shavenTex.flipY = false;
    shavenTex.colorSpace = THREE.SRGBColorSpace;
    bodies = { male: prepareBody(male, 'male', shavenTex), female: prepareBody(female, 'female', null) };
    clips = prepareClips(anims, male);
  })();
  return loading;
}

function prepareBody(gltf: GLTF, sex: Sex, shavenTex: THREE.Texture | null): BodyAsset {
  let skin!: THREE.MeshStandardMaterial;
  let eyes!: THREE.MeshStandardMaterial;
  gltf.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (m.name === 'Body') {
      skin = mat;
      addFaceMorphs(m.geometry, sex);
      m.updateMorphTargets();
    } else if (m.name === 'Brows') {
      addBrowMorphs(m.geometry);
      m.updateMorphTargets();
    } else if (m.name === 'Eyes') {
      eyes = mat;
    }
  });
  let shaven: THREE.MeshStandardMaterial | null = null;
  if (shavenTex) {
    shaven = skin.clone();
    shaven.map = shavenTex;
  }
  return { gltf, skin, shaven, eyes };
}

/** Keeps only rotations plus a pelvis track rescaled to our skeleton, so clips don't reshape bodies. */
function prepareClips(anims: GLTF, body: GLTF): Record<Clip, THREE.AnimationClip> {
  const animPelvis = anims.scene.getObjectByName('pelvis');
  const bodyPelvis = body.scene.getObjectByName('pelvis');
  const ratio = animPelvis && bodyPelvis ? bodyPelvis.position.length() / animPelvis.position.length() : 1;
  const pick = (name: string) => {
    const src = anims.animations.find((a) => a.name === name);
    if (!src) throw new Error(`Missing animation clip ${name}`);
    const clip = src.clone();
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
    for (const t of clip.tracks) if (t.name === 'pelvis.position') for (let i = 0; i < t.values.length; i++) t.values[i] *= ratio;
    return clip;
  };
  return { idle: pick('Idle_Loop'), walk: pick('Walk_Loop'), run: pick('Jog_Fwd_Loop') };
}

// ---------------------------------------------------------------- procedural face morphs

const falloff = (d: number) => {
  const t = Math.max(0, 1 - d);
  return t * t * (3 - 2 * t);
};

function landmark3d(pos: THREE.BufferAttribute, uv: THREE.BufferAttribute, [u, v]: [number, number]) {
  const out = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.hypot(uv.getX(i) - u, uv.getY(i) - v) < 0.012) {
      out.x += pos.getX(i);
      out.y += pos.getY(i);
      out.z += pos.getZ(i);
      n++;
    }
  }
  return out.divideScalar(Math.max(1, n));
}

function addFaceMorphs(geo: THREE.BufferGeometry, sex: Sex) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const L = LANDMARKS[sex];
  const mouth = landmark3d(pos, uv, L.mouth);
  const corners = [landmark3d(pos, uv, L.cornerR), landmark3d(pos, uv, L.cornerL)];
  const eyes = [landmark3d(pos, uv, L.eyeR), landmark3d(pos, uv, L.eyeL)];
  const targets = BODY_MORPHS.map(() => new Float32Array(pos.count * 3));
  const add = (morph: BodyMorph, i: number, x: number, y: number, z: number) => {
    const t = targets[BODY_MORPHS.indexOf(morph)];
    t[i * 3] += x;
    t[i * 3 + 1] += y;
    t[i * 3 + 2] += z;
  };
  const p = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    if (uv.getX(i) > FACE_ISLAND || uv.getY(i) > FACE_ISLAND) continue;
    p.fromBufferAttribute(pos, i);

    corners.forEach((c, k) => {
      const side = k === 0 ? -1 : 1;
      const w = falloff(p.distanceTo(c) / 0.024);
      if (w > 0) {
        add('smile', i, side * 0.006 * w, 0.011 * w, -0.0025 * w);
        add('frown', i, -side * 0.002 * w, -0.011 * w, 0);
        if (side === 1) add('smirk', i, 0.0055 * w, 0.0125 * w, -0.0025 * w);
      }
      const cheek = falloff(Math.hypot(p.x - (c.x + side * 0.012), p.y - (c.y + 0.02)) / 0.022);
      if (cheek > 0) {
        add('smile', i, 0, 0.0045 * cheek, 0.002 * cheek);
        if (side === 1) add('smirk', i, 0, 0.003 * cheek, 0.001 * cheek);
      }
    });

    const lips = falloff(Math.hypot((p.x - mouth.x) / 0.032, (p.y - mouth.y) / 0.014));
    if (lips > 0) add('press', i, 0, (mouth.y - p.y) * 0.6 * lips, -0.0015 * lips);
    const jaw = falloff(Math.hypot((p.x - mouth.x) / 0.034, (p.y - (mouth.y - 0.012)) / 0.03));
    if (jaw > 0) add('open', i, 0, p.y < mouth.y ? -0.012 * jaw : 0.002 * jaw, p.y < mouth.y ? 0.001 * jaw : 0);

    eyes.forEach((e, k) => {
      const w = falloff(Math.hypot((p.x - e.x) / 0.024, (p.y - e.y) / 0.02));
      if (w <= 0) return;
      const dy = p.y - e.y;
      const upper = dy > 0;
      const forward = 0.004 * w * (1 - Math.min(1, Math.abs(dy) / 0.02));
      add('squint', i, 0, upper ? -0.002 * w : 0.0028 * w, 0);
      if (upper) add('lids', i, 0, -dy * 0.5 * w, forward * 0.5);
      add('wide', i, 0, upper ? 0.0035 * w : -0.0012 * w, 0);
      const close = (m: BodyMorph) => add(m, i, 0, upper ? -dy * 1.0 * w : -dy * 0.35 * w, forward);
      close('blink');
      if (k === 1) close('wink');
    });
  }
  geo.morphAttributes.position = targets.map((t) => new THREE.Float32BufferAttribute(t, 3));
  geo.morphTargetsRelative = true;
  geo.userData.targetNames = BODY_MORPHS;
}

function addBrowMorphs(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const halfW = Math.max(Math.abs(geo.boundingBox!.min.x), geo.boundingBox!.max.x);
  const targets = BROW_MORPHS.map(() => new Float32Array(pos.count * 3));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const side = Math.sign(x) || 1;
    const inner = 1 - Math.min(1, Math.abs(x) / halfW);
    targets[0].set([-side * 0.005 * inner, -0.014 * inner - 0.003, 0.0025 * inner], i * 3);
    targets[1].set([0, 0.006 + 0.002 * (1 - inner), 0], i * 3);
    if (side > 0) targets[2].set([0, 0.014 + 0.003 * inner, 0.001], i * 3);
    targets[3].set([side * 0.002 * inner, 0.011 * inner - 0.004 * (1 - inner), 0.001 * inner], i * 3);
    targets[4].set([0, -0.007 - 0.002 * inner, 0], i * 3);
  }
  geo.morphAttributes.position = targets.map((t) => new THREE.Float32BufferAttribute(t, 3));
  geo.morphTargetsRelative = true;
  geo.userData.targetNames = BROW_MORPHS;
}

// ---------------------------------------------------------------- materials

function hairMaterial(base: THREE.MeshStandardMaterial, hex: string) {
  const key = `${base.name}${hex}`;
  let m = hairMats.get(key);
  if (!m) {
    m = base.clone();
    m.color.set(hex);
    hairMats.set(key, m);
  }
  return m;
}

function browMaterial(base: THREE.MeshStandardMaterial, hex: string) {
  const key = `${base.name}${hex}`;
  let m = browMats.get(key);
  if (!m) {
    m = base.clone();
    m.color.set(hex).multiplyScalar(0.7);
    browMats.set(key, m);
  }
  return m;
}

/** Recolors the iris of the source eye texture, keeping its shading, pupil and highlight. */
function eyeMaterial(base: THREE.MeshStandardMaterial, hex: string) {
  let m = eyeMats.get(hex);
  if (m) return m;
  const img = base.map!.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tint = new THREE.Color(hex);
  const [tr, tg, tb] = [tint.r * 255, tint.g * 255, tint.b * 255];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const R = canvas.width * 0.105;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const d = Math.hypot(x - cx, y - cy) / R;
      if (d > 1.05) continue;
      const i = (y * canvas.width + x) * 4;
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const lum = (r + g + b) / 3;
      if (lum < 40 || lum > 200) continue;
      const k = Math.min(1, (1.05 - d) / 0.12);
      const shade = lum / 95;
      data.data[i] = r + (tr * shade - r) * k;
      data.data[i + 1] = g + (tg * shade - g) * k;
      data.data[i + 2] = b + (tb * shade - b) * k;
    }
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  m = base.clone();
  m.map = tex;
  eyeMats.set(hex, m);
  return m;
}

const hairMeshName = (style: string) => `Hair${style[0].toUpperCase()}${style.slice(1)}`;

// ---------------------------------------------------------------- rigs

/** Builds a character. Pass null for the unformed clone that floats in a tube. */
export function buildRig(app: Appearance | null): Rig {
  if (!bodies || !clips) throw new Error('preloadCharacters() must resolve before building rigs');
  const sex: Sex = app?.sex ?? 'male';
  const asset = bodies[sex];
  const model = SkeletonUtils.clone(asset.gltf.scene);
  const face: Rig['face'] = [];

  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.frustumCulled = false;
    const base = m.material as THREE.MeshStandardMaterial;
    if (!app) {
      m.visible = m.name === 'Body';
      m.material = holoMat;
      return;
    }
    switch (m.name) {
      case 'Body':
        m.material = sex === 'male' && app.facialHair === 'none' && asset.shaven ? asset.shaven : asset.skin;
        break;
      case 'Eyes':
        m.material = eyeMaterial(asset.eyes, app.eyeColor);
        break;
      case 'Brows':
        m.material = browMaterial(base, app.hairColor);
        break;
      case 'HairParted':
      case 'HairBuzzed':
      case 'HairBuns':
      case 'HairLong':
        m.visible = m.name === hairMeshName(app.hairStyle);
        m.material = hairMaterial(base, app.hairColor);
        break;
      case 'Beard':
        m.visible = app.facialHair === 'beard';
        m.material = hairMaterial(base, app.hairColor);
        break;
      default:
        m.visible = false;
    }
    if (m.name === 'Body' || m.name === 'Brows') {
      m.updateMorphTargets();
      face.push({ mesh: m, names: m.geometry.userData.targetNames });
    }
  });

  const root = new THREE.Group();
  root.add(model);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  shadow.name = 'shadow';
  root.add(shadow);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {
    idle: mixer.clipAction(clips.idle),
    walk: mixer.clipAction(clips.walk),
    run: mixer.clipAction(clips.run),
  };
  const offset = Math.random() * 3;
  for (const a of Object.values(actions)) a.time = offset;
  actions.idle.play();

  const rig: Rig = {
    root,
    head: model.getObjectByName('Head') ?? model,
    mixer,
    actions,
    clip: 'idle',
    face,
    expression: app ? EXPRESSIONS[app.face] : {},
    flirty: app?.face === 'flirty',
    blinkIn: 1 + Math.random() * 3,
    winkIn: 2 + Math.random() * 3,
    blink: 0,
    wink: 0,
    time: 0,
  };
  applyFace(rig);
  return rig;
}

function play(rig: Rig, clip: Clip, timeScale = 1) {
  const next = rig.actions[clip];
  next.timeScale = timeScale;
  if (rig.clip === clip) return;
  const prev = rig.actions[rig.clip];
  next.reset().play();
  prev.crossFadeTo(next, 0.25, false);
  rig.clip = clip;
}

function applyFace(rig: Rig) {
  for (const { mesh, names } of rig.face) {
    const inf = mesh.morphTargetInfluences!;
    names.forEach((n, i) => {
      let v = rig.expression[n as BodyMorph] ?? 0;
      if (n === 'blink') v = rig.blink;
      if (n === 'wink') v = rig.wink;
      if (n === 'lids' && (rig.blink > 0 || rig.wink > 0)) v *= 1 - Math.max(rig.blink, rig.wink);
      inf[i] = v;
    });
  }
}

/** Dev tools: shows an arbitrary set of weights (e.g. a prototype expression) on a rig built for any face. */
export function setRigExpression(rig: Rig, weights: ExpressionWeights, flirty = false) {
  rig.expression = weights;
  rig.flirty = flirty;
  applyFace(rig);
}

function updateFace(rig: Rig, dt: number) {
  if (!rig.face.length) return;
  rig.blinkIn -= dt;
  if (rig.blinkIn <= 0) {
    rig.blink = Math.min(1, rig.blink + dt * 14);
    if (rig.blinkIn < -0.14) {
      rig.blinkIn = 2.5 + Math.random() * 3.5;
    }
  } else rig.blink = Math.max(0, rig.blink - dt * 10);
  if (rig.flirty) {
    rig.winkIn -= dt;
    if (rig.winkIn <= 0) {
      rig.wink = Math.min(1, rig.wink + dt * 8);
      if (rig.winkIn < -0.45) rig.winkIn = 3.5 + Math.random() * 3;
    } else rig.wink = Math.max(0, rig.wink - dt * 6);
  }
  applyFace(rig);
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** The library idles look at the floor; tilt the head up so faces read from a raised camera. */
function liftHead(rig: Rig, angle: number) {
  const parent = rig.head.parent;
  if (!parent) return;
  rig.root.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  _axis.set(1, 0, 0).transformDirection(rig.root.matrixWorld);
  parent.getWorldQuaternion(_q).invert();
  _axis.applyQuaternion(_q).normalize();
  rig.head.quaternion.premultiply(_q.setFromAxisAngle(_axis, -angle));
}

/** Gait picks the clip: the walk loop, or the jog loop (sprint is the jog sped up). */
export function animateRig(rig: Rig, dt: number, moving: boolean, gait: 'walk' | 'jog' | 'sprint' = 'walk') {
  rig.time += dt;
  if (!moving) play(rig, 'idle');
  else if (gait === 'walk') play(rig, 'walk', 1.15);
  else if (gait === 'jog') play(rig, 'run', 0.8);
  else play(rig, 'run', 1.12);
  rig.mixer.update(dt);
  liftHead(rig, moving ? 0.12 : 0.22);
  updateFace(rig, dt);
}

/** Relaxed floating pose for figures inside a tube. */
export function floatRig(rig: Rig, dt: number) {
  rig.time += dt;
  play(rig, 'idle', 0.45);
  rig.mixer.update(dt);
  updateFace(rig, dt);
}

export function disposeRig(rig: Rig) {
  rig.mixer.stopAllAction();
  rig.mixer.uncacheRoot(rig.mixer.getRoot());
}
