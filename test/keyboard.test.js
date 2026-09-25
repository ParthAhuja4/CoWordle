import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderKeyboard, renderKeyboardLine } from '../src/render/keyboard.js';
import { scoreGuess } from '../src/game/scoring.js';

test('QWERTY keyboard greys out absent letters and marks found ones', () => {
  const rows = [{ word: 'slate', pattern: scoreGuess('crane', 'slate') }]; // s,l,t absent; a,e green
  const kb = renderKeyboard(rows);
  const lines = kb.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /~~T~~/);
  assert.match(lines[0], /🟩E/);
  assert.match(lines[1], /🟩A/);
  assert.match(lines[1], /~~S~~/);
  assert.match(lines[1], /~~L~~/);
  assert.match(lines[0], /(^|\s)Q(\s|$)/); // untried stays plain
  assert.doesNotMatch(lines[2], /~~|🟩|🟨/);
});

test('QWERTY keyboard shows yellow and upgrades to green', () => {
  const rows = [
    { word: 'earns', pattern: scoreGuess('crane', 'earns') }, // e,a,r,n yellow
    { word: 'crane', pattern: scoreGuess('crane', 'crane') },
  ];
  const kb = renderKeyboard(rows);
  assert.match(kb, /🟩E/);
  assert.doesNotMatch(kb, /🟨E/);
  assert.match(kb, /~~S~~/);
});

test('compact line groups letters', () => {
  const rows = [{ word: 'slate', pattern: scoreGuess('crane', 'slate') }];
  assert.equal(renderKeyboardLine(rows), '🟩 A E  ·  ⬜ L S T');
  assert.equal(renderKeyboardLine([]), '_No letters tried yet_');
});
