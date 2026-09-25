import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { DEFAULT_TURNS, MAX_TURNS, MODES } from '../constants.js';
import { getMatchForUser } from '../match/registry.js';
import { getLobbyForUser } from '../match/lobbies.js';
import { getChallengeByHost, createChallenge, challengePayload } from '../match/challenges.js';
import { ephemeral, displayName, isPlayableTextChannel, missingBotPerms } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('challenge')
  .setDescription('Challenge specific people to a CoWordle match')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('user1').setDescription('Opponent').setRequired(true))
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
  .addUserOption((o) => o.setName('user2').setDescription('Another opponent'))
  .addUserOption((o) => o.setName('user3').setDescription('Another opponent'))
  .addUserOption((o) => o.setName('user4').setDescription('Another opponent'))
  .addIntegerOption((o) =>
    o.setName('turns').setDescription(`Turn-by-Turn only: turns per player (1–${MAX_TURNS}, default ${DEFAULT_TURNS})`).setMinValue(1).setMaxValue(MAX_TURNS),
  );

export async function execute(interaction) {
  const { guildId, user, channel } = interaction;
  const mode = interaction.options.getString('mode', true);
  const turnsEach = interaction.options.getInteger('turns') ?? DEFAULT_TURNS;

  if (!isPlayableTextChannel(channel)) {
    return interaction.reply(ephemeral('Use `/challenge` in a regular text channel (not inside a thread).'));
  }
  const missing = missingBotPerms(channel);
  if (missing.length) {
    return interaction.reply(ephemeral(`I'm missing permissions in this channel: **${missing.join(', ')}**.`));
  }
  if (getMatchForUser(guildId, user.id)) return interaction.reply(ephemeral("You're already in a match."));
  if (getLobbyForUser(guildId, user.id)) return interaction.reply(ephemeral("You're in a lobby. `/cancel` it first."));
  if (getChallengeByHost(guildId, user.id)) return interaction.reply(ephemeral('You already have a pending challenge. `/cancel` it first.'));

  const seen = new Set([user.id]);
  const invitees = [];
  for (const key of ['user1', 'user2', 'user3', 'user4']) {
    const u = interaction.options.getUser(key);
    if (!u) continue;
    if (u.bot) return interaction.reply(ephemeral(`${u.username} is a bot — bots can't play (yet).`));
    if (u.id === user.id) return interaction.reply(ephemeral("You can't challenge yourself."));
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const member = interaction.options.getMember(key);
    invitees.push({ id: u.id, name: member?.displayName ?? u.displayName ?? u.username });
  }
  const busy = invitees.filter((p) => getMatchForUser(guildId, p.id));
  if (busy.length) return interaction.reply(ephemeral(`${busy.map((p) => p.name).join(', ')} ${busy.length > 1 ? 'are' : 'is'} already in a match.`));

  const ch = createChallenge({
    guildId,
    channelId: channel.id,
    host: { id: user.id, name: displayName(interaction) },
    invitees,
    mode,
    turnsEach,
  });
  const msg = await interaction.reply({
    content: invitees.map((p) => `<@${p.id}>`).join(' '),
    ...challengePayload(ch),
    allowedMentions: { users: invitees.map((p) => p.id) },
    withResponse: true,
  });
  ch.messageId = msg.resource?.message?.id ?? (await interaction.fetchReply()).id;
}
