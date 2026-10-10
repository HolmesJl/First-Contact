/**
 * Third-person controls (classic MMO style, no pointer lock; the cursor stays free and visible).
 *
 *   W/S            forward / back, along the character's facing
 *   A/D            strafe left / right (facing is unchanged)
 *   Shift, C       sprint (stamina) / toggle walk, handled by the scene from `sample()` and `walkMode`
 *   right-drag     turns the character; the camera stays behind it
 *   left-drag      orbits the camera around the character without turning it, then eases back behind on release
 *   wheel          zoom
 *
 * State machine, all of it in this file:
 *   down        pressed keys, by KeyboardEvent.code
 *   drag        { button, id, lastX, lastY } | null, one drag at a time (steer = 2, orbit = 0)
 *   facing      where the character looks (the only thing the server and other players see)
 *   orbitOffset camera yaw relative to "behind the character" (0 = behind); never touches facing
 *   pitch/dist  camera elevation and zoom
 *   ret         the return tween that eases orbitOffset (and pitch) back to 0 / default
 *
 * The camera yaw is always `cameraYaw(facing, orbitOffset)` and "behind" is defined once, in `behindYaw()`.
 */
import { axesFromKeys, behindYaw, cameraYaw, moveVector, returnOffset, smoothstep, wrapAngle } from './controlMath';

export const DEFAULT_PITCH = 0.34;
const MIN_PITCH = 0.12;
const MAX_PITCH = 1.2;
const MIN_DIST = 2.2;
const MAX_DIST = 9;
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.004;
/** Seconds for the camera to ease back behind the character after a left-drag. */
export const RETURN_SMOOTH_S = 0.4;
/** Same, when the player starts moving (or right-steers) while the camera is off to the side. */
export const RETURN_FAST_S = 0.15;
const EPS = 0.004;

const SHIFT_CODES = ['ShiftLeft', 'ShiftRight'];
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Keys the browser would otherwise use to scroll, move focus or open quick-find while playing. */
const BROWSER_KEYS = new Set(['Space', 'Tab', 'Slash', 'Quote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface ControlsHooks {
  /** Controls only react while this is true (the walkable scene is showing). */
  isActive(): boolean;
  /** Input was cut off (blur, tab hidden): the scene should tell the server we stopped, right now. */
  onStop(): void;
}

export interface MoveSample {
  /** World-space ground direction, length 0..1. */
  x: number;
  z: number;
  mag: number;
  wantsSprint: boolean;
  /** Touch stick pushed gently: walk rather than jog. */
  analogWalk: boolean;
}

interface Drag {
  button: 0 | 2;
  id: number;
  lastX: number;
  lastY: number;
}

interface Return {
  from: number;
  fromPitch: number;
  t: number;
  dur: number;
}

function isTextTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export class Controls {
  facing = 0;
  orbitOffset = 0;
  pitch = DEFAULT_PITCH;
  dist = 3.9;
  walkMode = false;

  private down = new Set<string>();
  private drag: Drag | null = null;
  private ret: Return | null = null;
  private joy = { x: 0, y: 0 };
  private menuBlockedUntil = 0;
  private off: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: ControlsHooks,
  ) {
    this.bind();
  }

  get camYaw() {
    return cameraYaw(this.facing, this.orbitOffset);
  }

  /** 'steer' while right-dragging, 'orbit' while left-dragging. */
  get dragging(): 'steer' | 'orbit' | null {
    return this.drag ? (this.drag.button === 2 ? 'steer' : 'orbit') : null;
  }

  /** Start (or restart) walking mode with the camera directly behind `facing`. */
  reset(facing: number) {
    this.facing = wrapAngle(facing);
    this.orbitOffset = 0;
    this.pitch = DEFAULT_PITCH;
    this.ret = null;
    this.drag = null;
    this.down.clear();
    this.joy.x = this.joy.y = 0;
  }

  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }

  /** Forget every held key and drag. */
  clear(notify = true) {
    const hadKeys = this.down.size > 0 || Math.hypot(this.joy.x, this.joy.y) > 0;
    this.down.clear();
    this.joy.x = this.joy.y = 0;
    this.endDrag(false);
    if (notify && hadKeys) this.hooks.onStop();
  }

  hasMoveInput() {
    return this.keyboardMoving() || this.joyMoving();
  }

  /** Advance the camera return tween, and cut an orbit short when the player starts moving. Call once per frame. */
  update(dt: number) {
    if (this.keyboardMoving() && (this.drag?.button === 0 || this.orbitActive()) && !(this.ret && this.ret.dur <= RETURN_FAST_S)) {
      if (this.drag?.button === 0) this.drag = null;
      this.startReturn(RETURN_FAST_S);
    }
    const r = this.ret;
    if (!r) return;
    r.t += dt;
    if (r.t >= r.dur) {
      this.orbitOffset = 0;
      this.pitch = DEFAULT_PITCH;
      this.ret = null;
      return;
    }
    this.orbitOffset = returnOffset(r.from, r.t, r.dur);
    this.pitch = r.fromPitch + (DEFAULT_PITCH - r.fromPitch) * smoothstep(r.t / r.dur);
  }

  /** Movement intent for this frame. Keys move relative to the facing; the touch stick moves relative to the camera. */
  sample(): MoveSample {
    const a = axesFromKeys(this.down);
    const wantsSprint = SHIFT_CODES.some((c) => this.down.has(c));
    if (a.x !== 0 || a.y !== 0) {
      const v = moveVector(a.x, a.y, this.facing);
      return { x: v.x, z: v.z, mag: v.mag, wantsSprint, analogWalk: false };
    }
    if (this.joyMoving()) {
      const yaw = this.camYaw;
      const v = moveVector(this.joy.x, this.joy.y, behindYaw(yaw));
      if (v.mag > 0.1) this.setFacingKeepingCamera(Math.atan2(v.x, v.z), yaw);
      return { x: v.x, z: v.z, mag: v.mag, wantsSprint, analogWalk: v.mag < 0.55 };
    }
    return { x: 0, z: 0, mag: 0, wantsSprint, analogWalk: false };
  }

  dispose() {
    this.clear(false);
    this.off.forEach((f) => f());
    this.off.length = 0;
  }

  // ---- internals ----

  private keyboardMoving() {
    const a = axesFromKeys(this.down);
    return a.x !== 0 || a.y !== 0;
  }

  private joyMoving() {
    return Math.hypot(this.joy.x, this.joy.y) > 0.08;
  }

  private orbitActive() {
    return Math.abs(this.orbitOffset) > EPS || Math.abs(this.pitch - DEFAULT_PITCH) > EPS;
  }

  private setFacingKeepingCamera(next: number, yaw: number) {
    this.facing = wrapAngle(next);
    this.orbitOffset = wrapAngle(yaw - behindYaw(this.facing));
  }

  private startReturn(dur: number) {
    if (!this.orbitActive()) {
      this.orbitOffset = 0;
      this.pitch = DEFAULT_PITCH;
      this.ret = null;
      return;
    }
    if (this.ret && this.ret.dur <= dur) return;
    this.ret = { from: wrapAngle(this.orbitOffset), fromPitch: this.pitch, t: 0, dur };
  }

  private endDrag(returnCamera: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.button === 2) this.menuBlockedUntil = performance.now() + 100;
    try {
      this.canvas.releasePointerCapture(d.id);
    } catch {
      /* already released */
    }
    if (returnCamera && d.button === 0) this.startReturn(this.keyboardMoving() ? RETURN_FAST_S : RETURN_SMOOTH_S);
  }

  private bind() {
    const on = <T extends EventTarget>(t: T, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const canvas = this.canvas;

    // Shift can be released while focus is elsewhere (alt-tab, devtools); any later event with shiftKey=false fixes it.
    const syncShift = (e: { shiftKey: boolean }) => {
      if (!e.shiftKey) for (const c of SHIFT_CODES) this.down.delete(c);
    };

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.hooks.isActive() || isTextTarget(e.target)) return;
      syncShift(e);
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && (BROWSER_KEYS.has(e.code) || MOVE_CODES.has(e.code))) e.preventDefault();
      if (mod) return;
      if (e.code === 'KeyC' && !e.repeat) this.walkMode = !this.walkMode;
      if (MOVE_CODES.has(e.code) || SHIFT_CODES.includes(e.code)) this.down.add(e.code);
    });

    on(window, 'keyup', (e: KeyboardEvent) => {
      const wasMove = MOVE_CODES.has(e.code) && this.down.delete(e.code);
      this.down.delete(e.code);
      syncShift(e);
      if (wasMove && !this.hasMoveInput() && this.hooks.isActive()) this.hooks.onStop();
    });

    const stop = () => this.clear(true);
    on(window, 'blur', stop);
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop();
    });

    on(
      document,
      'contextmenu',
      (e: MouseEvent) => {
        if (!this.hooks.isActive()) return;
        if (e.target === canvas || this.drag?.button === 2 || performance.now() < this.menuBlockedUntil) e.preventDefault();
      },
      { capture: true },
    );

    on(canvas, 'pointerdown', (e: PointerEvent) => {
      if (!this.hooks.isActive()) return;
      syncShift(e);
      if ((e.button !== 0 && e.button !== 2) || this.drag) return;
      this.drag = { button: e.button, id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already-gone pointer */
      }
      if (e.button === 0) this.ret = null;
      else this.startReturn(RETURN_FAST_S);
    });

    on(canvas, 'pointermove', (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (e.buttons === 0) return this.endDrag(true);
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (d.button === 2) {
        this.facing = wrapAngle(this.facing - dx * YAW_PER_PX);
      } else {
        this.orbitOffset = wrapAngle(this.orbitOffset - dx * YAW_PER_PX);
        this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * PITCH_PER_PX));
      }
    });

    const up = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.endDrag(true);
    };
    on(canvas, 'pointerup', up);
    on(canvas, 'pointercancel', up);
    on(canvas, 'lostpointercapture', up);

    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (e.button === 1 && this.hooks.isActive()) e.preventDefault();
    });

    on(
      canvas,
      'wheel',
      (e: WheelEvent) => {
        if (!this.hooks.isActive()) return;
        e.preventDefault();
        this.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.dist + Math.sign(e.deltaY) * 0.5));
      },
      { passive: false },
    );
  }
}
