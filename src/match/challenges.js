/**
 * Direct challenges: a host invites 1–4 specific users. Each invitee accepts
 * or declines; the match starts with host + accepted players once everyone
 * has answered (or when the host presses Start).
 */
import { CHALLENGE_TTL_MS } from '../constants.js';
import { newId, userKey } from './registry.js';
import { ctx } from './context.js';
import { challengeEmbed, challengeButtons } from '../render/embeds.js';
import { editMessage } from '../util/discord.js';
import { startMatch } from './lifecycle.js';
import { log } from '../util/logger.js';

/** challengeId → challenge */
export const challenges = new Map();
/** `${guildId}:${hostId}` → challengeId (one outgoing challenge per host) */
export const challengeByHost = new Map();

export function getChallengeByHost(guildId, hostId) {
  const id = challengeByHost.get(userKey(guildId, hostId));
  return id ? challenges.get(id) ?? null : null;
}

export function createChallenge({ guildId, channelId, host, invitees, mode, turnsEach }) {
  const ch = {
    id: newId(),
    guildId,
    channelId,
    messageId: null,
    hostId: host.id,
    hostName: host.name,
    invitees: invitees.map((p) => ({ id: p.id, name: p.name })),
    accepted: new Set(),
    declined: new Set(),
    mode,
    turnsEach,
    state: 'open',
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    timer: null,
  };
  challenges.set(ch.id, ch);
  challengeByHost.set(userKey(guildId, host.id), ch.id);
  ch.timer = setTimeout(() => closeChallenge(ch, 'expired', '⌛ This challenge expired.').catch((e) => log.error(e)), CHALLENGE_TTL_MS);
  return ch;
}

export function challengePayload(ch, note = '') {
  return {
    embeds: [challengeEmbed(ch, { state: ch.state, note })],
    components: challengeButtons(ch, { disabled: ch.state !== 'open' }),
  };
}

export async function refreshChallenge(ch, note = '') {
  if (!ch.messageId) return;
  await editMessage(ctx.client, ch.channelId, ch.messageId, challengePayload(ch, note));
}

function dispose(ch) {
  clearTimeout(ch.timer);
  ch.timer = null;
  if (challengeByHost.get(userKey(ch.guildId, ch.hostId)) === ch.id) challengeByHost.delete(userKey(ch.guildId, ch.hostId));
  challenges.delete(ch.id);
}

export async function closeChallenge(ch, state, note) {
  if (ch.state !== 'open') return;
  ch.state = state;
  dispose(ch);
  await refreshChallenge(ch, note);
}

export function everyoneAnswered(ch) {
  return ch.invitees.every((p) => ch.accepted.has(p.id) || ch.declined.has(p.id));
}

/** @returns the match or null */
export async function startChallenge(ch, channel) {
  if (ch.state !== 'open') return null;
  const players = [{ id: ch.hostId, name: ch.hostName }, ...ch.invitees.filter((p) => ch.accepted.has(p.id))];
  if (players.length < 2) return null;
  ch.state = 'started';
  dispose(ch);
  await refreshChallenge(ch, '🚀 Game started!');
  try {
    return await startMatch({ channel, mode: ch.mode, turnsEach: ch.turnsEach, players });
  } catch (err) {
    log.error('startMatch from challenge failed:', err);
    return null;
  }
}
