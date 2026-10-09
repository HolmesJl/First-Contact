import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { JOG_SPEED, SPRINT_SPEED, WALK_SPEED } from '../../../shared/movement';
import type { Sex } from '../../../shared/protocol';

/**
 * Locomotion for the Quaternius characters: gendered ACCAD motion-capture clips (tools/build-character-clips.mjs
 * writes clips-<sex>.glb and motion.json), applied to body-<sex>.glb by bone name. The clip is chosen from the
 * ground speed (idle, walk, jog, sprint) and played at the speed that makes the feet track the ground, then
 * cross-faded when the gait changes.
 */

export type Gait = 'idle' | 'walk' | 'jog' | 'sprint';
const MOVING_GAITS = ['walk', 'jog', 'sprint'] as const;

/** Gait boundaries sit halfway between the game's movement speeds (same rule as gaitFromSpeed). */
const WALK_JOG = (WALK_SPEED + JOG_SPEED) / 2;
const JOG_SPRINT = (JOG_SPEED + SPRINT_SPEED) / 2;
const HYSTERESIS = 0.25;

/** Playback speed limits per gait, so a clip is never stretched into something that no longer reads as that gait. */
const RATE: Record<(typeof MOVING_GAITS)[number], [number, number]> = { walk: [0.55, 1.75], jog: [0.75, 1.3], sprint: [0.85, 1.25] };
const FADE = 0.25;

interface SexMotion {
  clips: Record<Gait, THREE.AnimationClip>;
  /** Ground speed (m/s) the clip covers at 1x. */
  ground: Record<Gait, number>;
}

let motion: Record<Sex, SexMotion> | null = null;

export async function loadMotion(base: string) {
  const loader = new GLTFLoader();
  const info = (await (await fetch(`${base}motion.json`)).json()) as Record<Sex, Record<Gait, { groundSpeed: number }>>;
  const load = async (sex: Sex): Promise<SexMotion> => {
    const gltf = await loader.loadAsync(`${base}clips-${sex}.glb`);
    const clips = {} as Record<Gait, THREE.AnimationClip>;
    const ground = {} as Record<Gait, number>;
    for (const g of ['idle', ...MOVING_GAITS] as const) {
      const clip = gltf.animations.find((a) => a.name === g);
      if (!clip) throw new Error(`${sex}: missing clip ${g}`);
      clips[g] = clip;
      ground[g] = info[sex][g].groundSpeed;
    }
    return { clips, ground };
  };
  const [male, female] = await Promise.all([load('male'), load('female')]);
  motion = { male, female };
}

export interface Motion {
  gait: Gait;
  actions: Record<Gait, THREE.AnimationAction>;
  ground: Record<Gait, number>;
  /** Smoothed ground speed (remote players only report positions, so their speed is noisy). */
  speed: number;
}

export function createMotion(mixer: THREE.AnimationMixer, sex: Sex): Motion {
  if (!motion) throw new Error('loadMotion() must resolve before building rigs');
  const m = motion[sex];
  const actions = {} as Record<Gait, THREE.AnimationAction>;
  for (const g of Object.keys(m.clips) as Gait[]) actions[g] = mixer.clipAction(m.clips[g]);
  actions.idle.time = Math.random() * m.clips.idle.duration;
  actions.idle.play();
  return { gait: 'idle', actions, ground: m.ground, speed: 0 };
}

export function gaitForSpeed(speed: number, current: Gait): Gait {
  const h = HYSTERESIS;
  const walkJog = current === 'walk' ? WALK_JOG + h : current === 'idle' ? WALK_JOG : WALK_JOG - h;
  const jogSprint = current === 'sprint' ? JOG_SPRINT - h : JOG_SPRINT + (current === 'jog' ? h : 0);
  if (speed < walkJog) return 'walk';
  return speed < jogSprint ? 'jog' : 'sprint';
}

/** speed: ground speed in m/s, only used while `moving`. */
export function updateMotion(m: Motion, dt: number, moving: boolean, speed: number) {
  m.speed += (speed - m.speed) * (1 - Math.exp(-10 * dt));
  if (m.speed < 0.3 && moving) m.speed = Math.max(m.speed, speed);
  const target: Gait = moving ? gaitForSpeed(m.speed, m.gait) : 'idle';
  if (target !== m.gait) {
    const prev = m.actions[m.gait];
    const next = m.actions[target];
    next.reset();
    // Moving to moving: keep the stride phase so the feet do not jump.
    if (m.gait !== 'idle' && target !== 'idle') next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    next.play();
    prev.crossFadeTo(next, FADE, false);
    m.gait = target;
  }
  if (m.gait !== 'idle') {
    const [lo, hi] = RATE[m.gait];
    m.actions[m.gait].timeScale = Math.min(hi, Math.max(lo, m.speed / m.ground[m.gait]));
  }
}

export function setIdleRate(m: Motion, rate: number) {
  m.actions.idle.timeScale = rate;
}
