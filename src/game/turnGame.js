/**
 * Turn-by-Turn round engine (pure). All players share one board and one secret.
 * Players guess in `order`; each gets `turnsEach` turns, so the board has
 * order.length * turnsEach rows. First to solve wins; full board → draw.
 */
import { scoreGuess, isSolved } from './scoring.js';

export function createTurnRound({ secret, order, turnsEach, startIdx = 0 }) {
  if (!order?.length) throw new Error('order must have at least one player');
  return {
    kind: 'turn',
    version: 0,
    secret,
    status: 'playing',
    winnerId: null,
    order: [...order],
    turnsEach,
    maxRows: order.length * turnsEach,
    rows: [],
    turnIdx: startIdx % order.length,
    deadline: null,
    timer: null,
  };
}

export function currentTurnUser(round) {
  return round.order[round.turnIdx];
}

export function rowsLeft(round) {
  return round.maxRows - round.rows.length;
}

function advance(round) {
  round.version++;
  if (round.rows.length >= round.maxRows) {
    round.status = 'draw';
    return 'draw';
  }
  round.turnIdx = (round.turnIdx + 1) % round.order.length;
  return 'continue';
}

/**
 * @returns {{ok:false, reason:'not_playing'|'not_your_turn'|'not_in_round'} |
 *           {ok:true, pattern:string[], event:'continue'|'won'|'draw'}}
 */
export function applyTurnGuess(round, userId, word) {
  if (round.status !== 'playing') return { ok: false, reason: 'not_playing' };
  if (!round.order.includes(userId)) return { ok: false, reason: 'not_in_round' };
  if (currentTurnUser(round) !== userId) return { ok: false, reason: 'not_your_turn' };

  const pattern = scoreGuess(round.secret, word);
  round.rows.push({ userId, word, pattern, timedOut: false });

  if (isSolved(pattern)) {
    round.version++;
    round.status = 'won';
    round.winnerId = userId;
    return { ok: true, pattern, event: 'won' };
  }
  return { ok: true, pattern, event: advance(round) };
}

/** Burns the current player's row. @returns 'continue'|'draw'|null (null = nothing happened) */
export function applyTurnTimeout(round, userId) {
  if (round.status !== 'playing') return null;
  if (currentTurnUser(round) !== userId) return null;
  round.rows.push({ userId, word: null, pattern: null, timedOut: true });
  return advance(round);
}

/**
 * Removes a player from the round. Their unused turns vanish.
 * @returns 'continue' | 'won' (last player standing) | 'draw' (nobody left) | null
 */
export function forfeitTurn(round, userId) {
  if (round.status !== 'playing') return null;
  const idx = round.order.indexOf(userId);
  if (idx === -1) return null;

  const wasTheirTurn = idx === round.turnIdx;
  round.order.splice(idx, 1);
  round.version++;

  // Rows already played stay; recompute the ceiling from remaining players'
  // remaining turns so the board can't exceed what is actually playable.
  const used = new Map();
  for (const r of round.rows) used.set(r.userId, (used.get(r.userId) ?? 0) + 1);
  let remainingTurns = 0;
  for (const p of round.order) remainingTurns += Math.max(0, round.turnsEach - (used.get(p) ?? 0));
  round.maxRows = round.rows.length + remainingTurns;

  if (round.order.length === 0) {
    round.status = 'draw';
    return 'draw';
  }
  if (round.order.length === 1) {
    round.status = 'won';
    round.winnerId = round.order[0];
    return 'won';
  }
  if (wasTheirTurn) {
    round.turnIdx = idx % round.order.length; // next player slides into this slot
  } else if (idx < round.turnIdx) {
    round.turnIdx -= 1;
  }
  if (remainingTurns === 0) {
    round.status = 'draw';
    return 'draw';
  }
  return 'continue';
}
