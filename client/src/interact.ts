import * as THREE from 'three';
import { interactIdForProp, interactPrompt, inRange, positionForInteract } from '../../shared/opening';

const DRAG_PX = 6;

export interface InteractHooks {
  onHover(id: string | null, prompt: string | null): void;
  onInteract(id: string): void;
  playerPos(): { x: number; z: number } | null;
  isActive(): boolean;
}

export class InteractSystem {
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hoverId: string | null = null;
  private down: { x: number; y: number } | null = null;
  private highlight: THREE.Mesh | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private root: THREE.Object3D,
    private hooks: InteractHooks,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.highlight?.removeFromParent();
  }

  /** Re-emit the hover for the current target (its prompt may depend on state that just changed). */
  refreshHover() {
    if (this.hoverId) this.hooks.onHover(this.hoverId, interactPrompt(this.hoverId));
  }

  update() {
    if (!this.hooks.isActive()) {
      this.setHover(null);
      return;
    }
    const pos = this.hooks.playerPos();
    if (!pos || !this.hoverId) {
      this.syncHighlight(null);
      return;
    }
    const p = positionForInteract(this.hoverId);
    if (!p || !inRange(pos.x, pos.z, p.x, p.z)) {
      this.setHover(null);
      return;
    }
    this.syncHighlight(p);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.down) return;
    const dx = e.clientX - this.down.x;
    const dy = e.clientY - this.down.y;
    this.down = null;
    if (dx * dx + dy * dy > DRAG_PX * DRAG_PX) return;
    if (!this.hooks.isActive()) return;
    const id = this.pick(e.clientX, e.clientY);
    if (!id) return;
    const pos = this.hooks.playerPos();
    const p = positionForInteract(id);
    if (!pos || !p || !inRange(pos.x, pos.z, p.x, p.z)) return;
    this.hooks.onInteract(id);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.hooks.isActive()) return this.setHover(null);
    this.setHover(this.pick(e.clientX, e.clientY));
  };

  private pick(cx: number, cy: number): string | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.x = ((cx - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((cy - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObject(this.root, true);
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

  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    const prompt = id ? interactPrompt(id) : null;
    this.hooks.onHover(id, prompt);
    if (!id) this.syncHighlight(null);
  }

  private syncHighlight(p: { x: number; z: number } | null) {
    if (!p) {
      this.highlight?.removeFromParent();
      return;
    }
    if (!this.highlight) {
      this.highlight = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
      );
      this.highlight.rotation.x = -Math.PI / 2;
    }
    if (!this.highlight.parent) this.root.add(this.highlight);
    this.highlight.position.set(p.x, 0.04, p.z);
  }
}
