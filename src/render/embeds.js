import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { MODES, MAX_PLAYERS } from '../constants.js';
import { activePlayers, playerName } from '../match/registry.js';
import { seriesLine, shortName, LEGEND } from './board.js';
import { relTime } from '../util/discord.js';

// Short labels + an emoji: Discord shrinks buttons on phones and truncates long text.
const btn = (id, label, style, { emoji = null, disabled = false } = {}) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
};

/* ---------------------------------------------------------------------- lobby */

export function lobbyEmbed(lobby, { state = 'open' } = {}) {
  const m = MODES[lobby.mode];
  const seats = [];
  for (let i = 0; i < lobby.maxPlayers; i++) {
    const p = lobby.players[i];
    seats.push(p ? `${p.id === lobby.hostId ? '👑' : '🟢'} ${shortName(p.name, 20)}` : '⚪ _open seat_');
  }
  const lines = [
    `${m.emoji} **${m.label}**${lobby.mode === 'turn' ? ` · ${lobby.turnsEach} turn${lobby.turnsEach > 1 ? 's' : ''} each` : ''} · **${lobby.players.length}/${lobby.maxPlayers}** players`,
    '',
    ...seats,
    '',
  ];
  if (state === 'open') lines.push(`Tap **Join** or run \`/play mode:${lobby.mode}\`. Starts when full or when 👑 taps **Start**.`, `⌛ Expires ${relTime(lobby.expiresAt)}`);
  else if (state === 'started') lines.push('🚀 Game started — check the new thread!');
  else if (state === 'expired') lines.push('⌛ This lobby expired.');
  else if (state === 'closed') lines.push('🚪 The host closed this lobby.');
  return new EmbedBuilder()
    .setTitle(`Lobby · ${m.label}`)
    .setDescription(lines.join('\n'))
    .setColor(state === 'open' ? 0x5865f2 : 0x3a3a3c);
}

export function lobbyButtons(lobby, { disabled = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      btn(`lobby:join:${lobby.id}`, 'Join', ButtonStyle.Success, { emoji: '➕', disabled }),
      btn(`lobby:start:${lobby.id}`, 'Start', ButtonStyle.Primary, { emoji: '▶️', disabled }),
      btn(`lobby:leave:${lobby.id}`, 'Leave', ButtonStyle.Secondary, { emoji: '🚪', disabled }),
    ),
  ];
}

/* ------------------------------------------------------------------ challenge */

export function challengeEmbed(ch, { state = 'open', note = '' } = {}) {
  const m = MODES[ch.mode];
  const status = (id) => (ch.accepted.has(id) ? '✅' : ch.declined.has(id) ? '❌' : '⏳');
  const lines = [
    `👑 **${shortName(ch.hostName, 20)}** invites you to **${m.label}**${ch.mode === 'turn' ? ` · ${ch.turnsEach} turn${ch.turnsEach > 1 ? 's' : ''} each` : ''}`,
    '',
    ...ch.invitees.map((p) => `${status(p.id)} ${shortName(p.name, 20)}`),
    '',
  ];
  if (state === 'open') lines.push('Tap **Accept** or **Decline**. Starts when everyone answers or when 👑 taps **Start**.', `⌛ Expires ${relTime(ch.expiresAt)}`);
  if (note) lines.push(note);
  return new EmbedBuilder()
    .setTitle(`Challenge · ${m.label}`)
    .setDescription(lines.join('\n'))
    .setColor(state === 'open' ? 0xeb459e : 0x3a3a3c);
}

export function challengeButtons(ch, { disabled = false } = {}) {
  // Two rows: invitee actions, then host actions. Four buttons in one row get cramped on phones.
  return [
    new ActionRowBuilder().addComponents(
      btn(`challenge:accept:${ch.id}`, 'Accept', ButtonStyle.Success, { emoji: '✅', disabled }),
      btn(`challenge:decline:${ch.id}`, 'Decline', ButtonStyle.Danger, { emoji: '❌', disabled }),
    ),
    new ActionRowBuilder().addComponents(
      btn(`challenge:start:${ch.id}`, 'Start', ButtonStyle.Primary, { emoji: '▶️', disabled }),
      btn(`challenge:cancel:${ch.id}`, 'Cancel', ButtonStyle.Secondary, { emoji: '🚫', disabled }),
    ),
  ];
}

/* ----------------------------------------------------------------- round end */

export function roundResultText(match) {
  const r = match.round;
  const word = `**${r.secret.toUpperCase()}**`;
  if (match.mode === 'turn') {
    if (r.status === 'won') {
      const row = r.rows.findLast?.((x) => x.userId === r.winnerId && x.pattern?.every((p) => p === 'g'));
      return row
        ? `🏆 **${shortName(playerName(match, r.winnerId), 20)}** solved ${word} on row ${r.rows.length}!`
        : `🏆 **${shortName(playerName(match, r.winnerId), 20)}** wins the round (everyone else left). The word was ${word}.`;
    }
    return `🤝 Draw — nobody found ${word}.`;
  }
  if (r.status === 'won') {
    const b = r.boards[r.winnerIds[0]];
    return b?.solvedAt
      ? `🏆 **${shortName(playerName(match, r.winnerIds[0]), 20)}** solved ${word} in ${b.solvedAt} guess${b.solvedAt === 1 ? '' : 'es'}!`
      : `🏆 **${shortName(playerName(match, r.winnerIds[0]), 20)}** wins the round. The word was ${word}.`;
  }
  if (r.status === 'tie') {
    const n = r.boards[r.winnerIds[0]].solvedAt;
    const names = r.winnerIds.map((id) => `**${shortName(playerName(match, id), 20)}**`);
    const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(' and ');
    return `🤝 Tie! ${list} ${names.length > 2 ? 'all' : 'both'} solved ${word} in ${n}.`;
  }
  return `😶 Nobody solved it — the word was ${word}.`;
}

export function roundResultEmbed(match) {
  const lines = [roundResultText(match), '', seriesLine(match)];
  const active = activePlayers(match);
  if (match.status === 'awaiting_rematch' && active.length >= 2 && match.idleDeadline) {
    const votes = active.map((p) => `${match.rematchVotes.has(p.id) ? '✅' : '⏳'} ${shortName(p.name)}`);
    lines.push('', `🔁 **Rematch?** ${votes.join(' · ')}`);
    lines.push(`Starts when everyone taps Rematch · closes ${relTime(match.idleDeadline)}`);
  }
  return new EmbedBuilder()
    .setTitle(`Round ${match.roundNumber} over`)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2);
}

export function rematchButtons(match, { disabled = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      btn(`rematch:yes:${match.id}`, 'Rematch', ButtonStyle.Success, { emoji: '🔁', disabled }),
      btn(`rematch:no:${match.id}`, 'Leave', ButtonStyle.Secondary, { emoji: '🚪', disabled }),
    ),
  ];
}

export function finalScoreEmbed(match, reason) {
  const ranked = [...match.players].sort((a, b) => (match.score[b.id] ?? 0) - (match.score[a.id] ?? 0));
  const lines = ranked.map((p, i) => `${['🥇', '🥈', '🥉'][i] ?? '▫️'} **${shortName(p.name, 20)}** — ${match.score[p.id] ?? 0}`);
  lines.push(`🤝 Draws: ${match.score.draws ?? 0} · Rounds: ${match.roundsPlayed}`);
  const why = {
    left: 'Not enough players left to continue.',
    idle: 'Nobody voted for a rematch in time.',
    forfeit: 'A player forfeited.',
    thread_deleted: 'The game thread was deleted.',
    error: 'The game hit an error and was closed.',
  }[reason];
  if (why) lines.push(`_${why}_`);
  lines.push('Thanks for playing! Start another with `/play` or `/challenge`.');
  return new EmbedBuilder().setTitle('🏁 Final score').setDescription(lines.join('\n')).setColor(0xf5c518);
}

/* ---------------------------------------------------------------------- help */

export function helpEmbed(turnSeconds) {
  return new EmbedBuilder()
    .setTitle('📖 How to play')
    .setColor(0x538d4e)
    .setDescription(
      [
        `Guess the hidden **5-letter word** in as few tries as you can.`,
        LEGEND,
        `**2–${MAX_PLAYERS} players** · round after round · running series score`,
      ].join('\n'),
    )
    .addFields(
      {
        name: '🎮 Turn-by-Turn',
        value: `One shared board, one word. Take turns (${turnSeconds}s each, 2 turns per player by default). Every guess helps everyone. First to solve wins; full board = draw. Time out and you lose that turn.`,
      },
      {
        name: '⚔️ Duel',
        value: `Own board each, same word, all at once (${turnSeconds}s per guess, 6 rows). Rivals see your colours only. Fewest guesses wins · same = tie · none = draw. When someone solves, others with fewer rows used get a last chance.`,
      },
      {
        name: '🕹️ Playing',
        value: [
          '**Start**: `/play` opens or joins a lobby · `/challenge` invites people',
          '**Guess**: type `/guess` then your word. Only you see the reply, so it works in Duel.',
          '**Keyboard**: under each board. 🟩/🟨 letters are found, ~~struck~~ letters are not in the word.',
          '**Between rounds**: tap 🔁 **Rematch** or 🚪 **Leave**',
          '**Also**: `/board` (your view) · `/forfeit` · `/cancel` · `/stats` · `/leaderboard`',
        ].join('\n'),
      },
      {
        name: '📱 On mobile',
        value: 'Tap the `+` or `/` next to the message box to find commands. Buttons and countdowns work the same as on desktop.',
      },
    );
}
