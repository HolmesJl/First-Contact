import * as THREE from 'three';
import { CLOSETS, STOCK_PANELS, WORLD_FILES, itemInteractPosition } from '../../../shared/items';
import { FACE_OUT } from '../../../shared/shipInterior';
import { labelSprite } from './interior/kit';

const HANDLE_IDLE = new THREE.Color(0x2a8cb8);
const HANDLE_OWNED = new THREE.Color(0x2fa868);

/**
 * Item interactables in the ship: stock control panels (Eatery, Printer, Refinery, Cargo Hold shelves) as amber
 * screens on their props, one closet handle per berth tier on the bunk-room cabinets and the Captain's trunk, and the
 * world Files: identical read-me pads lying on prop tops. Placement comes from shared/items.ts.
 */
export class ItemStationLayer {
  private readonly root = new THREE.Group();
  private closetHandles = new Map<number, THREE.MeshStandardMaterial>();
  private labels: THREE.Sprite[] = [];
  private anchor = new THREE.Vector3();
  /** Floor ring at the stand point of the quest's current item station. */
  private glow: THREE.Mesh;
  private time = 0;

  constructor() {
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.38, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.visible = false;
    this.root.add(this.glow);

    for (const p of STOCK_PANELS) {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      const f = FACE_OUT[p.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.14), new THREE.MeshStandardMaterial({ color: 0x3a4557, roughness: 0.6, metalness: 0.4 }));
      arm.position.z = -0.06;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.45, metalness: 0.35 }));
      panel.position.z = 0.04;
      const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.26, 0.02),
        new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: new THREE.Color(0xa86a1c), emissiveIntensity: 0.9, roughness: 0.35 }),
      );
      screen.position.z = 0.035;
      panel.add(screen);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.35), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.z = 0.05;
      pick.userData.interactId = p.interactId;
      const label = labelSprite(p.title.toUpperCase(), 'station', 0.16);
      label.position.set(0, 0.34, 0.1);
      this.labels.push(label);
      g.add(arm, panel, pick, label);
      this.root.add(g);
    }

    for (const c of CLOSETS) {
      const g = new THREE.Group();
      g.position.set(c.x, c.y, c.z);
      const f = FACE_OUT[c.face];
      g.rotation.y = Math.atan2(f.dx, f.dz);
      const mat = new THREE.MeshStandardMaterial({ color: 0x5fd8ff, emissive: HANDLE_IDLE.clone(), emissiveIntensity: 0.8, roughness: 0.4 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.5, metalness: 0.3 }));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), mat);
      handle.position.z = 0.025;
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.z = 0.08;
      pick.userData.interactId = c.interactId;
      const label = labelSprite(c.berth === 0 ? "CAPTAIN'S TRUNK" : `CLOSET ${c.berth}`, 'prop', 0.11);
      label.position.set(0, 0.17, 0.08);
      this.labels.push(label);
      g.add(plate, handle, pick, label);
      this.root.add(g);
      this.closetHandles.set(c.berth, mat);
    }

    const padBody = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, roughness: 0.55, metalness: 0.15 });
    const padStrip = new THREE.MeshStandardMaterial({ color: 0x1a2438, roughness: 0.5 });
    const padTab = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46d9ff).multiplyScalar(1.3), toneMapped: false });
    for (const w of WORLD_FILES) {
      const g = new THREE.Group();
      g.position.set(w.x, w.y, w.z);
      const f = FACE_OUT[w.face];
      g.rotation.y = Math.atan2(f.dx, f.dz) + 0.18;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.32), padBody);
      body.position.y = 0.0125;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.05), padStrip);
      strip.position.set(0, 0.027, -0.1);
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.03), padTab);
      tab.position.set(0.07, 0.027, 0.11);
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.45), new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.y = 0.1;
      pick.userData.interactId = w.interactId;
      const label = labelSprite(`FILE · ${w.name.toUpperCase()}`, 'prop', 0.12);
      label.position.set(0, 0.3, 0);
      this.labels.push(label);
      g.add(body, strip, tab, pick, label);
      this.root.add(g);
    }
  }

  attach(parent: THREE.Group) {
    parent.add(this.root);
  }

  /** The local player's own closet handle glows green; the rest idle blue. */
  setOwnBerth(berth: number | null) {
    for (const [b, mat] of this.closetHandles) mat.emissive.copy(b === berth ? HANDLE_OWNED : HANDLE_IDLE);
  }

  /** Light the stand point of an item interactable (a quest's current task), or none. */
  setHighlight(interactId: string | null) {
    const p = interactId ? itemInteractPosition(interactId) : null;
    this.glow.visible = !!p;
    if (p) this.glow.position.set(p.x, 0.04, p.z);
  }

  update(camera: THREE.Camera, dt = 0) {
    this.time += dt;
    if (this.glow.visible) (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(this.time * 3.2);
    for (const l of this.labels) {
      const d = l.getWorldPosition(this.anchor).distanceTo(camera.position);
      l.visible = d < 7;
    }
  }
}
