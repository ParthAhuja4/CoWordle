import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { WORD_LEN } from '../constants.js';

const WORD_RE = new RegExp(`^[a-z]{${WORD_LEN}}$`);

function loadList(relPath) {
  const text = readFileSync(new URL(relPath, import.meta.url), 'utf8');
  return text
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => WORD_RE.test(w));
}

/** Secret-word pool. */
export const ANSWERS = Object.freeze([...new Set(loadList('../../data/answers.txt'))]);

/** Every word accepted as a guess (answers ∪ extra allowed). */
export const ALLOWED = new Set([...ANSWERS, ...loadList('../../data/allowed.txt')]);

if (ANSWERS.length === 0) {
  throw new Error('data/answers.txt is empty. Run `npm run words` first.');
}

export function normalizeWord(input) {
  return String(input ?? '').trim().toLowerCase();
}

export function isWellFormed(word) {
  return WORD_RE.test(word);
}

export function isValidGuess(word) {
  return ALLOWED.has(word);
}

/**
 * Pick a random secret not in `exclude`. Falls back to any word if the
 * exclusion set somehow covers the whole pool.
 */
export function pickSecret(exclude = new Set()) {
  for (let i = 0; i < 50; i++) {
    const w = ANSWERS[randomInt(ANSWERS.length)];
    if (!exclude.has(w)) return w;
  }
  const remaining = ANSWERS.filter((w) => !exclude.has(w));
  return remaining.length ? remaining[randomInt(remaining.length)] : ANSWERS[randomInt(ANSWERS.length)];
}
