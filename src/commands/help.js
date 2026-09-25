import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { ctx } from '../util/context.js';
import { MAX_PLAYERS } from '../constants.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('How to play CoWordle');

export async function execute(interaction) {
  const s = ctx.config?.turnSeconds ?? 30;
  const embed = new EmbedBuilder()
    .setTitle('📖 CoWordle')
    .setColor(0x538d4e)
    .setDescription(
      [
        'Type **/cowordle** to open the game right here in Discord. Everyone who joins the Activity from this channel lands in the same room.',
        `Guess the hidden **5-letter word** in as few tries as you can. 🟩 right spot · 🟨 wrong spot · ⬛ not in word. **2–${MAX_PLAYERS} players**, round after round, with a running score.`,
      ].join('\n\n'),
    )
    .addFields(
      {
        name: '⚔️ Duel (default)',
        value: `Same word, your own board, all at once. ${s}s per guess, 6 rows. You only ever see your rivals' **colours**, never their letters. Fewest guesses wins · same = tie · nobody = draw. Once someone solves it, anyone with fewer rows used gets a last chance.`,
      },
      {
        name: '🎮 Turn-by-Turn',
        value: `One shared board. Take turns (${s}s each, 2 turns per player by default). Every guess helps everyone. First to solve wins; a full board is a draw.`,
      },
      {
        name: '🕹️ In the game',
        value: 'The host picks the mode and presses **Start**. Type with the on-screen keys or your keyboard, Enter to guess. After a round, tap **Play again**. `/stats` and `/leaderboard` track your record.',
      },
    );
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
