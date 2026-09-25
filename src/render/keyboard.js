import { EMOJI, LETTERS } from '../constants.js';
import { keyboardState } from '../game/scoring.js';

const up = (s) => s.toUpperCase();
const QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * QWERTY keyboard, one line per key row:
 *   🟩 = in the right spot, 🟨 = in the word but elsewhere,
 *   ~~struck~~ = not in the word (greyed out), plain = not tried yet.
 *
 *   Q W ~~E~~ R T Y U I O P
 *   🟩A ~~S~~ D F G H J K L
 *   Z X C V B N M
 */
export function renderKeyboard(rows) {
  const state = keyboardState(rows);
  return QWERTY.map((keys, i) =>
    ' '.repeat(i) +
    keys
      .split('')
      .map((l) => {
        const s = state.get(l);
        if (s === 'g') return `${EMOJI.g}${up(l)}`;
        if (s === 'y') return `${EMOJI.y}${up(l)}`;
        if (s === 'x') return `~~${up(l)}~~`;
        return up(l);
      })
      .join(' '),
  ).join('\n');
}

/**
 * Compact one-liner used where vertical space is tight (Duel fields):
 * "🟩 A E · 🟨 C · ⬜ L N R". Untried letters are omitted.
 */
export function renderKeyboardLine(rows, { includeUnused = false } = {}) {
  const state = keyboardState(rows);
  const groups = { g: [], y: [], x: [] };
  const unused = [];
  for (const l of LETTERS) {
    const s = state.get(l);
    if (s) groups[s].push(up(l));
    else unused.push(up(l));
  }
  const parts = [];
  if (groups.g.length) parts.push(`${EMOJI.g} ${groups.g.join(' ')}`);
  if (groups.y.length) parts.push(`${EMOJI.y} ${groups.y.join(' ')}`);
  if (groups.x.length) parts.push(`${EMOJI.x} ${groups.x.join(' ')}`);
  const lines = [parts.length ? parts.join('  ·  ') : '_No letters tried yet_'];
  if (includeUnused) lines.push(`Unused: ${unused.length ? unused.join(' ') : '—'}`);
  return lines.join('\n');
}

export function patternToEmoji(pattern) {
  return pattern.map((p) => EMOJI[p]).join('');
}

export function emptyRow(len = 5) {
  return EMOJI.empty.repeat(len);
}

export function lettersOf(word) {
  return `\`${word.toUpperCase().split('').join(' ')}\``;
}
