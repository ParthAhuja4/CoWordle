import * as play from './play.js';
import * as cancel from './cancel.js';
import * as challenge from './challenge.js';
import * as guess from './guess.js';
import * as board from './board.js';
import * as forfeit from './forfeit.js';
import * as stats from './stats.js';
import * as leaderboard from './leaderboard.js';
import * as help from './help.js';

export const commands = [play, cancel, challenge, guess, board, forfeit, stats, leaderboard, help];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
