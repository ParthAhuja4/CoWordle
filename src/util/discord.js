import { MessageFlags } from 'discord.js';

export const NO_PINGS = { parse: [] };

export function ephemeral(content, extra = {}) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS, ...extra };
}
