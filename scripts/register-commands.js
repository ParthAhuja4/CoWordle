/**
 * Registers the slash commands. With GUILD_ID set they are registered to that
 * server only (instant, good for development); otherwise globally (can take up
 * to an hour to propagate).
 *
 *   npm run register
 *   npm run register -- --clear      # remove all commands at the chosen scope
 */
import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { commands } from '../src/commands/index.js';

const clear = process.argv.includes('--clear');
const body = clear ? [] : commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);
const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

const result = await rest.put(route, { body });
console.log(
  `${clear ? 'Cleared' : `Registered ${result.length}`} command(s) ${config.guildId ? `in guild ${config.guildId}` : 'globally'}: ${result.map((c) => `/${c.name}`).join(' ')}`,
);
