import { MongoClient } from 'mongodb';

/**
 * Connects to MongoDB and makes sure the indexes exist.
 * @returns {Promise<{ client: MongoClient, db: import('mongodb').Db }>}
 */
export async function connectMongo(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return { client, db };
}

export async function ensureIndexes(db) {
  await db.collection('player_stats').createIndex({ guildId: 1, userId: 1 }, { unique: true });
  await db.collection('player_stats').createIndex({ guildId: 1, wins: -1 });
  await db.collection('head_to_head').createIndex({ guildId: 1, userA: 1, userB: 1 }, { unique: true });
  await db.collection('rounds').createIndex({ guildId: 1, endedAt: -1 });
}
