import * as THREE from 'three';
import { LAB_TRANSPORTER_INTERACT_ID, TRANSPORTER_STATIONS } from '../../../shared/transporter';
import { FACE_OUT } from '../../../shared/shipInterior';

/** Cargo bay floor console — amber idle like stock panels. */
const CARGO_IDLE_PAD_COLOR = 0xffb347;
const CARGO_IDLE_EMISSIVE = new THREE.Color(0xa86a1c);
const CARGO_HOVER_PAD_COLOR = 0xffc46b;
const CARGO_HOVER_EMISSIVE = new THREE.Color(0xd4922a);

/** Science Lab pillar datapad — cyan idle, amber on hover (single screen material path). */
const LAB_IDLE_PAD_COLOR = 0x5fd8ff;
const LAB_IDLE_EMISSIVE = new THREE.Color(0x2a8cb8);
const LAB_HOVER_PAD_COLOR = 0xffc46b;
const LAB_HOVER_EMISSIVE = new THREE.Color(0xd4922a);

type StationPalette = {
  idleColor: number;
  idleEmissive: THREE.Color;
  hoverColor: number;
  hoverEmissive: THREE.Color;
};

function paletteFor(interactId: string): StationPalette {
  if (interactId === LAB_TRANSPORTER_INTERACT_ID) {
    return {
      idleColor: LAB_IDLE_PAD_COLOR,
      idleEmissive: LAB_IDLE_EMISSIVE,
      hoverColor: LAB_HOVER_PAD_COLOR,
      hoverEmissive: LAB_HOVER_EMISSIVE,
    };
  }
  return {
    idleColor: CARGO_IDLE_PAD_COLOR,
    idleEmissive: CARGO_IDLE_EMISSIVE,
    hoverColor: CARGO_HOVER_PAD_COLOR,
    hoverEmissive: CARGO_HOVER_EMISSIVE,
  };
}

function makeScreenMaterial(palette: StationPalette): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: palette.idleColor,
    emissive: palette.idleEmissive.clone(),
    emissiveIntensity: 1.05,
    roughness: 0.35,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Floor beacons and consoles for Science Lab (pillar) and Cargo Bay transporter pads. */
export class TransporterStationLayer {
  readonly root = new THREE.Group();
  private beacons = new Map<string, THREE.Mesh>();
  private padGlows = new Map<string, THREE.Mesh>();
  private screens = new Map<string, THREE.MeshStandardMaterial>();
  private palettes = new Map<string, StationPalette>();
  private highlightId: string | null = null;

  constructor() {
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const s of TRANSPORTER_STATIONS) {
      const palette = paletteFor(s.interactId);
      const isLab = s.interactId === LAB_TRANSPORTER_INTERACT_ID;
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      const f = FACE_OUT[s.face];
      g.rotation.y = s.yaw ?? Math.atan2(f.dx, f.dz);

      const screenMat = makeScreenMaterial(palette);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(isLab ? 0.42 : 0.5, isLab ? 0.26 : 0.3, 0.02), screenMat);
      screen.position.z = 0.045;
      screen.renderOrder = 2;

      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(isLab ? 0.52 : 0.72, isLab ? 0.38 : 0.62, isLab ? 0.28 : 0.5),
        pickMat,
      );
      pick.position.set(0, 0, 0.06);
      pick.userData.interactId = s.interactId;

      if (isLab) {
        const bracket = new THREE.Mesh(
          new THREE.BoxGeometry(0.44, 0.3, 0.06),
          new THREE.MeshStandardMaterial({ color: 0x3a4557, roughness: 0.55, metalness: 0.35 }),
        );
        bracket.position.z = -0.02;
        g.add(bracket, screen, pick);
      } else {
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
        panel.add(screen);

        const padGlow = new THREE.Mesh(
          new THREE.RingGeometry(0.26, 0.44, 32),
          new THREE.MeshBasicMaterial({
            color: palette.idleColor,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        padGlow.rotation.x = -Math.PI / 2;
        padGlow.position.y = -0.58;

        const floorPick = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.5), pickMat);
        floorPick.position.set(0, 0.05, 0.08);
        floorPick.userData.interactId = s.interactId;

        const standPick = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.1), pickMat);
        standPick.position.set(s.stand.x, 1.1, s.stand.z);
        standPick.userData.interactId = s.interactId;

        g.add(pedestal, panel, padGlow, floorPick);
        this.root.add(standPick);
        this.padGlows.set(s.interactId, padGlow);
      }

      const beacon = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.52, 32),
        new THREE.MeshBasicMaterial({
          color: palette.idleColor,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(s.stand.x, 0.04, s.stand.z);

      this.root.add(g);
      this.root.add(beacon);
      this.beacons.set(s.interactId, beacon);
      this.screens.set(s.interactId, screenMat);
      this.palettes.set(s.interactId, palette);
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
      const palette = this.palettes.get(id)!;
      const hover = id === this.highlightId;
      const beacon = this.beacons.get(id);
      if (beacon) {
        const mat = beacon.material as THREE.MeshBasicMaterial;
        mat.opacity = hover ? hot : 0.42 + pulse * 0.22;
        mat.color.setHex(hover ? palette.hoverColor : palette.idleColor);
      }
      const pad = this.padGlows.get(id);
      if (pad) {
        const mat = pad.material as THREE.MeshBasicMaterial;
        if (hover) {
          mat.color.setHex(palette.hoverColor);
          mat.opacity = hot;
        } else {
          mat.color.setHex(palette.idleColor);
          mat.opacity = 0.55 + pulse * 0.2;
        }
      }
      const screen = this.screens.get(id);
      if (screen) {
        if (hover) {
          screen.emissive.copy(palette.hoverEmissive);
          screen.emissiveIntensity = 1.25 + hot * 0.35;
          screen.color.setHex(palette.hoverColor);
        } else {
          screen.emissive.copy(palette.idleEmissive);
          screen.emissiveIntensity = 1.05;
          screen.color.setHex(palette.idleColor);
        }
      }
    }
  }
}
