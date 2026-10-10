import type { Job } from './protocol';

export function cabinKeypadUiMode(codeSet: boolean, job: Job | null, inCabin: boolean): 'set' | 'enter' | 'change' | 'locked' {
  if (!codeSet) return job === 'Captain' ? 'set' : 'locked';
  if (job === 'Captain' && inCabin) return 'change';
  return 'enter';
}

export function cabinKeypadHoverPrompt(codeSet: boolean, job: Job | null, inCabin: boolean): string {
  const mode = cabinKeypadUiMode(codeSet, job, inCabin);
  if (mode === 'set') return 'Set cabin code';
  if (mode === 'change') return 'Change cabin code';
  if (mode === 'locked') return 'Use cabin keypad';
  return 'Enter cabin code';
}
