import * as THREE from 'three';
import { MEMORY_STATIONS, berthLabel, type BerthOwner } from '../../../shared/bunks';
import { FACE_OUT } from '../../../shared/shipInterior';
import { labelSprite } from './interior/kit';

const SCREEN_IDLE = new THREE.Color(0x2a8cb8);
const SCREEN_OWNED = new THREE.Color(0x2fa868);
const SCREEN_LIT = new THREE.Color(0x5fd8ff);

interface StationView {
  group: THREE.Group;
  screen: THREE.MeshStandardMaterial;
  glow: THREE.Mesh;
  label: THREE.Sprite | null;
  labelText: string;
  owned: boolean;
}

/**
 * One glowing data pad per berth, in the quest-terminal style: a small panel with an emissive screen on a short arm
 * off the bunk frame, a pulsing floor ring at the stand point while it is an objective, and a name tag once claimed.
 */
export class MemoryStationLayer {
  private readonly root = new THREE.Group();
  private views = new Map<string, StationView>();
  private highlighted = new Set<string>();
  private anchor = new THREE.Vector3();

  constructor() {
    for (const s of MEMORY_STATIONS) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      // Short mounting arm back to the bunk frame, then the pad.
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x3a4557, roughness: 0.6, metalness: 0.4 }),
      );
      arm.position.z = -0.05;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      panel.position.z = 0.04;
      const screenMat = new THREE.MeshStandardMaterial({
        color: 0x5fd8ff,
        emissive: SCREEN_IDLE.clone(),
        emissiveIntensity: 0.85,
        roughness: 0.35,
      });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.02), screenMat);
      screen.position.z = 0.035;
      panel.add(screen);

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.38, 32),
        new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(s.stand.x, 0.04, s.stand.z);
      glow.visible = false;
      this.root.add(glow);

      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.35), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.z = 0.05;
      pick.userData.interactId = s.interactId;

      g.add(arm, panel, pick);
      this.root.add(g);
      const view: StationView = { group: g, screen: screenMat, glow, label: null, labelText: '', owned: false };
      this.views.set(s.interactId, view);
      this.setLabel(s.interactId, `${berthLabel(s.berth).toUpperCase()} · FREE`, false);
    }
  }

  attach(parent: THREE.Group) {
    parent.add(this.root);
  }

  /** Light up the given stations (the current objective); others go idle. */
  setHighlight(interactIds: Iterable<string>) {
    this.highlighted = new Set(interactIds);
  }

  /** Name tags from berth -> owner; unclaimed berths read FREE. */
  setOwners(owners: Map<number, BerthOwner>) {
    for (const s of MEMORY_STATIONS) {
      const o = owners.get(s.berth);
      const text = o ? `${berthLabel(s.berth).toUpperCase()} · ${o.name}` : `${berthLabel(s.berth).toUpperCase()} · FREE`;
      this.setLabel(s.interactId, text, !!o);
    }
  }

  private setLabel(interactId: string, text: string, owned: boolean) {
    const v = this.views.get(interactId);
    if (!v || (v.labelText === text && v.owned === owned)) return;
    v.label?.removeFromParent();
    v.label = labelSprite(text, owned ? 'station' : 'prop', 0.16);
    v.label.position.set(0, 0.3, 0.1);
    v.group.add(v.label);
    v.labelText = text;
    v.owned = owned;
    v.screen.emissive.copy(owned ? SCREEN_OWNED : SCREEN_IDLE);
  }

  update(time: number, camera: THREE.Camera) {
    const pulse = 0.5 + 0.35 * Math.sin(time * 3.2);
    for (const [id, v] of this.views) {
      const on = this.highlighted.has(id);
      v.glow.visible = on;
      if (on) {
        (v.glow.material as THREE.MeshBasicMaterial).opacity = pulse;
        v.screen.emissive.copy(SCREEN_LIT);
        v.screen.emissiveIntensity = 0.9 + pulse * 0.8;
      } else {
        v.screen.emissive.copy(v.owned ? SCREEN_OWNED : SCREEN_IDLE);
        v.screen.emissiveIntensity = 0.85;
      }
      if (v.label) {
        const d = v.label.getWorldPosition(this.anchor).distanceTo(camera.position);
        v.label.visible = d < 9;
      }
    }
  }
}
