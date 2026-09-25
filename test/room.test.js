/**
 * Room state machine with fake sockets: lobby → round → next round, visibility
 * rules (opponent letters never leak), forfeits and disconnects.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/activity/room.js';
import { ANSWERS } from '../src/game/words.js';

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

function setup(opts = {}) {
  const recorded = [];
  const room = new Room({
    instanceId: 'inst',
    guildId: 'g1',
    turnSeconds: 30,
    stats: { recordRoundResult: async (r) => void recorded.push(r) },
    ...opts,
  });
  created.push(room);
  const join = (id, name = id) => {
    const s = new FakeSocket();
    room.join({ id, name, avatar: null }, s);
    return s;
  };
  return { room, join, recorded };
}

/** A word that is NOT the secret, for a guaranteed miss. */
function miss(secret) {
  return ANSWERS.find((w) => w !== secret && w.split('').every((ch) => !secret.includes(ch))) ?? ANSWERS.find((w) => w !== secret);
}

test('first joiner is host; only host changes settings and starts; need 2 players', () => {
  const { room, join } = setup();
  const a = join('a');
  assert.equal(room.hostId, 'a');
  assert.equal(a.last().phase, 'lobby');

  const b = join('b');
  assert.equal(room.setSettings('b', { mode: 'turn' }), false);
  assert.equal(b.last('error').text, 'Only the host can change settings.');
  assert.equal(room.setSettings('a', { mode: 'turn', turnsEach: 3 }), true);
  assert.deepEqual(room.settings, { mode: 'turn', turnsEach: 3, turnSeconds: 30 });
  assert.equal(room.setSettings('a', { turnsEach: 9 }), false);

  assert.equal(room.start('b'), false);
  room.setSettings('a', { mode: 'duel' });
  assert.equal(room.start('a'), true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.participants, ['a', 'b']);
  room.destroy();
});

test('host picks seconds per turn; the timer uses it; bounds are enforced; non-host cannot', () => {
  const { room, join } = setup();
  const a = join('a');
  const b = join('b');
  assert.equal(a.last().settings.turnSeconds, 30, 'room starts on the configured default');
  assert.ok(Array.isArray(a.last().settings.turnSecondsOptions), 'presets are announced to the client');

  assert.equal(room.setSettings('b', { turnSeconds: 90 }), false, 'non-host cannot change it');
  assert.equal(room.setSettings('a', { turnSeconds: 5 }), false, 'below the floor');
  assert.equal(room.setSettings('a', { turnSeconds: 301 }), false, 'above the ceiling');
  assert.equal(room.setSettings('a', { turnSeconds: 45.5 }), false, 'must be an integer');
  assert.match(a.last('error').text, /Seconds per turn/);
  assert.equal(room.settings.turnSeconds, 30);

  assert.equal(room.setSettings('a', { turnSeconds: 90 }), true);
  assert.equal(b.last().settings.turnSeconds, 90, 'everyone sees the new value');

  room.start('a');
  const before = Date.now();
  const dl = a.last().round.boards.a.deadline;
  assert.ok(dl >= before + 90_000 - 50 && dl <= before + 90_000 + 1000, `deadline uses 90s (got ${dl - before}ms)`);
  assert.equal(room.setSettings('a', { turnSeconds: 30 }), false, 'locked while playing');

  room.forfeit('b');
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.setSettings('a', { turnSeconds: 45 }), true, 'changeable between rounds');
  room.next('a');
  const dl2 = a.last().round.boards.a.deadline;
  assert.ok(dl2 - Date.now() <= 45_000 + 50 && dl2 - Date.now() > 44_000, 'next round uses the new value');
  room.destroy();
});

test('start refuses with one player', () => {
  const { room, join } = setup();
  const a = join('a');
  assert.equal(room.start('a'), false);
  assert.match(a.last('error').text, /at least 2/);
  room.destroy();
});

test('duel: opponents see colours only, guesser sees letters; solving ends the round and records stats', async () => {
  const { room, join, recorded } = setup();
  const a = join('a');
  const b = join('b');
  room.start('a');
  const secret = room.round.secret;

  const res = room.guess('a', miss(secret));
  assert.equal(res.ok, true);
  assert.equal(res.pattern.length, 5);

  const aSnap = a.last();
  const bSnap = b.last();
  assert.equal(aSnap.round.boards.a.rows[0].word, res.word, 'own letters visible');
  assert.equal(bSnap.round.boards.a.rows[0].word, null, 'opponent never sees letters');
  assert.deepEqual(bSnap.round.boards.a.rows[0].pattern, res.pattern, 'opponent sees colours');
  assert.equal(aSnap.round.secret, null);
  assert.ok(Object.keys(aSnap.keys).length > 0, 'keyboard state for own rows');
  assert.deepEqual(bSnap.keys, {}, 'keyboard state does not leak');

  assert.equal(room.guess('b', 'zzzzz').reason, 'not_a_word');
  assert.equal(room.guess('b', 'abc').reason, 'malformed');

  // a solves in 2; b has used 0 rows so gets a last chance → still pending.
  assert.equal(room.guess('a', secret).ok, true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round.boards.a.solvedAt, 2);
  assert.equal(room.guess('a', secret).reason, 'already_solved');

  // b misses once (1 row used < 2) → still pending; misses again → 2 rows, cannot beat → round over.
  room.guess('b', miss(secret));
  assert.equal(room.phase, 'playing');
  room.guess('b', miss(secret));
  assert.equal(room.phase, 'roundOver');
  assert.deepEqual(room.lastResult.winnerIds, ['a']);
  assert.equal(room.score.a, 1);

  const over = b.last();
  assert.equal(over.round.secret, secret, 'word revealed at the end');
  assert.equal(over.round.boards.a.rows[1].word, null, 'letters stay hidden even after the round');
  assert.equal(over.round.boards.b.rows[0].word, over.round.boards.b.rows[0].word);
  assert.ok(over.next.deadline > Date.now(), 'next-round deadline is announced');
  assert.equal(over.score.a, 1, 'winner’s score is in the snapshot');

  await new Promise((r) => setImmediate(r));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].result, 'win');
  assert.equal(recorded[0].guildId, 'g1');
  room.destroy();
});

test('next round: only the host starts it, mode picked between rounds applies, spectator is folded in', () => {
  const { room, join } = setup();
  const a = join('a');
  const b = join('b');
  room.start('a');
  const secret = room.round.secret;
  room.guess('a', secret);
  room.guess('b', miss(secret)); // bestSolve=1, b has used 1 row → cannot beat it → round over
  assert.equal(room.phase, 'roundOver');
  assert.equal(room.score.a, 1);

  const c = join('c'); // joins between rounds
  assert.equal(room.next('b'), false, 'non-host cannot start');
  assert.match(b.last('error').text, /host/);
  assert.equal(room.next('c'), false);
  assert.equal(room.phase, 'roundOver');

  assert.equal(room.setSettings('a', { mode: 'turn', turnsEach: 1 }), true, 'host changes mode between rounds');
  assert.equal(c.last().settings.mode, 'turn', 'everyone sees the chosen mode');

  assert.equal(room.next('a'), true);
  assert.equal(room.phase, 'playing');
  assert.equal(room.roundNumber, 2);
  assert.equal(room.round.kind, 'turn', 'round 2 uses the newly picked mode');
  assert.deepEqual(room.participants, ['a', 'b', 'c']);
  assert.deepEqual(c.last().round.order, ['a', 'b', 'c'], 'new player is in the round');
  assert.notEqual(room.round.secret, secret, 'no word reuse within the room');
  assert.equal(a.last().roundNumber, 2);
  assert.equal(a.last().score.a, 1, 'series score carries over');
  assert.equal(room.next('a'), false, 'cannot start while playing');
  room.destroy();
});

test('next round refuses with fewer than two players connected', () => {
  const { room, join } = setup();
  const a = join('a');
  const b = join('b');
  room.start('a');
  room.forfeit('b');
  assert.equal(room.phase, 'roundOver');
  room.leaveSocket(b);
  assert.equal(room.next('a'), false);
  assert.match(a.last('error').text, /at least 2/);
  assert.equal(room.phase, 'roundOver');
  room.destroy();
});

test('turn mode: shared rows carry letters, turn order enforced, timeout burns a row', () => {
  const { room, join } = setup();
  const a = join('a');
  const b = join('b');
  room.setSettings('a', { mode: 'turn', turnsEach: 1 });
  room.start('a');
  const first = room.round.order[room.round.turnIdx];
  const second = first === 'a' ? 'b' : 'a';
  assert.equal(room.guess(second, miss(room.round.secret)).reason, 'not_your_turn');
  const res = room.guess(first, miss(room.round.secret));
  assert.equal(res.ok, true);
  assert.equal(b.last().round.rows[0].word, res.word, 'shared board shows letters to everyone');
  assert.equal(a.last().round.turnUserId, second);

  room.onTurnTimeout(room.round, second);
  assert.equal(room.phase, 'roundOver', 'two rows total with 1 turn each → draw');
  assert.equal(room.lastResult.result, 'draw');
  assert.equal(room.score.draws, 1);
  room.destroy();
});

test('forfeit in a duel: other player wins; forfeiter still rejoins next round', () => {
  const { room, join } = setup();
  join('a');
  join('b');
  room.start('a');
  assert.equal(room.forfeit('b'), true);
  assert.equal(room.phase, 'roundOver');
  assert.deepEqual(room.lastResult.winnerIds, ['a']);
  assert.equal(room.lastResult.result, 'forfeit');
  assert.equal(room.next('a'), true);
  assert.equal(room.phase, 'playing');
  assert.deepEqual(room.participants, ['a', 'b']);
  room.destroy();
});

test('disconnect between rounds removes the player and hands over host; empty room self-destructs', () => {
  let closed = false;
  const { room, join } = setup({ onEmpty: () => (closed = true) });
  const a = join('a');
  const b = join('b');
  room.leaveSocket(a);
  assert.equal(room.hostId, 'b');
  assert.equal(room.members.has('a'), false);
  room.leaveSocket(b);
  assert.equal(room.connectedMembers().length, 0);
  assert.ok(room.emptyTimer);
  room.destroy();
  assert.equal(closed, true);
});

test('disconnect mid-round keeps the seat for a grace period, then forfeits', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  room.leaveSocket(a);
  assert.equal(room.phase, 'playing');
  assert.ok(room.members.get('a').disconnectTimer, 'grace timer armed');
  assert.equal(room.members.get('a').sockets.size, 0);
  // Reconnect cancels the grace timer.
  join('a');
  assert.equal(room.members.get('a').disconnectTimer, null);
  room.destroy();
});

test('snapshot marks roles: player / spectator / left / away', () => {
  const { room, join } = setup();
  const a = join('a');
  const b = join('b');
  room.start('a');
  const c = join('c');
  const roles = Object.fromEntries(c.last().members.map((m) => [m.id, m.role]));
  assert.deepEqual(roles, { a: 'player', b: 'player', c: 'spectator' });
  assert.equal(room.guess('c', 'crane').reason, 'spectator');
  room.forfeit('b');
  // 2-player duel: forfeit ends the round. Start a 3-way one to check "left" mid-round.
  room.next('a');
  room.forfeit('b');
  assert.equal(room.phase, 'playing');
  const r2 = Object.fromEntries(a.last().members.map((m) => [m.id, m.role]));
  assert.deepEqual(r2, { a: 'player', b: 'left', c: 'player' });
  room.leaveSocket(b);
  room.leaveSocket(c);
  const r3 = Object.fromEntries(a.last().members.map((m) => [m.id, m.role]));
  assert.equal(r3.c, 'away');
  room.destroy();
});
