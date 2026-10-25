/** Third-person camera hull clamp: `npm run check:camera`. */
import * as THREE from 'three';
import { clampCameraAlongRay } from './cameraCollision';

const problems: string[] = [];
const expect = (name: string, ok: boolean, detail = '') => {
  if (!ok) problems.push(`${name}${detail ? ` ${detail}` : ''}`);
};

const ray = new THREE.Raycaster();
const eye = new THREE.Vector3(0, 1.45, 0);
const wall = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 0.2), new THREE.MeshBasicMaterial());
wall.position.set(0, 2, -2.5);
wall.updateMatrixWorld(true);
const meshes = [wall];

const desiredBehind = new THREE.Vector3(0, 1.45, -6);
const clamped = clampCameraAlongRay(eye, desiredBehind, meshes, ray);
const distDesired = eye.distanceTo(desiredBehind);
const distClamped = eye.distanceTo(clamped);
expect('wall behind player shortens camera ray', distClamped < distDesired - 0.5, `dist ${distClamped.toFixed(3)} vs ${distDesired.toFixed(3)}`);
expect('camera stays in front of wall', clamped.z > wall.position.z + 0.05, `z=${clamped.z.toFixed(3)}`);

const desiredClear = new THREE.Vector3(0, 1.45, -1.2);
const clear = clampCameraAlongRay(eye, desiredClear, meshes, ray);
expect('clear line of sight keeps desired distance', eye.distanceTo(clear) >= eye.distanceTo(desiredClear) - 0.02);

if (problems.length) throw new Error(`camera collision problems:\n${problems.join('\n')}`);
console.log('check:camera ok');
