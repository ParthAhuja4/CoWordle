/**
 * Wordle scoring with correct duplicate-letter handling.
 * Returns an array of 'g' (green), 'y' (yellow) or 'x' (grey), one per position.
 */
export function scoreGuess(secret, guess) {
  const n = secret.length;
  const result = new Array(n).fill('x');
  const remaining = new Map();

  for (let i = 0; i < n; i++) {
    if (guess[i] === secret[i]) {
      result[i] = 'g';
    } else {
      remaining.set(secret[i], (remaining.get(secret[i]) ?? 0) + 1);
    }
  }
  for (let i = 0; i < n; i++) {
    if (result[i] === 'g') continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      result[i] = 'y';
      remaining.set(guess[i], left - 1);
    }
  }
  return result;
}

const RANK = { g: 3, y: 2, x: 1 };

/**
 * Best-known status per letter across the given rows.
 * rows: [{ word, pattern }] (rows with null word/pattern are ignored)
 * Returns Map<letter, 'g'|'y'|'x'>.
 */
export function keyboardState(rows) {
  const state = new Map();
  for (const row of rows) {
    if (!row?.word || !row?.pattern) continue;
    for (let i = 0; i < row.word.length; i++) {
      const ch = row.word[i];
      const s = row.pattern[i];
      const cur = state.get(ch);
      if (!cur || RANK[s] > RANK[cur]) state.set(ch, s);
    }
  }
  return state;
}

export function isSolved(pattern) {
  return pattern.every((p) => p === 'g');
}
