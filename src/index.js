import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { connectMongo } from './db/mongo.js';
import { StatsRepo } from './db/stats.js';
import { ctx } from './util/context.js';
import { commandMap } from './commands/index.js';
import { ANSWERS, ALLOWED } from './game/words.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './activity/ws.js';
import { destroyAllRooms } from './activity/rooms.js';
import { log } from './util/logger.js';

ctx.config = config;

let mongo = null;
if (config.mongoUri) {
  const conn = await connectMongo(config.mongoUri, config.mongoDb);
  mongo = conn.client;
  ctx.stats = new StatsRepo(conn.db);
  log.info(`MongoDB connected (${config.mongoDb})`);
} else {
  log.warn('MONGODB_URI not set: games run, but nothing is recorded and /stats is disabled');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
ctx.client = client;

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag} · ${ANSWERS.length} answers · ${ALLOWED.size} allowed guesses`);
  c.user.setActivity('/cowordle');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    await cmd.execute(interaction);
  } catch (err) {
    log.error(`interaction ${interaction.commandName} failed:`, err);
    const payload = { content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred && !interaction.replied) await interaction.editReply(payload);
      else if (interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {
      /* ignore */
    }
  }
});

client.on(Events.Error, (err) => log.error('client error:', err));
process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err));

// The Activity itself: static page + token exchange over HTTP, game over WebSocket.
const server = createHttpServer({ config, isReady: () => client.isReady() });
attachWebSocket(server, config);
server.listen(config.port, () => log.info(`activity server on :${config.port}${config.allowDevLogin ? ' (dev login enabled)' : ''}`));

async function shutdown(signal) {
  log.info(`${signal} received, shutting down`);
  try {
    destroyAllRooms();
    server.close();
    await client.destroy();
    if (mongo) await mongo.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await client.login(config.token);
