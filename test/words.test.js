import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS, ALLOWED, isValidGuess, pickSecret, normalizeWord, isWellFormed } from '../src/game/words.js';

test('word lists are loaded and well formed', () => {
  // Answers are the curated everyday-word pool (~2.3k); guesses accept the much larger union.
  assert.ok(ANSWERS.length > 2000, `answers too small: ${ANSWERS.length}`);
  assert.ok(ANSWERS.length < 5000, `answers pool is not the curated list: ${ANSWERS.length}`);
  assert.ok(ALLOWED.size > 18_000, `allowed too small: ${ALLOWED.size}`);
  assert.ok(ALLOWED.has('aahed'), 'obscure NYT-accepted words stay valid guesses');
  assert.ok(!ANSWERS.includes('aahed'), 'but never become the secret');
  for (const w of ANSWERS) assert.match(w, /^[a-z]{5}$/);
  for (const w of ANSWERS) assert.ok(ALLOWED.has(w), `answer ${w} not in allowed set`);
});

test('isValidGuess', () => {
  assert.equal(isValidGuess('crane'), true);
  assert.equal(isValidGuess('zzzzz'), false);
});

test('normalizeWord / isWellFormed', () => {
  assert.equal(normalizeWord('  CrAnE '), 'crane');
  assert.equal(isWellFormed('crane'), true);
  assert.equal(isWellFormed('cran'), false);
  assert.equal(isWellFormed('cran3'), false);
});

test('pickSecret avoids excluded words', () => {
  const exclude = new Set(ANSWERS.slice(1));
  for (let i = 0; i < 20; i++) assert.equal(pickSecret(exclude), ANSWERS[0]);
});
