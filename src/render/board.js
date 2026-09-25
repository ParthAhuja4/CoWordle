/**
 * Board rendering. Layout rules that keep things readable on phones:
 *  - every board row is short (5 emoji + 5 letters + a short name) so it never wraps
 *  - names are truncated to NAME_MAX characters inside boards
 *  - Duel boards are side-by-side only for 2 players; 3+ players stack full-width
 *  - Duel boards show only used rows; the "n/6" counter carries the rest
 *  - countdowns use Discord relative timestamps, which render natively everywhere
 */
import { EmbedBuilder } from 'discord.js';
import { EMOJI, MODES, WORD_LEN } from '../constants.js';
import { currentTurnUser, rowsLeft } from '../game/turnGame.js';
import { bestSolve, pendingPlayers, boardDone } from '../game/duelGame.js';
import { activePlayers, playerName } from '../match/registry.js';
import { renderKeyboard, renderKeyboardLine, patternToEmoji, emptyRow, lettersOf } from './keyboard.js';
import { relTime } from '../util/discord.js';

const COLORS = { playing: 0x538d4e, won: 0xf5c518, tie: 0xb59f3b, draw: 0x787c7e, ended: 0x3a3a3c };
const NAME_MAX = 14;
const placeholder = `\`${Array(WORD_LEN).fill('·').join(' ')}\``;
export const LEGEND = '🟩 right spot · 🟨 wrong spot · ⬜ not in word';

export function shortName(name, max = NAME_MAX) {
  const s = String(name ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const nameOf = (match, id) => shortName(playerName(match, id));

export function seriesLine(match) {
  const parts = activePlayers(match).map((p) => `**${shortName(p.name)}** ${match.score[p.id] ?? 0}`);
  const left = match.players.filter((p) => match.leftPlayers.has(p.id));
  if (left.length) parts.push(...left.map((p) => `~~${shortName(p.name)}~~ ${match.score[p.id] ?? 0}`));
  parts.push(`🤝 ${match.score.draws ?? 0}`);
  return `🏅 ${parts.join(' · ')}`;
}

function title(match) {
  const m = MODES[match.mode];
  return `${m.emoji} ${m.label} · Round ${match.roundNumber}`;
}

function footer(match, extra = '') {
  return { text: `${extra ? `${extra} · ` : ''}${LEGEND}` };
}

/* ---------------------------------------------------------------- Turn-by-Turn */

function turnRowLine(match, row) {
  const who = nameOf(match, row.userId);
  if (row.timedOut) return `${emptyRow()} \`⏱ ─ ─ ─ ─\` ${who}`;
  return `${patternToEmoji(row.pattern)} ${lettersOf(row.word)} ${who}`;
}

export function renderTurnBoard(match) {
  const round = match.round;
  const lines = [seriesLine(match), ''];

  for (const row of round.rows) lines.push(turnRowLine(match, row));
  for (let i = round.rows.length; i < round.maxRows; i++) lines.push(`${emptyRow()} ${placeholder}`);
  lines.push('');
  lines.push(renderKeyboard(round.rows));
  lines.push('');

  if (round.status === 'playing') {
    lines.push(`▶️ **${nameOf(match, currentTurnUser(round))}**, your turn · ends ${relTime(round.deadline)}`);
    const order = round.order.map((id, i) => (i === round.turnIdx ? `**${nameOf(match, id)}**` : nameOf(match, id)));
    lines.push(`🔁 ${order.join(' → ')} · ${rowsLeft(round)} row${rowsLeft(round) === 1 ? '' : 's'} left`);
  } else if (round.status === 'won') {
    lines.push(`🏆 **${nameOf(match, round.winnerId)}** solved **${round.secret.toUpperCase()}**!`);
  } else {
    lines.push(`🤝 Draw — the word was **${round.secret.toUpperCase()}**`);
  }

  return new EmbedBuilder()
    .setTitle(title(match))
    .setDescription(lines.join('\n'))
    .setColor(COLORS[round.status] ?? COLORS.playing)
    .setFooter(footer(match, `${round.turnsEach} turn${round.turnsEach > 1 ? 's' : ''} each · ${match.turnSeconds}s per turn`));
}

/* ------------------------------------------------------------------------ Duel */

function duelRowLines(board, { showLetters, fill = false, maxRows = 0 }) {
  const lines = [];
  for (const row of board.rows) {
    if (row.timedOut) lines.push(`${emptyRow()}${showLetters ? ' `⏱ ─ ─ ─ ─`' : ' ⏱'}`);
    else lines.push(`${patternToEmoji(row.pattern)}${showLetters ? ` ${lettersOf(row.word)}` : ''}`);
  }
  if (fill) for (let i = board.rows.length; i < maxRows; i++) lines.push(emptyRow());
  if (!lines.length) lines.push('_no guesses yet_');
  return lines;
}

function duelStatus(round, board) {
  if (board.forfeited) return '🏳️ left';
  if (board.solvedAt !== null) return `✅ solved in ${board.solvedAt}`;
  if (board.out) return '❌ out of guesses';
  if (round.status !== 'playing') return '⏹ round over';
  const best = bestSolve(round);
  if (best !== Infinity) {
    const left = best - board.rows.length;
    return `⚡ ${left} guess${left === 1 ? '' : 'es'} to tie/beat · ${relTime(board.deadline)}`;
  }
  return `⏳ next guess ${relTime(board.deadline)}`;
}

function duelHeadline(match, round) {
  const word = `**${round.secret.toUpperCase()}**`;
  if (round.status === 'playing') {
    const pend = pendingPlayers(round);
    const best = bestSolve(round);
    if (best !== Infinity && pend.length) return `⚡ Someone solved it in ${best}! ${pend.map((id) => nameOf(match, id)).join(', ')} can still tie or beat it.`;
    return `🏁 Race! Fewest guesses wins.`;
  }
  if (round.status === 'won') return `🏆 **${nameOf(match, round.winnerIds[0])}** wins — the word was ${word}`;
  if (round.status === 'tie') return `🤝 Tie: ${round.winnerIds.map((id) => `**${nameOf(match, id)}**`).join(', ')} — the word was ${word}`;
  return `😶 Nobody solved it — the word was ${word}`;
}

export function renderDuelBoard(match, { reveal = false } = {}) {
  const round = match.round;
  const ids = Object.keys(round.boards);
  const sideBySide = ids.length <= 2;

  const embed = new EmbedBuilder()
    .setTitle(title(match))
    .setColor(COLORS[round.status] ?? COLORS.playing)
    .setDescription([seriesLine(match), duelHeadline(match, round)].join('\n'))
    .setFooter(footer(match, `${match.turnSeconds}s per guess · letters private, see /board`));

  for (const userId of ids) {
    const board = round.boards[userId];
    const lines = duelRowLines(board, { showLetters: reveal });
    lines.push(duelStatus(round, board));
    if (board.rows.some((r) => r.word)) lines.push(renderKeyboardLine(board.rows, { includeUnused: false }));
    const icon = board.forfeited ? '🏳️' : board.solvedAt !== null ? '✅' : board.out ? '❌' : boardDone(board) ? '⏹' : '🟦';
    embed.addFields({
      name: `${icon} ${nameOf(match, userId)} · ${board.rows.length}/${round.maxRows}`,
      value: lines.join('\n'),
      inline: sideBySide,
    });
  }
  return embed;
}

export function renderBoard(match, opts) {
  return match.mode === 'turn' ? renderTurnBoard(match, opts) : renderDuelBoard(match, opts);
}

/* --------------------------------------------------------- private (ephemeral) */

/** The caller's own view: full letters for their own Duel board. */
export function renderPrivateView(match, userId) {
  const round = match.round;
  if (!round) return 'No round in progress.';
  const lines = [];
  if (match.mode === 'turn') {
    if (round.status === 'playing') {
      const turn = currentTurnUser(round);
      lines.push(turn === userId ? `▶️ **Your turn** · ends ${relTime(round.deadline)}` : `⏳ Waiting for **${nameOf(match, turn)}** · ends ${relTime(round.deadline)}`);
    }
    for (const row of round.rows) lines.push(turnRowLine(match, row));
    lines.push('', renderKeyboard(round.rows));
    lines.push(`📋 Board: <#${match.threadId}>`);
    return lines.join('\n');
  }
  const board = round.boards[userId];
  if (!board) return 'You are not in this round.';
  lines.push(`**Your board** · ${board.rows.length}/${round.maxRows}`);
  lines.push(...duelRowLines(board, { showLetters: true, fill: true, maxRows: round.maxRows }));
  lines.push(duelStatus(round, board));
  lines.push('', renderKeyboard(board.rows));
  lines.push(`📋 Board: <#${match.threadId}>`);
  return lines.join('\n');
}

/** Ephemeral feedback right after a guess. */
export function renderGuessFeedback(match, userId, { pattern, word, attempt, maxRows, solved, next }) {
  const lines = [`${patternToEmoji(pattern)} ${lettersOf(word)} · ${attempt}/${maxRows}`];
  if (solved) lines.push('🎉 **You solved it!**');
  if (next) lines.push(next);
  const rows = match.mode === 'turn' ? match.round.rows : match.round.boards[userId]?.rows ?? [];
  lines.push('', renderKeyboard(rows));
  lines.push(`📋 Board: <#${match.threadId}>`);
  return lines.join('\n');
}

export { EMOJI };
