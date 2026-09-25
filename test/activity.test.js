/**
 * End-to-end over real HTTP + WebSocket: dev login, two browsers join the
 * same instance, host starts a duel, both guess, one wins, both vote to
 * play again. No Discord or MongoDB involved.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createHttpServer } from '../src/http.js';
import { attachWebSocket } from '../src/activity/ws.js';
import { rooms, destroyAllRooms } from '../src/activity/rooms.js';
import { ctx } from '../src/util/context.js';
import { ANSWERS } from '../src/game/words.js';

const config = {
  clientId: '123',
  clientSecret: 'test-secret',
  sessionSecret: null,
  allowDevLogin: true,
  turnSeconds: 30,
};
ctx.config = config;
ctx.stats = null;

const server = createHttpServer({ config, isReady: () => true });
attachWebSocket(server, config);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

after(() => {
  destroyAllRooms();
  server.close();
});

async function devLogin(name) {
  const res = await fetch(`${base}/api/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(res.status, 200);
  return res.json();
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.inbox = [];
    ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString())));
  }
  static async connect(session, instance) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?s=${encodeURIComponent(session)}&i=${instance}`);
    const client = new Client(ws); // listen before 'open': the first snapshot can arrive in the same tick
    await once(ws, 'open');
    return client;
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  /** Waits until a message of type `t` satisfying `pred` arrives (already-received ones count). */
  async wait(t, pred = () => true, ms = 2000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m));
      if (i !== -1) return this.inbox.splice(0, i + 1)[i];
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}; inbox=${JSON.stringify(this.inbox).slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

test('static page is served with the client id injected and proxy prefix stripped', async () => {
  const res = await fetch(`${base}/.proxy/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<script src="config.js">/);
  const cfgJs = await (await fetch(`${base}/.proxy/config.js`)).text();
  assert.match(cfgJs, /"clientId":"123"/);
  assert.match(cfgJs, /"devLogin":true/);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('websocket rejects bad sessions', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?s=garbage&i=x`);
  const [err] = await once(ws, 'error');
  assert.match(String(err.message), /401/);
});

test('token endpoint validates input', async () => {
  const res = await fetch(`${base}/api/token`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 400);
});

test('two players play a duel round end to end and rematch', async () => {
  const [a, b] = await Promise.all([devLogin('Alice'), devLogin('Bob')]);
  assert.equal(a.user.name, 'Alice');
  const inst = 'e2e-room';
  const A = await Client.connect(a.session, inst);
  let s = await A.wait('state');
  assert.equal(s.phase, 'lobby');
  assert.equal(s.hostId, a.user.id);

  const B = await Client.connect(b.session, inst);
  s = await B.wait('state', (m) => m.members.length === 2);
  assert.equal(s.hostId, a.user.id, 'first joiner stays host');

  B.send({ t: 'start' });
  assert.match((await B.wait('error')).text, /host/);

  A.send({ t: 'settings', mode: 'duel' });
  A.send({ t: 'start' });
  s = await A.wait('state', (m) => m.phase === 'playing');
  assert.equal(s.round.kind, 'duel');
  assert.ok(s.round.boards[a.user.id].deadline > s.now);

  const room = rooms.get(inst);
  const secret = room.round.secret;
  const missWord = ANSWERS.find((w) => w !== secret && w.split('').every((ch) => !secret.includes(ch)));

  B.send({ t: 'guess', word: 'zzzzz' });
  let g = await B.wait('guess');
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'not_a_word');

  B.send({ t: 'guess', word: missWord });
  g = await B.wait('guess');
  assert.equal(g.ok, true);
  assert.deepEqual(g.pattern, ['x', 'x', 'x', 'x', 'x']);
  s = await A.wait('state', (m) => m.round.boards[b.user.id].rows.length === 1);
  assert.equal(s.round.boards[b.user.id].rows[0].word, null, 'Alice never sees Bob’s letters');

  A.send({ t: 'guess', word: secret });
  g = await A.wait('guess');
  assert.equal(g.ok, true);
  // Alice solved in 1; Bob has already used 1 row so cannot tie → round over.
  s = await B.wait('state', (m) => m.phase === 'roundOver');
  assert.equal(s.round.secret, secret);
  assert.deepEqual(s.result.winnerIds, [a.user.id]);
  assert.equal(s.score[a.user.id], 1);
  assert.deepEqual(s.rematch.needed.sort(), [a.user.id, b.user.id].sort());

  A.send({ t: 'rematch' });
  s = await B.wait('state', (m) => m.rematch?.votes.length === 1);
  B.send({ t: 'rematch' });
  s = await A.wait('state', (m) => m.phase === 'playing' && m.roundNumber === 2);
  assert.notEqual(rooms.get(inst).round.secret, secret);

  A.ws.close();
  B.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(room.connectedMembers().length, 0);
});
