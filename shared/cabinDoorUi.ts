import type { Job } from './protocol';

export type CabinKeypadMode = 'set' | 'enter' | 'change' | 'locked';

/**
 * What a keypad does when used. The code is set once per ship: before that the Captain gets `set` and everyone else
 * `locked`; after that every keypad on either side is `enter` (type the code, the door opens). Changing the code is a
 * separate action the Captain can pick from the `enter` screen (see `canChangeCabinCode`), never the default, so
 * leaving the cabin never asks for a new code.
 */
export function cabinKeypadUiMode(codeSet: boolean, job: Job | null): Exclude<CabinKeypadMode, 'change'> {
  if (!codeSet) return job === 'Captain' ? 'set' : 'locked';
  return 'enter';
}

export function canChangeCabinCode(codeSet: boolean, job: Job | null): boolean {
  return codeSet && job === 'Captain';
}

export function cabinKeypadHoverPrompt(codeSet: boolean, job: Job | null): string {
  const mode = cabinKeypadUiMode(codeSet, job);
  if (mode === 'set') return 'Set cabin code';
  if (mode === 'locked') return 'Use cabin keypad';
  return 'Enter cabin code';
}
