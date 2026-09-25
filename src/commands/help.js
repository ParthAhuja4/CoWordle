import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { ctx } from '../match/context.js';
import { helpEmbed } from '../render/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to play CoWordle')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  return interaction.reply({ embeds: [helpEmbed(ctx.config?.turnSeconds ?? 30)], flags: MessageFlags.Ephemeral });
}
