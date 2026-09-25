/**
 * Duel round engine (pure). Every player has their own board with the same
 * secret. Fewest attempts to solve wins; equal attempts → tie; nobody → draw.
 * Because guesses arrive sequentially, a player who hasn't yet used as many
 * rows as the current best solve gets a "last chance" to match or beat it.
 */
import { scoreGuess, isSolved } from './scoring.js';
import { DUEL_ROWS } from '../constants.js';

export function createDuelRound({ secret, playerIds, maxRows = DUEL_ROWS }) {
  const boards = {};
  for (const id of playerIds) {
    boards[id] = { rows: [], solvedAt: null, out: false, forfeited: false, deadline: null, timer: null, version: 0 };
  }
  return { kind: 'duel', version: 0, secret, status: 'playing', winnerIds: [], boards, maxRows };
}

export function boardDone(b) {
  return b.solvedAt !== null || b.out || b.forfeited;
}

export function bestSolve(round) {
  let best = Infinity;
  for (const b of Object.values(round.boards)) {
    if (b.solvedAt !== null && b.solvedAt < best) best = b.solvedAt;
  }
  return best;
}

/**
 * Players who are still able to influence the outcome.
 */
export function pendingPlayers(round) {
  const best = bestSolve(round);
  const ids = [];
  for (const [id, b] of Object.entries(round.boards)) {
    if (boardDone(b)) continue;
    if (b.rows.length < best) ids.push(id);
  }
  return ids;
}

/**
 * Evaluates the round and, if decided, updates status/winnerIds.
 * @returns 'pending' | 'won' | 'tie' | 'draw'
 */
export function resolveDuel(round) {
  if (round.status !== 'playing') return round.status;
  if (pendingPlayers(round).length > 0) return 'pending';

  const best = bestSolve(round);
  round.version++;
  if (best === Infinity) {
    round.status = 'draw';
    return 'draw';
  }
  const winners = Object.entries(round.boards)
    .filter(([, b]) => b.solvedAt === best)
    .map(([id]) => id);
  round.winnerIds = winners;
  round.status = winners.length > 1 ? 'tie' : 'won';
  return round.status;
}

/**
 * @returns {{ok:false, reason:'not_playing'|'not_in_round'|'already_solved'|'out'|'forfeited'} |
 *           {ok:true, pattern:string[], solved:boolean, attempt:number, result:string}}
 */
export function applyDuelGuess(round, userId, word) {
  if (round.status !== 'playing') return { ok: false, reason: 'not_playing' };
  const b = round.boards[userId];
  if (!b) return { ok: false, reason: 'not_in_round' };
  if (b.solvedAt !== null) return { ok: false, reason: 'already_solved' };
  if (b.out) return { ok: false, reason: 'out' };
  if (b.forfeited) return { ok: false, reason: 'forfeited' };

  const pattern = scoreGuess(round.secret, word);
  b.rows.push({ word, pattern, timedOut: false });
  b.version++;
  const attempt = b.rows.length;
  const solved = isSolved(pattern);
  if (solved) b.solvedAt = attempt;
  else if (attempt >= round.maxRows) b.out = true;

  return { ok: true, pattern, solved, attempt, result: resolveDuel(round) };
}

/** Burns a row for the player. @returns result string or null if nothing happened. */
export function applyDuelTimeout(round, userId) {
  if (round.status !== 'playing') return null;
  const b = round.boards[userId];
  if (!b || boardDone(b)) return null;
  b.rows.push({ word: null, pattern: null, timedOut: true });
  b.version++;
  if (b.rows.length >= round.maxRows) b.out = true;
  return resolveDuel(round);
}

/**
 * Player leaves the round. If exactly one player remains, they win outright
 * (last one standing); otherwise the round resolves normally.
 * @returns result string or null.
 */
export function forfeitDuel(round, userId) {
  if (round.status !== 'playing') return null;
  const b = round.boards[userId];
  if (!b || boardDone(b)) return null;
  b.forfeited = true;
  b.version++;
  const alive = Object.keys(round.boards).filter((id) => !round.boards[id].forfeited);
  if (alive.length === 1) {
    round.version++;
    round.status = 'won';
    round.winnerIds = alive;
    return 'won';
  }
  return resolveDuel(round);
}
