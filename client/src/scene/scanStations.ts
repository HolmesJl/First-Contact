import * as THREE from 'three';
import { BRIDGE_SCAN_INTERACT_ID, SCAN_STATIONS } from '../../../shared/scanning';
import { FACE_OUT } from '../../../shared/shipInterior';

/**
 * Bridge sensor scan: quest-terminal-style pad on scan-1 (shared desk mount) plus a floor beacon at the stand point.
 */
export class ScanStationLayer {
  private readonly root = new THREE.Group();
  private readonly beacons = new Map<string, THREE.Mesh>();
  private readonly pads = new Map<string, THREE.Mesh>();
  private discoverable = true;
  private highlightId: string | null = null;

  constructor() {
    for (const s of SCAN_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.2, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0x7cf0c4,
          emissive: new THREE.Color(0x2a9a72),
          emissiveIntensity: 0.95,
          roughness: 0.35,
        }),
      );
      screen.position.z = 0.035;
      panel.add(screen);

      const padGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.34, 32),
        new THREE.MeshBasicMaterial({ color: 0x7cf0c4, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      padGlow.rotation.x = -Math.PI / 2;
      padGlow.position.y = -0.22;

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.45, 0.35),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.z = 0.05;
      pick.userData.interactId = s.interactId;

      g.add(panel, screen, padGlow, pick);

      const beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.48, 32),
        new THREE.MeshBasicMaterial({ color: 0x7cf0c4, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(s.stand.x, 0.04, s.stand.z);

      this.root.add(g);
      this.root.add(beacon);
      this.pads.set(s.interactId, padGlow);
      this.beacons.set(s.interactId, beacon);
    }
  }

  attach(parent: THREE.Group) {
    parent.add(this.root);
  }

  setDiscoverable(on: boolean) {
    this.discoverable = on;
  }

  setHighlight(interactId: string | null) {
    this.highlightId = interactId === BRIDGE_SCAN_INTERACT_ID ? interactId : null;
  }

  update(time: number) {
    const pulse = 0.45 + 0.35 * Math.sin(time * 3.2);
    const hot = 0.75 + 0.2 * Math.sin(time * 4.5);
    for (const [id, beacon] of this.beacons) {
      const lit = this.discoverable;
      const hover = id === this.highlightId;
      beacon.visible = lit;
      if (lit) (beacon.material as THREE.MeshBasicMaterial).opacity = hover ? hot : pulse * 0.55;
    }
    for (const [id, pad] of this.pads) {
      const lit = this.discoverable;
      pad.visible = lit;
      if (lit) (pad.material as THREE.MeshBasicMaterial).opacity = id === this.highlightId ? hot : 0.5 + pulse * 0.25;
    }
  }
}
