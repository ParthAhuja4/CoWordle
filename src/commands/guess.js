import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { WORD_LEN } from '../constants.js';
import { normalizeWord, isWellFormed, isValidGuess } from '../game/words.js';
import { getMatchForUser } from '../match/registry.js';
import { applyGuess, afterMutation } from '../match/lifecycle.js';
import { ephemeral } from '../util/discord.js';
import { log } from '../util/logger.js';

export const data = new SlashCommandBuilder()
  .setName('guess')
  .setDescription('Guess the word in your current CoWordle match (only you see the reply)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName('word').setDescription(`A ${WORD_LEN}-letter word`).setRequired(true).setMinLength(WORD_LEN).setMaxLength(WORD_LEN),
  );

export async function execute(interaction) {
  const word = normalizeWord(interaction.options.getString('word', true));
  if (!isWellFormed(word)) return interaction.reply(ephemeral(`Guesses must be exactly ${WORD_LEN} letters A–Z.`));

  const match = getMatchForUser(interaction.guildId, interaction.user.id);
  if (!match) return interaction.reply(ephemeral('No active game. Start one with `/play` or `/challenge`.'));

  if (!isValidGuess(word)) return interaction.reply(ephemeral(`**${word.toUpperCase()}** isn't in the word list. Try another word (no penalty).`));

  // All state changes happen synchronously here, before the first await.
  const res = applyGuess(match, interaction.user.id, word);
  if (!res.ok) return interaction.reply(ephemeral(res.message));

  await interaction.reply(ephemeral(res.feedback));
  afterMutation(match, res.ended).catch((err) => log.error('afterMutation failed:', err));
}
