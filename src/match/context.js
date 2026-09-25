/**
 * Process-wide handles set once at startup so command/button handlers and the
 * match lifecycle can reach the Discord client, config and the stats repo
 * without threading them through every call.
 */
export const ctx = {
  /** @type {import('discord.js').Client | null} */
  client: null,
  /** @type {import('../db/stats.js').StatsRepo | null} */
  stats: null,
  /** @type {import('../config.js').config | null} */
  config: null,
};
