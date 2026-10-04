// Chess for Gamer mode (J1, owner 2026-10-04): a small, complete rules engine written for agent-against-agent play, not
// for strength. It knows every rule an agent's move must pass: castling (not out of, through or into check), en passant,
// promotion, check, checkmate, stalemate, threefold repetition, the fifty-move rule and insufficient material. Moves go
// in and out as standard algebraic notation (SAN: Nf3, exd5, O-O, e8=Q+); an agent may also answer in UCI (g1f3).
// Checked against the standard perft counts (test/games.test.ts), as open-source move generators such as chess.js are.
import type { GameEngine, Outcome } from './engine.js';

type Color = 'w' | 'b';
export interface ChessState {
  board: string[]; // 64 squares, a8 first and h1 last; 'P','N','B','R','Q','K' for White, lowercase for Black, '' empty
  turn: Color;
  castling: string; // a subset of 'KQkq'
  ep: number; // the en passant target square, or -1
  halfmove: number; // plies since the last capture or pawn move
  fullmove: number;
  seen: Record<string, number>; // how often each position (for repetition) has occurred
}
interface Move { from: number; to: number; piece: string; captured: string; promotion: string; flag: '' | 'ep' | 'k' | 'q' | 'big' }

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const square = (i: number) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const index = (name: string) => FILES.indexOf(name[0]!) + (8 - Number(name[1])) * 8;
const colorOf = (p: string): Color | '' => !p ? '' : p === p.toUpperCase() ? 'w' : 'b';
const other = (c: Color): Color => c === 'w' ? 'b' : 'w';
const on = (r: number, f: number) => r >= 0 && r < 8 && f >= 0 && f < 8;
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]], STRAIGHT = [[-1, 0], [1, 0], [0, -1], [0, 1]];
// The castling rights tied to each king and rook home square: e1, e8, h1, a1, h8, a8.
const RIGHTS: Record<number, string> = { 60: 'KQ', 4: 'kq', 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };

export function fromFen(fen: string): ChessState {
  const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const board: string[] = [];
  for (const ch of placement!) { if (ch === '/') continue; if (/\d/.test(ch)) board.push(...Array<string>(Number(ch)).fill('')); else board.push(ch); }
  if (board.length !== 64) throw new Error(`Not a FEN position: ${fen}`);
  const state: ChessState = { board, turn: turn as Color, castling: castling === '-' ? '' : castling, ep: ep === '-' ? -1 : index(ep), halfmove: Number(half), fullmove: Number(full), seen: {} };
  state.seen[key(state)] = 1;
  return state;
}
export function toFen(s: ChessState) {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) { const p = s.board[r * 8 + f]!; if (!p) empty++; else { if (empty) row += empty; empty = 0; row += p; } }
    rows.push(row + (empty ? empty : ''));
  }
  return `${rows.join('/')} ${s.turn} ${s.castling || '-'} ${s.ep >= 0 ? square(s.ep) : '-'} ${s.halfmove} ${s.fullmove}`;
}
// The position as repetition counts it: placement, side to move, castling rights and a capturable en passant square.
function key(s: ChessState) { const f = toFen({ ...s, ep: epCapturable(s) ? s.ep : -1 }).split(' '); return f.slice(0, 4).join(' '); }
function epCapturable(s: ChessState) {
  if (s.ep < 0) return false;
  const r = Math.floor(s.ep / 8), f = s.ep % 8, pawnRow = s.turn === 'w' ? r + 1 : r - 1, pawn = s.turn === 'w' ? 'P' : 'p';
  return [f - 1, f + 1].some(ff => on(pawnRow, ff) && s.board[pawnRow * 8 + ff] === pawn);
}

// Whether square sq is attacked by color by.
function attacked(board: string[], sq: number, by: Color) {
  const r = Math.floor(sq / 8), f = sq % 8, is = (rr: number, ff: number, p: string) => on(rr, ff) && board[rr * 8 + ff] === (by === 'w' ? p.toUpperCase() : p);
  const pr = by === 'w' ? r + 1 : r - 1;
  if (is(pr, f - 1, 'p') || is(pr, f + 1, 'p')) return true;
  if (KNIGHT.some(([dr, df]) => is(r + dr!, f + df!, 'n'))) return true;
  if (KING.some(([dr, df]) => is(r + dr!, f + df!, 'k'))) return true;
  const slide = (dirs: number[][], pieces: string) => dirs.some(([dr, df]) => {
    for (let rr = r + dr!, ff = f + df!; on(rr, ff); rr += dr!, ff += df!) {
      const p = board[rr * 8 + ff]!;
      if (p) return colorOf(p) === by && pieces.includes(p.toLowerCase());
    }
    return false;
  });
  return slide(DIAGONAL, 'bq') || slide(STRAIGHT, 'rq');
}
const kingSquare = (board: string[], c: Color) => board.indexOf(c === 'w' ? 'K' : 'k');
export const inCheck = (s: ChessState) => attacked(s.board, kingSquare(s.board, s.turn), other(s.turn));

function pseudo(s: ChessState): Move[] {
  const moves: Move[] = [], b = s.board, us = s.turn, them = other(us);
  const add = (from: number, to: number, flag: Move['flag'] = '', captured = b[to]!) => {
    const piece = b[from]!, row = Math.floor(to / 8);
    if (piece.toLowerCase() === 'p' && (row === 0 || row === 7)) for (const p of 'qrbn') moves.push({ from, to, piece, captured, promotion: us === 'w' ? p.toUpperCase() : p, flag });
    else moves.push({ from, to, piece, captured, promotion: '', flag });
  };
  for (let i = 0; i < 64; i++) {
    const p = b[i]!; if (!p || colorOf(p) !== us) continue;
    const r = Math.floor(i / 8), f = i % 8, type = p.toLowerCase();
    if (type === 'p') {
      const dir = us === 'w' ? -1 : 1, start = us === 'w' ? 6 : 1, one = (r + dir) * 8 + f;
      if (on(r + dir, f) && !b[one]) {
        add(i, one);
        const two = (r + 2 * dir) * 8 + f;
        if (r === start && !b[two]) add(i, two, 'big');
      }
      for (const df of [-1, 1]) {
        if (!on(r + dir, f + df)) continue;
        const t = (r + dir) * 8 + f + df;
        if (b[t] && colorOf(b[t]!) === them) add(i, t);
        else if (t === s.ep) add(i, t, 'ep', us === 'w' ? 'p' : 'P');
      }
    } else if (type === 'n' || type === 'k') {
      for (const [dr, df] of type === 'n' ? KNIGHT : KING) {
        if (!on(r + dr!, f + df!)) continue;
        const t = (r + dr!) * 8 + f + df!;
        if (!b[t] || colorOf(b[t]!) === them) add(i, t);
      }
      if (type === 'k') {
        const home = us === 'w' ? 60 : 4, [kSide, qSide] = us === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (i === home && !attacked(b, home, them)) {
          if (s.castling.includes(kSide!) && !b[home + 1] && !b[home + 2] && b[home + 3] === (us === 'w' ? 'R' : 'r') && !attacked(b, home + 1, them) && !attacked(b, home + 2, them)) add(i, home + 2, 'k');
          if (s.castling.includes(qSide!) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === (us === 'w' ? 'R' : 'r') && !attacked(b, home - 1, them) && !attacked(b, home - 2, them)) add(i, home - 2, 'q');
        }
      }
    } else {
      const dirs = type === 'b' ? DIAGONAL : type === 'r' ? STRAIGHT : [...DIAGONAL, ...STRAIGHT];
      for (const [dr, df] of dirs) for (let rr = r + dr!, ff = f + df!; on(rr, ff); rr += dr!, ff += df!) {
        const t = rr * 8 + ff;
        if (!b[t]) { add(i, t); continue; }
        if (colorOf(b[t]!) === them) add(i, t);
        break;
      }
    }
  }
  return moves;
}
function make(s: ChessState, m: Move, track = true): ChessState {
  const board = s.board.slice(), us = s.turn;
  board[m.to] = m.promotion || m.piece; board[m.from] = '';
  if (m.flag === 'ep') board[m.to + (us === 'w' ? 8 : -8)] = '';
  if (m.flag === 'k') { board[m.to - 1] = board[m.to + 1]!; board[m.to + 1] = ''; }
  if (m.flag === 'q') { board[m.to + 1] = board[m.to - 2]!; board[m.to - 2] = ''; }
  // A king or rook leaving its square (or a rook captured on it) ends those castling rights.
  let castling = s.castling;
  for (const sq of [m.from, m.to]) for (const right of RIGHTS[sq] ?? '') castling = castling.replace(right, '');
  const next: ChessState = { board, turn: other(us), castling, ep: m.flag === 'big' ? (m.from + m.to) / 2 : -1,
    halfmove: m.piece.toLowerCase() === 'p' || m.captured ? 0 : s.halfmove + 1, fullmove: s.fullmove + (us === 'b' ? 1 : 0), seen: track ? { ...s.seen } : s.seen };
  if (track) { const k = key(next); next.seen[k] = (next.seen[k] ?? 0) + 1; }
  return next;
}
function legalMoves(s: ChessState) { return pseudo(s).filter(m => { const n = make(s, m, false); return !attacked(n.board, kingSquare(n.board, s.turn), n.turn); }); }

function san(s: ChessState, m: Move, all: Move[]) {
  let text: string;
  if (m.flag === 'k') text = 'O-O';
  else if (m.flag === 'q') text = 'O-O-O';
  else {
    const type = m.piece.toUpperCase(), capture = !!m.captured;
    if (type === 'P') text = (capture ? `${FILES[m.from % 8]}x` : '') + square(m.to) + (m.promotion ? `=${m.promotion.toUpperCase()}` : '');
    else {
      const rivals = all.filter(o => o.piece === m.piece && o.to === m.to && o.from !== m.from);
      let which = '';
      if (rivals.length) {
        const sameFile = rivals.some(o => o.from % 8 === m.from % 8), sameRank = rivals.some(o => Math.floor(o.from / 8) === Math.floor(m.from / 8));
        which = !sameFile ? FILES[m.from % 8]! : !sameRank ? String(8 - Math.floor(m.from / 8)) : square(m.from);
      }
      text = type + which + (capture ? 'x' : '') + square(m.to);
    }
  }
  const n = make(s, m, false);
  if (attacked(n.board, kingSquare(n.board, n.turn), s.turn)) text += legalMoves(n).length ? '+' : '#';
  return text;
}
const uci = (m: Move) => square(m.from) + square(m.to) + (m.promotion ? m.promotion.toLowerCase() : '');

// Every legal move in SAN, in a stable order.
export function legalSan(s: ChessState) { const all = legalMoves(s); return all.map(m => san(s, m, all)); }
// An agent's move (SAN with or without check marks, castling with zeros, or UCI) as the legal move it names.
function find(s: ChessState, input: string) {
  const all = legalMoves(s), clean = (t: string) => t.replace(/[+#!?]+$/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/=?([QRBN])$/i, (_, p: string) => `=${p.toUpperCase()}`);
  const text = input.trim().replace(/^\d+\.(\.\.)?\s*/, '').replace(/\s+/g, '');
  const target = clean(text);
  const bySan = all.find(m => clean(san(s, m, all)) === target);
  if (bySan) return { move: bySan, all };
  const byUci = all.find(m => uci(m) === text.toLowerCase());
  if (byUci) return { move: byUci, all };
  // A pawn capture written without x (exd5 as ed5) or a piece move with a needless file (Ngf3): match loosely, if unique.
  const loose = all.filter(m => clean(san(s, m, all)).replace(/x/, '') === target.replace(/x/, ''));
  return loose.length === 1 ? { move: loose[0]!, all } : { move: undefined, all };
}
export function playSan(s: ChessState, input: string) {
  const { move, all } = find(s, input);
  if (!move) throw new Error(`${input} isn't a legal move here`);
  return { state: make(s, move), san: san(s, move, all), from: move.from, to: move.to };
}
function insufficient(board: string[]) {
  const pieces = board.map((p, i) => ({ p, i })).filter(x => x.p && x.p.toLowerCase() !== 'k');
  if (!pieces.length) return true;
  if (pieces.length === 1 && 'nb'.includes(pieces[0]!.p.toLowerCase())) return true;
  // Bishops only, all on squares of one color.
  return pieces.every(x => x.p.toLowerCase() === 'b') && new Set(pieces.map(x => (Math.floor(x.i / 8) + x.i % 8) % 2)).size === 1;
}
export function chessOutcome(s: ChessState): Outcome | null {
  const mover = s.turn === 'w' ? 0 : 1;
  if (!legalMoves(s).length) return inCheck(s) ? { winner: (1 - mover) as 0 | 1, reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
  if (s.halfmove >= 100) return { winner: null, reason: 'the fifty-move rule' };
  if ((s.seen[key(s)] ?? 0) >= 3) return { winner: null, reason: 'threefold repetition' };
  if (insufficient(s.board)) return { winner: null, reason: 'insufficient material' };
  return null;
}
export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(s);
  if (depth === 1) return moves.length;
  let n = 0; for (const m of moves) n += perft(make(s, m, false), depth - 1);
  return n;
}

export const chess: GameEngine<ChessState> = {
  kind: 'chess', name: 'Chess', sides: ['White', 'Black'], plyLimit: () => 300,
  start: () => fromFen(START_FEN),
  toMove: s => s.turn === 'w' ? 0 : 1,
  legal: legalSan,
  play: (s, input) => { const r = playSan(s, input); return { state: r.state, move: r.san }; },
  outcome: chessOutcome,
  limitOutcome: () => ({ winner: null, reason: 'the move limit' }),
  position: s => `FEN: ${toFen(s)}`,
  fromPosition: text => { const fen = text.match(/FEN: (\S+ [wb] \S+ \S+ \d+ \d+)/)?.[1]; if (!fen) throw new Error('Not a chess position.'); return fromFen(fen); },
  rules: 'The standard rules of chess (FIDE): castling, en passant and promotion included. A game ends in checkmate, stalemate, threefold repetition, the fifty-move rule or insufficient material.',
  notation: 'Moves in standard algebraic notation (SAN): e4, Nf3, exd5, Bxe5+, O-O, O-O-O, e8=Q. Positions in FEN (Forsyth-Edwards Notation): ranks 8 to 1, White in uppercase (K Q R B N P), Black in lowercase, then the side to move, castling rights, the en passant square and the move counters.',
  example: 'e4',
};
