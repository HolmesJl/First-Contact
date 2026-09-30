import * as THREE from 'three';
import type { Appearance } from '../../../shared/protocol';

const SKIN = 0xe0ad8a;
const UNDERWEAR = 0x33425e;

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  phase: number;
  amt: number;
  time: number;
}

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02, flatShading: true, ...extra });
}

function holo() {
  return new THREE.MeshStandardMaterial({
    color: 0xa8ecff,
    emissive: 0x2aa8ff,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function limb(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, r: number, len: number) {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat, g, 0, -(len / 2 + r * 0.6));
  parent.add(g);
  return g;
}

/** Builds a low-poly humanoid. Pass null for the unformed clone that floats in a tube. */
export function buildRig(app: Appearance | null): Rig {
  const female = app?.sex === 'female';
  const skin = app ? std(SKIN) : holo();
  const under = app ? std(UNDERWEAR, { roughness: 0.55 }) : skin;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const hips = mesh(new THREE.CylinderGeometry(female ? 0.185 : 0.175, 0.165, 0.2, 10), under, body, 0, 0.95);
  hips.scale.z = 0.8;
  const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), skin, body, 0, 1.26);
  torso.scale.set(female ? 0.88 : 1.05, 1, 0.76);
  mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.14, 8), skin, body, 0, 1.55);

  if (female && app) {
    const band = mesh(new THREE.CylinderGeometry(0.162, 0.158, 0.06, 10), under, body, 0, 1.3);
    band.scale.z = 0.8;
    for (const sx of [-1, 1]) {
      const cup = mesh(new THREE.SphereGeometry(0.068, 8, 6), under, body, sx * 0.068, 1.35, 0.085);
      cup.scale.set(1, 0.9, 0.75);
    }
  }

  const armX = female ? 0.225 : 0.25;
  const armL = limb(body, skin, -armX, 1.46, female ? 0.045 : 0.052, 0.48);
  const armR = limb(body, skin, armX, 1.46, female ? 0.045 : 0.052, 0.48);
  for (const arm of [armL, armR]) mesh(new THREE.IcosahedronGeometry(0.052, 0), skin, arm, 0, -0.62);
  armL.rotation.z = -0.08;
  armR.rotation.z = 0.08;

  const legL = limb(body, skin, -0.095, 0.92, female ? 0.066 : 0.072, 0.7);
  const legR = limb(body, skin, 0.095, 0.92, female ? 0.066 : 0.072, 0.7);
  for (const leg of [legL, legR]) mesh(new THREE.BoxGeometry(0.09, 0.05, 0.2), skin, leg, 0, -0.88, 0.04);

  const head = new THREE.Group();
  head.position.y = 1.72;
  body.add(head);
  const skull = mesh(new THREE.IcosahedronGeometry(0.14, 2), skin, head);
  skull.scale.set(0.95, 1.12, 1);

  if (app) decorateHead(head, app, skin);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  shadow.name = 'shadow';
  root.add(shadow);

  return { root, body, head, armL, armR, legL, legR, phase: 0, amt: 0, time: Math.random() * 10 };
}

function decorateHead(head: THREE.Group, app: Appearance, skin: THREE.Material) {
  const female = app.sex === 'female';
  const hair = std(app.hairColor, { roughness: 0.85 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x141014 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f2ee, roughness: 0.4 });
  const iris = new THREE.MeshStandardMaterial({ color: app.eyeColor, roughness: 0.3, emissive: app.eyeColor, emissiveIntensity: 0.15 });
  const lip = std(app.face === 'flirty' ? 0xc24b66 : female ? 0xb35d5d : 0x7d3c35);

  mesh(new THREE.ConeGeometry(0.022, 0.05, 4), skin, head, 0, -0.015, 0.14).rotation.x = Math.PI / 2;

  for (const side of [-1, 1] as const) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.048, 0.02, 0.118);
    mesh(new THREE.SphereGeometry(0.022, 10, 8), white, eye);
    mesh(new THREE.SphereGeometry(0.0125, 8, 6), iris, eye, 0, 0, 0.016);
    mesh(new THREE.SphereGeometry(0.0062, 6, 4), dark, eye, 0, 0, 0.025);
    if (app.face === 'flirty' && side === -1) eye.scale.y = 0.28;
    if (app.face === 'angry') eye.scale.y = 0.75;
    head.add(eye);

    const brow = mesh(new THREE.BoxGeometry(0.05, female ? 0.009 : 0.013, 0.02), hair, head, side * 0.05, 0.068, 0.122);
    switch (app.face) {
      case 'smiling':
        brow.position.y += 0.006;
        brow.rotation.z = side * -0.12;
        break;
      case 'angry':
        brow.position.y -= 0.006;
        brow.rotation.z = side * 0.42;
        break;
      case 'flirty':
        if (side === 1) {
          brow.position.y += 0.014;
          brow.rotation.z = 0.22;
        }
        break;
    }
  }

  const mouthZ = app.facialHair === 'beard' ? 0.139 : 0.13;
  switch (app.face) {
    case 'smiling': {
      const m = mesh(new THREE.TorusGeometry(0.032, 0.0075, 4, 12, Math.PI), lip, head, 0, -0.058, mouthZ);
      m.rotation.z = Math.PI;
      break;
    }
    case 'serious':
      mesh(new THREE.BoxGeometry(0.052, 0.009, 0.012), lip, head, 0, -0.074, mouthZ);
      break;
    case 'angry':
      mesh(new THREE.TorusGeometry(0.026, 0.0065, 4, 10, Math.PI), lip, head, 0, -0.088, mouthZ);
      break;
    case 'flirty': {
      const m = mesh(new THREE.TorusGeometry(0.028, 0.009, 4, 10, Math.PI * 0.75), lip, head, 0.008, -0.062, mouthZ);
      m.rotation.z = Math.PI + 0.35;
      break;
    }
  }

  const cap = mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, head, 0, 0.012, -0.004);
  cap.scale.set(0.98, 1.12, 1.04);
  cap.rotation.x = -0.22;
  const back = mesh(new THREE.SphereGeometry(0.143, 12, 8), hair, head, 0, 0.03, -0.026);
  back.scale.set(0.98, 1.08, 1);

  if (app.hairLength === 'long') {
    const len = female ? 0.5 : 0.3;
    const slab = mesh(new THREE.BoxGeometry(0.27, len, 0.075), hair, head, 0, -len / 2 + 0.06, -0.105);
    slab.rotation.x = 0.08;
    for (const side of [-1, 1]) {
      const lock = mesh(new THREE.BoxGeometry(0.035, len * 0.62, 0.1), hair, head, side * 0.132, -len * 0.25 + 0.02, 0.0);
      lock.rotation.z = side * 0.06;
    }
  } else if (female) {
    const bob = mesh(new THREE.BoxGeometry(0.29, 0.14, 0.12), hair, head, 0, -0.07, -0.07);
    bob.rotation.x = 0.1;
  }

  if (!female && app.facialHair !== 'none') {
    const full = app.facialHair === 'beard';
    const beardMat = full
      ? hair
      : new THREE.MeshStandardMaterial({ color: app.hairColor, transparent: true, opacity: 0.42, depthWrite: false, roughness: 1 });
    const r = full ? 0.148 : 0.1425;
    const beard = mesh(new THREE.SphereGeometry(r, 12, 8, 0, Math.PI, Math.PI * 0.56, Math.PI * 0.36), beardMat, head);
    beard.scale.set(0.98, 1.12, 1.02);
    if (full) {
      mesh(new THREE.BoxGeometry(0.075, 0.018, 0.022), hair, head, 0, -0.045, 0.135);
      const chin = mesh(new THREE.ConeGeometry(0.06, 0.07, 6), hair, head, 0, -0.17, 0.08);
      chin.rotation.x = Math.PI;
    }
  }
}

export function animateRig(rig: Rig, dt: number, moving: boolean, speed = 1) {
  rig.time += dt;
  rig.amt += ((moving ? 1 : 0) - rig.amt) * Math.min(1, dt * 10);
  rig.phase += dt * 9 * speed * (0.3 + rig.amt);
  const swing = Math.sin(rig.phase) * 0.6 * rig.amt;
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.armL.rotation.x = -swing * 0.8;
  rig.armR.rotation.x = swing * 0.8;
  const breathe = Math.sin(rig.time * 2) * 0.012;
  rig.body.position.y = Math.abs(Math.cos(rig.phase)) * 0.045 * rig.amt;
  rig.armL.rotation.z = -0.08 - breathe * 2;
  rig.armR.rotation.z = 0.08 + breathe * 2;
  rig.head.rotation.x = breathe;
}

/** Arms-relaxed floating pose for figures inside a tube. */
export function floatRig(rig: Rig, dt: number) {
  rig.time += dt;
  const s = Math.sin(rig.time * 1.3);
  rig.armL.rotation.z = -0.25 - s * 0.05;
  rig.armR.rotation.z = 0.25 + s * 0.05;
  rig.legL.rotation.z = -0.05;
  rig.legR.rotation.z = 0.05;
  rig.head.rotation.x = -0.05 + s * 0.03;
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
