import { SlashCommandBuilder, InteractionContextType, EmbedBuilder } from 'discord.js';
import { ctx } from '../match/context.js';
import { NO_PINGS } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top CoWordle players in this server')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('sort')
      .setDescription('Ranking')
      .addChoices(
        { name: 'Most wins', value: 'wins' },
        { name: 'Best win rate (min 5 games)', value: 'winrate' },
        { name: 'Longest streak', value: 'streak' },
      ),
  );

const MEDALS = ['🥇', '🥈', '🥉'];

export async function execute(interaction) {
  await interaction.deferReply();
  const sort = interaction.options.getString('sort') ?? 'wins';
  const rows = await ctx.stats.getLeaderboard(interaction.guildId, sort, 10, 5);

  const lines = rows.map((r, i) => {
    const rank = MEDALS[i] ?? `**${i + 1}.**`;
    const value =
      sort === 'winrate'
        ? `${Math.round(100 * (r.wins / r.games))}% (${r.wins}/${r.games})`
        : sort === 'streak'
          ? `best ${r.bestStreak} · current ${r.streak}`
          : `${r.wins} win${r.wins === 1 ? '' : 's'} · ${r.games} game${r.games === 1 ? '' : 's'}`;
    return `${rank} <@${r.userId}> — ${value}`;
  });

  const titles = { wins: 'Most wins', winrate: 'Best win rate', streak: 'Longest streak' };
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Leaderboard · ${titles[sort]}`)
    .setDescription(lines.length ? lines.join('\n') : 'No games played yet. Start one with `/play`!')
    .setColor(0xf5c518);
  return interaction.editReply({ embeds: [embed], allowedMentions: NO_PINGS });
}
