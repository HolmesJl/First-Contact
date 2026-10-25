import * as THREE from 'three';
import { QUEST_TERMINALS } from '../../../shared/opening';
import { LAB_QUEST_TERMINAL_INTERACT_ID } from '../../../shared/transporter';
import { FACE_OUT } from '../../../shared/shipInterior';

export class QuestTerminalLayer {
  private readonly root = new THREE.Group();
  private glows = new Map<string, THREE.Mesh>();
  private highlightId: string | null = null;

  constructor() {
    for (const t of QUEST_TERMINALS) {
      // Science Lab transporter uses TransporterStationLayer + pad pick volume (same slot as the opening quest terminal).
      if (t.interactId === LAB_QUEST_TERMINAL_INTERACT_ID) continue;
      const g = new THREE.Group();
      g.position.set(t.x, t.y, t.z);
      const f = FACE_OUT[t.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }),
      );
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.2, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0x5fd8ff,
          emissive: new THREE.Color(0x2a8cb8),
          emissiveIntensity: 0.85,
          roughness: 0.35,
        }),
      );
      screen.position.z = 0.035;
      panel.add(screen);

      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.38, 32),
        new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(t.stand.x, 0.04, t.stand.z);
      glow.visible = false;

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.45, 0.35),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      pick.position.z = 0.05;
      pick.userData.interactId = t.interactId;

      g.add(panel, pick);
      this.root.add(g);
      this.root.add(glow);
      this.glows.set(t.interactId, glow);
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
