/** Game-scale light years: 1 LY = this many kilometres (abstract, not physical). */
export const KM_PER_LIGHT_YEAR = 1_000_000;

export const APPROACH_DISTANCE_KM = 20;
export const SCAN_DISTANCE_CAP_LY = 5.0;
export const SCAN_DISTANCE_CAP_KM = SCAN_DISTANCE_CAP_LY * KM_PER_LIGHT_YEAR;

export type ShipMotionState = 'still' | 'warp' | 'f-warp';
export type WarpMode = 'warp' | 'f-warp';

export const WARP_MS_PER_LY = 2 * 60 * 1000;
export const F_WARP_MS_PER_LY = 30 * 1000;

export const HELM_INTERACT_ID = 'star-map';
export const BRIDGE_HELM_STAND = { x: -38.2, z: 34.4 };

/** Primary end-goal row on the helm console (not a scan contact). */
export const FIRST_CONTACT_DESTINATION_ID = 'first-contact';
export const FIRST_CONTACT_DISPLAY_NAME = 'First Contact';
export const FIRST_CONTACT_DISTANCE_LABEL = 'Unknown';
/** Flavor coords for the seed-ship’s open voyage (not tied to real astrometry). */
export const FIRST_CONTACT_COORDINATES = 'FC-VECTOR 7.2 / −1.4 / 0.0';

export interface ShipScanTransit {
  scanId: string;
  mode: WarpMode;
  startedAt: number;
  endsAt: number;
}

export interface ShipNavigation {
  motion: ShipMotionState;
  /** Open cruise toward First Contact (no timer; ends when Captain diverts). */
  firstContactCourse: boolean;
  /** Warp mode while on {@link firstContactCourse}. */
  cruiseMode: WarpMode;
  /** Timed divert to a scan contact only. */
  transit: ShipScanTransit | null;
}

export function defaultNavigation(): ShipNavigation {
  return { motion: 'still', firstContactCourse: false, cruiseMode: 'warp', transit: null };
}

export function syncNavigationMotion(nav: ShipNavigation) {
  if (nav.transit) nav.motion = motionForMode(nav.transit.mode);
  else if (nav.firstContactCourse) nav.motion = motionForMode(nav.cruiseMode);
  else nav.motion = 'still';
}

export function normalizeNavigation(raw: unknown): ShipNavigation {
  if (!raw || typeof raw !== 'object') return defaultNavigation();
  const r = raw as Record<string, unknown>;
  const firstContactCourse = r.firstContactCourse === true;
  let cruiseMode: WarpMode = r.cruiseMode === 'f-warp' ? 'f-warp' : 'warp';
  let transit: ShipScanTransit | null = null;
  if (r.transit && typeof r.transit === 'object') {
    const t = r.transit as Record<string, unknown>;
    if (
      typeof t.scanId === 'string' &&
      (t.mode === 'warp' || t.mode === 'f-warp') &&
      typeof t.startedAt === 'number' &&
      typeof t.endsAt === 'number' &&
      t.endsAt > t.startedAt
    ) {
      transit = { scanId: t.scanId, mode: t.mode, startedAt: t.startedAt, endsAt: t.endsAt };
    }
  }
  const nav: ShipNavigation = { motion: 'still', firstContactCourse, cruiseMode, transit };
  syncNavigationMotion(nav);
  return nav;
}

/** Parse scan distance labels (`<20 km`, `142 km`, `0.4 LY`, `5.0 LY`). */
export function parseDistanceKm(label: string): number | null {
  const s = label.trim();
  const lt = s.match(/^<\s*(\d+(?:\.\d+)?)\s*km$/i);
  if (lt) return Math.max(0, Number(lt[1]) - 0.001);
  const km = s.match(/^(\d+(?:\.\d+)?)\s*km$/i);
  if (km) return Number(km[1]);
  const ly = s.match(/^(\d+(?:\.\d+)?)\s*LY$/i);
  if (ly) return Number(ly[1]) * KM_PER_LIGHT_YEAR;
  return null;
}

export function formatDistanceKm(km: number): string {
  if (km < APPROACH_DISTANCE_KM) return `<${APPROACH_DISTANCE_KM} km`;
  const ly = km / KM_PER_LIGHT_YEAR;
  if (ly >= 0.01) {
    const rounded = ly >= 10 ? ly.toFixed(0) : ly >= 1 ? ly.toFixed(1) : ly.toFixed(2);
    return `${rounded} LY`;
  }
  const k = km >= 1000 ? Math.round(km).toString() : km >= 100 ? km.toFixed(0) : km.toFixed(1);
  return `${k} km`;
}

export function distanceNeedsTransit(label: string): boolean {
  const km = parseDistanceKm(label);
  return km !== null && km > APPROACH_DISTANCE_KM;
}

export function warpDurationMs(distanceKm: number, mode: WarpMode): number {
  const ly = Math.max(0, distanceKm) / KM_PER_LIGHT_YEAR;
  const rate = mode === 'f-warp' ? F_WARP_MS_PER_LY : WARP_MS_PER_LY;
  return Math.max(500, Math.round(ly * rate));
}

export function formatEta(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function motionForMode(mode: WarpMode): ShipMotionState {
  return mode;
}
