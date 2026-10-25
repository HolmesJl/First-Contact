/**
 * Raycast smoke: Science Lab transporter datapad is pickable from the stand point.
 *
 * Run: npm run smoke:transporter-pick
 */
import * as THREE from 'three';
import { interactIdForProp } from '../shared/opening';
import { LAB_TRANSPORTER_INTERACT_ID, LAB_TRANSPORTER_PROP_ID, TRANSPORTER_STATIONS } from '../shared/transporter';
import { TransporterStationLayer } from '../client/src/scene/transporterStations';

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

function pickInteractId(root: THREE.Object3D, camera: THREE.PerspectiveCamera, ndc = new THREE.Vector2(0, 0.05)): string | null {
  camera.updateMatrixWorld();
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(root, true);
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    while (o) {
      const id = o.userData.interactId as string | undefined;
      if (id && interactIdForProp(id)) return id;
      o = o.parent;
    }
  }
  return null;
}

const lab = TRANSPORTER_STATIONS.find((s) => s.interactId === LAB_TRANSPORTER_INTERACT_ID)!;
const cargo = TRANSPORTER_STATIONS.find((s) => s.interactId === 'cargo-transporter')!;

assert(interactIdForProp(LAB_TRANSPORTER_PROP_ID) === LAB_TRANSPORTER_INTERACT_ID, 'prop id maps to lab-transporter');

const scene = new THREE.Group();
const trans = new TransporterStationLayer();
trans.attach(scene);

// Merged pad art (no interactId) used to block the datapad until raycast is disabled on it.
const padArt = new THREE.Mesh(
  new THREE.CylinderGeometry(lab.stand.x ? 0.75 : 0.75, 0.85, 0.12, 24),
  new THREE.MeshLambertMaterial(),
);
padArt.position.set(lab.stand.x, 0.06, lab.stand.z);
padArt.raycast = () => {};
scene.add(padArt);

const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
cam.position.set(lab.stand.x, 1.45, lab.stand.z - 0.85);
cam.lookAt(lab.x, lab.y, lab.z);

const labId = pickInteractId(scene, cam);
assert(labId === LAB_TRANSPORTER_INTERACT_ID, `lab transporter pick from stand (got ${labId ?? 'none'})`);

cam.position.set(cargo.stand.x, 1.45, cargo.stand.z - 0.85);
cam.lookAt(cargo.x, cargo.y, cargo.z);
const cargoId = pickInteractId(scene, cam);
assert(cargoId === 'cargo-transporter', `cargo transporter pick from stand (got ${cargoId ?? 'none'})`);

// Hover highlight path: layer accepts lab id
trans.setHighlight(LAB_TRANSPORTER_INTERACT_ID);
trans.update(0);
assert(true, 'highlight path wired');

console.log('transporter pick smoke ok');
