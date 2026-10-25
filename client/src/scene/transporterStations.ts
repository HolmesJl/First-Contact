import * as THREE from 'three';
import { TRANSPORTER_STATIONS } from '../../../shared/transporter';
import { FACE_OUT } from '../../../shared/shipInterior';

/** Floor beacons and pick volumes for Science Lab and Cargo Bay transporter pads. */
export class TransporterStationLayer {
  private readonly root = new THREE.Group();
  private beacons = new Map<string, THREE.Mesh>();
  private highlightId: string | null = null;

  constructor() {
    for (const s of TRANSPORTER_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const color = s.lootKind === 'raw' ? 0x5fd8ff : 0xffc46a;
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.2, 0.02),
        new THREE.MeshStandardMaterial({
          color,
          emissive: new THREE.Color(s.lootKind === 'raw' ? 0x2a8cb8 : 0xb8862a),
          emissiveIntensity: 0.85,
          roughness: 0.35,
        }),
      );
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      screen.position.z = 0.035;
      panel.add(screen);

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.45, 0.35),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.z = 0.05;
      pick.userData.interactId = s.interactId;

      const beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.48, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(s.stand.x, 0.04, s.stand.z);

      g.add(panel, pick);
      this.root.add(g);
      this.root.add(beacon);
      this.beacons.set(s.interactId, beacon);
    }
  }

  attach(parent: THREE.Group) {
    parent.add(this.root);
  }

  setHighlight(interactId: string | null) {
    this.highlightId = interactId;
  }

  update(time: number) {
    const pulse = 0.45 + 0.35 * Math.sin(time * 3.2);
    const hot = 0.75 + 0.2 * Math.sin(time * 4.5);
    for (const [id, beacon] of this.beacons) {
      const hover = id === this.highlightId;
      (beacon.material as THREE.MeshBasicMaterial).opacity = hover ? hot : pulse * 0.55;
    }
  }
}
