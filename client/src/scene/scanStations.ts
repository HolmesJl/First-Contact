import * as THREE from 'three';
import { FACE_OUT } from '../../../shared/shipInterior';
import { SCAN_STATIONS } from '../../../shared/scanning';

/**
 * Bridge sensor scan consoles: a small emissive panel on an arm, with a floor ring when highlighted.
 */
export class ScanStationLayer {
  private readonly root = new THREE.Group();
  private glows = new Map<string, THREE.Mesh>();
  private highlightId: string | null = null;

  constructor() {
    for (const s of SCAN_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x2a3548, roughness: 0.5, metalness: 0.4 }),
      );
      arm.position.z = -0.12;

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.34, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.26, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0x7cf0c4,
          emissive: new THREE.Color(0x2a9a72),
          emissiveIntensity: 0.85,
          roughness: 0.35,
        }),
      );
      screen.position.z = 0.035;
      panel.add(screen);

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.38, 32),
        new THREE.MeshBasicMaterial({ color: 0x7cf0c4, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(s.stand.x - s.x, -s.y + 0.04, s.stand.z - s.z);
      glow.visible = false;

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.85, 0.65),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.userData.interactId = s.interactId;

      g.add(arm, panel, pick, glow);
      this.root.add(g);
      this.glows.set(s.interactId, glow);
    }
  }

  attach(parent: THREE.Group) {
    parent.add(this.root);
  }

  setHighlight(interactId: string | null) {
    this.highlightId = interactId;
  }

  update(time: number) {
    const pulse = 0.5 + 0.35 * Math.sin(time * 3.2);
    for (const [id, glow] of this.glows) {
      const on = id === this.highlightId;
      glow.visible = on;
      if (on) (glow.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }
}
