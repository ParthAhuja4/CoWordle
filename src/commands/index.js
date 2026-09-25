import * as stats from './stats.js';
import * as leaderboard from './leaderboard.js';
import * as help from './help.js';

/** Slash commands handled by the bot. The `/cowordle` Entry Point command is launched by Discord itself. */
export const commands = [stats, leaderboard, help];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

/**
 * The Entry Point command that opens the Activity. Discord handles it
 * (handler 2 = DISCORD_LAUNCH_ACTIVITY), so no interaction reaches the bot.
 * Entry Point commands can only be registered globally.
 */
export const ENTRY_POINT_COMMAND = {
  name: 'cowordle',
  description: 'Play CoWordle — multiplayer Wordle with friends',
  type: 4, // PRIMARY_ENTRY_POINT
  handler: 2, // DISCORD_LAUNCH_ACTIVITY
  integration_types: [0, 1], // guild install, user install
  contexts: [0, 1, 2], // guild, bot DM, private channel
};
