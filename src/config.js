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
const port = Number.parseInt(process.env.PORT ?? '3000', 10);

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  /** OAuth2 client secret: needed to turn the Activity's authorization code into a user. */
  clientSecret: required('DISCORD_CLIENT_SECRET'),
  guildId: process.env.GUILD_ID || null,
  /** Optional. Without it the game still runs, but nothing is recorded and /stats is disabled. */
  mongoUri: process.env.MONGODB_URI || null,
  mongoDb: process.env.MONGODB_DB || 'cowordle',
  turnSeconds: Number.isFinite(turnSeconds) && turnSeconds >= 10 ? turnSeconds : 30,
  port: Number.isFinite(port) && port > 0 ? port : 3000,
  /** Secret used to sign browser sessions; falls back to the client secret. */
  sessionSecret: process.env.SESSION_SECRET || null,
  /**
   * Development only: lets `http://localhost:PORT/?dev=Name&instance=room1`
   * play without Discord. Never enable this on a public host.
   */
  allowDevLogin: process.env.ALLOW_DEV_LOGIN === '1',
};
