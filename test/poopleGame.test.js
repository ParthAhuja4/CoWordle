import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPoopleRound,
  applyPoopleStep,
  closePoopleWindow,
  forfeitPoople,
} from '../src/game/poopleGame.js';

const SHORT = ['pome', 'pomp', 'poop']; // home → poop in 3 (par)
const LONG = ['come', 'comp', 'pomp', 'poop']; // home → poop in 4

const mk = (ids = ['a', 'b']) => createPoopleRound({ start: 'home', par: 3, path: ['home', ...SHORT], playerIds: ids });
const play = (r, id, words) => words.map((w) => applyPoopleStep(r, id, w)).at(-1);

test('a step must change exactly one letter of the last word', () => {
  const r = mk();
  assert.equal(applyPoopleStep(r, 'a', 'pomp').reason, 'not_one_letter');
  assert.equal(applyPoopleStep(r, 'a', 'home').reason, 'not_one_letter');
  const ok = applyPoopleStep(r, 'a', 'pome');
  assert.equal(ok.ok, true);
  assert.equal(ok.steps, 1);
  assert.equal(applyPoopleStep(r, 'a', 'pomp').ok, true);
});

test('going back to an earlier word is allowed and counts as a step', () => {
  const r = mk();
  play(r, 'a', ['hole']);
  const back = applyPoopleStep(r, 'a', 'home');
  assert.equal(back.ok, true);
  assert.equal(back.steps, 2);
  play(r, 'b', LONG.slice(0, 3));
  const res = play(r, 'a', SHORT);
  assert.equal(res.arrived, true);
  assert.equal(r.boards.a.arrivedAt, 5, 'the detour through HOLE still costs two steps');
});

test('first arrival sets the count to beat and keeps the round open', () => {
  const r = mk();
  const res = play(r, 'a', LONG);
  assert.equal(res.arrived, true);
  assert.equal(res.firstArrival, true);
  assert.equal(res.result, 'pending');
  assert.equal(r.bestSteps, 4);
  assert.equal(applyPoopleStep(r, 'a', 'pool').reason, 'arrived');
});

test('a later arrival with fewer steps wins', () => {
  const r = mk();
  play(r, 'a', LONG);
  const res = play(r, 'b', SHORT);
  assert.equal(res.firstArrival, false);
  assert.equal(res.result, 'won');
  assert.deepEqual(r.winnerIds, ['b']);
});

test('equal steps is a tie', () => {
  const r = mk();
  play(r, 'a', SHORT);
  assert.equal(play(r, 'b', SHORT).result, 'tie');
  assert.deepEqual(r.winnerIds.sort(), ['a', 'b']);
});

test('closing the window resolves with whoever arrived', () => {
  const r = mk(['a', 'b', 'c']);
  play(r, 'a', LONG);
  play(r, 'b', ['hole']);
  assert.equal(r.status, 'playing');
  assert.equal(closePoopleWindow(r), 'won');
  assert.deepEqual(r.winnerIds, ['a']);
  assert.equal(closePoopleWindow(r), null);
});

test('last player standing wins before anyone arrives', () => {
  const r = mk(['a', 'b', 'c']);
  assert.equal(forfeitPoople(r, 'a'), 'pending');
  assert.equal(forfeitPoople(r, 'b'), 'won');
  assert.deepEqual(r.winnerIds, ['c']);
});

test('forfeiting after an arrival resolves once nobody is still going', () => {
  const r = mk();
  play(r, 'a', LONG);
  assert.equal(forfeitPoople(r, 'b'), 'won');
  assert.deepEqual(r.winnerIds, ['a']);
});
