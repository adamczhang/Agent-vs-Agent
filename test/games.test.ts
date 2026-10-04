import test from 'node:test';
import assert from 'node:assert/strict';
import { START_FEN, chess, chessOutcome, fromFen, perft, playSan, toFen } from '../src/games/chess.js';
import { checkers, checkersLegal, checkersPerft, checkersStart } from '../src/games/checkers.js';
import { go, goScore, goStart } from '../src/games/go.js';

// J1: each engine is checked as open-source move generators are, against published perft counts.
test('J1 chess: perft matches the standard positions, castling, en passant and promotion included', () => {
  const cases: Array<[string, number[]]> = [
    [START_FEN, [20, 400, 8902]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ];
  for (const [fen, counts] of cases) counts.forEach((n, i) => assert.equal(perft(fromFen(fen), i + 1), n, `${fen} depth ${i + 1}`));
  assert.equal(toFen(fromFen(cases[1]![0])), cases[1]![0]);
});

test('J1 chess: moves in SAN or UCI, check marks, mate, stalemate and repetition', () => {
  let s = chess.start();
  assert.deepEqual(chess.legal(s).length, 20);
  for (const m of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6']) s = chess.play(s, m).state;
  const mate = chess.play(s, 'Qxf7');
  assert.equal(mate.move, 'Qxf7#'); assert.deepEqual(chess.outcome(mate.state), { winner: 0, reason: 'checkmate' });
  assert.equal(chess.play(chess.start(), 'g1f3').move, 'Nf3', 'UCI is accepted');
  assert.equal(chess.play(chess.start(), '1. e4').move, 'e4', 'a move number is ignored');
  assert.throws(() => chess.play(chess.start(), 'e5'), /isn't a legal move/);
  assert.equal(playSan(fromFen('7k/P7/8/8/8/8/8/K7 w - - 0 1'), 'a8Q').san, 'a8=Q+', 'promotion written without =');
  assert.equal(playSan(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), '0-0').san, 'O-O');
  assert.deepEqual(chessOutcome(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), { winner: null, reason: 'stalemate' });
  assert.deepEqual(chessOutcome(fromFen('8/8/4k3/8/8/2B5/4K3/8 w - - 0 1')), { winner: null, reason: 'insufficient material' });
  let r = chess.start();
  for (let i = 0; i < 2; i++) for (const m of ['Nf3', 'Nf6', 'Ng1', 'Ng8']) r = chess.play(r, m).state;
  assert.deepEqual(chess.outcome(r), { winner: null, reason: 'threefold repetition' });
});

test('J1 checkers: perft matches the published counts; captures are compulsory and chain; crowning ends a move', () => {
  [7, 49, 302, 1469, 7361].forEach((n, i) => assert.equal(checkersPerft(checkersStart(), i + 1), n, `depth ${i + 1}`));
  assert.deepEqual(checkersLegal(checkersStart()), ['9-13', '9-14', '10-14', '10-15', '11-15', '11-16', '12-16']);
  let s = checkersStart();
  for (const m of ['11-15', '22-18']) s = checkers.play(s, m).state;
  assert.deepEqual(checkers.legal(s), ['15x22'], 'a capture is available, so it is the only legal move');
  assert.throws(() => checkers.play(s, '9-13'), /captures are compulsory/);
  // A double jump, and one written by its first and last squares.
  const board = Array<string>(32).fill(''); board[20] = 'w'; board[16] = 'b'; board[8] = 'b'; board[0] = 'b';
  const double = { board, turn: 'w' as const, quiet: 0, seen: {} };
  assert.deepEqual(checkers.legal(double), ['21x14x5']);
  assert.equal(checkers.play(double, '21x5').move, '21x14x5');
  // A man crowned by a jump stops there, even with another capture beyond.
  const crown = Array<string>(32).fill(''); crown[10] = 'w'; crown[6] = 'b'; crown[5] = 'b';
  const crowning = { board: crown, turn: 'w' as const, quiet: 0, seen: {} };
  assert.deepEqual(checkers.legal(crowning), ['11x2']);
  const crowned = checkers.play(crowning, '11x2');
  assert.deepEqual([crowned.state.board[1], crowned.state.board[5]], ['W', 'b'], 'crowned on 2; the move ended there, though a king could jump 6');
  assert.deepEqual(checkers.outcome({ board: Array<string>(32).fill('').map((_, i) => i === 0 ? 'w' : ''), turn: 'b', quiet: 0, seen: {} }), { winner: 1, reason: 'all pieces captured' });
});

test('J1 go: captures, suicide, ko (superko), passes and area scoring', () => {
  let s = goStart(9);
  assert.equal(go.legal(s).length, 82, '81 points and pass');
  // White's stone at E5 captured by four black stones.
  for (const m of ['D5', 'E5', 'F5', 'A1', 'E4', 'A2', 'E6']) s = go.play(s, m).state;
  assert.equal(s.board[(9 - 5) * 9 + 4], 0, 'E5 is empty: captured'); assert.equal(s.captures[0], 1);
  assert.throws(() => go.play(s, 'E5'), /suicide/, 'White can’t play into the eye');
  assert.throws(() => go.play(s, 'Z9'), /isn't a point/);
  // Ko: a single-stone capture can't be retaken at once.
  let k = goStart(9);
  for (const m of ['B5', 'C5', 'A4', 'D4', 'B3', 'C3', 'C4', 'B4']) k = go.play(k, m).state;
  assert.equal(k.board[(9 - 4) * 9 + 2], 0, 'White took the black stone at C4');
  assert.throws(() => go.play(k, 'C4'), /repeat an earlier position/);
  // Two passes end the game; area scoring with komi.
  let e = goStart(9);
  e = go.play(e, 'E5').state; e = go.play(e, 'pass').state;
  assert.equal(go.outcome(e), null);
  e = go.play(e, 'pass').state;
  assert.deepEqual(goScore(e), { black: 81, white: 7.5 });
  assert.deepEqual(go.outcome(e), { winner: 0, reason: 'both players passed', score: 'B+73.5 (Black 81, White 7.5)' });
});
