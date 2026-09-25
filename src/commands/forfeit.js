import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { getMatchForUser } from '../match/registry.js';
import { forfeit } from '../match/lifecycle.js';
import { ephemeral } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('forfeit')
  .setDescription('Concede the current round and leave the match')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const match = getMatchForUser(interaction.guildId, interaction.user.id);
  if (!match) return interaction.reply(ephemeral("You're not in a match."));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const msg = await forfeit(match, interaction.user.id);
  return interaction.editReply(ephemeral(msg));
}
