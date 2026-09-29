import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED4,
  START_POOL,
  isPoopleWord,
  oneLetterApart,
  distanceToPoop,
  pickStart,
  optimalPath,
} from '../src/game/poopleWords.js';
import { POOPLE_TARGET, POOPLE_PAR_MIN, POOPLE_PAR_MAX } from '../src/constants.js';

test('word lists are loaded, 4 letters, and include the target', () => {
  assert.ok(ALLOWED4.size > 3000);
  assert.ok(isPoopleWord(POOPLE_TARGET));
  for (const w of ALLOWED4) assert.match(w, /^[a-z]{4}$/);
  assert.equal(isPoopleWord('crane'), false);
});

test('every start word can reach the target within the par range', () => {
  assert.ok(START_POOL.length > 500);
  for (const w of START_POOL) {
    assert.ok(isPoopleWord(w), w);
    const d = distanceToPoop(w);
    assert.ok(d >= POOPLE_PAR_MIN && d <= POOPLE_PAR_MAX, `${w} has par ${d}`);
  }
});

test('oneLetterApart', () => {
  assert.equal(oneLetterApart('barn', 'born'), true);
  assert.equal(oneLetterApart('barn', 'barn'), false);
  assert.equal(oneLetterApart('barn', 'bore'), false);
  assert.equal(oneLetterApart('barn', 'barns'), false);
});

test('optimalPath is a shortest valid ladder to the target', () => {
  for (const start of START_POOL.slice(0, 200)) {
    const path = optimalPath(start);
    assert.equal(path.length, distanceToPoop(start) + 1, start);
    assert.equal(path[0], start);
    assert.equal(path.at(-1), POOPLE_TARGET);
    for (let i = 1; i < path.length; i++) {
      assert.ok(isPoopleWord(path[i]), path[i]);
      assert.ok(oneLetterApart(path[i - 1], path[i]), `${path[i - 1]} → ${path[i]}`);
    }
  }
  assert.deepEqual(optimalPath('home'), ['home', 'pome', 'pomp', 'poop']);
});

test('pickStart avoids excluded words', () => {
  const keep = START_POOL[0];
  const exclude = new Set(START_POOL.filter((w) => w !== keep));
  assert.equal(pickStart(exclude), keep);
});
