/**
 * Poople word data. Every accepted step comes from ENABLE (data/poople-allowed.txt);
 * start words come from the everyday list (data/poople-starts.txt). At load time a
 * breadth-first search from the target gives every word's shortest distance to it,
 * which is the par shown to players.
 */
import { randomInt } from 'node:crypto';
import { loadList } from './words.js';
import { POOPLE_TARGET, POOPLE_LEN, POOPLE_PAR_MIN, POOPLE_PAR_MAX, LETTERS } from '../constants.js';

const RE = new RegExp(`^[a-z]{${POOPLE_LEN}}$`);

/** Every word accepted as a step. */
export const ALLOWED4 = new Set([...loadList('../../data/poople-allowed.txt', RE), POOPLE_TARGET]);

/** Everyday words; used for start words and preferred when revealing a path. */
const EVERYDAY = new Set(loadList('../../data/poople-starts.txt', RE).filter((w) => ALLOWED4.has(w)));

/** Words exactly one letter away from `word` that are in ALLOWED4. */
export function neighbours(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    for (const ch of LETTERS) {
      if (ch === word[i]) continue;
      const w = word.slice(0, i) + ch + word.slice(i + 1);
      if (ALLOWED4.has(w)) out.push(w);
    }
  }
  return out;
}

/** word → fewest steps to the target. Words that cannot reach it are absent. */
const DIST = new Map([[POOPLE_TARGET, 0]]);
{
  const queue = [POOPLE_TARGET];
  for (let i = 0; i < queue.length; i++) {
    const w = queue[i];
    for (const n of neighbours(w)) {
      if (DIST.has(n)) continue;
      DIST.set(n, DIST.get(w) + 1);
      queue.push(n);
    }
  }
}

/** Start-word pool: everyday words whose par is within range. */
export const START_POOL = Object.freeze(
  [...EVERYDAY].filter((w) => {
    const d = DIST.get(w);
    return d !== undefined && d >= POOPLE_PAR_MIN && d <= POOPLE_PAR_MAX;
  }),
);

if (START_POOL.length === 0) {
  throw new Error('No Poople start words. Run `npm run words` first.');
}

export function isPoopleWord(word) {
  return ALLOWED4.has(word);
}

/** True when `a` and `b` have the same length and differ in exactly one position. */
export function oneLetterApart(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return diff === 1;
}

/** Fewest steps from `word` to the target, or null if it cannot get there. */
export function distanceToPoop(word) {
  return DIST.get(word) ?? null;
}

/** Random start word not in `exclude`; same fallback rules as pickSecret. */
export function pickStart(exclude = new Set()) {
  for (let i = 0; i < 50; i++) {
    const w = START_POOL[randomInt(START_POOL.length)];
    if (!exclude.has(w)) return w;
  }
  const remaining = START_POOL.filter((w) => !exclude.has(w));
  return remaining.length ? remaining[randomInt(remaining.length)] : START_POOL[randomInt(START_POOL.length)];
}

/**
 * One shortest path from `start` to the target (inclusive of both ends),
 * preferring everyday words whenever there is a choice. Null if unreachable.
 */
export function optimalPath(start) {
  if (!DIST.has(start)) return null;
  // Fewest non-everyday words on a shortest path from each word, filled lazily.
  const cost = new Map([[POOPLE_TARGET, 0]]);
  const costOf = (w) => {
    if (cost.has(w)) return cost.get(w);
    const d = DIST.get(w);
    let best = Infinity;
    for (const n of neighbours(w)) {
      if (DIST.get(n) === d - 1) best = Math.min(best, costOf(n) + (EVERYDAY.has(n) || n === POOPLE_TARGET ? 0 : 1));
    }
    cost.set(w, best);
    return best;
  };

  const path = [start];
  let w = start;
  while (w !== POOPLE_TARGET) {
    const d = DIST.get(w);
    let pick = null;
    let pickCost = Infinity;
    for (const n of neighbours(w)) {
      if (DIST.get(n) !== d - 1) continue;
      const c = costOf(n) + (EVERYDAY.has(n) || n === POOPLE_TARGET ? 0 : 1);
      if (c < pickCost) {
        pick = n;
        pickCost = c;
      }
    }
    path.push(pick);
    w = pick;
  }
  return path;
}
