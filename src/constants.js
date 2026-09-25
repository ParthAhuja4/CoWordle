export const WORD_LEN = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;
export const DEFAULT_TURNS = 2;
export const MAX_TURNS = 3;
export const DUEL_ROWS = 6;

export const CHALLENGE_TTL_MS = 60_000;
export const LOBBY_TTL_MS = 600_000;
export const REMATCH_IDLE_MS = 120_000;
export const TIMER_GRACE_MS = 750;
export const ARCHIVE_DELAY_MS = 30_000;

export const MODES = {
  turn: { key: 'turn', label: 'Turn-by-Turn', emoji: '🎮' },
  duel: { key: 'duel', label: 'Duel', emoji: '⚔️' },
};

export const EMOJI = {
  g: '🟩',
  y: '🟨',
  x: '⬜',
  empty: '⬛',
};

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
