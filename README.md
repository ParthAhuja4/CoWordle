# CoWordle for Discord

A Discord bot that brings CoWordle / Victordle-style multiplayer Wordle to your server: two game modes, 2–5 players per match, open lobbies for random opponents, direct challenges, back-to-back rounds with a series score, rematches, and a permanent leaderboard stored in MongoDB.

## Features

- **Turn-by-Turn** — everyone shares one board and one hidden word, taking turns (30 s per turn, 2 turns each by default). First to solve wins; full board is a draw.
- **Duel** — everyone gets their own board with the same word and races (30 s per guess, 6 rows). Opponents see your colours, never your letters. Fewest guesses wins; equal = tie; nobody = draw. A player who solves first leaves the others a "last chance" to tie or beat it.
- **2–5 players** in either mode.
- **Lobbies** (`/play`) act as the random-opponent queue; **challenges** (`/challenge`) invite specific people.
- **Series**: rounds continue with a Rematch vote and a running score; each round is a new word.
- **Stats**: wins, losses, draws, streaks, head-to-head, and `/leaderboard` per server.
- Big dictionary: ~14.8k possible answers, ~20k accepted guesses.

## Commands

| Command | What it does |
|---|---|
| `/play mode:<turn\|duel> [players:2-5] [turns:1-3]` | Open a lobby, or join an existing open lobby of that mode. Starts when full or when the host presses **Start now**. |
| `/challenge user1:@x [user2..user4] mode:<…> [turns]` | Invite specific players. Each accepts or declines; starts when everyone answered or when the host presses **Start now**. |
| `/guess word:<word>` | Make a guess. Only you see the reply (so Duel letters stay private). Works anywhere in the server. |
| `/board` | Your private view of the current round. |
| `/forfeit` | Concede the round and leave the match. |
| `/cancel` | Leave a lobby (host closes it) or withdraw your challenge. |
| `/stats [user]` | Record, win rate, streaks, head-to-head vs you. |
| `/leaderboard [sort]` | Top 10 by wins, win rate (min 5 games) or streak. |
| `/help` | Rules. |

Each match runs in its own public thread under the channel where it started. Board messages are edited in place; countdowns use Discord's relative timestamps.

Every board shows a QWERTY keyboard: letters found in the word carry a 🟩 or 🟨 tile, letters proven absent are ~~struck through~~ (greyed out), untried letters stay plain.

The UI is designed for phones as well as desktop: board rows are short enough never to wrap, long names are truncated inside boards, Duel boards sit side by side for two players and stack full-width for three or more, buttons use short labels with emoji, and every board carries a text legend for the tile colours.

## Setup

### 1. Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`). No privileged intents are needed.
3. **General Information** → copy the **Application ID** (`CLIENT_ID`).
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions: *View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads, Embed Links, Read Message History*. Open the generated URL and invite the bot to your server.

### 2. MongoDB

Create a free cluster at <https://www.mongodb.com/atlas> (M0), add a database user, allow access from anywhere (`0.0.0.0/0`, needed for cloud hosts), and copy the connection string (`MONGODB_URI`).

### 3. Run locally

```bash
npm install
npm run words          # downloads data/answers.txt and data/allowed.txt
cp .env.example .env   # fill in DISCORD_TOKEN, CLIENT_ID, MONGODB_URI (+ GUILD_ID for instant dev commands)
npm run register       # registers slash commands
npm run dev            # or: npm start
```

`GUILD_ID` set → commands appear instantly in that server only. Leave it empty for global commands (up to an hour to propagate). If you registered both, run `npm run register -- --clear` at the scope you want to drop to remove duplicates.

### 4. Deploy on Render (free tier)

Render's free tier has no persistent disk and sleeps idle web services, so:

- Stats live in MongoDB Atlas (free), so they survive restarts and redeploys.
- Deploy as a **Web Service** (not a background worker). Build command `npm install && npm run words`, start command `npm start`. Add the environment variables from `.env.example`; Render sets `PORT` automatically and the bot serves `GET /` and `/health` on it.
- Point a free uptime monitor (e.g. UptimeRobot, every 5 minutes) at the service URL so it never spins down.
- Run `npm run register` once from your machine (or as a one-off) to register the commands.

In-progress games live in memory and are lost on a restart; finished rounds are already saved.

## Development

```bash
npm test                                          # unit tests (scoring, engines, word lists)
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm test  # also runs the stats integration test
```

Layout:

- `src/game/` — pure game logic (`scoring.js`, `turnGame.js`, `duelGame.js`, `words.js`), no Discord.
- `src/match/` — in-memory matches, lobbies, challenges, versioned timers, and `lifecycle.js` (threads, boards, round/match end, stats).
- `src/render/` — embeds and board layouts.
- `src/commands/`, `src/buttons/` — slash command and button handlers.
- `src/db/` — MongoDB connection and `StatsRepo`.

## Word lists

- `data/answers.txt`: the list of words accepted by NYT Wordle, from [tabatkins/wordle-list](https://github.com/tabatkins/wordle-list).
- `data/allowed.txt`: 5-letter words from [dwyl/english-words](https://github.com/dwyl/english-words).

## Rules details

- Timing out in Turn-by-Turn burns your row and passes the turn. Timing out in Duel burns one of your six rows.
- Guesses must be in the word list; invalid words cost nothing. Repeating a guess is allowed.
- Forfeiting removes you from the series. With two players the other wins the round; with more, play continues without you.
- A word is never reused within the same series.
