# CoWordle for Discord

CoWordle as a **Discord Activity**: type `/cowordle` in any channel and a real Wordle board opens inside Discord, the same way the official `/wordle` does. Everyone who opens it from that channel lands in the same room and plays against each other with live tiles, an on-screen keyboard and timers. No threads, no text commands during play.

## How it plays

- **Duel** (default): same hidden word, your own board, everyone at once. 30 s per guess, 6 rows. You only ever see your rivals' **colours**, never their letters, not even after the round. Fewest guesses wins; same count is a tie; nobody solving is a draw. Once someone solves it, anyone who has used fewer rows gets a last chance to tie or beat it.
- **Turn-by-Turn**: one shared board, players take turns (30 s each, 1–3 turns per player). Every guess helps everyone. First to solve wins; a full board is a draw.
- **2–5 players**, round after round with a running score. After a round everyone taps **Play again**; people who joined mid-round come in on the next one. Timing out burns a row. Forfeiting (two taps) removes you from the round; if you are the last one standing, you win.
- **Stats**: `/stats [user]` and `/leaderboard [sort]` per server, stored in MongoDB. `/help` explains the rules in Discord.

## How it is built

One Node process does three jobs:

1. **Discord bot** (discord.js): handles `/stats`, `/leaderboard`, `/help`. The `/cowordle` Entry Point command is launched by Discord itself, so no bot code runs for it.
2. **Activity web server** (`src/http.js`): serves the page in `public/`, exchanges the Activity's OAuth2 code for the player's identity (`POST /api/token`), and answers `/health`.
3. **Game server** (`src/activity/`): one `Room` per Activity instance, driven over WebSocket (`/ws`). It reuses the pure game engines in `src/game/` and pushes each player a personalised snapshot, so opponents' letters never leave the server.

The front end (`web/main.js`, bundled by esbuild into `public/app.js`) is plain JavaScript on top of `@discord/embedded-app-sdk`.

## Setup

### 1. Discord application

1. <https://discord.com/developers/applications> → **New Application** (or open the existing one).
2. **Bot** → **Reset Token** → copy it (`DISCORD_TOKEN`). No privileged intents needed.
3. **General Information** → copy the **Application ID** (`CLIENT_ID`).
4. **OAuth2** → copy the **Client Secret** (`DISCORD_CLIENT_SECRET`). Under **Redirects** add `https://127.0.0.1` (the SDK never uses it, but Discord requires one to exist).
5. **Activities → Getting Started** → **Enable Activities**.
6. **Activities → URL Mappings**: prefix `/` → target your public host **without** `https://`, e.g. `cowordle.onrender.com`.
7. **Activities → Settings**: tick the platforms you want (web, iOS, Android).
8. **Installation**: enable Guild Install (scopes `applications.commands`, `bot`) and, if you like, User Install. Use the install link to add the app to your server.

### 2. MongoDB (optional but recommended)

Free M0 cluster at <https://www.mongodb.com/atlas>: create a database user, allow access from `0.0.0.0/0`, copy the connection string (`MONGODB_URI`). Without it everything still works but nothing is recorded and `/stats` is disabled.

### 3. Deploy on Render (free tier)

`render.yaml` describes the service. Or manually: **Web Service**, build command `npm install && npm run words && npm run build`, start command `npm start`, health check `/health`, environment variables from `.env.example`. Render sets `PORT` itself and gives you HTTPS, which Activities require. Put the Render host name in the URL mapping from step 1.6.

Render's free tier sleeps idle services, so point a free uptime monitor (e.g. UptimeRobot every 5 minutes) at `https://<your-service>/health`. Rooms live in memory: a restart ends games in progress, but finished rounds are already in MongoDB.

### 4. Register the commands

Once, from your machine with the same `.env`:

```bash
npm install
npm run register
```

This creates `/cowordle` (global, replaces Discord's default "Launch" entry point) and `/stats`, `/leaderboard`, `/help`. With `GUILD_ID` set the three chat commands go to that server only, instantly; without it they are global and can take up to an hour to appear.

If you still have old commands (`/play`, `/guess`, …) registered from the previous version at the other scope, run `npm run register -- --clear` at that scope once.

### 5. Play

In any channel of a server that has the app: type `/cowordle` and press Enter, or open it from the **App Launcher** (the rocket / apps button). Friends join by clicking the Activity in the channel.

## Local development

```bash
cp .env.example .env     # fill in DISCORD_TOKEN, CLIENT_ID, DISCORD_CLIENT_SECRET (+ MONGODB_URI)
npm install
npm run words            # downloads data/answers.txt and data/allowed.txt
npm run dev              # builds the front end, starts the bot + web server on :3000
```

**Without Discord**: set `ALLOW_DEV_LOGIN=1` in `.env` and open two browser windows at `http://localhost:3000/?dev=Alice&instance=room1` and `http://localhost:3000/?dev=Bob&instance=room1`. Never enable this on a public host.

**Inside Discord**: Activities must be served over HTTPS through Discord's proxy. Tunnel your local port, e.g. `cloudflared tunnel --url http://localhost:3000`, and put the tunnel host in the URL mapping. Use a separate dev application so you do not disturb the deployed one.

```bash
npm test                                                # unit + end-to-end tests (no Discord/Mongo needed)
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test     # also runs the stats integration test
```

## Layout

- `src/game/` — pure Wordle logic: scoring, Duel and Turn-by-Turn engines, word lists. No Discord.
- `src/activity/` — `room.js` (lobby, rounds, timers, snapshots per viewer), `rooms.js` (registry), `ws.js` (WebSocket protocol), `auth.js` (OAuth2 exchange, signed sessions).
- `src/http.js` — static files, `/api/token`, `/health`, dev login.
- `src/commands/` — slash commands and the Entry Point definition.
- `src/db/` — MongoDB connection and `StatsRepo`.
- `web/main.js`, `public/` — the Activity page.
- `scripts/` — command registration and word list download.

## Word lists

- `data/answers.txt`: words accepted by NYT Wordle, from [tabatkins/wordle-list](https://github.com/tabatkins/wordle-list).
- `data/allowed.txt`: 5-letter words from [dwyl/english-words](https://github.com/dwyl/english-words).
