import * as THREE from 'three';
import type { ShipMotionState } from '../../../shared/navigation';

/** Seed ship heading in world space (+Z = bridge forward). */
export const SHIP_FORWARD = new THREE.Vector3(0, 0, 1);

const VIEWPORT_VERTEX = `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const VIEWPORT_FRAGMENT = `
  uniform vec3 uCameraPos;
  uniform vec3 uShipForward;
  uniform float uTime;
  uniform float uScroll;
  uniform float uStreak;
  uniform float uOpacity;
  uniform float uDisplayChrome;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float starsAt(vec3 p) {
    vec3 cell = floor(p * 14.0);
    vec3 f = fract(p * 14.0);
    float h = hash31(cell);
    if (h < 0.92) return 0.0;
    float d = length(f - 0.5);
    float core = smoothstep(0.22, 0.0, d);
    float tint = 0.75 + 0.25 * hash31(cell + 1.7);
    return core * tint;
  }

  vec3 starColor(vec3 p) {
    float h = hash31(floor(p * 14.0) + 0.5);
    float hue = 0.55 + h * 0.15;
    return vec3(0.65 + hue * 0.35, 0.75 + hue * 0.2, 1.0);
  }

  void main() {
    vec3 ray = normalize(vWorldPos - uCameraPos);
    vec3 drift = uShipForward * uTime * uScroll;
    float align = abs(dot(ray, uShipForward));
    float streakLen = uStreak * (0.35 + 0.65 * align);

    float acc = 0.0;
    vec3 colAcc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float t = float(i) / 5.0;
      vec3 offset = uShipForward * (streakLen * t * 6.0);
      vec3 p = ray * 72.0 - drift - offset;
      float layer = starsAt(p) + starsAt(p * 2.1 + 3.0) * 0.55 + starsAt(p * 4.3 - 1.0) * 0.25;
      if (layer > 0.01) {
        colAcc += starColor(p) * layer;
        acc += layer;
      }
    }
    acc /= 6.0;
    colAcc /= 6.0;

    vec3 bg = vec3(0.01, 0.02, 0.05);
    vec3 col = bg + colAcc * (1.2 + uStreak * 1.5);
    float alpha = uOpacity * clamp(acc * 2.8 + 0.02, 0.0, 1.0);

    if (uDisplayChrome > 0.5) {
      vec2 uv = vUv;
      float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x)
        * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
      float scan = 0.93 + 0.07 * sin(uv.y * 520.0 + uTime * 3.5);
      float vignette = 1.0 - 0.4 * length((uv - 0.5) * vec2(1.0, 1.15));
      col = mix(vec3(0.008, 0.012, 0.022), col, edge) * scan * vignette;
      alpha = uOpacity * edge * clamp(acc * 2.6 + 0.04, 0.0, 1.0);
      float gloss = pow(1.0 - abs(uv.y - 0.22), 3.0) * 0.12;
      col += vec3(0.35, 0.5, 0.65) * gloss * edge;
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

type UniformNum = { value: number };
type UniformVec3 = { value: THREE.Vector3 };

/**
 * Procedural exterior field for interior glass: one continuous 3D star volume advected along ship forward.
 * Each viewport pixel uses the camera ray through that point, so bridge panels show adjacent sky and side
 * windows get lateral parallax.
 */
export class StarscapeRenderer {
  private readonly uTime: UniformNum = { value: 0 };
  private readonly uScroll: UniformNum = { value: 0.12 };
  private readonly uStreak: UniformNum = { value: 0 };
  private readonly uCameraPos: UniformVec3 = { value: new THREE.Vector3() };
  private readonly uShipForward: UniformVec3 = { value: SHIP_FORWARD.clone() };
  private motion: ShipMotionState = 'still';
  private time = 0;

  constructor(_sharedRenderer: THREE.WebGLRenderer) {
    /* Offscreen target removed — viewports shade in the main pass. */
  }

  setMotion(motion: ShipMotionState) {
    this.motion = motion;
    if (motion === 'f-warp') {
      this.uScroll.value = 28;
      this.uStreak.value = 1.15;
    } else if (motion === 'warp') {
      this.uScroll.value = 9;
      this.uStreak.value = 0.45;
    } else {
      this.uScroll.value = 0.35;
      this.uStreak.value = 0.04;
    }
  }

  private baseUniforms(opacity: number, displayChrome: number) {
    return {
      uCameraPos: this.uCameraPos,
      uShipForward: this.uShipForward,
      uTime: this.uTime,
      uScroll: this.uScroll,
      uStreak: this.uStreak,
      uOpacity: { value: opacity },
      uDisplayChrome: { value: displayChrome },
    };
  }

  private shaderMaterial(opacity: number, displayChrome: number) {
    return new THREE.ShaderMaterial({
      uniforms: this.baseUniforms(opacity, displayChrome),
      vertexShader: VIEWPORT_VERTEX,
      fragmentShader: VIEWPORT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  /** Corridor / greenhouse: window-like glass, no monitor chrome. */
  viewportMaterial(opacity = 0.92): THREE.ShaderMaterial {
    return this.shaderMaterial(opacity, 0);
  }

  /** Bridge forward displays: stars inset with vignette / scanlines. */
  viewportDisplayMaterial(opacity = 0.9): THREE.ShaderMaterial {
    return this.shaderMaterial(opacity, 1);
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    this.time += dt;
    this.uTime.value = this.time;
    camera.getWorldPosition(this.uCameraPos.value);
  }

  dispose() {
    /* Materials disposed with meshes. */
  }
}
