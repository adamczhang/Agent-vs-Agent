// Go for Gamer mode (J1), on a 9x9, 13x13 or 19x19 board, under no-suicide Tromp-Taylor rules, the precise rules Go
// programs use: a stone or group with no liberty is captured; a move may not leave its own group without a liberty
// (suicide) or repeat an earlier position (positional superko). Two passes in a row end the game, which is scored by area:
// each player's stones plus the empty points that reach only their stones; White gets 7.5 points of komi. Dead stones are
// not removed by agreement, so a player should capture them before passing. Moves are a column letter (A-T without I)
// and a row number from the bottom, such as D4, or pass.
import type { GameEngine, Outcome } from './engine.js';

export const COLUMNS = 'ABCDEFGHJKLMNOPQRST';
export const KOMI = 7.5;
export interface GoState {
  size: number;
  board: number[]; // 0 empty, 1 Black, 2 White; row 0 at the top (row number size)
  turn: 1 | 2;
  passes: number; // passes in a row
  captures: [number, number]; // stones captured by Black and by White
  seen: string[]; // every position so far, for superko
  plies: number;
}
export const goPoint = (size: number, i: number) => `${COLUMNS[i % size]}${size - Math.floor(i / size)}`;
function neighbors(size: number, i: number) {
  const r = Math.floor(i / size), c = i % size, out: number[] = [];
  if (r > 0) out.push(i - size); if (r < size - 1) out.push(i + size); if (c > 0) out.push(i - 1); if (c < size - 1) out.push(i + 1);
  return out;
}
// The group at i and whether it has a liberty.
function group(board: number[], size: number, i: number) {
  const color = board[i], stones = new Set([i]), stack = [i];
  let free = false;
  while (stack.length) for (const n of neighbors(size, stack.pop()!)) {
    if (board[n] === 0) free = true;
    else if (board[n] === color && !stones.has(n)) { stones.add(n); stack.push(n); }
  }
  return { stones, free };
}
export function goStart(size = 9): GoState {
  if (![9, 13, 19].includes(size)) throw new Error('Go is played on 9x9, 13x13 or 19x19 here.');
  const board = Array<number>(size * size).fill(0);
  return { size, board, turn: 1, passes: 0, captures: [0, 0], seen: [board.join('')], plies: 0 };
}
// Places a stone: the new state, or why it can't go there.
function place(s: GoState, i: number): GoState | string {
  if (s.board[i] !== 0) return 'that point is occupied';
  const board = s.board.slice(), me = s.turn, them = me === 1 ? 2 : 1;
  board[i] = me;
  let taken = 0;
  for (const n of neighbors(s.size, i)) if (board[n] === them) { const g = group(board, s.size, n); if (!g.free) for (const st of g.stones) { board[st] = 0; taken++; } }
  if (!group(board, s.size, i).free) return 'it would be suicide (the stone would have no liberty)';
  const position = board.join('');
  if (s.seen.includes(position)) return 'it would repeat an earlier position (ko)';
  const captures: [number, number] = [...s.captures];
  captures[me === 1 ? 0 : 1] += taken;
  return { size: s.size, board, turn: them as 1 | 2, passes: 0, captures, seen: [...s.seen, position], plies: s.plies + 1 };
}
export function goParse(size: number, input: string) {
  const text = input.trim().toUpperCase().replace(/\s+/g, '');
  if (text === 'PASS') return 'pass';
  const m = text.match(/^([A-HJ-T])(\d{1,2})$/);
  if (!m) return null;
  const c = COLUMNS.indexOf(m[1]!), row = Number(m[2]);
  return c < size && row >= 1 && row <= size ? (size - row) * size + c : null;
}
export function goLegal(s: GoState) {
  const out: string[] = [];
  for (let i = 0; i < s.board.length; i++) if (s.board[i] === 0 && typeof place(s, i) !== 'string') out.push(goPoint(s.size, i));
  return [...out, 'pass'];
}
export function goPlay(s: GoState, input: string) {
  const at = goParse(s.size, input);
  if (at === null) throw new Error(`${input} isn't a point on this board (columns ${COLUMNS.slice(0, s.size)}, rows 1-${s.size}) or pass`);
  if (at === 'pass') return { state: { ...s, turn: (s.turn === 1 ? 2 : 1) as 1 | 2, passes: s.passes + 1, plies: s.plies + 1 }, move: 'pass' };
  const next = place(s, at);
  if (typeof next === 'string') throw new Error(`${input.trim().toUpperCase()} isn't legal: ${next}`);
  return { state: next, move: goPoint(s.size, at) };
}
// Area scoring (Tromp-Taylor): stones, plus empty regions that reach only one color.
export function goScore(s: GoState) {
  const score = [0, 0], visited = new Set<number>();
  for (let i = 0; i < s.board.length; i++) {
    if (s.board[i]) { score[s.board[i]! - 1] = score[s.board[i]! - 1]! + 1; continue; }
    if (visited.has(i)) continue;
    const region = [i], reach = new Set<number>(); visited.add(i);
    for (let k = 0; k < region.length; k++) for (const n of neighbors(s.size, region[k]!)) {
      if (s.board[n]) reach.add(s.board[n]!);
      else if (!visited.has(n)) { visited.add(n); region.push(n); }
    }
    if (reach.size === 1) score[[...reach][0]! - 1]! += region.length;
  }
  return { black: score[0]!, white: score[1]! + KOMI };
}
function scored(s: GoState, why: string): Outcome {
  const { black, white } = goScore(s), margin = Math.abs(black - white);
  return { winner: black > white ? 0 : 1, reason: why, score: `${black > white ? 'B' : 'W'}+${margin} (Black ${black}, White ${white})` };
}
export function goOutcome(s: GoState): Outcome | null { return s.passes >= 2 ? scored(s, 'both players passed') : null; }
// The position as a compact grid, one row per line from the top, X Black, O White, . empty, then the side to move and the
// captures so far (so that, like a FEN, it stands on its own).
function position(s: GoState) {
  const lines = [`   ${COLUMNS.slice(0, s.size)}`];
  for (let r = 0; r < s.size; r++) lines.push(`${String(s.size - r).padStart(2)} ${s.board.slice(r * s.size, (r + 1) * s.size).map(v => v === 1 ? 'X' : v === 2 ? 'O' : '.').join('')}`);
  return [...lines, `${s.turn === 1 ? 'Black' : 'White'} to play. Captures: Black ${s.captures[0]}, White ${s.captures[1]}.`].join('\n');
}
// A position read back from that grid (the simulator's players read their turns this way). It has no history, so
// superko only covers positions from here on.
export function goFromPosition(text: string): GoState {
  const rows = [...text.matchAll(/^ ?(\d{1,2}) ([XO.]+)$/gm)], size = rows.length, turn = text.match(/(Black|White) to play\./)?.[1];
  if (![9, 13, 19].includes(size) || rows.some(r => r[2]!.length !== size) || !turn) throw new Error('Not a Go position.');
  const board = rows.flatMap(r => [...r[2]!].map(c => c === 'X' ? 1 : c === 'O' ? 2 : 0)), captures = text.match(/Captures: Black (\d+), White (\d+)\./);
  return { size, board, turn: turn === 'Black' ? 1 : 2, passes: 0, captures: [Number(captures?.[1] ?? 0), Number(captures?.[2] ?? 0)], seen: [board.join('')], plies: 0 };
}

export const go: GameEngine<GoState> = {
  kind: 'go', name: 'Go', sides: ['Black', 'White'],
  start: size => goStart(size ?? 9),
  toMove: s => s.turn === 1 ? 0 : 1,
  legal: goLegal,
  play: goPlay,
  outcome: goOutcome,
  plyLimit: s => s.size * s.size * 3,
  limitOutcome: s => scored(s, 'the move limit'),
  position,
  fromPosition: goFromPosition,
  rules: 'Go under no-suicide Tromp-Taylor rules. Black moves first. A stone or group with no liberty (empty adjacent point) is captured. You may not play suicide or recreate an earlier whole-board position (positional superko, which covers ko). Two passes in a row end the game. Scoring is by area: your stones plus the empty points that reach only your stones; White gets 7.5 points of komi. Nothing is removed as dead at the end, so capture dead stones before you pass.',
  notation: 'Moves in GTP coordinates: a column letter A to T without I, then the row number counted from the bottom, such as D4 or Q16; or pass. Positions as a grid: a header of column letters, then one line per row from the top, starting with its row number; X is Black, O is White, . is empty; then the side to play and the stones each side has captured.',
  example: 'D4',
};
