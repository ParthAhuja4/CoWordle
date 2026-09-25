import { MessageFlags } from 'discord.js';
import { matches } from '../match/registry.js';
import { voteRematch, leaveMatch } from '../match/lifecycle.js';
import { ephemeral } from '../util/discord.js';

export async function handle(interaction, action, id) {
  const match = matches.get(id);
  if (!match || match.status === 'ended') return interaction.reply(ephemeral('This match has ended.'));
  const userId = interaction.user.id;
  if (!match.players.some((p) => p.id === userId)) return interaction.reply(ephemeral("You're not in this match."));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const msg = action === 'yes' ? await voteRematch(match, userId) : await leaveMatch(match, userId);
  return interaction.editReply(msg);
}
