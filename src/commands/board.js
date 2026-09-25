import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { getMatchForUser } from '../match/registry.js';
import { renderPrivateView } from '../render/board.js';
import { ephemeral } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('board')
  .setDescription('Show your private view of the current round')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const match = getMatchForUser(interaction.guildId, interaction.user.id);
  if (!match) return interaction.reply(ephemeral('No active game. Start one with `/play` or `/challenge`.'));
  if (match.status !== 'active') return interaction.reply(ephemeral(`The round is over — vote in <#${match.threadId}>.`));
  return interaction.reply(ephemeral(renderPrivateView(match, interaction.user.id)));
}
