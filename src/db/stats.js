/**
 * Stats persistence on MongoDB.
 *
 * Collections:
 *   player_stats { guildId, userId, wins, losses, draws, games, streak, bestStreak, lastPlayedAt }
 *   head_to_head { guildId, userA, userB, aWins, bWins, draws }   (userA < userB)
 *   rounds       { matchId, guildId, mode, players[], winners[], result, secret, endedAt }
 */
const EMPTY = { wins: 0, losses: 0, draws: 0, games: 0, streak: 0, bestStreak: 0, lastPlayedAt: null };

export class StatsRepo {
  constructor(db) {
    this.players = db.collection('player_stats');
    this.h2h = db.collection('head_to_head');
    this.rounds = db.collection('rounds');
  }

  /**
   * Records one finished round. Writes are idempotent per document but not
   * transactional, which is fine for a game bot.
   *
   * @param {object} p
   * @param {string} p.guildId
   * @param {string} p.matchId
   * @param {'turn'|'duel'} p.mode
   * @param {string[]} p.playerIds  everyone who took part in the round
   * @param {string[]} p.winnerIds  [] for draw; >1 for tie
   * @param {'win'|'tie'|'draw'|'forfeit'} p.result
   * @param {string} p.secret
   */
  async recordRoundResult({ guildId, matchId, mode, playerIds, winnerIds, result, secret, endedAt = new Date() }) {
    const winners = new Set(winnerIds);
    const isDraw = winners.size === 0;
    const isTie = winners.size > 1;

    const playerOps = playerIds.map((userId) => {
      const won = winners.has(userId) && !isTie;
      const drew = isDraw || (isTie && winners.has(userId));
      const lost = !won && !drew;
      const streakExpr = won
        ? { $add: [{ $ifNull: ['$streak', 0] }, 1] }
        : lost
          ? 0
          : { $ifNull: ['$streak', 0] };
      return {
        updateOne: {
          filter: { guildId, userId },
          update: [
            {
              $set: {
                guildId,
                userId,
                wins: { $add: [{ $ifNull: ['$wins', 0] }, won ? 1 : 0] },
                losses: { $add: [{ $ifNull: ['$losses', 0] }, lost ? 1 : 0] },
                draws: { $add: [{ $ifNull: ['$draws', 0] }, drew ? 1 : 0] },
                games: { $add: [{ $ifNull: ['$games', 0] }, 1] },
                streak: streakExpr,
                lastPlayedAt: endedAt,
              },
            },
            { $set: { bestStreak: { $max: [{ $ifNull: ['$bestStreak', 0] }, '$streak'] } } },
          ],
          upsert: true,
        },
      };
    });

    const h2hOps = [];
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p = playerIds[i];
        const q = playerIds[j];
        const [userA, userB] = p < q ? [p, q] : [q, p];
        const aWon = winners.has(userA) && !winners.has(userB);
        const bWon = winners.has(userB) && !winners.has(userA);
        const drew = !aWon && !bWon;
        h2hOps.push({
          updateOne: {
            filter: { guildId, userA, userB },
            update: {
              $inc: { aWins: aWon ? 1 : 0, bWins: bWon ? 1 : 0, draws: drew ? 1 : 0 },
              $setOnInsert: { guildId, userA, userB },
            },
            upsert: true,
          },
        });
      }
    }

    await this.players.bulkWrite(playerOps, { ordered: false });
    if (h2hOps.length) await this.h2h.bulkWrite(h2hOps, { ordered: false });
    await this.rounds.insertOne({
      matchId,
      guildId,
      mode,
      players: [...playerIds],
      winners: [...winners],
      result,
      secret,
      endedAt,
    });
  }

  async getStats(guildId, userId) {
    const doc = await this.players.findOne({ guildId, userId });
    return { guildId, userId, ...EMPTY, ...(doc ?? {}) };
  }

  /** Returns { wins, losses, draws } from `userId`'s point of view vs `otherId`. */
  async getHeadToHead(guildId, userId, otherId) {
    const [userA, userB] = userId < otherId ? [userId, otherId] : [otherId, userId];
    const row = await this.h2h.findOne({ guildId, userA, userB });
    if (!row) return { wins: 0, losses: 0, draws: 0 };
    const mine = userId === userA ? row.aWins : row.bWins;
    const theirs = userId === userA ? row.bWins : row.aWins;
    return { wins: mine ?? 0, losses: theirs ?? 0, draws: row.draws ?? 0 };
  }

  /**
   * @param {'wins'|'winrate'|'streak'} sort
   */
  async getLeaderboard(guildId, sort = 'wins', limit = 10, minGames = 5) {
    if (sort === 'winrate') {
      return this.players
        .aggregate([
          { $match: { guildId, games: { $gte: minGames } } },
          { $addFields: { winrate: { $divide: ['$wins', '$games'] } } },
          { $sort: { winrate: -1, wins: -1 } },
          { $limit: limit },
        ])
        .toArray();
    }
    const order =
      sort === 'streak'
        ? { bestStreak: -1, streak: -1, wins: -1 }
        : { wins: -1, games: 1, lastPlayedAt: -1 };
    return this.players
      .find({ guildId, games: { $gt: 0 } })
      .sort(order)
      .limit(limit)
      .toArray();
  }
}
