/**
 * Registers the application commands.
 *
 *  - `/cowordle` is an Entry Point command that launches the Activity. Discord
 *    only allows it globally, and it requires Activities to be enabled for the
 *    app in the Developer Portal.
 *  - `/stats`, `/leaderboard`, `/help` go to GUILD_ID if set (instant, good for
 *    development), otherwise globally (can take up to an hour to propagate).
 *
 *   npm run register
 *   npm run register -- --clear      # remove the guild commands (GUILD_ID) or the global chat commands
 */
import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { commands, ENTRY_POINT_COMMAND } from '../src/commands/index.js';

const clear = process.argv.includes('--clear');
const rest = new REST().setToken(config.token);
const chat = clear ? [] : commands.map((c) => c.data.toJSON());

function describe(list) {
  return list.map((c) => `/${c.name}`).join(' ') || '(none)';
}

try {
  if (config.guildId) {
    const guild = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: chat });
    console.log(`${clear ? 'Cleared' : 'Registered'} guild ${config.guildId}: ${describe(guild)}`);
    const global = await rest.put(Routes.applicationCommands(config.clientId), { body: [ENTRY_POINT_COMMAND] });
    console.log(`Registered globally: ${describe(global)}`);
  } else {
    const global = await rest.put(Routes.applicationCommands(config.clientId), { body: [ENTRY_POINT_COMMAND, ...chat] });
    console.log(`${clear ? 'Cleared chat commands, kept' : 'Registered'} globally: ${describe(global)}`);
  }
} catch (err) {
  const text = JSON.stringify(err?.rawError ?? err?.message ?? err);
  if (/entry point|activit/i.test(text)) {
    console.error('Discord rejected the Entry Point command. Enable Activities for the app first:');
    console.error('  Developer Portal → your app → Activities → Getting Started → Enable Activities, then run this again.');
  }
  console.error(text);
  process.exit(1);
}
