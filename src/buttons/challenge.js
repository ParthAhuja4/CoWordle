import { MessageFlags } from 'discord.js';
import { challenges, challengePayload, closeChallenge, everyoneAnswered, startChallenge } from '../match/challenges.js';
import { getMatchForUser } from '../match/registry.js';
import { ephemeral } from '../util/discord.js';

export async function handle(interaction, action, id) {
  const ch = challenges.get(id);
  if (!ch || ch.state !== 'open') return interaction.reply(ephemeral('This challenge is no longer open.'));
  const { guildId, user } = interaction;
  const isInvitee = ch.invitees.some((p) => p.id === user.id);
  const isHost = ch.hostId === user.id;

  if (action === 'accept' || action === 'decline') {
    if (!isInvitee) return interaction.reply(ephemeral('This challenge is not for you.'));
    if (action === 'accept') {
      if (getMatchForUser(guildId, user.id)) return interaction.reply(ephemeral("You're already in a match. Finish it first."));
      ch.accepted.add(user.id);
      ch.declined.delete(user.id);
    } else {
      ch.declined.add(user.id);
      ch.accepted.delete(user.id);
    }

    if (everyoneAnswered(ch)) {
      await interaction.deferUpdate();
      if (ch.accepted.size === 0) return closeChallenge(ch, 'declined', '❌ Everyone declined.');
      if (getMatchForUser(guildId, ch.hostId)) return closeChallenge(ch, 'cancelled', '⚠️ The host is now busy in another match.');
      const match = await startChallenge(ch, interaction.channel);
      if (!match) await interaction.followUp({ content: 'Could not start the match.', flags: MessageFlags.Ephemeral });
      return;
    }
    return interaction.update(challengePayload(ch));
  }

  if (action === 'start') {
    if (!isHost) return interaction.reply(ephemeral('Only the challenger can start early.'));
    if (ch.accepted.size === 0) return interaction.reply(ephemeral('Nobody has accepted yet.'));
    await interaction.deferUpdate();
    const match = await startChallenge(ch, interaction.channel);
    if (!match) await interaction.followUp({ content: 'Could not start the match.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'cancel') {
    if (!isHost) return interaction.reply(ephemeral('Only the challenger can cancel.'));
    await interaction.deferUpdate();
    return closeChallenge(ch, 'cancelled', '🚫 The host withdrew this challenge.');
  }
  return interaction.reply(ephemeral('Unknown action.'));
}
