import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreGuess, keyboardState, isSolved } from '../src/game/scoring.js';

const cases = [
  ['crane', 'crane', 'ggggg'],
  ['crane', 'slate', 'xxgxg'],
  ['abbey', 'babes', 'yyggx'],
  ['robot', 'boost', 'ygyxg'],
  ['speed', 'erase', 'yxxyy'],
  ['speed', 'eerie', 'yyxxx'],
  ['alley', 'llama', 'ygyxx'],
  ['banal', 'nanny', 'xggxx'],
  ['moody', 'oomph', 'ygyxx'],
  ['crane', 'zzzzz', 'xxxxx'],
];

for (const [secret, guess, expected] of cases) {
  test(`scoreGuess(${secret}, ${guess}) → ${expected}`, () => {
    assert.equal(scoreGuess(secret, guess).join(''), expected);
  });
}

test('isSolved', () => {
  assert.equal(isSolved(['g', 'g', 'g', 'g', 'g']), true);
  assert.equal(isSolved(['g', 'y', 'g', 'g', 'g']), false);
});

test('keyboardState keeps the best status per letter', () => {
  const rows = [
    { word: 'crane', pattern: scoreGuess('slate', 'crane') }, // a=y, e=g, c/r/n=x
    { word: 'slate', pattern: scoreGuess('slate', 'slate') },
  ];
  const kb = keyboardState(rows);
  assert.equal(kb.get('a'), 'g'); // yellow first, then green → green
  assert.equal(kb.get('e'), 'g');
  assert.equal(kb.get('c'), 'x');
  assert.equal(kb.get('z'), undefined);
});

test('keyboardState ignores burned rows', () => {
  const kb = keyboardState([{ word: null, pattern: null, timedOut: true }]);
  assert.equal(kb.size, 0);
});
