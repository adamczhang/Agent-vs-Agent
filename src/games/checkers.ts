// Checkers (English draughts) for Gamer mode (J1): the 8x8 game with the standard numbering of the 32 dark squares, 1 to
// 32 from Black's side. Black (on 1-12) moves first. Men move one square diagonally forward; kings move both ways.
// Captures are compulsory, a capturing piece must keep jumping while it can, and a man that reaches the far row is
// crowned and its move ends. Moves are written as in published games: 11-15 for a move, 22x15x8 for a capture. A side
// with no legal move loses; 40 moves each without a capture or a man moving, or a threefold repetition, is a draw.
// Checked against the published perft counts from the start (7, 49, 302, 1469, 7361), as open-source move generators are.
import type { GameEngine, Outcome } from './engine.js';

type Side = 'b' | 'w';
export interface CheckersState {
  board: string[]; // squares 1-32 at indexes 0-31: 'b' and 'B' (Black man and king), 'w' and 'W', '' empty
  turn: Side;
  quiet: number; // plies since the last capture or man move
  seen: Record<string, number>;
}
interface Jump { path: number[]; taken: number[] }
const rowOf = (i: number) => i >> 2, colOf = (i: number) => (rowOf(i) % 2 === 0 ? 2 * (i % 4) + 1 : 2 * (i % 4));
const at = (r: number, c: number) => r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0 ? -1 : r * 4 + (r % 2 === 0 ? (c - 1) / 2 : c / 2);
const sideOf = (p: string): Side | '' => p ? p.toLowerCase() as Side : '';
// The row directions a piece moves in: Black men down the board (towards 32), White men up, kings both.
const forward = (p: string) => p === 'b' ? [1] : p === 'w' ? [-1] : [-1, 1];
const crownRow = (side: Side) => side === 'b' ? 7 : 0;
const key = (s: CheckersState) => `${s.board.map(p => p || '.').join('')} ${s.turn}`;

export function checkersStart(): CheckersState {
  const board = Array.from({ length: 32 }, (_, i) => i < 12 ? 'b' : i >= 20 ? 'w' : '');
  const s: CheckersState = { board, turn: 'b', quiet: 0, seen: {} };
  s.seen[key(s)] = 1;
  return s;
}
function jumpsFrom(board: string[], from: number): Jump[] {
  const piece = board[from]!, side = sideOf(piece) as Side, out: Jump[] = [];
  const walk = (sq: number, man: string, path: number[], taken: number[]) => {
    let extended = false;
    for (const dr of forward(man)) for (const dc of [-1, 1]) {
      const over = at(rowOf(sq) + dr, colOf(sq) + dc), land = at(rowOf(sq) + 2 * dr, colOf(sq) + 2 * dc);
      if (over < 0 || land < 0 || taken.includes(over)) continue;
      const victim = board[over]!;
      if (!victim || sideOf(victim) === side) continue;
      if (board[land] && land !== from) continue;
      extended = true;
      // A man that reaches the far row is crowned, and its move ends there.
      if (man === man.toLowerCase() && rowOf(land) === crownRow(side)) out.push({ path: [...path, land], taken: [...taken, over] });
      else walk(land, man, [...path, land], [...taken, over]);
    }
    if (!extended && taken.length) out.push({ path, taken });
  };
  walk(from, piece, [from], []);
  return out;
}
function moves(s: CheckersState): Jump[] {
  const mine = s.board.map((p, i) => ({ p, i })).filter(x => sideOf(x.p) === s.turn);
  const jumps = mine.flatMap(x => jumpsFrom(s.board, x.i));
  if (jumps.length) return jumps;
  const steps: Jump[] = [];
  for (const { p, i } of mine) for (const dr of forward(p)) for (const dc of [-1, 1]) {
    const to = at(rowOf(i) + dr, colOf(i) + dc);
    if (to >= 0 && !s.board[to]) steps.push({ path: [i, to], taken: [] });
  }
  return steps;
}
const notation = (m: Jump) => m.path.map(i => i + 1).join(m.taken.length ? 'x' : '-');
function apply(s: CheckersState, m: Jump, track = true): CheckersState {
  const board = s.board.slice(), from = m.path[0]!, to = m.path.at(-1)!, piece = board[from]!;
  board[from] = '';
  for (const t of m.taken) board[t] = '';
  board[to] = rowOf(to) === crownRow(s.turn) ? piece.toUpperCase() : piece;
  const man = piece === piece.toLowerCase();
  const next: CheckersState = { board, turn: s.turn === 'b' ? 'w' : 'b', quiet: m.taken.length || man ? 0 : s.quiet + 1, seen: track ? { ...s.seen } : s.seen };
  if (track) { const k = key(next); next.seen[k] = (next.seen[k] ?? 0) + 1; }
  return next;
}
export const checkersLegal = (s: CheckersState) => moves(s).map(notation);
// An agent's move as written (11-15, 22x15x8, spaces allowed), or just a capture's first and last squares (22x8) when
// only one capture goes that way.
export function checkersPlay(s: CheckersState, input: string) {
  const all = moves(s), text = input.trim().replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/X/g, 'x');
  let move = all.find(m => notation(m) === text);
  if (!move) {
    const ends = text.split(/[-x]/).map(Number);
    const candidates = ends.length >= 2 && ends.every(n => Number.isInteger(n) && n >= 1 && n <= 32) ? all.filter(m => m.path[0]! + 1 === ends[0] && m.path.at(-1)! + 1 === ends.at(-1)) : [];
    if (candidates.length === 1) move = candidates[0];
  }
  if (!move) throw new Error(`${input} isn't a legal move here${all.some(m => m.taken.length) ? ' (a capture is available, and captures are compulsory)' : ''}`);
  return { state: apply(s, move), move: notation(move) };
}
export function checkersOutcome(s: CheckersState): Outcome | null {
  if (!moves(s).length) return { winner: s.turn === 'b' ? 1 : 0, reason: s.board.some(p => sideOf(p) === s.turn) ? 'no legal move left' : 'all pieces captured' };
  if (s.quiet >= 80) return { winner: null, reason: 'the 40-move rule' };
  if ((s.seen[key(s)] ?? 0) >= 3) return { winner: null, reason: 'threefold repetition' };
  return null;
}
export function checkersPerft(s: CheckersState, depth: number): number {
  if (depth === 0) return 1;
  const all = moves(s);
  if (depth === 1) return all.length;
  let n = 0; for (const m of all) n += checkersPerft(apply(s, m, false), depth - 1);
  return n;
}
// The position in PDN FEN, the standard for draughts: the side to move, then each side's squares, kings marked K.
export function checkersFen(s: CheckersState) {
  const squares = (side: Side) => s.board.map((p, i) => ({ p, i })).filter(x => sideOf(x.p) === side).map(x => `${x.p === side.toUpperCase() ? 'K' : ''}${x.i + 1}`).join(',');
  return `${s.turn === 'b' ? 'B' : 'W'}:W${squares('w')}:B${squares('b')}`;
}
// A position read back from PDN FEN (for the simulator's players): no repetition history.
export function checkersFromFen(text: string): CheckersState {
  const m = text.match(/FEN: ([BW]):W([K\d,]*):B([K\d,]*)/);
  if (!m) throw new Error('Not a checkers position.');
  const board = Array<string>(32).fill('');
  for (const [side, list] of [['w', m[2]!], ['b', m[3]!]] as const) for (const square of list.split(',').filter(Boolean)) {
    const king = square.startsWith('K'), n = Number(king ? square.slice(1) : square);
    if (!(n >= 1 && n <= 32)) throw new Error('Not a checkers position.');
    board[n - 1] = king ? side.toUpperCase() : side;
  }
  return { board, turn: m[1] === 'B' ? 'b' : 'w', quiet: 0, seen: {} };
}

export const checkers: GameEngine<CheckersState> = {
  kind: 'checkers', name: 'Checkers', sides: ['Black', 'White'],
  start: checkersStart,
  toMove: s => s.turn === 'b' ? 0 : 1,
  legal: checkersLegal,
  play: checkersPlay,
  outcome: checkersOutcome,
  plyLimit: () => 250,
  limitOutcome: () => ({ winner: null, reason: 'the move limit' }),
  position: s => `FEN: ${checkersFen(s)}`,
  fromPosition: checkersFromFen,
  rules: 'English draughts (American checkers): an 8x8 board, played on the 32 dark squares. Black starts on squares 1-12 and moves first; White starts on 21-32. Men move one square diagonally forward (Black towards 32, White towards 1); a man reaching the far row is crowned a king, which moves diagonally both ways. Captures are compulsory: jump an adjacent enemy piece into the empty square beyond, and keep jumping with the same piece while you can (any capture may be chosen, not necessarily the longest). A man crowned during a capture stops there. You lose when you have no legal move. 40 moves each without a capture or a man moving, or a threefold repetition, is a draw.',
  notation: 'Squares are numbered 1 to 32 as in standard checkers diagrams: row by row from Black’s side, four dark squares per row (1-4 on Black’s back row, 29-32 on White’s). Moves in PDN: 11-15 for a move, 22x15 for a capture, 22x15x8 for a multiple capture (every square the piece lands on). Positions in PDN FEN: the side to move (B or W), then White’s squares and Black’s squares, kings marked K, for example W:W21,22,K5:B1,2,12.',
  example: '11-15',
};
