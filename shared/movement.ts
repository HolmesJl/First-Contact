/** Movement speeds and the sprint stamina rule, shared by the client (prediction, HUD bar) and the server (cap). */

/** Metres per second. */
export const WALK_SPEED = 2.2;
export const JOG_SPEED = 3.5;
export const SPRINT_SPEED = 4.8;

/** Seconds of sprint from a full bar. */
export const SPRINT_SECONDS = 3;
/** Seconds to refill an empty bar. */
export const STAMINA_REFILL_SECONDS = 6;
/** After running dry, sprint is locked until the bar has refilled to this fraction. */
export const SPRINT_RESUME_AT = 0.25;

export type Gait = 'walk' | 'jog' | 'sprint';

/** Gait a remote player is in, from the speed observed between snapshots. */
export function gaitFromSpeed(speed: number): Gait {
  if (speed < (WALK_SPEED + JOG_SPEED) / 2) return 'walk';
  if (speed < (JOG_SPEED + SPRINT_SPEED) / 2) return 'jog';
  return 'sprint';
}

/** Local stamina bar (0..1). */
export class Stamina {
  value = 1;
  private locked = false;

  /** Advance by dt. Returns true if the player may sprint this frame (wants to, and has stamina). */
  update(dt: number, wantsSprint: boolean): boolean {
    if (this.locked && this.value >= SPRINT_RESUME_AT) this.locked = false;
    const sprinting = wantsSprint && !this.locked && this.value > 0;
    if (sprinting) {
      this.value = Math.max(0, this.value - dt / SPRINT_SECONDS);
      if (this.value === 0) this.locked = true;
    } else {
      this.value = Math.min(1, this.value + dt / STAMINA_REFILL_SECONDS);
    }
    return sprinting;
  }

  get exhausted() {
    return this.locked;
  }
}

/**
 * Server-side movement cap. Clients report positions at about 15 Hz; the budget is a token bucket so network jitter
 * never clips an honest client, while a hacked one cannot beat jog speed except for the stamina-limited sprint burst.
 */
export class MoveBudget {
  private base = 1;
  private extra = SPRINT_EXTRA_CAPACITY;
  private last = 0;

  constructor(now: number) {
    this.last = now;
  }

  /** Returns the fraction (0..1) of the requested step the player may take. `dist` is in metres, `now` in seconds. */
  take(dist: number, now: number): number {
    const dt = Math.min(1.5, Math.max(0, now - this.last));
    this.last = now;
    this.base = Math.min(BASE_CAPACITY, this.base + dt * JOG_SPEED * TOLERANCE);
    this.extra = Math.min(SPRINT_EXTRA_CAPACITY, this.extra + (dt * SPRINT_EXTRA_CAPACITY) / STAMINA_REFILL_SECONDS);
    if (dist <= 1e-6) return 1;
    // One message can never move further than a bit over 0.4 s of sprinting, whatever the budget holds.
    const want = Math.min(dist, MAX_STEP);
    let granted = Math.min(want, this.base);
    this.base -= granted;
    const need = want - granted;
    if (need > 0) {
      const more = Math.min(need, this.extra);
      this.extra -= more;
      granted += more;
    }
    return granted / dist;
  }
}

const TOLERANCE = 1.12;
const MAX_STEP = SPRINT_SPEED * 0.4;
const BASE_CAPACITY = 1.0;
/** Extra metres a full stamina bar buys over jogging: (sprint - jog) * seconds. */
const SPRINT_EXTRA_CAPACITY = (SPRINT_SPEED - JOG_SPEED) * SPRINT_SECONDS * TOLERANCE + 0.6;
