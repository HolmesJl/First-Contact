import * as THREE from 'three';

const MIN_FROM_EYE = 0.35;

/**
 * Pull `desired` toward `eye` so a sphere of radius `skin` stays inside solid meshes
 * (third-person camera collision along the look ray).
 */
export function clampCameraAlongRay(
  eye: THREE.Vector3,
  desired: THREE.Vector3,
  meshes: THREE.Object3D[],
  raycaster: THREE.Raycaster,
  skin = 0.28,
): THREE.Vector3 {
  const delta = new THREE.Vector3().subVectors(desired, eye);
  const len = delta.length();
  if (len < 1e-5) return desired.clone();
  const dir = delta.multiplyScalar(1 / len);
  raycaster.near = 0.05;
  raycaster.far = len;
  raycaster.set(eye, dir);
  const hits = raycaster.intersectObjects(meshes, false);
  let allow = len;
  for (const h of hits) {
    const d = h.distance - skin;
    if (d > MIN_FROM_EYE && d < allow) allow = d;
  }
  allow = Math.max(MIN_FROM_EYE, Math.min(allow, len));
  return eye.clone().add(dir.multiplyScalar(allow));
}
