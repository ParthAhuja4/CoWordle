import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelRound,
  applyDuelGuess,
  applyDuelTimeout,
  forfeitDuel,
  pendingPlayers,
} from '../src/game/duelGame.js';

const mk = (ids = ['a', 'b']) => createDuelRound({ secret: 'crane', playerIds: ids });
const miss = (r, id) => applyDuelGuess(r, id, 'slate');
const hit = (r, id) => applyDuelGuess(r, id, 'crane');

test('solving when opponent already used as many rows wins immediately', () => {
  const r = mk();
  miss(r, 'a');
  miss(r, 'b');
  miss(r, 'b');
  const res = hit(r, 'a'); // a solves at 2, b has 2 rows
  assert.equal(res.solved, true);
  assert.equal(res.attempt, 2);
  assert.equal(res.result, 'won');
  assert.deepEqual(r.winnerIds, ['a']);
  assert.equal(applyDuelGuess(r, 'b', 'crane').reason, 'not_playing');
});

test('last chance: opponent with fewer rows may tie or win', () => {
  const r = mk();
  miss(r, 'a');
  miss(r, 'a');
  assert.equal(hit(r, 'a').result, 'pending'); // a solves at 3, b has 0 rows
  assert.deepEqual(pendingPlayers(r), ['b']);
  assert.equal(miss(r, 'b').result, 'pending');
  assert.equal(hit(r, 'b').result, 'won'); // b solves at 2 → b wins
  assert.deepEqual(r.winnerIds, ['b']);

  const r2 = mk();
  miss(r2, 'a');
  hit(r2, 'a'); // solved at 2
  miss(r2, 'b');
  assert.equal(hit(r2, 'b').result, 'tie');
  assert.equal(r2.status, 'tie');
  assert.deepEqual(r2.winnerIds.sort(), ['a', 'b']);

  const r3 = mk();
  hit(r3, 'a'); // solved at 1
  assert.equal(miss(r3, 'b').result, 'won'); // b missed at 1 → cannot match
  assert.deepEqual(r3.winnerIds, ['a']);
});

test('nobody solves → draw; out after 6 rows', () => {
  const r = mk();
  for (let i = 0; i < 6; i++) miss(r, 'a');
  assert.equal(r.boards.a.out, true);
  assert.equal(applyDuelGuess(r, 'a', 'crane').reason, 'out');
  for (let i = 0; i < 5; i++) assert.equal(miss(r, 'b').result, 'pending');
  assert.equal(miss(r, 'b').result, 'draw');
});

test('timeouts burn rows and can end the round', () => {
  const r = mk();
  hit(r, 'a');
  assert.equal(applyDuelTimeout(r, 'a'), null); // a is done
  assert.equal(applyDuelTimeout(r, 'b'), 'won');
  assert.equal(r.boards.b.rows[0].timedOut, true);

  const r2 = mk();
  for (let i = 0; i < 5; i++) applyDuelTimeout(r2, 'a');
  assert.equal(applyDuelTimeout(r2, 'a'), 'pending');
  assert.equal(r2.boards.a.out, true);
});

test('forfeit removes a player from contention', () => {
  const r = mk(['a', 'b', 'c']);
  assert.equal(forfeitDuel(r, 'a'), 'pending');
  assert.equal(applyDuelGuess(r, 'a', 'crane').reason, 'forfeited');
  miss(r, 'b');
  assert.equal(hit(r, 'c').result, 'won');
  assert.deepEqual(r.winnerIds, ['c']);

  // Last player standing wins outright.
  const r2 = mk();
  assert.equal(forfeitDuel(r2, 'a'), 'won');
  assert.deepEqual(r2.winnerIds, ['b']);
  assert.equal(forfeitDuel(r2, 'b'), null, 'round already over');

  // Everyone gone: draw.
  const r3 = mk(['a', 'b', 'c']);
  assert.equal(forfeitDuel(r3, 'a'), 'pending');
  assert.equal(forfeitDuel(r3, 'b'), 'won');
  assert.deepEqual(r3.winnerIds, ['c']);
});

test('three-way tie', () => {
  const r = mk(['a', 'b', 'c']);
  assert.equal(hit(r, 'a').result, 'pending');
  assert.equal(hit(r, 'b').result, 'pending');
  assert.equal(hit(r, 'c').result, 'tie');
  assert.deepEqual(r.winnerIds.sort(), ['a', 'b', 'c']);
});

test('per-board version increments on every row', () => {
  const r = mk();
  miss(r, 'a');
  assert.equal(r.boards.a.version, 1);
  applyDuelTimeout(r, 'a');
  assert.equal(r.boards.a.version, 2);
  assert.equal(r.boards.b.version, 0);
});
