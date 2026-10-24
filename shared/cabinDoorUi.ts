import { CABIN_KEYPAD_IN_INTERACT_ID, type CabinKeypadId } from './cabinDoor';
import type { Job } from './protocol';

export type CabinKeypadMode = 'set' | 'enter' | 'change' | 'locked';

/**
 * Corridor keypad: set once (Captain, no code yet), then enter code to open. Inside keypad never uses this — it opens
 * the door with one click (`exit` action, no UI).
 */
export function cabinKeypadUiMode(codeSet: boolean, job: Job | null): Exclude<CabinKeypadMode, 'change'> {
  if (!codeSet) return job === 'Captain' ? 'set' : 'locked';
  return 'enter';
}

export function canChangeCabinCode(codeSet: boolean, job: Job | null): boolean {
  return codeSet && job === 'Captain';
}

export function cabinKeypadHoverPrompt(keypad: CabinKeypadId, codeSet: boolean, job: Job | null): string {
  if (keypad === CABIN_KEYPAD_IN_INTERACT_ID) return 'Open cabin door';
  const mode = cabinKeypadUiMode(codeSet, job);
  if (mode === 'set') return 'Set cabin code';
  if (mode === 'locked') return 'Use cabin keypad';
  return 'Enter cabin code';
}
