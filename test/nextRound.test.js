/**
 * Every way a round can end must leave the host holding a "roundOver" snapshot
 * that carries the result and the next-round deadline, and the host must then
 * be able to start the next round. Real timers are driven with mock timers so
 * timeouts and the disconnect grace period run for real.
 */
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/activity/room.js';
import { ANSWERS } from '../src/game/words.js';
import { TIMER_GRACE_MS, DISCONNECT_GRACE_MS, REMATCH_IDLE_MS } from '../src/constants.js';

const TURN_SECONDS = 70;
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
  states() {
    return this.messages.filter((m) => m.t === 'state');
  }
}

function setup(opts = {}) {
  const room = new Room({ instanceId: 'inst', guildId: 'g1', turnSeconds: TURN_SECONDS, stats: null, ...opts });
  created.push(room);
  const join = (id, name = id) => {
    const s = new FakeSocket();
    room.join({ id, name, avatar: null }, s);
    return s;
  };
  return { room, join };
}

function miss(secret) {
  return ANSWERS.find((w) => w !== secret && w.split('').every((ch) => !secret.includes(ch))) ?? ANSWERS.find((w) => w !== secret);
}

/** The host's socket must hold a roundOver snapshot that lets it start the next round. */
function assertHostGotRoundOver(room, hostSocket, hostId, expected = {}) {
  assert.equal(room.phase, 'roundOver', 'room is in roundOver');
  const snap = hostSocket.last();
  assert.ok(snap, 'host received a state snapshot');
  assert.equal(snap.phase, 'roundOver', 'host’s latest snapshot is roundOver');
  assert.equal(snap.hostId, hostId, 'host is still the host in the snapshot');
  assert.equal(snap.me, hostId);
  assert.ok(snap.result, 'result attached');
  assert.equal(typeof snap.result.secret, 'string');
  assert.ok(snap.next && typeof snap.next.deadline === 'number', 'next-round deadline attached');
  assert.equal(snap.round.status !== 'playing', true, 'round shown as finished');
  assert.equal(snap.round.secret, snap.result.secret, 'secret revealed');
  if (expected.result) assert.equal(snap.result.result, expected.result);
  if (expected.winnerIds) assert.deepEqual(snap.result.winnerIds, expected.winnerIds);
  // Every state the host got after roundOver is roundOver too (nothing flips it back).
  const idx = hostSocket.states().findIndex((s) => s.phase === 'roundOver');
  assert.ok(idx >= 0);
  for (const s of hostSocket.states().slice(idx)) assert.equal(s.phase, 'roundOver');
  const eventTexts = hostSocket.messages.filter((m) => m.t === 'event' && m.kind === 'result').map((m) => m.text);
  assert.equal(eventTexts.length, 1, 'exactly one result event delivered to the host');
  // What the result card needs to draw the mode / turns / seconds pickers and the Start button.
  assert.ok(['duel', 'turn'].includes(snap.settings.mode));
  assert.ok(Number.isInteger(snap.settings.turnsEach) && snap.settings.turnsEach >= 1);
  assert.ok(Number.isInteger(snap.settings.turnSeconds) && snap.settings.turnSeconds >= 10);
  assert.ok(Array.isArray(snap.settings.turnSecondsOptions) && snap.settings.turnSecondsOptions.length > 0);
  assert.ok(Number.isInteger(snap.settings.minPlayers));
  // The client's "enough players" count must agree with the server's, so the button state is honest.
  const clientConnected = snap.members.filter((m) => m.connected !== false).length;
  assert.equal(clientConnected, room.connectedMembers().length, 'connected count in snapshot matches the server');
  return snap;
}

function assertHostCanStartNext(room, hostSocket, hostId) {
  const before = room.roundNumber;
  assert.equal(room.next(hostId), true, 'host can start the next round');
  assert.equal(room.phase, 'playing');
  assert.equal(room.roundNumber, before + 1);
  const snap = hostSocket.last();
  assert.equal(snap.phase, 'playing');
  assert.equal(snap.roundNumber, before + 1);
  assert.equal(snap.next, null);
  assert.equal(snap.result, null);
}

test('duel: host wins → host gets roundOver and starts next round', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  const secret = room.round.secret;
  room.guess('a', secret);
  room.guess('b', miss(secret));
  assertHostGotRoundOver(room, a, 'a', { result: 'win', winnerIds: ['a'] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: host loses (non-host solves) → host still gets roundOver', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  const secret = room.round.secret;
  room.guess('b', secret);
  room.guess('a', miss(secret));
  assertHostGotRoundOver(room, a, 'a', { result: 'win', winnerIds: ['b'] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: tie → host gets roundOver', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  const secret = room.round.secret;
  room.guess('a', miss(secret));
  room.guess('b', miss(secret));
  room.guess('a', secret);
  room.guess('b', secret);
  assertHostGotRoundOver(room, a, 'a', { result: 'tie', winnerIds: ['a', 'b'] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: nobody solves (all rows used) → draw → host gets roundOver', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  const secret = room.round.secret;
  for (let i = 0; i < 6; i++) {
    room.guess('a', miss(secret));
    room.guess('b', miss(secret));
  }
  assertHostGotRoundOver(room, a, 'a', { result: 'draw', winnerIds: [] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: non-host forfeits → host wins → host gets roundOver', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  room.forfeit('b');
  assertHostGotRoundOver(room, a, 'a', { result: 'forfeit', winnerIds: ['a'] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: host forfeits → host still gets roundOver and can start the next round', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.start('a');
  room.forfeit('a');
  assertHostGotRoundOver(room, a, 'a', { result: 'forfeit', winnerIds: ['b'] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('duel: every timer runs out (real timers) → draw → host gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    join('b');
    room.start('a');
    const step = TURN_SECONDS * 1000 + TIMER_GRACE_MS;
    for (let i = 0; i < 6; i++) {
      assert.equal(room.phase, 'playing', `still playing before timeout ${i + 1}`);
      mock.timers.tick(step + 5);
    }
    assertHostGotRoundOver(room, a, 'a', { result: 'draw', winnerIds: [] });
    assert.equal(room.round.boards.a.rows.length, 6);
    assert.equal(room.round.boards.b.rows.length, 6);
    assertHostCanStartNext(room, a, 'a');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('duel: non-host disconnects mid-round, grace expires → host wins → host gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    const b = join('b');
    room.start('a');
    room.leaveSocket(b);
    assert.equal(room.phase, 'playing');
    mock.timers.tick(DISCONNECT_GRACE_MS + TIMER_GRACE_MS + 5);
    assertHostGotRoundOver(room, a, 'a', { result: 'forfeit', winnerIds: ['a'] });
    assert.equal(room.members.has('b'), false, 'disconnected player dropped');
    // Someone else joins; host starts the next round.
    join('c');
    assertHostCanStartNext(room, a, 'a');
    assert.deepEqual(room.participants, ['a', 'c']);
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('duel: host drops mid-round and comes back before the end → still host, gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a1 = join('a');
    join('b');
    room.start('a');
    const secret = room.round.secret;
    room.leaveSocket(a1);
    mock.timers.tick(DISCONNECT_GRACE_MS / 2);
    const a2 = join('a'); // reconnect on a fresh socket
    assert.equal(room.hostId, 'a');
    room.guess('b', secret);
    room.guess('a', miss(secret));
    assertHostGotRoundOver(room, a2, 'a', { result: 'win', winnerIds: ['b'] });
    assertHostCanStartNext(room, a2, 'a');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('duel: host is gone at round end → host role moves to a connected player who gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    const b = join('b');
    room.start('a');
    room.leaveSocket(a);
    mock.timers.tick(DISCONNECT_GRACE_MS + TIMER_GRACE_MS + 5);
    assert.equal(room.phase, 'roundOver');
    assert.equal(room.hostId, 'b', 'host handed to the remaining player');
    assertHostGotRoundOver(room, b, 'b', { result: 'forfeit', winnerIds: ['b'] });
    assert.equal(b.last().members.find((m) => m.id === 'a')?.role, 'left', 'old host shown as left on the board');
    assert.equal(room.members.has('a'), false, 'old host removed from the room');
    join('c');
    assertHostCanStartNext(room, b, 'b');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('duel: host drops in a 3-player round and a spectator joins → an existing player becomes host, not the newcomer', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    const b = join('b');
    join('c');
    room.start('a');
    const secret = room.round.secret;
    room.leaveSocket(a);
    mock.timers.tick(DISCONNECT_GRACE_MS + TIMER_GRACE_MS + 5);
    assert.equal(room.phase, 'playing', 'three-player duel continues after one forfeit');
    assert.equal(room.hostId, 'a', 'host is kept during the round (seat reserved)');
    const d = join('d'); // spectator; the host is gone, so a connected host is picked now
    assert.equal(room.hostId, 'b', 'earliest connected member becomes host, not the newcomer');
    room.guess('b', secret);
    room.guess('c', miss(secret));
    assert.equal(room.phase, 'roundOver');
    assert.equal(room.hostId, 'b');
    assertHostGotRoundOver(room, b, 'b', { winnerIds: ['b'] });
    assertHostCanStartNext(room, b, 'b');
    assert.deepEqual(room.participants, ['b', 'c', 'd'], 'spectator folded into the next round');
    assert.equal(d.last().hostId, 'b');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('turn: host solves → roundOver; non-host solves → roundOver', () => {
  for (const solver of ['a', 'b']) {
    const { room, join } = setup();
    const a = join('a');
    join('b');
    room.setSettings('a', { mode: 'turn', turnsEach: 2 });
    room.start('a');
    const secret = room.round.secret;
    let cur = room.round.order[room.round.turnIdx];
    while (cur !== solver) {
      room.guess(cur, miss(secret));
      cur = room.round.order[room.round.turnIdx];
    }
    room.guess(solver, secret);
    assertHostGotRoundOver(room, a, 'a', { result: 'win', winnerIds: [solver] });
    assertHostCanStartNext(room, a, 'a');
    room.destroy();
  }
});

test('turn: board fills with misses → draw → host gets roundOver', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  room.setSettings('a', { mode: 'turn', turnsEach: 3 });
  room.start('a');
  const secret = room.round.secret;
  for (let i = 0; i < 6; i++) room.guess(room.round.order[room.round.turnIdx], miss(secret));
  assertHostGotRoundOver(room, a, 'a', { result: 'draw', winnerIds: [] });
  assertHostCanStartNext(room, a, 'a');
  room.destroy();
});

test('turn: every turn times out (real timers) → draw → host gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    join('b');
    room.setSettings('a', { mode: 'turn', turnsEach: 2 });
    room.start('a');
    const step = TURN_SECONDS * 1000 + TIMER_GRACE_MS;
    for (let i = 0; i < 4; i++) {
      assert.equal(room.phase, 'playing');
      mock.timers.tick(step + 5);
    }
    assertHostGotRoundOver(room, a, 'a', { result: 'draw', winnerIds: [] });
    assert.equal(room.round.rows.length, 4);
    assertHostCanStartNext(room, a, 'a');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('turn: forfeit by either side → host gets roundOver', () => {
  for (const who of ['a', 'b']) {
    const { room, join } = setup();
    const a = join('a');
    join('b');
    room.setSettings('a', { mode: 'turn', turnsEach: 1 });
    room.start('a');
    room.forfeit(who);
    assertHostGotRoundOver(room, a, 'a', { result: 'forfeit', winnerIds: [who === 'a' ? 'b' : 'a'] });
    assertHostCanStartNext(room, a, 'a');
    room.destroy();
  }
});

test('turn: non-host disconnects, grace expires → host gets roundOver', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    const b = join('b');
    room.setSettings('a', { mode: 'turn', turnsEach: 2 });
    room.start('a');
    room.leaveSocket(b);
    mock.timers.tick(DISCONNECT_GRACE_MS + TIMER_GRACE_MS + 5);
    assertHostGotRoundOver(room, a, 'a', { result: 'forfeit', winnerIds: ['a'] });
    join('c');
    assertHostCanStartNext(room, a, 'a');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('roundOver survives until the host acts; idle fallback returns to the lobby, not to a dead state', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { room, join } = setup();
    const a = join('a');
    join('b');
    room.start('a');
    room.forfeit('b');
    assertHostGotRoundOver(room, a, 'a');
    mock.timers.tick(REMATCH_IDLE_MS - 1000);
    assert.equal(room.phase, 'roundOver', 'still waiting on the host');
    assert.equal(a.last().phase, 'roundOver');
    mock.timers.tick(2000);
    assert.equal(room.phase, 'lobby');
    assert.equal(a.last().phase, 'lobby');
    assert.equal(a.last().hostId, 'a');
    assert.equal(room.start('a'), true, 'host can start from the lobby too');
    room.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('host with two tabs/sockets: both receive roundOver', () => {
  const { room, join } = setup();
  const a1 = join('a');
  const a2 = join('a');
  join('b');
  room.start('a');
  room.forfeit('b');
  assertHostGotRoundOver(room, a1, 'a');
  assertHostGotRoundOver(room, a2, 'a');
  room.destroy();
});

test('multi-round series: host gets roundOver after each of five rounds in mixed modes', () => {
  const { room, join } = setup();
  const a = join('a');
  join('b');
  const c = join('c');
  for (let n = 1; n <= 5; n++) {
    room.setSettings('a', { mode: n % 2 ? 'duel' : 'turn', turnsEach: 1 });
    assert.equal(n === 1 ? room.start('a') : room.next('a'), true);
    assert.equal(room.roundNumber, n);
    a.messages.length = 0; // look only at what this round delivers to the host
    const secret = room.round.secret;
    if (room.round.kind === 'duel') {
      room.guess('a', secret);
      room.guess('b', miss(secret));
      room.guess('c', miss(secret));
    } else {
      room.guess(room.round.order[room.round.turnIdx], secret);
    }
    assertHostGotRoundOver(room, a, 'a');
    assert.equal(c.last().phase, 'roundOver');
  }
  room.destroy();
});
