import * as THREE from 'three';
import { TRANSPORTER_STATIONS } from '../../../shared/transporter';
import { FACE_OUT } from '../../../shared/shipInterior';

/** Matches stock panels / scavenger terminals (visible yellow idle, brighter on hover). */
const IDLE_PAD_COLOR = 0xffb347;
const IDLE_EMISSIVE = new THREE.Color(0xa86a1c);
const HOVER_PAD_COLOR = 0xffc46b;
const HOVER_EMISSIVE = new THREE.Color(0xd4922a);

/** Floor beacons and chest-height consoles for Science Lab and Cargo Bay transporter pads. */
export class TransporterStationLayer {
  readonly root = new THREE.Group();
  private beacons = new Map<string, THREE.Mesh>();
  private padGlows = new Map<string, THREE.Mesh>();
  private screens = new Map<string, THREE.MeshStandardMaterial>();
  private highlightId: string | null = null;

  constructor() {
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const s of TRANSPORTER_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const pedestal = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.92, 0.38),
        new THREE.MeshStandardMaterial({ color: 0x3a4557, roughness: 0.55, metalness: 0.35 }),
      );
      pedestal.position.y = -0.5;

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.36, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      panel.position.y = 0.02;

      const screenMat = new THREE.MeshStandardMaterial({
        color: IDLE_PAD_COLOR,
        emissive: IDLE_EMISSIVE.clone(),
        emissiveIntensity: 1.05,
        roughness: 0.35,
      });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.02), screenMat);
      screen.position.z = 0.045;
      screen.userData.interactId = s.interactId;
      panel.add(screen);

      const padGlow = new THREE.Mesh(
        new THREE.RingGeometry(0.26, 0.44, 32),
        new THREE.MeshBasicMaterial({ color: IDLE_PAD_COLOR, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
      );
      padGlow.rotation.x = -Math.PI / 2;
      padGlow.position.y = -0.58;

      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.5), pickMat);
      pick.position.set(0, 0.05, 0.08);
      pick.userData.interactId = s.interactId;

      const standPick = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.1), pickMat);
      standPick.position.set(s.stand.x, 1.1, s.stand.z);
      standPick.userData.interactId = s.interactId;

      const beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.52, 32),
        new THREE.MeshBasicMaterial({ color: IDLE_PAD_COLOR, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(s.stand.x, 0.04, s.stand.z);

      g.add(pedestal, panel, padGlow, pick);
      this.root.add(g);
      this.root.add(standPick);
      this.root.add(beacon);
      this.beacons.set(s.interactId, beacon);
      this.padGlows.set(s.interactId, padGlow);
      this.screens.set(s.interactId, screenMat);
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
    const hot = 0.82 + 0.18 * Math.sin(time * 4.5);
    for (const s of TRANSPORTER_STATIONS) {
      const id = s.interactId;
      const hover = id === this.highlightId;
      const beacon = this.beacons.get(id);
      if (beacon) {
        const mat = beacon.material as THREE.MeshBasicMaterial;
        mat.opacity = hover ? hot : 0.42 + pulse * 0.22;
        mat.color.setHex(hover ? HOVER_PAD_COLOR : IDLE_PAD_COLOR);
      }
      const pad = this.padGlows.get(id);
      if (pad) {
        const mat = pad.material as THREE.MeshBasicMaterial;
        if (hover) {
          mat.color.setHex(HOVER_PAD_COLOR);
          mat.opacity = hot;
        } else {
          mat.color.setHex(IDLE_PAD_COLOR);
          mat.opacity = 0.55 + pulse * 0.2;
        }
      }
      const screen = this.screens.get(id);
      if (screen) {
        if (hover) {
          screen.emissive.copy(HOVER_EMISSIVE);
          screen.emissiveIntensity = 1.25 + hot * 0.35;
          screen.color.setHex(HOVER_PAD_COLOR);
        } else {
          screen.emissive.copy(IDLE_EMISSIVE);
          screen.emissiveIntensity = 1.05;
          screen.color.setHex(IDLE_PAD_COLOR);
        }
      }
    }
  }
}
