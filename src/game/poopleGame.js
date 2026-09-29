/**
 * Poople round engine (pure). Every player builds their own word ladder from the
 * same start word to the target, changing one letter per step. There is no clock
 * until somebody arrives; that first arrival sets the step count to beat and opens
 * a finish window for everyone still going. When the window closes (or nobody is
 * left going) the fewest steps wins; equal steps → tie.
 *
 * Every step counts and none can be taken back. Going back to an earlier word
 * is allowed (it is simply another step), so a player can never get stuck in a
 * word whose only neighbour is the one they came from.
 *
 * Dictionary checks happen in the room; this module only enforces ladder rules.
 */
import { oneLetterApart } from './poopleWords.js';
import { POOPLE_TARGET } from '../constants.js';

export function createPoopleRound({ start, par, path, playerIds, target = POOPLE_TARGET }) {
  const boards = {};
  for (const id of playerIds) {
    boards[id] = { steps: [], arrivedAt: null, forfeited: false, version: 0 };
  }
  return {
    kind: 'poople',
    version: 0,
    start,
    target,
    par,
    path,
    status: 'playing',
    winnerIds: [],
    bestSteps: null,
    windowClosed: false,
    deadline: null,
    timer: null,
    boards,
  };
}

export function boardDone(b) {
  return b.arrivedAt !== null || b.forfeited;
}

export function lastWord(round, b) {
  return b.steps.at(-1) ?? round.start;
}

/**
 * Evaluates the round and, if decided, updates status/winnerIds.
 * @returns 'pending' | 'won' | 'tie' | 'draw'
 */
export function resolvePoople(round) {
  if (round.status !== 'playing') return round.status;
  const boards = Object.values(round.boards);
  const stillGoing = boards.some((b) => !boardDone(b));
  if (stillGoing && !round.windowClosed) return 'pending';

  round.version++;
  if (round.bestSteps === null) {
    round.status = 'draw';
    return 'draw';
  }
  const winners = Object.entries(round.boards)
    .filter(([, b]) => b.arrivedAt === round.bestSteps)
    .map(([id]) => id);
  round.winnerIds = winners;
  round.status = winners.length > 1 ? 'tie' : 'won';
  return round.status;
}

/**
 * @returns {{ok:false, reason:'not_playing'|'not_in_round'|'arrived'|'forfeited'|'not_one_letter'} |
 *           {ok:true, arrived:boolean, steps:number, firstArrival:boolean, result:string}}
 */
export function applyPoopleStep(round, userId, word) {
  if (round.status !== 'playing') return { ok: false, reason: 'not_playing' };
  const b = round.boards[userId];
  if (!b) return { ok: false, reason: 'not_in_round' };
  if (b.arrivedAt !== null) return { ok: false, reason: 'arrived' };
  if (b.forfeited) return { ok: false, reason: 'forfeited' };
  if (!oneLetterApart(lastWord(round, b), word)) return { ok: false, reason: 'not_one_letter' };

  b.steps.push(word);
  b.version++;
  const steps = b.steps.length;
  const arrived = word === round.target;
  let firstArrival = false;
  if (arrived) {
    b.arrivedAt = steps;
    firstArrival = round.bestSteps === null;
    if (firstArrival || steps < round.bestSteps) round.bestSteps = steps;
    round.version++;
  }
  return { ok: true, arrived, steps, firstArrival, result: resolvePoople(round) };
}

/** The finish window ran out. @returns result string or null if nothing happened. */
export function closePoopleWindow(round) {
  if (round.status !== 'playing') return null;
  round.windowClosed = true;
  return resolvePoople(round);
}

/**
 * Player leaves the round. If nobody has arrived yet and exactly one player
 * remains, they win outright (last one standing); otherwise the round
 * resolves normally.
 * @returns result string or null.
 */
export function forfeitPoople(round, userId) {
  if (round.status !== 'playing') return null;
  const b = round.boards[userId];
  if (!b || boardDone(b)) return null;
  b.forfeited = true;
  b.version++;
  const alive = Object.keys(round.boards).filter((id) => !round.boards[id].forfeited);
  if (round.bestSteps === null && alive.length === 1) {
    round.version++;
    round.status = 'won';
    round.winnerIds = alive;
    return 'won';
  }
  return resolvePoople(round);
}
