import * as THREE from 'three';
import type { ShipMotionState } from '../../../shared/navigation';

const STAR_COUNT = 2800;
const RADIUS = 420;

/**
 * One offscreen starfield render shared by corridor glass, bridge screens, and the greenhouse dome.
 * Motion state stretches stars along the forward axis.
 */
export class StarscapeRenderer {
  readonly texture: THREE.Texture;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 16 / 9, 1, RADIUS * 2);
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private target = new THREE.WebGLRenderTarget(1024, 576, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });
  private motion: ShipMotionState = 'still';
  private time = 0;

  constructor(sharedRenderer: THREE.WebGLRenderer) {
    this.renderer = sharedRenderer;
    this.scene.background = new THREE.Color(0x02040a);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const phase = new Float32Array(STAR_COUNT);
    const c = new THREE.Color();
    for (let i = 0; i < STAR_COUNT; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(RADIUS * (0.7 + Math.random() * 0.3));
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.52 + Math.random() * 0.18, 0.45, 0.55 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: 0 },
        uSize: { value: 2.4 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        uniform float uMotion;
        uniform float uSize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec3 p = position;
          float drift = uMotion * (0.35 + sin(aPhase + uTime * 2.0) * 0.15);
          p.z -= uTime * drift * 40.0;
          p.z = mod(p.z + ${RADIUS.toFixed(1)}, ${(RADIUS * 2).toFixed(1)}) - ${RADIUS.toFixed(1)};
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float stretch = 1.0 + uMotion * 3.5;
          gl_Position = projectionMatrix * vec4(mv.x, mv.y, mv.z * stretch, mv.w);
          gl_PointSize = uSize * (280.0 / -mv.z);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.scene.add(this.points);
    this.texture = this.target.texture;
    this.renderFrame();
  }

  setMotion(motion: ShipMotionState) {
    this.motion = motion;
  }

  motionValue(): number {
    if (this.motion === 'f-warp') return 1;
    if (this.motion === 'warp') return 0.42;
    return 0;
  }

  update(dt: number) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uMotion.value = this.motionValue();
    this.renderFrame();
  }

  private renderFrame() {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
  }

  /** Glass / screen material sampling the live exterior texture. */
  viewportMaterial(opacity = 0.92): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity,
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  dispose() {
    this.target.dispose();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
