/**
 * Open lobbies. One user can be in at most one lobby per guild. `/play` joins
 * an existing open lobby for the same mode if there is one, so lobbies double
 * as the "random opponent" queue.
 */
import { LOBBY_TTL_MS } from '../constants.js';
import { newId, userKey } from './registry.js';
import { ctx } from './context.js';
import { lobbyEmbed, lobbyButtons } from '../render/embeds.js';
import { editMessage } from '../util/discord.js';
import { startMatch } from './lifecycle.js';
import { log } from '../util/logger.js';

/** lobbyId → lobby */
export const lobbies = new Map();
/** `${guildId}:${userId}` → lobbyId */
export const lobbyByUser = new Map();

export function getLobbyForUser(guildId, userId) {
  const id = lobbyByUser.get(userKey(guildId, userId));
  return id ? lobbies.get(id) ?? null : null;
}

export function findOpenLobby(guildId, mode) {
  for (const l of lobbies.values()) {
    if (l.guildId === guildId && l.mode === mode && l.state === 'open' && l.players.length < l.maxPlayers) return l;
  }
  return null;
}

export function createLobby({ guildId, channelId, host, mode, maxPlayers, turnsEach }) {
  const lobby = {
    id: newId(),
    guildId,
    channelId,
    messageId: null,
    hostId: host.id,
    mode,
    maxPlayers,
    turnsEach,
    players: [{ id: host.id, name: host.name }],
    state: 'open',
    expiresAt: Date.now() + LOBBY_TTL_MS,
    timer: null,
  };
  lobbies.set(lobby.id, lobby);
  lobbyByUser.set(userKey(guildId, host.id), lobby.id);
  lobby.timer = setTimeout(() => closeLobby(lobby, 'expired').catch((e) => log.error(e)), LOBBY_TTL_MS);
  return lobby;
}

export function addPlayer(lobby, player) {
  if (lobby.players.some((p) => p.id === player.id)) return false;
  lobby.players.push({ id: player.id, name: player.name });
  lobbyByUser.set(userKey(lobby.guildId, player.id), lobby.id);
  return true;
}

export function removePlayer(lobby, userId) {
  const idx = lobby.players.findIndex((p) => p.id === userId);
  if (idx === -1) return false;
  lobby.players.splice(idx, 1);
  lobbyByUser.delete(userKey(lobby.guildId, userId));
  return true;
}

export function lobbyPayload(lobby) {
  return { embeds: [lobbyEmbed(lobby, { state: lobby.state })], components: lobbyButtons(lobby, { disabled: lobby.state !== 'open' }) };
}

export async function refreshLobby(lobby) {
  if (!lobby.messageId) return;
  await editMessage(ctx.client, lobby.channelId, lobby.messageId, lobbyPayload(lobby));
}

function dispose(lobby) {
  clearTimeout(lobby.timer);
  lobby.timer = null;
  for (const p of lobby.players) {
    if (lobbyByUser.get(userKey(lobby.guildId, p.id)) === lobby.id) lobbyByUser.delete(userKey(lobby.guildId, p.id));
  }
  lobbies.delete(lobby.id);
}

export async function closeLobby(lobby, state = 'closed') {
  if (lobby.state !== 'open') return;
  lobby.state = state;
  dispose(lobby);
  await refreshLobby(lobby);
}

/**
 * Starts the match for a lobby. `channel` must be the lobby's text channel.
 * @returns the match, or null if it could not start
 */
export async function startLobby(lobby, channel) {
  if (lobby.state !== 'open' || lobby.players.length < 2) return null;
  lobby.state = 'started';
  dispose(lobby);
  await refreshLobby(lobby);
  try {
    return await startMatch({ channel, mode: lobby.mode, turnsEach: lobby.turnsEach, players: lobby.players });
  } catch (err) {
    log.error('startMatch from lobby failed:', err);
    return null;
  }
}
