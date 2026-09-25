import { TIMER_GRACE_MS } from '../constants.js';

/**
 * Schedules `fn` after `ms` (+ a small grace so Discord's countdown reaches 0
 * first). `guard()` is re-checked when the timer fires so stale timers whose
 * state moved on (a guess landed, the round ended, the player forfeited) do
 * nothing.
 */
export function scheduleGuarded(ms, guard, fn) {
  return setTimeout(() => {
    try {
      if (guard()) fn();
    } catch (err) {
      console.error('timer callback failed:', err);
    }
  }, Math.max(0, ms) + TIMER_GRACE_MS);
}

export function clearTimer(holder, prop = 'timer') {
  if (holder?.[prop]) {
    clearTimeout(holder[prop]);
    holder[prop] = null;
  }
}
