import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { getLobbyForUser, removePlayer, closeLobby, refreshLobby } from '../match/lobbies.js';
import { getChallengeByHost, closeChallenge } from '../match/challenges.js';
import { ephemeral } from '../util/discord.js';

export const data = new SlashCommandBuilder()
  .setName('cancel')
  .setDescription('Leave the lobby you are in, or withdraw your pending challenge')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const { guildId, user } = interaction;
  const notes = [];

  const lobby = getLobbyForUser(guildId, user.id);
  if (lobby) {
    if (lobby.hostId === user.id) {
      await closeLobby(lobby, 'closed');
      notes.push('Closed your lobby.');
    } else {
      removePlayer(lobby, user.id);
      await refreshLobby(lobby);
      notes.push('Left the lobby.');
    }
  }

  const ch = getChallengeByHost(guildId, user.id);
  if (ch) {
    await closeChallenge(ch, 'cancelled', '🚫 The host withdrew this challenge.');
    notes.push('Withdrew your challenge.');
  }

  return interaction.reply(ephemeral(notes.length ? notes.join(' ') : "You're not in a lobby and have no pending challenge."));
}
