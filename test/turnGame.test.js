import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTurnRound,
  applyTurnGuess,
  applyTurnTimeout,
  forfeitTurn,
  currentTurnUser,
  rowsLeft,
} from '../src/game/turnGame.js';

const mk = (order = ['a', 'b'], turnsEach = 2, startIdx = 0) =>
  createTurnRound({ secret: 'crane', order, turnsEach, startIdx });

test('rows = players × turns and turns alternate', () => {
  const r = mk(['a', 'b', 'c'], 2);
  assert.equal(r.maxRows, 6);
  assert.equal(currentTurnUser(r), 'a');
  assert.equal(applyTurnGuess(r, 'b', 'slate').reason, 'not_your_turn');
  assert.equal(applyTurnGuess(r, 'zzz', 'slate').reason, 'not_in_round');
  const res = applyTurnGuess(r, 'a', 'slate');
  assert.equal(res.ok, true);
  assert.equal(res.event, 'continue');
  assert.equal(currentTurnUser(r), 'b');
  applyTurnGuess(r, 'b', 'slate');
  assert.equal(currentTurnUser(r), 'c');
  applyTurnGuess(r, 'c', 'slate');
  assert.equal(currentTurnUser(r), 'a');
  assert.equal(rowsLeft(r), 3);
});

test('solving wins', () => {
  const r = mk();
  applyTurnGuess(r, 'a', 'slate');
  const res = applyTurnGuess(r, 'b', 'crane');
  assert.equal(res.event, 'won');
  assert.equal(r.status, 'won');
  assert.equal(r.winnerId, 'b');
  assert.equal(applyTurnGuess(r, 'a', 'crane').reason, 'not_playing');
});

test('full board is a draw', () => {
  const r = mk(['a', 'b'], 1);
  applyTurnGuess(r, 'a', 'slate');
  const res = applyTurnGuess(r, 'b', 'slate');
  assert.equal(res.event, 'draw');
  assert.equal(r.status, 'draw');
});

test('timeout burns a row and passes the turn', () => {
  const r = mk();
  const v = r.version;
  assert.equal(applyTurnTimeout(r, 'b'), null); // not b's turn
  assert.equal(applyTurnTimeout(r, 'a'), 'continue');
  assert.ok(r.version > v);
  assert.equal(r.rows[0].timedOut, true);
  assert.equal(currentTurnUser(r), 'b');
});

test('timeout on the last row is a draw', () => {
  const r = mk(['a', 'b'], 1);
  applyTurnGuess(r, 'a', 'slate');
  assert.equal(applyTurnTimeout(r, 'b'), 'draw');
});

test('start index rotates the first player', () => {
  const r = mk(['a', 'b', 'c'], 2, 1);
  assert.equal(currentTurnUser(r), 'b');
});

test('forfeit with 2 players → other wins', () => {
  const r = mk();
  assert.equal(forfeitTurn(r, 'a'), 'won');
  assert.equal(r.winnerId, 'b');
});

test('forfeit with 3 players continues and fixes the turn pointer', () => {
  const r = mk(['a', 'b', 'c'], 2);
  applyTurnGuess(r, 'a', 'slate'); // now b's turn
  assert.equal(forfeitTurn(r, 'b'), 'continue');
  assert.deepEqual(r.order, ['a', 'c']);
  assert.equal(currentTurnUser(r), 'c');
  assert.equal(r.maxRows, 1 + 1 + 2); // a has 1 left, c has 2

  const r2 = mk(['a', 'b', 'c'], 2);
  applyTurnGuess(r2, 'a', 'slate');
  applyTurnGuess(r2, 'b', 'slate'); // c's turn
  assert.equal(forfeitTurn(r2, 'a'), 'continue');
  assert.equal(currentTurnUser(r2), 'c');
  assert.equal(forfeitTurn(r2, 'zzz'), null);
});

test('forfeit when remaining players have no turns left is a draw', () => {
  const r = mk(['a', 'b'], 1);
  applyTurnGuess(r, 'a', 'slate'); // b's turn, a used their only row
  const r3 = mk(['a', 'b', 'c'], 1);
  applyTurnGuess(r3, 'a', 'slate');
  applyTurnGuess(r3, 'b', 'slate'); // c's turn; a and b done
  assert.equal(forfeitTurn(r3, 'c'), 'draw');
  assert.equal(r.status, 'playing');
});
