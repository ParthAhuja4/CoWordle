try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; environment variables may be provided by the host.
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const turnSeconds = Number.parseInt(process.env.TURN_SECONDS ?? '30', 10);
const port = Number.parseInt(process.env.PORT ?? '', 10);

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  mongoUri: required('MONGODB_URI'),
  mongoDb: process.env.MONGODB_DB || 'cowordle',
  turnSeconds: Number.isFinite(turnSeconds) && turnSeconds >= 10 ? turnSeconds : 30,
  port: Number.isFinite(port) && port > 0 ? port : null,
};
