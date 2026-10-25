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
  uniform float uPanorama;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }

  float starLayer(vec3 p, float cell, float keep) {
    vec3 id = floor(p * cell);
    vec3 f = fract(p * cell) - 0.5;
    float h = hash31(id);
    if (h > keep) return 0.0;
    float r = 0.05 + h * 0.16;
    float d = length(f);
    float core = smoothstep(r, 0.0, d);
    float tw = 0.45 + 0.55 * sin(uTime * (1.2 + h * 7.0) + h * 22.0);
    float glam = smoothstep(0.32, 0.0, abs(f.x)) * smoothstep(0.32, 0.0, abs(f.y));
    return core * tw + glam * 0.12 * tw;
  }

  vec3 starTint(vec3 id) {
    float h = hash31(id + 0.42);
    float warm = step(0.82, h);
    vec3 cool = vec3(0.92, 0.95, 1.0);
    vec3 gold = vec3(1.0, 0.94, 0.82);
    return mix(cool, gold, warm * 0.35);
  }

  void main() {
    vec3 ray = normalize(vWorldPos - uCameraPos);
    if (uPanorama > 0.5) {
      float az = (vUv.x - 0.5) * 1.75;
      float el = (vUv.y - 0.46) * 0.78;
      vec3 pano = normalize(vec3(sin(az), el, cos(az) + 0.35));
      ray = normalize(mix(ray, pano, 0.9));
    }
    vec3 drift = uShipForward * uTime * uScroll;
    float align = abs(dot(ray, uShipForward));
    float streakLen = uStreak * (0.3 + 0.7 * align);

    float acc = 0.0;
    vec3 colAcc = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      float t = float(i) / 6.0;
      vec3 offset = uShipForward * (streakLen * t * 7.5);
      vec3 p = ray * 88.0 - drift - offset;
      float s1 = starLayer(p, 16.0, 0.78);
      float s2 = starLayer(p * 1.9 + 1.3, 20.0, 0.84);
      float s3 = starLayer(p * 3.7 - 2.1, 26.0, 0.88);
      float layer = s1 + s2 * 0.75 + s3 * 0.45;
      if (layer > 0.004) {
        colAcc += starTint(floor(p * 18.0)) * layer;
        acc += layer;
      }
    }
    acc /= 7.0;
    colAcc /= 7.0;

    vec2 nebUv = ray.xz * 2.4 + drift.xz * 0.015 + vec2(uTime * 0.01);
    float neb = fbm(nebUv) * fbm(nebUv * 1.6 + 3.7);
    vec3 nebCol = vec3(0.05, 0.035, 0.09) * neb * (0.2 + 0.45 * (1.0 - align));
    if (uDisplayChrome > 0.5) nebCol *= 0.35;

    vec3 col = nebCol + colAcc * (1.55 + uStreak * 2.0);
    float alpha;

    if (uDisplayChrome > 0.5) {
      vec2 uv = vUv;
      float edge;
      if (uPanorama > 0.5) {
        edge = smoothstep(0.0, 0.022, uv.x) * smoothstep(1.0, 0.978, uv.x)
          * smoothstep(0.0, 0.045, uv.y) * smoothstep(1.0, 0.955, uv.y);
      } else {
        edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x)
          * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);
      }
      float scan = 0.96 + 0.04 * sin(uv.y * 480.0 + uTime * 2.8);
      float vignette = 1.0 - 0.28 * length((uv - 0.5) * vec2(1.0, 1.1));
      col = mix(vec3(0.0), col, edge) * scan * vignette;
      alpha = uOpacity * edge;
      float gloss = pow(1.0 - abs(uv.y - 0.18), 3.0) * 0.08;
      col += vec3(0.4, 0.55, 0.7) * gloss * edge;
    } else {
      float starMix = clamp(acc * 2.4 + 0.05, 0.0, 1.0);
      alpha = uOpacity * mix(0.9, 1.0, starMix);
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

type UniformNum = { value: number };
type UniformVec3 = { value: THREE.Vector3 };

/**
 * Procedural exterior field for interior glass: one continuous 3D star volume advected along ship forward.
 * Bridge fore uses panorama UVs so the nose reads as one wide monitor.
 */
export class StarscapeRenderer {
  private readonly uTime: UniformNum = { value: 0 };
  private readonly uScroll: UniformNum = { value: 0.12 };
  private readonly uStreak: UniformNum = { value: 0 };
  private readonly uCameraPos: UniformVec3 = { value: new THREE.Vector3() };
  private readonly uShipForward: UniformVec3 = { value: SHIP_FORWARD.clone() };
  private readonly uPanorama: UniformNum = { value: 0 };
  private bridgeForeMat: THREE.ShaderMaterial | null = null;
  private motion: ShipMotionState = 'still';
  private time = 0;

  constructor(_sharedRenderer: THREE.WebGLRenderer) {
    /* Materials shade in the main pass. */
  }

  setMotion(motion: ShipMotionState) {
    this.motion = motion;
    if (motion === 'f-warp') {
      this.uScroll.value = 52;
      this.uStreak.value = 1.45;
    } else if (motion === 'warp') {
      this.uScroll.value = 13;
      this.uStreak.value = 0.58;
    } else {
      this.uScroll.value = 0.07;
      this.uStreak.value = 0.02;
    }
  }

  private baseUniforms(opacity: number, displayChrome: number, panorama: number) {
    this.uPanorama.value = panorama;
    return {
      uCameraPos: this.uCameraPos,
      uShipForward: this.uShipForward,
      uTime: this.uTime,
      uScroll: this.uScroll,
      uStreak: this.uStreak,
      uOpacity: { value: opacity },
      uDisplayChrome: { value: displayChrome },
      uPanorama: this.uPanorama,
    };
  }

  private shaderMaterial(opacity: number, displayChrome: number, panorama: number) {
    return new THREE.ShaderMaterial({
      uniforms: this.baseUniforms(opacity, displayChrome, panorama),
      vertexShader: VIEWPORT_VERTEX,
      fragmentShader: VIEWPORT_FRAGMENT,
      transparent: displayChrome < 0.5,
      depthWrite: displayChrome > 0.5,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  /** Corridor / greenhouse: window-like glass, no monitor chrome. */
  viewportMaterial(opacity = 0.92): THREE.ShaderMaterial {
    return this.shaderMaterial(opacity, 0, 0);
  }

  /** Bridge forward displays: stars inset with vignette / scanlines. */
  viewportDisplayMaterial(opacity = 0.9): THREE.ShaderMaterial {
    return this.shaderMaterial(opacity, 1, 0);
  }

  /** Single shared material for the continuous bridge fore panorama. */
  bridgeForeMaterial(): THREE.ShaderMaterial {
    if (!this.bridgeForeMat) this.bridgeForeMat = this.shaderMaterial(1, 1, 1);
    return this.bridgeForeMat;
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    this.time += dt;
    this.uTime.value = this.time;
    camera.getWorldPosition(this.uCameraPos.value);
  }

  dispose() {
    this.bridgeForeMat?.dispose();
    this.bridgeForeMat = null;
  }
}
