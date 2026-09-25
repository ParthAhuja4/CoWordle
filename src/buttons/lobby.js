import { MessageFlags } from 'discord.js';
import { lobbies, addPlayer, removePlayer, closeLobby, startLobby, getLobbyForUser, lobbyPayload } from '../match/lobbies.js';
import { getMatchForUser } from '../match/registry.js';
import { ephemeral, displayName } from '../util/discord.js';

export async function handle(interaction, action, id) {
  const lobby = lobbies.get(id);
  if (!lobby || lobby.state !== 'open') return interaction.reply(ephemeral('This lobby is no longer open.'));
  const { guildId, user } = interaction;

  if (action === 'join') {
    if (lobby.players.some((p) => p.id === user.id)) return interaction.reply(ephemeral("You're already in this lobby."));
    if (getMatchForUser(guildId, user.id)) return interaction.reply(ephemeral("You're already in a match."));
    if (getLobbyForUser(guildId, user.id)) return interaction.reply(ephemeral("You're already in another lobby. `/cancel` it first."));
    if (lobby.players.length >= lobby.maxPlayers) return interaction.reply(ephemeral('This lobby is full.'));
    addPlayer(lobby, { id: user.id, name: displayName(interaction) });
    if (lobby.players.length >= lobby.maxPlayers) {
      await interaction.deferUpdate();
      const match = await startLobby(lobby, interaction.channel);
      if (!match) await interaction.followUp(ephemeral('Could not start the match. Try `/play` again.'));
      return;
    }
    return interaction.update(lobbyPayload(lobby));
  }

  if (action === 'leave') {
    if (!lobby.players.some((p) => p.id === user.id)) return interaction.reply(ephemeral("You're not in this lobby."));
    if (lobby.hostId === user.id) {
      await interaction.deferUpdate();
      await closeLobby(lobby, 'closed');
      return;
    }
    removePlayer(lobby, user.id);
    return interaction.update(lobbyPayload(lobby));
  }

  if (action === 'start') {
    if (lobby.hostId !== user.id) return interaction.reply(ephemeral('Only the host can start the lobby.'));
    if (lobby.players.length < 2) return interaction.reply(ephemeral('You need at least 2 players.'));
    await interaction.deferUpdate();
    const match = await startLobby(lobby, interaction.channel);
    if (!match) await interaction.followUp({ content: 'Could not start the match.', flags: MessageFlags.Ephemeral });
    return;
  }
  return interaction.reply(ephemeral('Unknown action.'));
}
