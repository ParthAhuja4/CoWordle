/**
 * CoWordle Activity front end. Bundled by esbuild into public/app.js.
 *
 * Boot: Discord Embedded App SDK → authorize → POST /api/token → authenticate
 *       → open WebSocket to the room for this Activity instance.
 * Then: every server snapshot re-renders the screen for the current phase.
 */
import { DiscordSDK } from '@discord/embedded-app-sdk';

const cfg = window.COWORDLE ?? {};
const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
// Inside Discord the page is served through the Activity proxy with a root ("/")
// URL mapping, so relative paths reach our server unchanged. Same locally.
const BASE = '';
const WORD_LEN = 5;
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const state = {
  sdk: null, // DiscordSDK instance (null under dev login)
  session: null,
  instanceId: null,
  channelId: null,
  me: null,
  snap: null,
  typed: '',
  pending: false,
  offset: 0, // serverNow - clientNow
  ws: null,
  retry: 0,
  revealed: new Map(), // boardKey → rows already shown (for flip animation)
  shakeRow: false,
};

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    if (cfg.devLogin && params.has('dev')) await devBoot();
    else await discordBoot();
    connect();
  } catch (err) {
    console.error(err);
    showLoadingError(err?.message ?? String(err));
  }
}

async function discordBoot() {
  if (!params.get('frame_id')) {
    throw new Error('Open CoWordle from inside Discord: type /cowordle in a channel.');
  }
  const sdk = new DiscordSDK(cfg.clientId);
  state.sdk = sdk;
  setLoading('Connecting to Discord…');
  await sdk.ready();
  setLoading('Signing you in…');
  const { code } = await sdk.commands.authorize({
    client_id: cfg.clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds.members.read'],
  });
  const res = await fetch(`${BASE}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, guildId: sdk.guildId }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check DISCORD_CLIENT_SECRET on the server.`);
  const { access_token, session, user } = await res.json();
  await sdk.commands.authenticate({ access_token });
  state.session = session;
  state.me = user;
  state.instanceId = sdk.instanceId;
  state.channelId = sdk.channelId;
}

async function devBoot() {
  setLoading('Dev login…');
  const res = await fetch(`${BASE}/api/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: params.get('dev') }),
  });
  if (!res.ok) throw new Error('Dev login is disabled on this server.');
  const { session, user } = await res.json();
  state.session = session;
  state.me = user;
  state.instanceId = params.get('instance') || 'dev';
  state.channelId = null;
}

function setLoading(text) {
  $('#loading-text').textContent = text;
}

function showLoadingError(text) {
  show('loading');
  $('#screen-loading').classList.add('failed');
  $('#loading-text').textContent = 'Could not start CoWordle.';
  const el = $('#loading-error');
  el.textContent = text;
  el.hidden = false;
}

/* --------------------------------------------------------------- network */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ s: state.session, i: state.instanceId });
  if (state.channelId) q.set('c', state.channelId);
  const ws = new WebSocket(`${proto}://${location.host}${BASE}/ws?${q}`);
  state.ws = ws;
  setLoading('Joining the room…');

  ws.onopen = () => {
    state.retry = 0;
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(msg);
  };
  ws.onclose = (ev) => {
    if (ev.code === 1000 && ev.reason === 'room closed') {
      showLoadingError('This room was closed. Launch /cowordle again.');
      return;
    }
    if (ev.code === 1008 || ev.code === 4401) {
      showLoadingError('Your session expired. Launch /cowordle again.');
      return;
    }
    const delay = Math.min(8000, 500 * 2 ** state.retry++);
    if (state.snap) toast('Reconnecting…', true);
    setTimeout(connect, delay);
  };
  ws.onerror = () => {};
}

function send(msg) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
}

function handle(msg) {
  switch (msg.t) {
    case 'state':
      state.offset = msg.now - Date.now();
      if (state.snap?.phase !== msg.phase || state.snap?.roundNumber !== msg.roundNumber) {
        state.typed = '';
        state.pending = false;
      }
      state.snap = msg;
      render();
      break;
    case 'guess':
      state.pending = false;
      if (msg.ok) state.typed = '';
      else {
        state.shakeRow = true;
        toast(msg.message ?? 'Try again');
      }
      render();
      break;
    case 'event':
      if (msg.kind !== 'join') toast(msg.text, msg.kind === 'leave' || msg.kind === 'info');
      break;
    case 'error':
      toast(msg.text);
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- render */

function show(name) {
  for (const s of ['loading', 'lobby', 'game']) $(`#screen-${s}`).hidden = s !== name;
}

function render() {
  const snap = state.snap;
  if (!snap) return;
  if (snap.phase === 'lobby') renderLobby(snap);
  else renderGame(snap);
}

function member(snap, id) {
  return snap.members.find((m) => m.id === id) ?? { id, name: 'Player', avatar: null };
}

function avatarEl(m, cls = 'avatar') {
  const el = document.createElement('div');
  el.className = cls;
  if (m.avatar) {
    const img = document.createElement('img');
    img.src = m.avatar;
    img.alt = '';
    img.onerror = () => {
      img.remove();
      el.textContent = initials(m.name);
    };
    el.appendChild(img);
  } else {
    el.textContent = initials(m.name);
  }
  return el;
}

function initials(name) {
  return String(name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
}

function badge(kind, text) {
  const el = document.createElement('span');
  el.className = `badge ${kind}`;
  el.textContent = text;
  return el;
}

function scoreText(snap) {
  const ids = Object.keys(snap.score).filter((k) => k !== 'draws');
  if (!ids.length) return '';
  const parts = ids.map((id) => `${member(snap, id).name} ${snap.score[id]}`);
  if (snap.score.draws) parts.push(`draws ${snap.score.draws}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ lobby */

const MODE_DESC = {
  duel: 'Everyone gets the same word on their own board. You see your rivals’ colours, never their letters. Fewest guesses wins.',
  turn: 'One board for everyone. Take turns guessing; every guess helps the next player. First to solve it wins.',
};
const MODE_OPTIONS = [
  { value: 'duel', label: 'Duel' },
  { value: 'turn', label: 'Turn-by-Turn' },
];
const TURN_OPTIONS = [1, 2, 3].map((n) => ({ value: n, label: String(n) }));

/** Seconds-per-turn presets from the server, plus the current value if it is not one of them. */
function secondsOptions(snap) {
  const opts = [...(snap.settings.turnSecondsOptions ?? [30, 45, 70, 90, 120])];
  if (!opts.includes(snap.settings.turnSeconds)) opts.push(snap.settings.turnSeconds);
  opts.sort((a, b) => a - b);
  return opts.map((s) => ({ value: s, label: `${s}s` }));
}

function secondsPicker(snap, isHost) {
  return segmented({
    options: secondsOptions(snap),
    current: snap.settings.turnSeconds,
    disabled: !isHost,
    label: 'Seconds per turn',
    onPick: (turnSeconds) => send({ t: 'settings', turnSeconds }),
  });
}

function modeSummary(snap) {
  const s = snap.settings;
  return s.mode === 'turn' ? `Turn-by-Turn · ${s.turnsEach} turn${s.turnsEach === 1 ? '' : 's'} each · ${s.turnSeconds}s per turn` : `Duel · ${s.turnSeconds}s per guess`;
}

/**
 * Segmented radio control. Used for the turns picker in the lobby and for the
 * mode + turns pickers on the result card, so they cannot drift apart.
 */
function segmented({ options, current, onPick, disabled = false, label = '' }) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  if (label) seg.setAttribute('aria-label', label);
  seg.setAttribute('aria-disabled', String(disabled));
  for (const o of options) {
    const b = document.createElement('button');
    const on = o.value === current;
    b.className = 'seg-btn' + (on ? ' on' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.disabled = disabled;
    b.textContent = o.label;
    b.onclick = () => {
      if (!disabled && !on) onPick(o.value);
    };
    seg.appendChild(b);
  }
  return seg;
}

function renderLobby(snap) {
  show('lobby');
  const isHost = snap.hostId === snap.me;
  const host = member(snap, snap.hostId);
  const role = $('#lobby-role');
  role.classList.toggle('host', isHost);
  role.textContent = isHost
    ? 'You’re the host. Pick a mode and start once everyone’s in.'
    : `${host.name} is the host and will pick the mode and start the game.`;
  $('#invite-btn').hidden = !state.sdk;
  const list = $('#lobby-players');
  const rows = snap.members.map((m) => {
    const li = document.createElement('li');
    li.className = 'member' + (m.id === snap.me ? ' me' : '');
    li.appendChild(avatarEl(m));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = m.name;
    li.appendChild(name);
    if (m.id === snap.me) li.appendChild(badge('you', 'you'));
    if (m.id === snap.hostId) li.appendChild(badge('host', 'host'));
    return li;
  });
  const open = snap.settings.maxPlayers - snap.members.length;
  for (let i = 0; i < open; i++) {
    const li = document.createElement('li');
    li.className = 'member empty';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = '+';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = 'Open slot';
    li.append(av, name);
    rows.push(li);
  }
  if (open > 0) {
    // Phones show this single pill instead of one dashed row per open slot (CSS picks).
    const li = document.createElement('li');
    li.className = 'member empty slots';
    li.textContent = `+ ${open} open slot${open === 1 ? '' : 's'}`;
    rows.push(li);
  }
  list.replaceChildren(...rows);
  $('#lobby-count').textContent = `${snap.members.length} / ${snap.settings.maxPlayers}`;

  const modeSeg = $('#mode-picker');
  modeSeg.setAttribute('aria-disabled', String(!isHost));
  for (const b of modeSeg.querySelectorAll('button')) {
    const on = b.dataset.mode === snap.settings.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.disabled = !isHost;
  }
  $('#mode-desc').textContent = MODE_DESC[snap.settings.mode] + ` ${snap.settings.turnSeconds}s per ${snap.settings.mode === 'turn' ? 'turn' : 'guess'}.`;
  const turnsRow = $('#turns-row');
  turnsRow.hidden = snap.settings.mode !== 'turn';
  $('#turns-picker').replaceChildren(
    segmented({
      options: TURN_OPTIONS,
      current: snap.settings.turnsEach,
      disabled: !isHost,
      label: 'Turns per player',
      onPick: (turnsEach) => send({ t: 'settings', turnsEach }),
    }),
  );
  $('#secs-label').textContent = snap.settings.mode === 'turn' ? 'Seconds per turn' : 'Seconds per guess';
  $('#secs-picker').replaceChildren(secondsPicker(snap, isHost));

  const enough = snap.members.length >= snap.settings.minPlayers;
  const nextRound = snap.roundNumber + 1;
  const startBtn = $('#start-btn');
  const wait = $('#lobby-wait');
  startBtn.hidden = !isHost;
  startBtn.disabled = !enough;
  startBtn.textContent = enough ? `3 · Start round ${nextRound}` : `Waiting for players (${snap.members.length}/${snap.settings.minPlayers})`;
  wait.hidden = isHost;
  wait.textContent = enough ? `Waiting for ${host.name} to start round ${nextRound}…` : `Waiting for more players (${snap.members.length}/${snap.settings.minPlayers})…`;

  const score = $('#lobby-score');
  const st = scoreText(snap);
  score.hidden = !st;
  score.textContent = st;
}

$('#mode-picker').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b && !b.disabled) send({ t: 'settings', mode: b.dataset.mode });
});
$('#start-btn').addEventListener('click', () => send({ t: 'start' }));
$('#invite-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await state.sdk.commands.openInviteDialog();
  } catch (err) {
    console.warn('invite dialog failed', err);
    btn.hidden = true;
    toast('Invites are not available here. Friends can tap the activity in the channel to join.', true);
  }
});

/* ------------------------------------------------------------------- game */

function myRole(snap) {
  return member(snap, snap.me).role ?? (snap.participants.includes(snap.me) ? 'player' : 'spectator');
}

function canGuess(snap) {
  if (snap.phase !== 'playing' || !snap.round) return false;
  if (!snap.participants.includes(snap.me) || myRole(snap) === 'left') return false;
  if (snap.round.kind === 'turn') return snap.round.turnUserId === snap.me;
  const b = snap.round.boards[snap.me];
  return !!b && !b.done;
}

function myDeadline(snap) {
  if (!snap.round || snap.phase !== 'playing') return null;
  if (snap.round.kind === 'turn') return snap.round.deadline;
  return snap.round.boards[snap.me]?.deadline ?? null;
}

function renderGame(snap) {
  show('game');
  const round = snap.round;
  const playing = snap.phase === 'playing';

  // Score chips
  const chips = $('#score-chips');
  chips.classList.toggle('many', snap.participants.length >= 4);
  chips.replaceChildren(
    ...snap.participants.map((id) => {
      const m = member(snap, id);
      const c = document.createElement('div');
      const isTurn = playing && round?.kind === 'turn' && round.turnUserId === id;
      const isDone = round?.kind === 'duel' && round.boards[id]?.solvedAt != null;
      c.className = 'chip' + (id === snap.me ? ' me' : '') + (m.role === 'left' ? ' left' : '') + (isTurn ? ' turn' : '') + (isDone ? ' done' : '');
      c.appendChild(avatarEl(m));
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = m.name;
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = snap.score[id] ?? 0;
      c.append(n, s);
      return c;
    }),
  );
  $('#round-label').textContent = `Round ${snap.roundNumber} · ${round?.kind === 'turn' ? 'Turn-by-Turn' : 'Duel'}${snap.score.draws ? ` · ${snap.score.draws} draw${snap.score.draws === 1 ? '' : 's'}` : ''}`;

  // Status line
  const status = $('#status');
  status.innerHTML = statusHtml(snap);
  status.classList.toggle('hot', playing && canGuess(snap));

  // Boards
  const boards = $('#boards');
  boards.replaceChildren(round.kind === 'turn' ? renderTurnBoard(snap) : renderDuelBoards(snap));

  // Overlay
  const overlay = $('#overlay');
  if (snap.phase === 'roundOver') {
    overlay.hidden = false;
    overlay.replaceChildren(resultCard(snap));
  } else {
    overlay.hidden = true;
    overlay.replaceChildren();
  }

  // Keyboard + forfeit
  renderKeyboard(snap);
  const ff = $('#forfeit-btn');
  ff.hidden = !(playing && snap.participants.includes(snap.me) && myRole(snap) === 'player');

  state.shakeRow = false;
  tickTimer();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function statusHtml(snap) {
  const r = snap.round;
  const meIn = snap.participants.includes(snap.me);
  if (snap.phase !== 'playing') return '';
  if (!meIn) return 'You’re watching this round — you join the next one.';
  if (myRole(snap) === 'left') return 'You forfeited this round.';
  if (r.kind === 'turn') {
    if (r.turnUserId === snap.me) return `<b>Your turn</b> · ${r.maxRows - r.rows.length} row${r.maxRows - r.rows.length === 1 ? '' : 's'} left`;
    return `Waiting for <b>${esc(member(snap, r.turnUserId).name)}</b>…`;
  }
  const b = r.boards[snap.me];
  if (b.solvedAt !== null) return `<b>Solved in ${b.solvedAt}!</b> Waiting for the others…`;
  if (b.out) return 'Out of guesses. Waiting for the others…';
  if (r.bestSolve !== null) {
    const left = r.bestSolve - b.rows.length;
    return left > 0 ? `Someone solved it in <b>${r.bestSolve}</b> — ${left} guess${left === 1 ? '' : 'es'} to tie or beat it` : 'Someone solved it first.';
  }
  return `Guess ${b.rows.length + 1} of ${r.maxRows}`;
}

function tileRow(row, { typed = '', flip = false, timedLabel = '⏱' } = {}) {
  const el = document.createElement('div');
  el.className = 'row';
  for (let i = 0; i < WORD_LEN; i++) {
    const t = document.createElement('div');
    let cls = 'tile';
    if (row?.timedOut) {
      cls += ' timed';
      t.textContent = i === 2 ? timedLabel : '';
    } else if (row?.pattern) {
      cls += ` ${row.pattern[i]}`;
      if (flip) {
        cls += ' flip';
        t.style.animationDelay = `${i * 90}ms`;
      }
      t.textContent = row.word ? row.word[i] : '';
    } else if (typed[i]) {
      cls += ' typed';
      t.textContent = typed[i];
    }
    t.className = cls;
    el.appendChild(t);
  }
  return el;
}

/** Rows that appeared since the last render get the flip animation. */
function newRowsFrom(key, count) {
  const seen = state.revealed.get(key) ?? 0;
  state.revealed.set(key, count);
  return seen;
}

function renderDuelBoards(snap) {
  const r = snap.round;
  const wrap = document.createElement('div');
  wrap.className = 'mine-wrap';

  const mine = r.boards[snap.me];
  if (mine) {
    const board = document.createElement('div');
    board.className = 'board';
    const key = `duel:${snap.roundNumber}:me`;
    const seen = newRowsFrom(key, mine.rows.length);
    const typing = canGuess(snap) && snap.phase === 'playing';
    for (let i = 0; i < r.maxRows; i++) {
      const row = mine.rows[i];
      const el = tileRow(row, { typed: typing && i === mine.rows.length ? state.typed : '', flip: !!row && i >= seen });
      if (typing && i === mine.rows.length && state.shakeRow) el.classList.add('shake');
      board.appendChild(el);
    }
    wrap.appendChild(board);
  } else {
    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = 'Spectating';
    wrap.appendChild(lbl);
  }

  const others = document.createElement('div');
  others.className = 'others';
  for (const [id, b] of Object.entries(r.boards)) {
    if (id === snap.me) continue;
    others.appendChild(miniBoard(snap, id, b));
  }
  const container = document.createElement('div');
  container.style.display = 'contents';
  container.append(wrap, others);
  return container;
}

function miniBoard(snap, id, b) {
  const m = member(snap, id);
  const el = document.createElement('div');
  el.className = 'other' + (b.solvedAt !== null ? ' done' : '') + (b.forfeited || m.role === 'away' ? ' left' : '');
  const grid = document.createElement('div');
  grid.className = 'mini';
  for (let i = 0; i < snap.round.maxRows; i++) {
    const row = b.rows[i];
    const mr = document.createElement('div');
    mr.className = 'mrow';
    for (let j = 0; j < WORD_LEN; j++) {
      const t = document.createElement('div');
      t.className = 'mtile' + (row?.timedOut ? ' timed' : row?.pattern ? ` ${row.pattern[j]}` : '');
      mr.appendChild(t);
    }
    grid.appendChild(mr);
  }
  const name = document.createElement('div');
  name.className = 'oname';
  name.textContent = m.name;
  const stat = document.createElement('div');
  stat.className = 'ostat';
  stat.textContent = b.forfeited ? 'left' : m.role === 'away' ? 'away' : b.solvedAt !== null ? `solved in ${b.solvedAt}` : b.out ? 'out' : `${b.rows.length}/${snap.round.maxRows}`;
  const text = document.createElement('div');
  text.className = 'other-text';
  text.append(name, stat);
  el.append(grid, text);
  return el;
}

function renderTurnBoard(snap) {
  const r = snap.round;
  const board = document.createElement('div');
  board.className = 'board';
  const key = `turn:${snap.roundNumber}`;
  const seen = newRowsFrom(key, r.rows.length);
  const typing = canGuess(snap);
  for (let i = 0; i < r.maxRows; i++) {
    const row = r.rows[i];
    const isNext = i === r.rows.length && snap.phase === 'playing';
    const el = tileRow(row, { typed: typing && isNext ? state.typed : '', flip: !!row && i >= seen });
    el.className = 'turn-row' + (isNext ? ' active' : '');
    if (typing && isNext && state.shakeRow) el.classList.add('shake');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = row ? member(snap, row.userId).name : isNext ? member(snap, r.turnUserId).name : '';
    el.appendChild(who);
    board.appendChild(el);
  }
  return board;
}

function resultCard(snap) {
  const card = document.createElement('div');
  card.className = 'result';
  const res = snap.result ?? { winnerIds: [], result: 'draw', secret: snap.round?.secret ?? '' };
  const names = res.winnerIds.map((id) => member(snap, id).name);
  const meWon = res.winnerIds.includes(snap.me);

  const emoji = document.createElement('div');
  emoji.className = 'result-emoji';
  const h = document.createElement('h3');
  if (res.winnerIds.length === 1) {
    emoji.textContent = meWon ? '🏆' : '🎉';
    h.textContent = meWon ? 'You win!' : `${names[0]} wins`;
  } else if (res.winnerIds.length > 1) {
    emoji.textContent = '🤝';
    h.textContent = meWon ? 'You tied!' : `Tie: ${names.join(' & ')}`;
  } else {
    emoji.textContent = '😶';
    h.textContent = 'Nobody got it';
  }
  card.append(emoji, h);

  const word = document.createElement('div');
  word.className = 'word';
  for (const ch of res.secret) {
    const s = document.createElement('span');
    s.textContent = ch;
    word.appendChild(s);
  }
  card.appendChild(word);

  const board = document.createElement('div');
  board.className = 'scoreboard';
  const ids = Object.keys(snap.score).filter((k) => k !== 'draws').sort((a, b) => snap.score[b] - snap.score[a]);
  for (const id of ids) {
    const m = member(snap, id);
    const row = document.createElement('div');
    row.className = 'srow' + (res.winnerIds.includes(id) ? ' win' : '');
    const n = document.createElement('span');
    n.className = 'sn';
    n.textContent = m.name + (id === snap.me ? ' (you)' : '');
    const s = document.createElement('span');
    s.className = 'ss';
    s.textContent = snap.score[id];
    row.append(avatarEl(m), n, s);
    board.appendChild(row);
  }
  if (snap.score.draws) {
    const d = document.createElement('div');
    d.className = 'srow draws';
    d.textContent = `${snap.score.draws} draw${snap.score.draws === 1 ? '' : 's'}`;
    board.appendChild(d);
  }
  card.appendChild(board);

  card.appendChild(nextRoundBlock(snap));

  const cd = document.createElement('p');
  cd.className = 'countdown';
  cd.dataset.deadline = snap.next?.deadline ?? '';
  cd.id = 'next-countdown';
  card.appendChild(cd);
  return card;
}

/**
 * "Next round" section of the result card. The host picks the mode (defaults
 * to the one just played) and starts; everyone else watches the choice update.
 */
function nextRoundBlock(snap) {
  const isHost = snap.hostId === snap.me;
  const host = member(snap, snap.hostId);
  // Only people with a live socket count: the server refuses to start otherwise.
  const connected = snap.members.filter((m) => m.connected !== false).length;
  const enough = connected >= snap.settings.minPlayers;
  const nextRound = snap.roundNumber + 1;

  const block = document.createElement('div');
  block.className = 'next';

  const head = document.createElement('div');
  head.className = 'next-head';
  head.textContent = `Round ${nextRound}`;
  block.appendChild(head);

  block.appendChild(
    segmented({
      options: MODE_OPTIONS,
      current: snap.settings.mode,
      disabled: !isHost,
      label: 'Mode for the next round',
      onPick: (mode) => send({ t: 'settings', mode }),
    }),
  );
  if (snap.settings.mode === 'turn') {
    const row = document.createElement('div');
    row.className = 'next-turns';
    const lbl = document.createElement('span');
    lbl.className = 'turns-label';
    lbl.textContent = 'Turns each';
    row.append(
      lbl,
      segmented({
        options: TURN_OPTIONS,
        current: snap.settings.turnsEach,
        disabled: !isHost,
        label: 'Turns per player',
        onPick: (turnsEach) => send({ t: 'settings', turnsEach }),
      }),
    );
    block.appendChild(row);
  }
  {
    const row = document.createElement('div');
    row.className = 'next-secs';
    const lbl = document.createElement('span');
    lbl.className = 'turns-label';
    lbl.textContent = snap.settings.mode === 'turn' ? 'Seconds per turn' : 'Seconds per guess';
    row.append(lbl, secondsPicker(snap, isHost));
    block.appendChild(row);
  }

  if (isHost) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-lg';
    btn.textContent = enough ? `Start round ${nextRound}` : `Waiting for players (${connected}/${snap.settings.minPlayers})`;
    btn.disabled = !enough;
    btn.onclick = () => send({ t: 'next' });
    block.appendChild(btn);
  } else {
    const wait = document.createElement('p');
    wait.className = 'wait';
    wait.textContent = `Waiting for ${host.name} to start ${modeSummary(snap)}`;
    block.appendChild(wait);
    if (!snap.participants.includes(snap.me)) {
      const sub = document.createElement('p');
      sub.className = 'sub';
      sub.textContent = 'You’ll play in the next round.';
      block.appendChild(sub);
    }
  }
  return block;
}

function renderKeyboard(snap) {
  const kb = $('#keyboard');
  const active = canGuess(snap);
  kb.classList.toggle('off', !active);
  if (kb.dataset.built !== '1') {
    kb.dataset.built = '1';
    kb.replaceChildren(
      ...KEY_ROWS.map((row, i) => {
        const r = document.createElement('div');
        r.className = 'krow';
        if (i === 2) r.appendChild(keyBtn('enter', 'Enter', true));
        for (const ch of row) r.appendChild(keyBtn(ch, ch));
        if (i === 2) r.appendChild(keyBtn('backspace', '⌫', true));
        return r;
      }),
    );
  }
  for (const b of kb.querySelectorAll('.key[data-key]')) {
    const k = b.dataset.key;
    if (k.length !== 1) continue;
    b.className = 'key' + (snap.keys[k] ? ` ${snap.keys[k]}` : '');
  }
}

function keyBtn(key, label, wide = false) {
  const b = document.createElement('button');
  b.className = 'key' + (wide ? ' wide' : '');
  b.dataset.key = key;
  b.textContent = label;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onKey(key);
  });
  return b;
}

function onKey(key) {
  const snap = state.snap;
  if (!snap || !canGuess(snap) || state.pending) return;
  if (key === 'enter') {
    if (state.typed.length !== WORD_LEN) {
      state.shakeRow = true;
      toast('Not enough letters');
      render();
      return;
    }
    state.pending = true;
    send({ t: 'guess', word: state.typed });
    return;
  }
  if (key === 'backspace') {
    if (state.typed) {
      state.typed = state.typed.slice(0, -1);
      render();
    }
    return;
  }
  if (/^[a-z]$/.test(key) && state.typed.length < WORD_LEN) {
    state.typed += key;
    render();
  }
}

window.addEventListener('keydown', (e) => {
  if ($('#screen-game').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'enter' || k === 'backspace' || /^[a-z]$/.test(k)) {
    e.preventDefault();
    onKey(k);
  }
});

// Two taps instead of confirm(): dialogs are blocked inside Discord's sandboxed iframe.
let forfeitArmed = null;
$('#forfeit-btn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (forfeitArmed) {
    clearTimeout(forfeitArmed);
    forfeitArmed = null;
    btn.textContent = 'Forfeit round';
    btn.classList.remove('armed');
    send({ t: 'forfeit' });
    return;
  }
  btn.textContent = 'Tap again to forfeit';
  btn.classList.add('armed');
  forfeitArmed = setTimeout(() => {
    forfeitArmed = null;
    btn.textContent = 'Forfeit round';
    btn.classList.remove('armed');
  }, 3000);
});

/* ----------------------------------------------------------------- timer */

function tickTimer() {
  const snap = state.snap;
  const fill = $('#timer-fill');
  if (!snap || snap.phase !== 'playing') {
    fill.style.width = '0%';
  } else {
    const r = snap.round;
    const total = snap.settings.turnSeconds * 1000;
    const dl = r.kind === 'turn' ? r.deadline : (r.boards[snap.me]?.deadline ?? null);
    if (dl) {
      const left = Math.max(0, dl - (Date.now() + state.offset));
      fill.style.width = `${(100 * left) / total}%`;
      fill.classList.toggle('low', left < 8000);
    } else {
      fill.style.width = '0%';
    }
  }
  const cd = document.getElementById('next-countdown');
  if (cd && cd.dataset.deadline) {
    const left = Math.max(0, Number(cd.dataset.deadline) - (Date.now() + state.offset));
    cd.textContent = `Back to the lobby in ${Math.ceil(left / 1000)}s if nobody starts`;
  }
}
setInterval(tickTimer, 250);
setInterval(() => send({ t: 'ping' }), 25_000);

/* ----------------------------------------------------------------- toasts */

function toast(text, quiet = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (quiet ? ' quiet' : '');
  el.textContent = text;
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 2300);
}

boot();
