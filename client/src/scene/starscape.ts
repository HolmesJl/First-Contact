import * as THREE from 'three';
import type { ShipMotionState } from '../../../shared/navigation';

/** Seed ship heading in world space (+Z = bridge forward). */
export const SHIP_FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * Star density knobs (shader uniforms). Higher `keep` = sparser field.
 * Tuned against `media/starscape-still-reference.png` in the project store.
 * @see docs/starscape-tuning.md
 */
export const STARSCAPE_TUNING = {
  /** Primary catalog grid (one star candidate per cell). */
  cell: 4.6,
  keep: 0.868,
  /** Distant smaller layer. */
  cellFar: 9.2,
  keepFar: 0.904,
  /** Hash above this → hero star (halo + 4-point spikes). */
  heroThreshold: 0.94,
  /** Brightness cap for hero cores. */
  brightGain: 1.95,
  /** Multiplier on lit pixels only (gaps stay black). */
  starGain: 1.88,
};

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
  uniform float uStarCell;
  uniform float uStarKeep;
  uniform float uStarCellFar;
  uniform float uStarKeepFar;
  uniform float uHeroThreshold;
  uniform float uBrightGain;
  uniform float uStarGain;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 starAt(vec3 p, float cell, float keep, float layerGain) {
    vec3 id = floor(p * cell);
    float h = hash31(id);
    if (h < keep) return vec3(0.0);

    vec3 f = fract(p * cell) - 0.5;
    vec2 jitter = vec2(hash31(id + 1.7), hash31(id + 2.3)) - 0.5;
    jitter *= 0.74;
    vec2 d = (f.xy - jitter) * 2.2;

    float mag = hash31(id + 4.1);
    float dist = length(d);

    float radius;
    float peak;
    if (mag >= uHeroThreshold) {
      radius = 0.028;
      peak = uBrightGain;
    } else if (mag > 0.76) {
      radius = 0.011 + (mag - 0.76) * 0.02;
      peak = 0.43 + (mag - 0.76) * 1.68;
    } else {
      radius = 0.004 + mag * 0.005;
      peak = 0.098 + mag * 0.217;
    }

    float core = smoothstep(radius, radius * 0.1, dist);
    float lum = core * peak;

    if (mag >= uHeroThreshold) {
      float halo = exp(-dist * dist / (radius * radius * 4.5)) * 0.5;
      vec2 sp = d / max(radius, 0.001);
      float spike = (exp(-abs(sp.x) * 10.0) + exp(-abs(sp.y) * 10.0)) * exp(-length(sp) * 0.5) * 0.78;
      lum += halo + spike;
    }

    if (lum < 0.002) return vec3(0.0);

    float tw = 0.84 + 0.16 * sin(uTime * (0.45 + mag * 1.4) + h * 11.0);
    return vec3(lum * tw * layerGain * uStarGain);
  }

  vec3 stampStars(vec3 p, float cellMul, float keepDelta) {
    float cellN = uStarCell * cellMul;
    float cellF = uStarCellFar * cellMul;
    float keepN = clamp(uStarKeep + keepDelta, 0.82, 0.985);
    float keepF = clamp(uStarKeepFar + keepDelta * 0.7, 0.86, 0.99);
    vec3 near = starAt(p, cellN, keepN, 1.0);
    vec3 far = starAt(p * 1.03 + 0.35, cellF, keepF, 0.62);
    return max(near, far);
  }

  // Fly-through: advect along the view ray (stars rush toward camera ahead, sparse on the sides).
  vec3 sampleField(vec3 ray, float forward, float flyDist, float streakLen) {
    float cellMul = 1.0 / (1.0 + forward * streakLen * 0.62);
    float keepDelta = -forward * streakLen * 0.055;
    float depth = 112.0 / (1.0 + forward * streakLen * 0.28);
    vec3 anchor = ray * depth - ray * flyDist;
    vec3 col = stampStars(anchor, cellMul, keepDelta);
    if (uStreak > 0.08) {
      col = max(col, stampStars(anchor - ray * (streakLen * 1.1), cellMul, keepDelta));
      col = max(col, stampStars(anchor - ray * (streakLen * 2.5), cellMul, keepDelta));
      col = max(col, stampStars(anchor - ray * (streakLen * 4.2), cellMul, keepDelta));
      col = max(col, stampStars(anchor - ray * (streakLen * 6.5), cellMul, keepDelta));
    }
    return col;
  }

  void main() {
    vec3 ray = normalize(vWorldPos - uCameraPos);
    if (uPanorama > 0.5) {
      float az = (vUv.x - 0.5) * 1.75;
      float el = (vUv.y - 0.46) * 0.78;
      vec3 pano = normalize(vec3(sin(az), el, cos(az) + 0.35));
      ray = normalize(mix(ray, pano, 0.9));
    }
    float forward = max(dot(ray, uShipForward), 0.0);
    float flyDist = uStreak > 0.001 ? uTime * uScroll * (0.2 + forward * 1.25) : 0.0;
    float streakLen = uStreak * (0.35 + 0.65 * forward);

    vec3 col = sampleField(ray, forward, flyDist, streakLen);
    col *= 1.0 + uStreak * forward * 0.42;

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
      float scan = 0.99 + 0.01 * sin(uv.y * 380.0 + uTime * 1.8);
      float vignette = 1.0 - 0.18 * length((uv - 0.5) * vec2(1.0, 1.06));
      col = col * edge * scan * vignette;
      alpha = uOpacity * edge;
      float gloss = pow(1.0 - abs(uv.y - 0.18), 3.0) * 0.035;
      col += vec3(1.0) * gloss * edge;
    } else {
      float lum = max(col.r, max(col.g, col.b));
      alpha = uOpacity * mix(0.9, 1.0, smoothstep(0.0, 0.2, lum));
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

type UniformNum = { value: number };
type UniformVec3 = { value: THREE.Vector3 };

/**
 * Procedural exterior field for interior glass: sparse 3D star catalog advected along ship forward.
 * Bridge fore uses panorama UVs so the nose reads as one wide monitor.
 */
export class StarscapeRenderer {
  private readonly uTime: UniformNum = { value: 0 };
  private readonly uScroll: UniformNum = { value: 0.12 };
  private readonly uStreak: UniformNum = { value: 0 };
  private readonly uCameraPos: UniformVec3 = { value: new THREE.Vector3() };
  private readonly uShipForward: UniformVec3 = { value: SHIP_FORWARD.clone() };
  private readonly uPanorama: UniformNum = { value: 0 };
  private readonly uStarCell: UniformNum = { value: STARSCAPE_TUNING.cell };
  private readonly uStarKeep: UniformNum = { value: STARSCAPE_TUNING.keep };
  private readonly uStarCellFar: UniformNum = { value: STARSCAPE_TUNING.cellFar };
  private readonly uStarKeepFar: UniformNum = { value: STARSCAPE_TUNING.keepFar };
  private readonly uHeroThreshold: UniformNum = { value: STARSCAPE_TUNING.heroThreshold };
  private readonly uBrightGain: UniformNum = { value: STARSCAPE_TUNING.brightGain };
  private readonly uStarGain: UniformNum = { value: STARSCAPE_TUNING.starGain };
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
      this.uScroll.value = 6.5;
      this.uStreak.value = 0.29;
    } else {
      this.uScroll.value = 0.02;
      this.uStreak.value = 0;
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
      uStarCell: this.uStarCell,
      uStarKeep: this.uStarKeep,
      uStarCellFar: this.uStarCellFar,
      uStarKeepFar: this.uStarKeepFar,
      uHeroThreshold: this.uHeroThreshold,
      uBrightGain: this.uBrightGain,
      uStarGain: this.uStarGain,
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
