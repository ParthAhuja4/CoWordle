import { createServer } from 'node:http';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { connectMongo } from './db/mongo.js';
import { StatsRepo } from './db/stats.js';
import { ctx } from './match/context.js';
import { commandMap } from './commands/index.js';
import { dispatchButton } from './buttons/index.js';
import { getMatchByThread } from './match/registry.js';
import { endMatch } from './match/lifecycle.js';
import { ANSWERS, ALLOWED } from './game/words.js';
import { log } from './util/logger.js';

const { db, client: mongo } = await connectMongo(config.mongoUri, config.mongoDb);
log.info(`MongoDB connected (${config.mongoDb})`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
ctx.client = client;
ctx.stats = new StatsRepo(db);
ctx.config = config;

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag} · ${ANSWERS.length} answers · ${ALLOWED.size} allowed guesses`);
  c.user.setActivity('/help · CoWordle');
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) return interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
      await cmd.execute(interaction);
    } else if (interaction.isButton()) {
      const handled = await dispatchButton(interaction);
      if (!handled) await interaction.reply({ content: 'This button is no longer active.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    log.error(`interaction ${interaction.commandName ?? interaction.customId} failed:`, err);
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

client.on(Events.ThreadDelete, (thread) => {
  const match = getMatchByThread(thread.id);
  if (match) endMatch(match, 'thread_deleted').catch((err) => log.error('endMatch failed:', err));
});

client.on(Events.Error, (err) => log.error('client error:', err));
process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err));

// Optional keep-alive HTTP server (Render and similar hosts expect a web
// service to bind PORT; an uptime monitor can ping / to prevent spin-down).
if (config.port) {
  createServer((req, res) => {
    const ok = client.isReady();
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, bot: client.user?.tag ?? null, uptime: Math.floor(process.uptime()) }));
  }).listen(config.port, () => log.info(`health server on :${config.port}`));
}

async function shutdown(signal) {
  log.info(`${signal} received, shutting down`);
  try {
    await client.destroy();
    await mongo.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await client.login(config.token);
