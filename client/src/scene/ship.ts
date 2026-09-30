import * as THREE from 'three';
import { canvasTexture } from './common';

/** The colony ship "First Contact", built from primitives. Long axis is +X (bow). */
export function buildShip() {
  const ship = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xc9d2de, metalness: 0.55, roughness: 0.4, flatShading: true });
  const darkHull = new THREE.MeshStandardMaterial({ color: 0x4a5566, metalness: 0.6, roughness: 0.5, flatShading: true });
  const glowBlue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x66ccff).multiplyScalar(3) });
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2a8).multiplyScalar(2.2) });

  const spine = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 26, 10), hull);
  spine.rotation.z = Math.PI / 2;
  ship.add(spine);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 10), hull);
  bow.rotation.z = -Math.PI / 2;
  bow.position.x = 16;
  ship.add(bow);
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4, 10), hull);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.x = 11;
  ship.add(bridge);
  const bridgeWindows = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.35, 10, 1, true), windowMat);
  bridgeWindows.rotation.z = Math.PI / 2;
  bridgeWindows.position.x = 12;
  ship.add(bridgeWindows);

  const ring = new THREE.Group();
  ring.position.x = 2;
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(7, 1, 8, 40), hull));
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(7.95, 0.12, 4, 80), windowMat));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 14, 0.5), darkHull);
    spoke.rotation.z = (i * Math.PI) / 4;
    ring.add(spoke);
  }
  ring.rotation.y = Math.PI / 2;
  ship.add(ring);

  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 2.2), hull);
    pod.position.set(-5, 0, side * 2.2);
    ship.add(pod);
    const greenhouse = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7dff9a, emissive: 0x2a9c4a, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }),
    );
    greenhouse.position.set(-5, 0.8, side * 2.2);
    ship.add(greenhouse);

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.08, 9),
      new THREE.MeshStandardMaterial({ color: 0x1b2b5c, metalness: 0.8, roughness: 0.25, emissive: 0x0b1a44 }),
    );
    panel.position.set(-1.5, 0, side * 10.5);
    ship.add(panel);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), darkHull);
    strut.rotation.x = Math.PI / 2;
    strut.position.set(-1.5, 0, side * 4.5);
    ship.add(strut);
  }

  const engines = new THREE.Group();
  engines.position.x = -13;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const y = Math.cos(a) * 1.9;
    const z = Math.sin(a) * 1.9;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 2.4, 10, 1, true), darkHull);
    bell.material.side = THREE.DoubleSide;
    bell.rotation.z = Math.PI / 2;
    bell.position.set(-1, y, z);
    engines.add(bell);
    const core = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), glowBlue);
    core.rotation.y = -Math.PI / 2;
    core.position.set(-1.6, y, z);
    engines.add(core);
  }
  ship.add(engines);

  const nameTex = canvasTexture(1024, 128, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.font = '700 84px "Orbitron", "Segoe UI", sans-serif';
    ctx.fillStyle = '#1e2a3a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FIRST  CONTACT', 512, 68);
  });
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.1),
      new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false }),
    );
    plate.position.set(-6, 0.1, side * 1.33);
    if (side < 0) plate.rotation.y = Math.PI;
    ship.add(plate);
  }

  const navLights: THREE.Mesh[] = [];
  for (const [x, y, z, c] of [
    [18.5, 0, 0, 0xffffff],
    [-2, 0, 15, 0x33ff66],
    [-2, 0, -15, 0xff3344],
  ] as const) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4) }));
    l.position.set(x, y, z);
    ship.add(l);
    navLights.push(l);
  }

  let t = 0;
  const update = (dt: number) => {
    t += dt;
    ring.rotation.x += dt * 0.15;
    const on = Math.sin(t * 5) > 0.6;
    navLights.forEach((l) => (l.visible = on));
  };
  return { ship, update };
}
