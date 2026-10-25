import * as THREE from 'three';
import { TRANSPORTER_STATIONS } from '../../../shared/transporter';
import { FACE_OUT } from '../../../shared/shipInterior';

/** Quest / hover highlight on the datapad screen and floor ring (matches item station amber). */
const HOVER_PAD_COLOR = 0xffc46b;
const HOVER_EMISSIVE = new THREE.Color(0xa86a1c);

/** Floor beacons and pick volumes for Science Lab and Cargo Bay transporter pads. */
export class TransporterStationLayer {
  readonly root = new THREE.Group();
  private beacons = new Map<string, THREE.Mesh>();
  private padGlows = new Map<string, THREE.Mesh>();
  private screens = new Map<string, THREE.MeshStandardMaterial>();
  private baseEmissive = new Map<string, THREE.Color>();
  private highlightId: string | null = null;

  constructor() {
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const s of TRANSPORTER_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const color = s.lootKind === 'raw' ? 0x5fd8ff : 0xffc46a;
      const emissive = new THREE.Color(s.lootKind === 'raw' ? 0x2a8cb8 : 0xb8862a);
      const screenMat = new THREE.MeshStandardMaterial({
        color,
        emissive: emissive.clone(),
        emissiveIntensity: 0.85,
        roughness: 0.35,
      });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.02), screenMat);
      screen.position.z = 0.035;
      screen.userData.interactId = s.interactId;

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      panel.add(screen);

      const padGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.34, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      padGlow.rotation.x = -Math.PI / 2;
      padGlow.position.y = -0.22;

      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.42), pickMat);
      pick.position.z = 0.05;
      pick.userData.interactId = s.interactId;

      const standPick = new THREE.Mesh(new THREE.BoxGeometry(1.35, 2.35, 1.35), pickMat);
      standPick.position.set(s.stand.x, 1.15, s.stand.z);
      standPick.userData.interactId = s.interactId;

      const beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.48, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(s.stand.x, 0.04, s.stand.z);

      g.add(panel, padGlow, pick);
      this.root.add(g);
      this.root.add(standPick);
      this.root.add(beacon);
      this.beacons.set(s.interactId, beacon);
      this.padGlows.set(s.interactId, padGlow);
      this.screens.set(s.interactId, screenMat);
      this.baseEmissive.set(s.interactId, emissive.clone());
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
    for (const s of TRANSPORTER_STATIONS) {
      const id = s.interactId;
      const idle = s.lootKind === 'raw' ? 0x5fd8ff : 0xffc46a;
      const hover = id === this.highlightId;
      const pad = this.padGlows.get(id);
      if (pad) {
        const mat = pad.material as THREE.MeshBasicMaterial;
        if (hover) {
          mat.color.setHex(HOVER_PAD_COLOR);
          mat.opacity = hot;
        } else {
          mat.color.setHex(idle);
          mat.opacity = 0.5 + pulse * 0.25;
        }
      }
      const screen = this.screens.get(id);
      const base = this.baseEmissive.get(id);
      if (screen && base) {
        if (hover) {
          screen.emissive.copy(HOVER_EMISSIVE);
          screen.emissiveIntensity = 0.95 + hot * 0.35;
          screen.color.setHex(HOVER_PAD_COLOR);
        } else {
          screen.emissive.copy(base);
          screen.emissiveIntensity = 0.85;
          screen.color.setHex(idle);
        }
      }
    }
  }
}
