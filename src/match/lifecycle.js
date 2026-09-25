/**
 * Discord-aware orchestration of a match: threads, board messages, timers,
 * round/match end, stats. Every mutation of game state happens synchronously
 * (before any await) so timers and guesses can never interleave mid-update.
 */
import { ThreadAutoArchiveDuration } from 'discord.js';
import { ARCHIVE_DELAY_MS, REMATCH_IDLE_MS } from '../constants.js';
import { pickSecret } from '../game/words.js';
import {
  createTurnRound,
  applyTurnGuess,
  applyTurnTimeout,
  forfeitTurn,
  currentTurnUser,
} from '../game/turnGame.js';
import { createDuelRound, applyDuelGuess, applyDuelTimeout, forfeitDuel, boardDone } from '../game/duelGame.js';
import { ctx } from './context.js';
import {
  newId,
  registerMatch,
  unregisterMatch,
  unregisterUser,
  activePlayers,
  playerName,
} from './registry.js';
import { scheduleGuarded, clearTimer } from './timers.js';
import { renderBoard, renderGuessFeedback } from '../render/board.js';
import { roundResultEmbed, rematchButtons, finalScoreEmbed } from '../render/embeds.js';
import { fetchChannel, editMessage, NO_PINGS, relTime } from '../util/discord.js';
import { log } from '../util/logger.js';

/* ------------------------------------------------------------------ helpers */

function turnMs(match) {
  return match.turnSeconds * 1000;
}

async function thread(match) {
  return fetchChannel(ctx.client, match.threadId);
}

async function send(match, payload) {
  const t = await thread(match);
  if (!t) return null;
  try {
    return await t.send({ allowedMentions: NO_PINGS, ...payload });
  } catch (err) {
    log.warn(`send to thread ${match.threadId} failed:`, err?.message ?? err);
    return null;
  }
}

/** Serialised edit of the round's board message. */
export function refreshBoard(match, opts = {}) {
  if (!match.round || !match.boardMessageId) return Promise.resolve();
  const payload = { embeds: [renderBoard(match, opts)] };
  match.editChain = match.editChain
    .then(() => editMessage(ctx.client, match.threadId, match.boardMessageId, payload))
    .catch((err) => log.warn('board edit failed:', err?.message ?? err));
  return match.editChain;
}

function clearRoundTimers(match) {
  const r = match.round;
  if (!r) return;
  if (r.kind === 'turn') clearTimer(r);
  else for (const b of Object.values(r.boards)) clearTimer(b);
}

/* ------------------------------------------------------------- timers (sync) */

function armTurnTimer(match) {
  const round = match.round;
  clearTimer(round);
  if (round.status !== 'playing') return;
  const userId = currentTurnUser(round);
  const version = round.version;
  round.deadline = Date.now() + turnMs(match);
  round.timer = scheduleGuarded(
    turnMs(match),
    () => match.round === round && round.status === 'playing' && round.version === version,
    () => onTurnTimeout(match, round, userId),
  );
}

function armDuelTimer(match, userId) {
  const round = match.round;
  const board = round.boards[userId];
  clearTimer(board);
  if (round.status !== 'playing' || boardDone(board)) return;
  const version = board.version;
  board.deadline = Date.now() + turnMs(match);
  board.timer = scheduleGuarded(
    turnMs(match),
    () => match.round === round && round.status === 'playing' && board.version === version && !boardDone(board),
    () => onDuelTimeout(match, round, userId),
  );
}

/* ------------------------------------------------------------- match start */

/**
 * @param {object} p
 * @param {import('discord.js').TextChannel} p.channel
 * @param {'turn'|'duel'} p.mode
 * @param {number} p.turnsEach
 * @param {{id:string,name:string}[]} p.players
 */
export async function startMatch({ channel, mode, turnsEach, players }) {
  const match = {
    id: newId(),
    guildId: channel.guildId,
    channelId: channel.id,
    threadId: null,
    mode,
    turnsEach,
    turnSeconds: ctx.config.turnSeconds,
    players: players.map((p) => ({ id: p.id, name: p.name })),
    score: Object.fromEntries([...players.map((p) => [p.id, 0]), ['draws', 0]]),
    roundNumber: 0,
    roundsPlayed: 0,
    round: null,
    roundParticipants: [],
    status: 'active',
    rematchVotes: new Set(),
    leftPlayers: new Set(),
    boardMessageId: null,
    resultMessageId: null,
    usedSecrets: new Set(),
    editChain: Promise.resolve(),
    idleTimer: null,
    idleDeadline: null,
  };

  const modeLabel = mode === 'turn' ? 'turn' : 'duel';
  const name = `wordle-${modeLabel}-${players.map((p) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '')).join('-vs-')}`.slice(0, 95);
  const t = await channel.threads.create({
    name: name || `wordle-${modeLabel}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    reason: 'CoWordle match',
  });
  match.threadId = t.id;
  registerMatch(match);

  for (const p of players) {
    try {
      await t.members.add(p.id);
    } catch (err) {
      log.warn(`could not add ${p.id} to thread:`, err?.message ?? err);
    }
  }

  await t.send({
    content: `${players.map((p) => `<@${p.id}>`).join(' ')} — your **${mode === 'turn' ? 'Turn-by-Turn' : 'Duel'}** match starts now! Guess with \`/guess word:<word>\` (you can run it anywhere in the server). \`/help\` for the rules.`,
    allowedMentions: { users: players.map((p) => p.id) },
  });

  await startRound(match);
  return match;
}

export async function startRound(match) {
  clearTimer(match, 'idleTimer');
  match.roundNumber += 1;
  match.status = 'active';
  match.rematchVotes = new Set();
  match.resultMessageId = null;
  match.boardMessageId = null;

  const players = activePlayers(match);
  match.roundParticipants = players.map((p) => p.id);
  const secret = pickSecret(match.usedSecrets);

  if (match.mode === 'turn') {
    match.round = createTurnRound({
      secret,
      order: players.map((p) => p.id),
      turnsEach: match.turnsEach,
      startIdx: match.roundNumber - 1,
    });
    armTurnTimer(match);
  } else {
    match.round = createDuelRound({ secret, playerIds: players.map((p) => p.id) });
    for (const p of players) armDuelTimer(match, p.id);
  }

  const msg = await send(match, {
    content: match.mode === 'turn' ? `**Round ${match.roundNumber}** — ${playerName(match, currentTurnUser(match.round))} goes first.` : `**Round ${match.roundNumber}** — go!`,
    embeds: [renderBoard(match)],
  });
  if (!msg) {
    log.error(`match ${match.id}: could not post board; ending`);
    await endMatch(match, 'error');
    return;
  }
  match.boardMessageId = msg.id;
}

/* ------------------------------------------------------------------ guesses */

/**
 * Synchronous part of a guess: mutates state and re-arms timers.
 * @returns {{ok:false, message:string} | {ok:true, feedback:string, ended:boolean}}
 */
export function applyGuess(match, userId, word) {
  if (match.status !== 'active' || !match.round) {
    return { ok: false, message: 'The round is over — vote **Rematch** or **Leave** in the game thread.' };
  }
  const round = match.round;

  if (match.mode === 'turn') {
    const res = applyTurnGuess(round, userId, word);
    if (!res.ok) {
      if (res.reason === 'not_your_turn') {
        return { ok: false, message: `It's **${playerName(match, currentTurnUser(round))}'s** turn (ends ${relTime(round.deadline)}).` };
      }
      if (res.reason === 'not_in_round') return { ok: false, message: 'You are not part of this round.' };
      return { ok: false, message: 'The round is not in progress.' };
    }
    const ended = res.event !== 'continue';
    if (!ended) armTurnTimer(match);
    else clearTimer(round);
    const feedback = renderGuessFeedback(match, userId, {
      pattern: res.pattern,
      word,
      attempt: round.rows.length,
      maxRows: round.maxRows,
      solved: res.event === 'won',
      next: ended ? null : `Next up: **${playerName(match, currentTurnUser(round))}** (ends ${relTime(round.deadline)})`,
    });
    return { ok: true, feedback, ended };
  }

  const res = applyDuelGuess(round, userId, word);
  if (!res.ok) {
    const msg = {
      already_solved: 'You already solved this round — wait for the others to finish.',
      out: 'You are out of guesses for this round.',
      forfeited: 'You left this round.',
      not_in_round: 'You are not part of this round.',
    }[res.reason] ?? 'The round is not in progress.';
    return { ok: false, message: msg };
  }
  const board = round.boards[userId];
  const ended = res.result !== 'pending';
  if (ended) clearRoundTimers(match);
  else armDuelTimer(match, userId);
  const feedback = renderGuessFeedback(match, userId, {
    pattern: res.pattern,
    word,
    attempt: res.attempt,
    maxRows: round.maxRows,
    solved: res.solved,
    next: ended
      ? null
      : boardDone(board)
        ? 'Waiting for the other players to finish…'
        : `Next guess ends ${relTime(board.deadline)}`,
  });
  return { ok: true, feedback, ended };
}

/** Async follow-up after applyGuess: refresh board, end round if needed. */
export async function afterMutation(match, ended) {
  if (ended && match.round && match.round.status !== 'playing' && match.status === 'active') {
    await endRound(match);
  } else {
    await refreshBoard(match);
  }
}

/* ----------------------------------------------------------------- timeouts */

function onTurnTimeout(match, round, userId) {
  const event = applyTurnTimeout(round, userId);
  if (event === null) return;
  if (event === 'continue') armTurnTimer(match);
  const who = playerName(match, userId);
  const next = event === 'continue' ? ` — **${playerName(match, currentTurnUser(round))}**, you're up.` : '';
  send(match, { content: `⏱️ **${who}** ran out of time.${next}` }).catch(() => {});
  afterMutation(match, event !== 'continue').catch((err) => log.error('afterMutation failed:', err));
}

function onDuelTimeout(match, round, userId) {
  const result = applyDuelTimeout(round, userId);
  if (result === null) return;
  const ended = result !== 'pending';
  if (ended) clearRoundTimers(match);
  else armDuelTimer(match, userId);
  const b = round.boards[userId];
  send(match, { content: `⏱️ **${playerName(match, userId)}** ran out of time (${b.rows.length}/${round.maxRows})${b.out ? ' and is out of guesses' : ''}.` }).catch(() => {});
  afterMutation(match, ended).catch((err) => log.error('afterMutation failed:', err));
}

/* ------------------------------------------------------------------ forfeit */

/**
 * Player concedes the current round and leaves the series.
 * @returns {string} message for the player
 */
export async function forfeit(match, userId) {
  if (match.leftPlayers.has(userId)) return 'You already left this match.';
  match.leftPlayers.add(userId);
  unregisterUser(match, userId);

  if (match.status === 'active' && match.round) {
    const round = match.round;
    const result = match.mode === 'turn' ? forfeitTurn(round, userId) : forfeitDuel(round, userId);
    match.forfeitedThisRound ??= new Set();
    match.forfeitedThisRound.add(userId);
    if (match.mode === 'turn' && result === 'continue') armTurnTimer(match);
    const ended = result !== null && result !== 'continue' && result !== 'pending';
    if (ended) clearRoundTimers(match);
    await send(match, { content: `🏳️ **${playerName(match, userId)}** forfeited and left the match.` });
    await afterMutation(match, ended);
    if (!ended && activePlayers(match).length < 2) await endMatch(match, 'left');
    return 'You forfeited the round and left the match.';
  }

  // Between rounds: acts like "Leave".
  await send(match, { content: `🚪 **${playerName(match, userId)}** left the match.` });
  if (activePlayers(match).length < 2) await endMatch(match, 'left');
  else await updateResultMessage(match);
  return 'You left the match.';
}

/* ---------------------------------------------------------------- round end */

export async function endRound(match) {
  const round = match.round;
  if (!round || match.status !== 'active') return;
  clearRoundTimers(match);
  match.status = 'awaiting_rematch';
  match.roundsPlayed += 1;
  match.usedSecrets.add(round.secret);

  const winnerIds = round.kind === 'turn' ? (round.winnerId ? [round.winnerId] : []) : [...round.winnerIds];
  if (winnerIds.length === 1) match.score[winnerIds[0]] = (match.score[winnerIds[0]] ?? 0) + 1;
  else match.score.draws += 1; // nobody solved, or a tie

  const forfeited = match.forfeitedThisRound ?? new Set();
  const result = forfeited.size && winnerIds.length ? 'forfeit' : round.status === 'tie' ? 'tie' : winnerIds.length ? 'win' : 'draw';
  match.forfeitedThisRound = new Set();

  try {
    await ctx.stats.recordRoundResult({
      guildId: match.guildId,
      matchId: match.id,
      mode: match.mode,
      playerIds: match.roundParticipants,
      winnerIds,
      result,
      secret: round.secret,
    });
  } catch (err) {
    log.error('recordRoundResult failed:', err);
  }

  await refreshBoard(match, { reveal: true });

  if (activePlayers(match).length < 2) {
    await send(match, { embeds: [roundResultEmbed(match)] });
    await endMatch(match, 'left');
    return;
  }

  match.idleDeadline = Date.now() + REMATCH_IDLE_MS;
  match.idleTimer = setTimeout(() => {
    if (match.status === 'awaiting_rematch') endMatch(match, 'idle').catch((err) => log.error('endMatch failed:', err));
  }, REMATCH_IDLE_MS);

  const msg = await send(match, {
    content: activePlayers(match).map((p) => `<@${p.id}>`).join(' '),
    embeds: [roundResultEmbed(match)],
    components: rematchButtons(match),
    allowedMentions: { users: activePlayers(match).map((p) => p.id) },
  });
  match.resultMessageId = msg?.id ?? null;
}

export async function updateResultMessage(match, { disabled = false } = {}) {
  if (!match.resultMessageId) return;
  await editMessage(ctx.client, match.threadId, match.resultMessageId, {
    embeds: [roundResultEmbed(match)],
    components: rematchButtons(match, { disabled }),
  });
}

/* ------------------------------------------------------------------ rematch */

/** @returns {string} ephemeral message for the voter */
export async function voteRematch(match, userId) {
  if (match.status !== 'awaiting_rematch') return 'There is no rematch vote right now.';
  if (match.leftPlayers.has(userId)) return 'You already left this match.';
  match.rematchVotes.add(userId);
  const active = activePlayers(match);
  if (active.every((p) => match.rematchVotes.has(p.id))) {
    await updateResultMessage(match, { disabled: true });
    await startRound(match);
    return 'Everyone is in — next round started!';
  }
  await updateResultMessage(match);
  return `Vote counted (${match.rematchVotes.size}/${active.length}).`;
}

export async function leaveMatch(match, userId) {
  if (match.leftPlayers.has(userId)) return 'You already left this match.';
  return forfeit(match, userId);
}

/* ---------------------------------------------------------------- match end */

export async function endMatch(match, reason) {
  if (match.status === 'ended') return;
  match.status = 'ended';
  clearRoundTimers(match);
  clearTimer(match, 'idleTimer');
  unregisterMatch(match);

  if (match.resultMessageId) {
    await editMessage(ctx.client, match.threadId, match.resultMessageId, {
      embeds: [roundResultEmbed(match)],
      components: [],
    });
  }
  if (reason !== 'thread_deleted') {
    await send(match, { embeds: [finalScoreEmbed(match, reason)] });
    setTimeout(async () => {
      const t = await thread(match);
      if (t) t.setArchived(true, 'CoWordle match finished').catch(() => {});
    }, ARCHIVE_DELAY_MS);
  }
  log.info(`match ${match.id} ended (${reason})`);
}
