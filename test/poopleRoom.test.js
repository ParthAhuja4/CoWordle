/**
 * Poople through the Room: validation messages, stepping back, the finish
 * window that opens on the first arrival, and what each player's snapshot may reveal.
 */
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/activity/room.js';
import { START_POOL } from '../src/game/poopleWords.js';
import { TIMER_GRACE_MS } from '../src/constants.js';

const TURN_SECONDS = 30;
const SHORT = ['pome', 'pomp', 'poop']; // home → poop in 3 (par)
const LONG = ['come', 'comp', 'pomp', 'poop']; // home → poop in 4

const created = [];
after(() => {
  for (const r of created) r.destroy();
});

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.messages = [];
  }
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  last(type = 'state') {
    return [...this.messages].reverse().find((m) => m.t === type);
  }
}

/** Two players in a Poople room whose next start word is always HOME. */
function setup() {
  const room = new Room({ instanceId: 'poople', guildId: 'g1', turnSeconds: TURN_SECONDS, stats: null });
  created.push(room);
  const a = new FakeSocket();
  const b = new FakeSocket();
  room.join({ id: 'a', name: 'Ann', avatar: null }, a);
  room.join({ id: 'b', name: 'Bob', avatar: null }, b);
  room.setSettings('a', { mode: 'poople' });
  // pickStart skips used words, so excluding every other start word pins HOME.
  for (const w of START_POOL) if (w !== 'home') room.usedSecrets.add(w);
  room.start('a');
  return { room, a, b };
}

const play = (room, id, words) => words.map((w) => room.guess(id, w)).at(-1);

test('a Poople round starts with the start word, par and no clock', () => {
  const { room, a } = setup();
  const snap = a.last();
  assert.equal(snap.phase, 'playing');
  assert.equal(snap.round.kind, 'poople');
  assert.equal(snap.round.wordLen, 4);
  assert.equal(snap.round.start, 'home');
  assert.equal(snap.round.target, 'poop');
  assert.equal(snap.round.par, 3);
  assert.equal(snap.round.path, null, 'the shortest path stays hidden until the end');
  assert.equal(snap.round.deadline, null);
  assert.equal(room.round.timer, null);
});

test('steps are validated with Poople messages', () => {
  const { room } = setup();
  assert.equal(room.guess('a', 'crane').message, 'Four letters, please.');
  assert.equal(room.guess('a', 'hxme').message, 'Not in word list');
  assert.equal(room.guess('a', 'pomp').message, 'Change exactly one letter of HOME');
  assert.equal(room.guess('a', 'hole').ok, true);
});

test('stepping back to an earlier word is allowed and counted', () => {
  const { room, a } = setup();
  play(room, 'a', ['hole', 'home']);
  assert.deepEqual(a.last().round.boards.a.steps, ['hole', 'home']);
  assert.equal(a.last().round.boards.a.count, 2);
});

test('rivals see step counts during the round and words only after it', () => {
  const { room, a, b } = setup();
  play(room, 'a', LONG.slice(0, 1));
  assert.equal(b.last().round.boards.a.steps, null);
  assert.equal(b.last().round.boards.a.count, 1);
  assert.deepEqual(a.last().round.boards.a.steps, ['come']);
  play(room, 'a', LONG.slice(1));
  play(room, 'b', SHORT);
  const end = b.last();
  assert.equal(end.phase, 'roundOver');
  assert.deepEqual(end.round.boards.a.steps, LONG);
  assert.deepEqual(end.round.path, ['home', ...SHORT]);
});

test('the first arrival opens the finish window; fewer steps still wins', () => {
  const { room, a } = setup();
  const res = play(room, 'a', LONG);
  assert.equal(res.ok, true);
  assert.equal(res.arrived, true);
  assert.equal(room.phase, 'playing');
  assert.ok(a.last().round.deadline > Date.now());
  play(room, 'b', SHORT);
  assert.equal(room.phase, 'roundOver');
  assert.deepEqual(room.lastResult.winnerIds, ['b']);
  assert.deepEqual(room.lastResult.steps, { a: 4, b: 3 });
  assert.equal(room.lastResult.kind, 'poople');
  assert.equal(room.score.b, 1);
});

test('when the window runs out, the arrivals are scored', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, b } = setup();
    play(room, 'b', ['hole']);
    play(room, 'a', LONG);
    assert.equal(room.phase, 'playing');
    mock.timers.tick(TURN_SECONDS * 1000 + TIMER_GRACE_MS + 5);
    assert.equal(room.phase, 'roundOver');
    assert.deepEqual(room.lastResult.winnerIds, ['a']);
    assert.deepEqual(room.lastResult.steps, { a: 4, b: null });
    assert.equal(b.last().phase, 'roundOver');
    // The next Poople round can start from the result card.
    assert.equal(room.next('a'), true);
    assert.equal(room.round.kind, 'poople');
  } finally {
    mock.timers.reset();
  }
});
