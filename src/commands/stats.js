import { SlashCommandBuilder, InteractionContextType, EmbedBuilder } from 'discord.js';
import { ctx } from '../util/context.js';
import { NO_PINGS, ephemeral } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show CoWordle stats for you or another player')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('user').setDescription('Whose stats to show'));

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

export async function execute(interaction) {
  if (!ctx.stats) return interaction.reply(ephemeral('Stats are not enabled on this bot (no database configured).'));
  await interaction.deferReply();
  const target = interaction.options.getUser('user') ?? interaction.user;
  const member = interaction.options.getMember('user');
  const name = member?.displayName ?? target.displayName ?? target.username;
  const s = await ctx.stats.getStats(interaction.guildId, target.id);

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${name}'s CoWordle stats`)
    .setThumbnail(target.displayAvatarURL())
    .setColor(0x538d4e)
    .addFields(
      { name: 'Games', value: String(s.games), inline: true },
      { name: 'Wins', value: String(s.wins), inline: true },
      { name: 'Win rate', value: pct(s.wins, s.games), inline: true },
      { name: 'Losses', value: String(s.losses), inline: true },
      { name: 'Draws', value: String(s.draws), inline: true },
      { name: 'Streak', value: `${s.streak} (best ${s.bestStreak})`, inline: true },
    );

  if (target.id !== interaction.user.id) {
    const h2h = await ctx.stats.getHeadToHead(interaction.guildId, interaction.user.id, target.id);
    embed.addFields({
      name: `Head-to-head vs you`,
      value: `You ${h2h.losses} – ${h2h.wins} ${name} · ${h2h.draws} draw${h2h.draws === 1 ? '' : 's'}`,
    });
  }
  return interaction.editReply({ embeds: [embed], allowedMentions: NO_PINGS });
}
