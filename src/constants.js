export const WORD_LEN = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;
export const DEFAULT_TURNS = 2;
export const MAX_TURNS = 3;
export const DUEL_ROWS = 6;

/** Seconds per guess/turn the host can pick from; TURN_SECONDS (env) is the default. */
export const TURN_SECONDS_OPTIONS = [30, 45, 70, 90, 120];
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 300;

/** How long the "Play again" vote stays open after a round. */
export const REMATCH_IDLE_MS = 120_000;
/** Extra slack added to every game timer so clients see the bar reach zero first. */
export const TIMER_GRACE_MS = 750;
/** A player who drops mid-round is forfeited after this long without reconnecting. */
export const DISCONNECT_GRACE_MS = 20_000;
/** An activity instance with nobody connected is torn down after this long. */
export const ROOM_EMPTY_TTL_MS = 60_000;

export const MODES = {
  duel: { key: 'duel', label: 'Duel' },
  turn: { key: 'turn', label: 'Turn-by-Turn' },
  poople: { key: 'poople', label: 'Poople' },
};

/** Poople: change one letter at a time to get from a random start word to the target. */
export const POOPLE_TARGET = 'poop';
export const POOPLE_LEN = 4;
/** Start words are picked so the shortest path (par) is within this range. */
export const POOPLE_PAR_MIN = 3;
export const POOPLE_PAR_MAX = 6;

export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
