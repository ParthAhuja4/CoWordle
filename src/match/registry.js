import { randomUUID } from 'node:crypto';

/** matchId → Match */
export const matches = new Map();
/** `${guildId}:${userId}` → matchId */
export const activeByUser = new Map();
/** threadId → matchId */
export const byThread = new Map();

export const userKey = (guildId, userId) => `${guildId}:${userId}`;

export function newId() {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

export function getMatchForUser(guildId, userId) {
  const id = activeByUser.get(userKey(guildId, userId));
  return id ? matches.get(id) ?? null : null;
}

export function getMatchByThread(threadId) {
  const id = byThread.get(threadId);
  return id ? matches.get(id) ?? null : null;
}

export function registerMatch(match) {
  matches.set(match.id, match);
  for (const p of match.players) activeByUser.set(userKey(match.guildId, p.id), match.id);
  if (match.threadId) byThread.set(match.threadId, match.id);
}

export function unregisterUser(match, userId) {
  const k = userKey(match.guildId, userId);
  if (activeByUser.get(k) === match.id) activeByUser.delete(k);
}

export function unregisterMatch(match) {
  matches.delete(match.id);
  for (const p of match.players) unregisterUser(match, p.id);
  if (match.threadId) byThread.delete(match.threadId);
}

/** Players who have not left the series. */
export function activePlayers(match) {
  return match.players.filter((p) => !match.leftPlayers.has(p.id));
}

export function playerName(match, userId) {
  return match.players.find((p) => p.id === userId)?.name ?? 'Unknown';
}
