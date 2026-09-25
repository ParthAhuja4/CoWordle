/**
 * One Room per Activity instance (everyone who opened the Activity from the
 * same channel launch shares an instance). The Room owns the lobby, the
 * current round, timers, the series score and the personalised snapshots
 * that are pushed to every connected browser over WebSocket.
 *
 * Every mutation of game state happens synchronously (before any await) so
 * timers, guesses and disconnects can never interleave mid-update.
 *
 * Phases:
 *   lobby      → host picks mode/turns and presses Start (2–5 connected people)
 *   playing    → a round is in progress
 *   roundOver  → word revealed; connected participants vote "Play again"
 */
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  DEFAULT_TURNS,
  MAX_TURNS,
  MODES,
  REMATCH_IDLE_MS,
  DISCONNECT_GRACE_MS,
  ROOM_EMPTY_TTL_MS,
} from '../constants.js';
import { pickSecret, normalizeWord, isWellFormed, isValidGuess } from '../game/words.js';
import { keyboardState } from '../game/scoring.js';
import { createTurnRound, applyTurnGuess, applyTurnTimeout, forfeitTurn, currentTurnUser } from '../game/turnGame.js';
import { createDuelRound, applyDuelGuess, applyDuelTimeout, forfeitDuel, boardDone, bestSolve } from '../game/duelGame.js';
import { scheduleGuarded, clearTimer } from '../util/timers.js';

const noopLog = { info() {}, warn() {}, error() {} };

export class Room {
  /**
   * @param {object} p
   * @param {string} p.instanceId
   * @param {string|null} p.guildId   verified guild the Activity runs in (null in DMs)
   * @param {string|null} p.channelId
   * @param {number} p.turnSeconds
   * @param {{recordRoundResult:Function}|null} p.stats
   * @param {Function} p.onEmpty       called when the room has been empty for ROOM_EMPTY_TTL_MS
   * @param {object} [p.log]
   */
  constructor({ instanceId, guildId = null, channelId = null, turnSeconds = 30, stats = null, onEmpty = () => {}, log = noopLog }) {
    this.id = instanceId;
    this.guildId = guildId;
    this.channelId = channelId;
    this.turnSeconds = turnSeconds;
    this.stats = stats;
    this.onEmpty = onEmpty;
    this.log = log;

    /** @type {Map<string, {id:string,name:string,avatar:string|null,sockets:Set<any>,joinedAt:number,seq:number,disconnectTimer:any}>} */
    this.members = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { mode: 'duel', turnsEach: DEFAULT_TURNS };
    this.score = { draws: 0 };
    this.roundNumber = 0;
    this.roundsPlayed = 0;
    this.round = null;
    /** user ids taking part in the current/last round */
    this.participants = [];
    this.forfeited = new Set();
    this.rematchVotes = new Set();
    this.rematchDeadline = null;
    this.rematchTimer = null;
    this.usedSecrets = new Set();
    this.lastResult = null;
    this.emptyTimer = null;
    this.destroyed = false;
    this.matchId = `${instanceId}:${Date.now().toString(36)}`;
    this.seq = 0;
  }

  /* ------------------------------------------------------------ membership */

  /** A browser (socket) for `user` joined. Returns the member record. */
  join(user, socket) {
    clearTimer(this, 'emptyTimer');
    let m = this.members.get(user.id);
    if (!m) {
      m = { id: user.id, name: user.name, avatar: user.avatar ?? null, sockets: new Set(), joinedAt: Date.now(), seq: this.seq++, disconnectTimer: null };
      this.members.set(user.id, m);
      this.event('join', `${m.name} joined`);
    } else {
      m.name = user.name;
      m.avatar = user.avatar ?? m.avatar;
      clearTimer(m, 'disconnectTimer');
    }
    m.sockets.add(socket);
    if (!this.hostId || !this.isConnected(this.hostId)) this.hostId = m.id;
    this.broadcast();
    return m;
  }

  /** A socket closed. */
  leaveSocket(socket) {
    for (const m of this.members.values()) {
      if (!m.sockets.delete(socket)) continue;
      if (m.sockets.size === 0) this.onMemberDisconnected(m);
      this.broadcast();
      return;
    }
  }

  onMemberDisconnected(m) {
    if (this.phase === 'playing' && this.participants.includes(m.id) && !this.forfeited.has(m.id)) {
      // Give them a moment to come back (Discord reconnects Activities after
      // a network blip) before their board is forfeited.
      m.disconnectTimer = scheduleGuarded(
        DISCONNECT_GRACE_MS,
        () => !this.destroyed && m.sockets.size === 0 && this.phase === 'playing',
        () => {
          this.event('leave', `${m.name} disconnected`);
          this.forfeit(m.id, { silent: true });
        },
      );
      return;
    }
    // Not mid-round: they are simply gone.
    this.members.delete(m.id);
    this.event('leave', `${m.name} left`);
    if (this.hostId === m.id) this.hostId = this.connectedMembers()[0]?.id ?? null;
    if (this.phase === 'roundOver') this.checkRematch();
    if (this.connectedMembers().length === 0) this.scheduleEmpty();
  }

  scheduleEmpty() {
    clearTimer(this, 'emptyTimer');
    this.emptyTimer = setTimeout(() => {
      if (this.connectedMembers().length === 0) this.destroy();
    }, ROOM_EMPTY_TTL_MS);
  }

  isConnected(userId) {
    return (this.members.get(userId)?.sockets.size ?? 0) > 0;
  }

  /** Connected members in join order. */
  connectedMembers() {
    return [...this.members.values()].filter((m) => m.sockets.size > 0).sort((a, b) => a.seq - b.seq);
  }

  name(userId) {
    return this.members.get(userId)?.name ?? 'Player';
  }

  /* --------------------------------------------------------------- lobby */

  setSettings(userId, { mode, turnsEach }) {
    if (userId !== this.hostId) return this.fail(userId, 'Only the host can change settings.');
    if (this.phase === 'playing') return this.fail(userId, 'Finish the round first.');
    if (mode !== undefined) {
      if (!MODES[mode]) return this.fail(userId, 'Unknown mode.');
      this.settings.mode = mode;
    }
    if (turnsEach !== undefined) {
      const n = Number(turnsEach);
      if (!Number.isInteger(n) || n < 1 || n > MAX_TURNS) return this.fail(userId, `Turns must be 1–${MAX_TURNS}.`);
      this.settings.turnsEach = n;
    }
    this.broadcast();
    return true;
  }

  start(userId) {
    if (userId !== this.hostId) return this.fail(userId, 'Only the host can start.');
    if (this.phase === 'playing') return this.fail(userId, 'A round is already running.');
    const connected = this.connectedMembers();
    if (connected.length < MIN_PLAYERS) return this.fail(userId, `You need at least ${MIN_PLAYERS} players. Invite friends to the Activity.`);
    this.startRound(connected.slice(0, MAX_PLAYERS).map((m) => m.id));
    return true;
  }

  /* --------------------------------------------------------------- rounds */

  startRound(playerIds) {
    clearTimer(this, 'rematchTimer');
    this.rematchVotes = new Set();
    this.rematchDeadline = null;
    this.forfeited = new Set();
    this.lastResult = null;
    this.phase = 'playing';
    this.roundNumber += 1;
    this.participants = [...playerIds];
    for (const id of playerIds) this.score[id] ??= 0;

    const secret = pickSecret(this.usedSecrets);
    if (this.settings.mode === 'turn') {
      this.round = createTurnRound({ secret, order: playerIds, turnsEach: this.settings.turnsEach, startIdx: this.roundNumber - 1 });
      this.armTurnTimer();
    } else {
      this.round = createDuelRound({ secret, playerIds });
      for (const id of playerIds) this.armDuelTimer(id);
    }
    this.event('round', `Round ${this.roundNumber} — ${this.settings.mode === 'turn' ? `${this.name(currentTurnUser(this.round))} goes first` : 'go!'}`);
    this.broadcast();
  }

  /* --------------------------------------------------------------- timers */

  turnMs() {
    return this.turnSeconds * 1000;
  }

  armTurnTimer() {
    const round = this.round;
    clearTimer(round);
    if (round.status !== 'playing') return;
    const userId = currentTurnUser(round);
    const version = round.version;
    round.deadline = Date.now() + this.turnMs();
    round.timer = scheduleGuarded(
      this.turnMs(),
      () => !this.destroyed && this.round === round && round.status === 'playing' && round.version === version,
      () => this.onTurnTimeout(round, userId),
    );
  }

  armDuelTimer(userId) {
    const round = this.round;
    const board = round.boards[userId];
    clearTimer(board);
    if (round.status !== 'playing' || boardDone(board)) return;
    const version = board.version;
    board.deadline = Date.now() + this.turnMs();
    board.timer = scheduleGuarded(
      this.turnMs(),
      () => !this.destroyed && this.round === round && round.status === 'playing' && board.version === version && !boardDone(board),
      () => this.onDuelTimeout(round, userId),
    );
  }

  clearRoundTimers() {
    const r = this.round;
    if (!r) return;
    if (r.kind === 'turn') clearTimer(r);
    else for (const b of Object.values(r.boards)) clearTimer(b);
  }

  onTurnTimeout(round, userId) {
    const event = applyTurnTimeout(round, userId);
    if (event === null) return;
    if (event === 'continue') this.armTurnTimer();
    this.event('timeout', `${this.name(userId)} ran out of time`);
    this.afterMutation(event !== 'continue');
  }

  onDuelTimeout(round, userId) {
    const result = applyDuelTimeout(round, userId);
    if (result === null) return;
    const ended = result !== 'pending';
    if (ended) this.clearRoundTimers();
    else this.armDuelTimer(userId);
    this.event('timeout', `${this.name(userId)} ran out of time`);
    this.afterMutation(ended);
  }

  /* -------------------------------------------------------------- guesses */

  /**
   * @returns {{ok:true, pattern:string[], word:string} | {ok:false, reason:string, message:string}}
   */
  guess(userId, input) {
    const word = normalizeWord(input);
    const round = this.round;
    if (this.phase !== 'playing' || !round) return { ok: false, reason: 'not_playing', message: 'No round in progress.' };
    if (!this.participants.includes(userId)) return { ok: false, reason: 'spectator', message: 'You are watching this round. You join the next one.' };
    if (!isWellFormed(word)) return { ok: false, reason: 'malformed', message: 'Five letters, please.' };
    if (!isValidGuess(word)) return { ok: false, reason: 'not_a_word', message: 'Not in word list' };

    if (round.kind === 'turn') {
      const res = applyTurnGuess(round, userId, word);
      if (!res.ok) {
        const message =
          res.reason === 'not_your_turn' ? `It's ${this.name(currentTurnUser(round))}'s turn` : res.reason === 'not_in_round' ? 'You are not in this round.' : 'The round is over.';
        return { ok: false, reason: res.reason, message };
      }
      const ended = res.event !== 'continue';
      if (ended) clearTimer(round);
      else this.armTurnTimer();
      this.afterMutation(ended);
      return { ok: true, pattern: res.pattern, word };
    }

    const res = applyDuelGuess(round, userId, word);
    if (!res.ok) {
      const message =
        {
          already_solved: 'You already solved it — waiting for the others.',
          out: 'You are out of guesses.',
          forfeited: 'You left this round.',
          not_in_round: 'You are not in this round.',
        }[res.reason] ?? 'The round is over.';
      return { ok: false, reason: res.reason, message };
    }
    const ended = res.result !== 'pending';
    if (ended) this.clearRoundTimers();
    else this.armDuelTimer(userId);
    this.afterMutation(ended);
    return { ok: true, pattern: res.pattern, word };
  }

  afterMutation(ended) {
    if (ended && this.round && this.round.status !== 'playing' && this.phase === 'playing') this.endRound();
    else this.broadcast();
  }

  /* -------------------------------------------------------------- forfeit */

  forfeit(userId, { silent = false } = {}) {
    if (this.phase !== 'playing' || !this.round) return this.fail(userId, 'No round in progress.');
    if (!this.participants.includes(userId) || this.forfeited.has(userId)) return this.fail(userId, 'You are not playing this round.');
    const round = this.round;
    const result = round.kind === 'turn' ? forfeitTurn(round, userId) : forfeitDuel(round, userId);
    if (result === null) return this.fail(userId, 'You cannot forfeit now.');
    this.forfeited.add(userId);
    if (round.kind === 'turn' && result === 'continue') this.armTurnTimer();
    const ended = result !== 'continue' && result !== 'pending';
    if (ended) this.clearRoundTimers();
    if (!silent) this.event('forfeit', `${this.name(userId)} forfeited`);
    this.afterMutation(ended);
    return true;
  }

  /* ------------------------------------------------------------ round end */

  endRound() {
    const round = this.round;
    if (!round || this.phase !== 'playing') return;
    this.clearRoundTimers();
    this.phase = 'roundOver';
    this.roundsPlayed += 1;
    this.usedSecrets.add(round.secret);

    const winnerIds = round.kind === 'turn' ? (round.winnerId ? [round.winnerId] : []) : [...round.winnerIds];
    if (winnerIds.length === 1) this.score[winnerIds[0]] = (this.score[winnerIds[0]] ?? 0) + 1;
    else this.score.draws += 1;

    const result = this.forfeited.size && winnerIds.length ? 'forfeit' : round.status === 'tie' ? 'tie' : winnerIds.length ? 'win' : 'draw';
    this.lastResult = { winnerIds, result, secret: round.secret };

    if (this.stats && this.guildId) {
      this.stats
        .recordRoundResult({
          guildId: this.guildId,
          matchId: this.matchId,
          mode: round.kind,
          playerIds: this.participants,
          winnerIds,
          result,
          secret: round.secret,
        })
        .catch((err) => this.log.error('recordRoundResult failed:', err));
    }

    const text =
      winnerIds.length === 1
        ? `${this.name(winnerIds[0])} wins round ${this.roundNumber}!`
        : winnerIds.length > 1
          ? `Tie between ${winnerIds.map((id) => this.name(id)).join(' and ')}`
          : `Nobody got it — the word was ${round.secret.toUpperCase()}`;
    this.event('result', text);

    // Drop participants who already disconnected; they can't vote.
    for (const id of this.participants) {
      const m = this.members.get(id);
      if (m && m.sockets.size === 0) {
        clearTimer(m, 'disconnectTimer');
        this.members.delete(id);
        if (this.hostId === id) this.hostId = this.connectedMembers()[0]?.id ?? null;
      }
    }

    this.rematchDeadline = Date.now() + REMATCH_IDLE_MS;
    this.rematchTimer = setTimeout(() => {
      if (this.phase === 'roundOver') this.backToLobby('The vote timed out.');
    }, REMATCH_IDLE_MS);

    this.broadcast();
    this.checkRematch();
  }

  /** Participants who are still connected: the people whose vote is needed. */
  voters() {
    return this.participants.filter((id) => this.isConnected(id));
  }

  voteRematch(userId) {
    if (this.phase !== 'roundOver') return this.fail(userId, 'There is no vote right now.');
    if (!this.participants.includes(userId)) return this.fail(userId, 'You join automatically when the next round starts.');
    this.rematchVotes.add(userId);
    this.broadcast();
    this.checkRematch();
    return true;
  }

  checkRematch() {
    if (this.phase !== 'roundOver') return;
    const voters = this.voters();
    const connected = this.connectedMembers();
    if (connected.length < MIN_PLAYERS) {
      // Not enough people to play on. Wait for the vote timeout, or for someone to join.
      if (connected.length === 0) this.scheduleEmpty();
      return;
    }
    if (voters.length === 0 || voters.every((id) => this.rematchVotes.has(id))) {
      this.startRound(connected.slice(0, MAX_PLAYERS).map((m) => m.id));
    }
  }

  backToLobby(reason) {
    clearTimer(this, 'rematchTimer');
    this.phase = 'lobby';
    this.rematchVotes = new Set();
    this.rematchDeadline = null;
    if (reason) this.event('info', reason);
    this.broadcast();
  }

  /* ------------------------------------------------------------ snapshots */

  /** Everything a given viewer is allowed to see. */
  snapshotFor(viewerId) {
    const members = this.connectedMembers().map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      role: this.phase === 'lobby' ? 'player' : this.participants.includes(m.id) ? (this.forfeited.has(m.id) ? 'left' : 'player') : 'spectator',
    }));
    // Participants who dropped mid-round still show on the board.
    if (this.phase !== 'lobby') {
      for (const id of this.participants) {
        if (!members.some((m) => m.id === id)) {
          const m = this.members.get(id);
          members.push({ id, name: m?.name ?? 'Player', avatar: m?.avatar ?? null, role: this.forfeited.has(id) ? 'left' : 'away' });
        }
      }
    }

    const snap = {
      t: 'state',
      now: Date.now(),
      me: viewerId,
      hostId: this.hostId,
      phase: this.phase,
      settings: { ...this.settings, turnSeconds: this.turnSeconds, maxPlayers: MAX_PLAYERS, minPlayers: MIN_PLAYERS, maxTurns: MAX_TURNS },
      members,
      participants: this.participants,
      score: this.score,
      roundNumber: this.roundNumber,
      roundsPlayed: this.roundsPlayed,
      round: null,
      keys: {},
      result: this.phase === 'roundOver' ? this.lastResult : null,
      rematch: this.phase === 'roundOver' ? { votes: [...this.rematchVotes], needed: this.voters(), deadline: this.rematchDeadline } : null,
    };

    const round = this.round;
    if (!round || this.phase === 'lobby') return snap;
    const over = round.status !== 'playing';

    if (round.kind === 'turn') {
      snap.round = {
        kind: 'turn',
        status: round.status,
        secret: over ? round.secret : null,
        maxRows: round.maxRows,
        turnsEach: round.turnsEach,
        order: round.order,
        turnUserId: over ? null : currentTurnUser(round),
        deadline: over ? null : round.deadline,
        winnerId: round.winnerId,
        rows: round.rows.map((r) => ({ userId: r.userId, word: r.word, pattern: r.pattern, timedOut: r.timedOut })),
      };
      snap.keys = Object.fromEntries(keyboardState(round.rows));
      return snap;
    }

    const best = bestSolve(round);
    const boards = {};
    for (const [id, b] of Object.entries(round.boards)) {
      const mine = id === viewerId;
      boards[id] = {
        // Opponents only ever see colours, never letters — even after the round.
        rows: b.rows.map((r) => ({ word: mine ? r.word : null, pattern: r.pattern, timedOut: r.timedOut })),
        solvedAt: b.solvedAt,
        out: b.out,
        forfeited: b.forfeited,
        done: boardDone(b),
        deadline: over || boardDone(b) ? null : b.deadline,
      };
    }
    snap.round = {
      kind: 'duel',
      status: round.status,
      secret: over ? round.secret : null,
      maxRows: round.maxRows,
      bestSolve: best === Infinity ? null : best,
      winnerIds: round.winnerIds,
      boards,
    };
    snap.keys = round.boards[viewerId] ? Object.fromEntries(keyboardState(round.boards[viewerId].rows)) : {};
    return snap;
  }

  /* ------------------------------------------------------------ transport */

  send(socket, msg) {
    try {
      if (socket.readyState === undefined || socket.readyState === 1) socket.send(JSON.stringify(msg));
    } catch (err) {
      this.log.warn('send failed:', err?.message ?? err);
    }
  }

  sendTo(userId, msg) {
    const m = this.members.get(userId);
    if (!m) return;
    for (const s of m.sockets) this.send(s, msg);
  }

  broadcast() {
    if (this.destroyed) return;
    for (const m of this.members.values()) {
      if (m.sockets.size === 0) continue;
      const snap = this.snapshotFor(m.id);
      for (const s of m.sockets) this.send(s, snap);
    }
  }

  event(kind, text) {
    const msg = { t: 'event', kind, text, now: Date.now() };
    for (const m of this.members.values()) for (const s of m.sockets) this.send(s, msg);
  }

  fail(userId, text) {
    this.sendTo(userId, { t: 'error', text });
    return false;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearRoundTimers();
    clearTimer(this, 'rematchTimer');
    clearTimer(this, 'emptyTimer');
    for (const m of this.members.values()) {
      clearTimer(m, 'disconnectTimer');
      for (const s of m.sockets) {
        try {
          s.close(1000, 'room closed');
        } catch {
          /* ignore */
        }
      }
    }
    this.members.clear();
    this.onEmpty(this);
  }
}
