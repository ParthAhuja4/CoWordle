import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { MAX_PLAYERS, MIN_PLAYERS, DEFAULT_TURNS, MAX_TURNS, MODES } from '../constants.js';
import { getMatchForUser } from '../match/registry.js';
import { getLobbyForUser, findOpenLobby, createLobby, addPlayer, lobbyPayload, refreshLobby, startLobby } from '../match/lobbies.js';
import { getChallengeByHost } from '../match/challenges.js';
import { ephemeral, displayName, isPlayableTextChannel, missingBotPerms, NO_PINGS } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Open or join a CoWordle lobby (random opponents)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('mode')
      .setDescription('Game mode')
      .setRequired(true)
      .addChoices(
        { name: `${MODES.turn.label} — shared board, take turns`, value: 'turn' },
        { name: `${MODES.duel.label} — own boards, race`, value: 'duel' },
      ),
  )
  .addIntegerOption((o) =>
    o.setName('players').setDescription(`Lobby size (${MIN_PLAYERS}–${MAX_PLAYERS}, default 2)`).setMinValue(MIN_PLAYERS).setMaxValue(MAX_PLAYERS),
  )
  .addIntegerOption((o) =>
    o.setName('turns').setDescription(`Turn-by-Turn only: turns per player (1–${MAX_TURNS}, default ${DEFAULT_TURNS})`).setMinValue(1).setMaxValue(MAX_TURNS),
  );

export async function execute(interaction) {
  const { guildId, user, channel } = interaction;
  const mode = interaction.options.getString('mode', true);
  const maxPlayers = interaction.options.getInteger('players') ?? 2;
  const turnsEach = interaction.options.getInteger('turns') ?? DEFAULT_TURNS;

  if (!isPlayableTextChannel(channel)) {
    return interaction.reply(ephemeral('Use `/play` in a regular text channel (not inside a thread), so I can create a game thread there.'));
  }
  const missing = missingBotPerms(channel);
  if (missing.length) {
    return interaction.reply(ephemeral(`I'm missing permissions in this channel: **${missing.join(', ')}**. Ask an admin to grant them.`));
  }
  if (getMatchForUser(guildId, user.id)) {
    return interaction.reply(ephemeral("You're already in a match. Finish it or `/forfeit` first."));
  }
  if (getChallengeByHost(guildId, user.id)) {
    return interaction.reply(ephemeral('You have a pending challenge. `/cancel` it first.'));
  }
  const existing = getLobbyForUser(guildId, user.id);
  if (existing) {
    return interaction.reply(ephemeral(`You're already in a lobby: https://discord.com/channels/${guildId}/${existing.channelId}/${existing.messageId}`));
  }

  const me = { id: user.id, name: displayName(interaction) };

  // Join an open lobby for this mode if there is one (this is the random queue).
  const open = findOpenLobby(guildId, mode);
  if (open) {
    addPlayer(open, me);
    if (open.players.length >= open.maxPlayers) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const lobbyChannel = open.channelId === channel.id ? channel : await interaction.client.channels.fetch(open.channelId).catch(() => null);
      const match = lobbyChannel ? await startLobby(open, lobbyChannel) : null;
      if (!match) {
        return interaction.editReply(ephemeral('Could not start the match (the lobby channel may be gone). Try `/play` again.'));
      }
      return interaction.editReply(ephemeral(`Lobby full — match started in <#${match.threadId}>!`));
    }
    await refreshLobby(open);
    return interaction.reply(
      ephemeral(`Joined the ${MODES[mode].label} lobby (${open.players.length}/${open.maxPlayers}): https://discord.com/channels/${guildId}/${open.channelId}/${open.messageId}`),
    );
  }

  const lobby = createLobby({ guildId, channelId: channel.id, host: me, mode, maxPlayers, turnsEach });
  const msg = await interaction.reply({ ...lobbyPayload(lobby), allowedMentions: NO_PINGS, withResponse: true });
  lobby.messageId = msg.resource?.message?.id ?? (await interaction.fetchReply()).id;
}
