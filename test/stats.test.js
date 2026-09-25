/**
 * Integration test for the MongoDB stats repo.
 * Runs only when MONGODB_TEST_URI is set (e.g. a local mongod or an Atlas
 * cluster). Uses a throwaway database that is dropped afterwards.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from '../src/db/mongo.js';
import { StatsRepo } from '../src/db/stats.js';

const uri = process.env.MONGODB_TEST_URI;
const G = 'g1';
const base = { guildId: G, matchId: 'm1', mode: 'turn', secret: 'crane' };

async function withRepo(fn) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(`cowordle_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  try {
    await ensureIndexes(db);
    await fn(new StatsRepo(db));
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
}

test('win/loss/draw/tie bookkeeping and streaks', { skip: !uri && 'MONGODB_TEST_URI not set' }, async () => {
  await withRepo(async (repo) => {
    await repo.recordRoundResult({ ...base, playerIds: ['a', 'b'], winnerIds: ['a'], result: 'win' });
    await repo.recordRoundResult({ ...base, playerIds: ['a', 'b'], winnerIds: ['a'], result: 'win' });
    let a = await repo.getStats(G, 'a');
    let b = await repo.getStats(G, 'b');
    assert.equal(a.wins, 2);
    assert.equal(a.streak, 2);
    assert.equal(a.bestStreak, 2);
    assert.equal(b.losses, 2);
    assert.equal(b.streak, 0);

    await repo.recordRoundResult({ ...base, playerIds: ['a', 'b'], winnerIds: [], result: 'draw' });
    a = await repo.getStats(G, 'a');
    assert.equal(a.draws, 1);
    assert.equal(a.streak, 2, 'draw keeps the streak');

    await repo.recordRoundResult({ ...base, playerIds: ['a', 'b'], winnerIds: ['b'], result: 'win' });
    a = await repo.getStats(G, 'a');
    b = await repo.getStats(G, 'b');
    assert.equal(a.streak, 0);
    assert.equal(a.bestStreak, 2);
    assert.equal(b.wins, 1);
    assert.equal(b.streak, 1);
    assert.equal(a.games, 4);

    assert.deepEqual(await repo.getHeadToHead(G, 'a', 'b'), { wins: 2, losses: 1, draws: 1 });
    assert.deepEqual(await repo.getHeadToHead(G, 'b', 'a'), { wins: 1, losses: 2, draws: 1 });
    assert.deepEqual(await repo.getHeadToHead(G, 'b', 'nobody'), { wins: 0, losses: 0, draws: 0 });
  });
});

test('tie in a 3-player duel: tied players draw, the rest lose', { skip: !uri && 'MONGODB_TEST_URI not set' }, async () => {
  await withRepo(async (repo) => {
    await repo.recordRoundResult({ ...base, mode: 'duel', playerIds: ['a', 'b', 'c'], winnerIds: ['a', 'b'], result: 'tie' });
    assert.equal((await repo.getStats(G, 'a')).draws, 1);
    assert.equal((await repo.getStats(G, 'b')).draws, 1);
    assert.equal((await repo.getStats(G, 'c')).losses, 1);
    assert.deepEqual(await repo.getHeadToHead(G, 'a', 'b'), { wins: 0, losses: 0, draws: 1 });
    assert.deepEqual(await repo.getHeadToHead(G, 'a', 'c'), { wins: 1, losses: 0, draws: 0 });
  });
});

test('leaderboard sorts', { skip: !uri && 'MONGODB_TEST_URI not set' }, async () => {
  await withRepo(async (repo) => {
    for (let i = 0; i < 6; i++) {
      await repo.recordRoundResult({ ...base, playerIds: ['a', 'b'], winnerIds: ['a'], result: 'win' });
    }
    await repo.recordRoundResult({ ...base, playerIds: ['c', 'd'], winnerIds: ['c'], result: 'win' });
    const wins = await repo.getLeaderboard(G, 'wins');
    assert.equal(wins[0].userId, 'a');
    assert.equal(wins[1].userId, 'c');
    const rate = await repo.getLeaderboard(G, 'winrate', 10, 5);
    assert.deepEqual(rate.map((r) => r.userId), ['a', 'b']);
    const streak = await repo.getLeaderboard(G, 'streak');
    assert.equal(streak[0].userId, 'a');
    assert.equal((await repo.getStats(G, 'zzz')).games, 0);
  });
});
