import test from 'node:test';
import assert from 'node:assert/strict';
import { CROSSCURRENT_STAR, crosscurrentClassic as crosscurrent, crosscurrentThreeEdges as threeEdges, crosscurrent as cooldown, crosscurrentConnection, crosscurrentGroup, crosscurrentParse, crosscurrentShift, type CrosscurrentState } from '../src/games/crosscurrent.js';
import { conversationConfig, type GameSetup } from '../src/types.js';
import { gameBrief, judgeReply, replay } from '../src/games/referee.js';
import { gameEngine } from '../src/games/index.js';
import { analyze, apply, fromBoard, label, rawActions, rng, start, VARIANTS } from '../scripts/research/crosscurrent.js';

const position = (rows: string[], turn: 1 | 2 = 1): CrosscurrentState => ({ size: rows.length, ruleset: 'classic-v1', resting: null, board: rows.flatMap(row => [...row].map(v => '.OX*'.indexOf(v))), turn });
const rows = (s: CrosscurrentState) => Array.from({ length: s.size }, (_, r) => s.board.slice(r * s.size, (r + 1) * s.size).map(v => '.OX*'[v]).join(''));

test('J8 Crosscurrent: only 7x7, exactly one central star, and at most 48 placements', () => {
  for (const size of [0, 3, 4, 5, 6, 9, 7.5, NaN]) assert.throws(() => crosscurrent.start(size), /7x7/);
  const state = crosscurrent.start();
  assert.equal(state.size, 7); assert.equal(state.board.length, 49);
  assert.equal(state.board[24], CROSSCURRENT_STAR);
  assert.equal(state.board.filter(v => v === CROSSCURRENT_STAR).length, 1);
  assert.equal(crosscurrent.legal(state).length, 192);
  assert.equal(crosscurrent.plyLimit(state), 48);
  assert.throws(() => crosscurrent.play(state, 'D4 RIGHT'), /isn't empty/, 'the neutral star cannot be replaced');
});

test('J8 Crosscurrent: a placement shifts all contents, including the star, in all four directions', () => {
  const horizontal = position(['O......', '.......', '.......', 'O.X*X..', '.......', '.......', '.......']);
  const before = structuredClone(horizontal);
  const right = crosscurrent.play(horizontal, ' g4   right ');
  assert.equal(right.move, 'G4 RIGHT');
  assert.equal(rows(right.state)[3], 'OO.X*X.');
  assert.equal(rows(crosscurrent.play(horizontal, 'G4 LEFT').state)[3], '.X*X.OO');
  assert.deepEqual(horizontal, before, 'playing leaves the previous position intact for replay');
  assert.equal(right.state.turn, 2);
  const vertical = position(['...O...', '...X...', '.......', '...*...', '...O...', '...X...', '.......']);
  assert.deepEqual(rows(crosscurrent.play(vertical, 'D3 UP').state), ['...X...', '...O...', '...*...', '...O...', '...X...', '.......', '...O...']);
  assert.deepEqual(rows(crosscurrent.play(vertical, 'D3 DOWN').state), ['.......', '...O...', '...X...', '...O...', '...*...', '...O...', '...X...']);
  for (const [from, move, to] of [[6, 'A1 RIGHT', 0], [0, 'G1 LEFT', 6], [3, 'D7 UP', 45], [45, 'D1 DOWN', 3]] as const) {
    const state = crosscurrent.start(); state.board[24] = 0; state.board[from] = CROSSCURRENT_STAR;
    const moved = crosscurrent.play(state, move).state;
    assert.equal(moved.board[to], CROSSCURRENT_STAR, move);
    assert.equal(moved.board.filter(v => v === CROSSCURRENT_STAR).length, 1);
  }
});

test('J8 Crosscurrent: judge after the shift, including opponent wins and both players qualifying through the star', () => {
  const before = position(['...O..X', '...O..X', '...O..X', '...*...', '...O..X', '...O..X', '.......']);
  const placed = structuredClone(before); placed.board[45] = 1;
  assert.equal(crosscurrent.outcome(placed)?.winner, 0, 'placement alone would qualify');
  assert.equal(crosscurrent.outcome(crosscurrent.play(before, 'D7 RIGHT').state), null, 'the mandatory shift breaks it');
  assert.deepEqual(crosscurrent.outcome(crosscurrent.play(before, 'D7 UP').state), { winner: 0, reason: 'Circle connected top to bottom with the star' });
  const opponent = position(['...X..O', '...X..O', '...X..O', '...*...', '...X..O', '...X..O', '..X...O']);
  assert.deepEqual(crosscurrent.outcome(crosscurrent.play(opponent, 'A7 RIGHT').state), { winner: 1, reason: 'Diamond connected top to bottom with the star' });
  const simultaneous = position(['...O...', '...O...', '...O...', '.X*XXXX', '...O...', '...O...', '...O...'], 2);
  assert.equal(crosscurrent.outcome(simultaneous), null);
  const drawn = crosscurrent.play(simultaneous, 'A4 RIGHT').state;
  assert.equal(rows(drawn)[3], 'XXX*XXX');
  assert.deepEqual(crosscurrent.outcome(drawn), { winner: null, reason: 'both players connected opposite edges with the star' });
  const full = crosscurrent.play(position(['.OXOXOO', 'XOXOXOX', 'OXOXOXO', 'XOX*XOX', 'OXOXOXO', 'XOXOXOX', 'OXOXOXO'], 2), 'A1 RIGHT').state;
  assert.deepEqual(crosscurrent.outcome(full), { winner: null, reason: 'the board is full with no winning connection' });
  const filled = structuredClone(drawn); filled.board = filled.board.map(v => v || 1);
  assert.equal(crosscurrent.outcome(filled)?.reason, 'both players connected opposite edges with the star', 'qualification takes priority over a full board');
});

test('J8 Crosscurrent: a winning group must include the star; branches count, diagonals and wrapping do not', () => {
  const disconnected = position(['O......', 'O......', 'O......', 'O..*...', 'O......', 'O......', 'O......']);
  assert.equal(crosscurrent.outcome(disconnected), null, 'an edge-to-edge connection without the star cannot win');
  const branched = position(['.O.....', '.O.....', '.O.....', '.OO*...', '.O.....', '.O.....', '.O.....']);
  assert.equal(crosscurrent.outcome(branched)?.winner, 0, 'the star can be on a branch of the connected group');
  assert.ok(crosscurrentConnection(branched, 1)?.includes(24));
  const bent = position(['.O.....', '.O.....', '.O.....', '.OO*OO.', '.....O.', '.....O.', '.....O.']);
  assert.deepEqual(crosscurrentConnection(bent, 1), [1, 8, 15, 22, 23, 24, 25, 26, 33, 40, 47]);
  assert.equal(crosscurrent.outcome(position(['......O', '......O', '......O', 'O.....*', 'O......', 'O......', 'O......'])), null, 'opposite row ends are not adjacent');
  assert.equal(crosscurrent.outcome(position(['O......', '.O.....', '..O....', '...*...', '....O..', '.....O.', '......O'])), null, 'diagonals are not adjacent');
});

test('J8 Crosscurrent: occupied cells, incomplete moves, passing and moves after the end are refused', () => {
  const start = crosscurrent.start();
  for (const move of ['A1', 'RIGHT', 'H1 RIGHT', 'A8 UP', 'A0 LEFT', 'A01 RIGHT', 'pass', 'A1 NORTH', 'A1 RIGHT B2']) assert.throws(() => crosscurrent.play(start, move), /isn't a move/);
  const played = crosscurrent.play(start, 'A1 RIGHT').state;
  assert.throws(() => crosscurrent.play(played, 'B1 DOWN'), /isn't empty/);
  const over = position(['...O...', '...O...', '...O...', '...*...', '...O...', '...O...', '...O...']);
  assert.deepEqual(crosscurrent.legal(over), []);
  assert.throws(() => crosscurrent.play(over, 'A1 LEFT'), /already over/);
});

test('J8 Crosscurrent: positions round-trip with exactly one star, 7x7 coordinates and valid turn counts', () => {
  const state = crosscurrent.play(crosscurrent.start(), 'A4 RIGHT').state, text = crosscurrent.position(state);
  assert.match(text, / 4 \.O\.\.\*\.\./);
  assert.deepEqual(crosscurrent.fromPosition(`Move 1, Diamond to play.\n${text}\nReply with: MOVE: <move>`), state);
  assert.deepEqual(crosscurrent.fromPosition(text.replace(/\n/g, '\r\n')), state);
  assert.throws(() => crosscurrent.fromPosition(text.replace(' 2 ', ' 1 ')), /Not a Crosscurrent position/);
  assert.throws(() => crosscurrent.fromPosition(text.replace('Diamond to play.', 'Circle to play.')), /stone counts/);
  assert.throws(() => crosscurrent.fromPosition(text.replace('*', '.')), /exactly one star/);
  assert.throws(() => crosscurrent.fromPosition(text.replace(' 1 .......', ' 1 *......')), /exactly one star/);
  for (const malformed of [text.replace('7x7', '5x5'), text.replace('7x7', '3x3'), text.replace(' 1 .......', ' 1 ......?'), 'FEN: B:W32:B1']) assert.throws(() => crosscurrent.fromPosition(malformed), /Not a Crosscurrent position/);
});

test('J8 Crosscurrent: star-group connectivity agrees with an independent component oracle', () => {
  // Exhaustive small graph fixtures exercise the size-independent traversal, not another playable board size.
  // For each of nine star positions, enumerate every assignment to the other eight squares (59,049 fixtures).
  for (let star = 0; star < 9; star++) for (let encoding = 0; encoding < 3 ** 8; encoding++) {
    let digits = encoding;
    const board = Array.from({ length: 9 }, (_, i) => { if (i === star) return CROSSCURRENT_STAR; const value = digits % 3; digits = Math.floor(digits / 3); return value; });
    const winners: number[] = [];
    for (const color of [1, 2]) {
      const parent = Array.from({ length: 9 }, (_, i) => i), root = (i: number): number => parent[i] === i ? i : root(parent[i]!);
      const allowed = (i: number) => i === star || board[i] === color;
      for (let i = 0; i < 9; i++) if (allowed(i)) for (const j of [i % 3 < 2 ? i + 1 : -1, i < 6 ? i + 3 : -1]) if (j >= 0 && allowed(j)) parent[root(j)] = root(i);
      let flags = 0;
      for (let i = 0; i < 9; i++) if (allowed(i) && root(i) === root(star)) flags |= (i % 3 === 0 ? 1 : 0) | (i % 3 === 2 ? 2 : 0) | (i < 3 ? 4 : 0) | (i >= 6 ? 8 : 0);
      if ((flags & 3) === 3 || (flags & 12) === 12) winners.push(color - 1);
    }
    const expected = winners.length === 2 || (!winners.length && !board.includes(0)) ? null : winners[0];
    assert.equal(crosscurrent.outcome({ size: 3, ruleset: 'classic-v1', resting: null, board, turn: 1 })?.winner, expected, `star ${star}, board ${encoding}`);
  }
});

test('J12/J14: new games use cooldown; unversioned saved games retain Classic replay and briefs', () => {
  const old: GameSetup = { kind: 'crosscurrent', first: 'cli1', moveMs: 300_000, maxIllegal: 3 };
  const fresh = conversationConfig('Crosscurrent', { mode: 'game', game: old }).game!;
  assert.equal(fresh.ruleset, 'three-edges-cooldown-v3'); assert.equal(cooldown.start().ruleset, 'three-edges-cooldown-v3');
  assert.equal(threeEdges.start().ruleset, 'three-edges-v2');
  assert.equal(threeEdges.legal(threeEdges.start()).length, 1344);
  assert.equal(gameEngine(old), crosscurrent);
  const moves = ['A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'F4 RIGHT', 'A1 RIGHT', 'A4 RIGHT'];
  assert.deepEqual(crosscurrent.outcome(replay(old, moves) as CrosscurrentState), { winner: 0, reason: 'Circle connected left to right with the star' });
  assert.match(gameBrief(old, 'cli1'), /MOVE: A1 RIGHT/); assert.doesNotMatch(gameBrief(old, 'cli1'), /Three Edges/);
  assert.match(gameBrief(fresh, 'cli1'), /AT LEAST THREE[\s\S]*MOVE: E3 ROW 4 RIGHT/);
  assert.equal(judgeReply(fresh, [], 'MOVE: A1 RIGHT').kind, 'illegal');
  assert.equal(judgeReply(fresh, [], 'MOVE: E3 ROW 4 RIGHT').kind, 'move');
  assert.equal(judgeReply(old, [], 'MOVE: E3 ROW 4 RIGHT').kind, 'illegal');
  assert.throws(() => conversationConfig('Chess', { mode: 'game', game: { ...fresh, kind: 'chess', size: undefined } }), /ruleset/);
  assert.throws(() => conversationConfig('Crosscurrent', { mode: 'game', game: { ...old, ruleset: 'future' as 'classic-v1' } }), /ruleset/);
});

test('J12: placement and shift are independent, including empty lines, star wrapping and new-stone highlights', () => {
  const s = threeEdges.start(), before = structuredClone(s);
  const remote = threeEdges.play(s, ' a1  col d down ');
  assert.equal(remote.move, 'A1 COL D DOWN');
  assert.equal(remote.state.board[0], 1); assert.equal(remote.state.board[31], 3);
  assert.equal(crosscurrentShift(7, crosscurrentParse(7, remote.move)!).destination, 0);
  assert.deepEqual(s, before);
  const noOp = threeEdges.play(s, 'A1 ROW 7 LEFT').state;
  assert.equal(noOp.board[0], 1); assert.equal(noOp.board[24], 3);
  for (const [star, move, target, stone] of [[6, 'A1 ROW 1 RIGHT', 0, 1], [0, 'G1 ROW 1 LEFT', 6, 5], [3, 'A1 COL D UP', 45, 0], [45, 'A1 COL D DOWN', 3, 0]] as const) {
    const board = threeEdges.start(); board.board[24] = 0; board.board[star] = 3;
    const result = threeEdges.play(board, move).state;
    assert.equal(result.board[target], 3); assert.equal(result.board[stone], 1);
  }
  for (const move of ['A1 RIGHT', 'A1 ROW 0 LEFT', 'A1 ROW 8 RIGHT', 'A1 ROW 4 UP', 'A1 COL D RIGHT', 'A1 COL 4 UP', 'A1 ROW D LEFT', 'A1 COL H DOWN', 'A1 COL D DOWN extra', 'pass']) assert.throws(() => threeEdges.play(s, move), /isn't a move/);
  assert.throws(() => threeEdges.play(s, 'D4 ROW 1 LEFT'), /isn't empty/);
  assert.deepEqual(threeEdges.fromPosition(threeEdges.position(remote.state)), remote.state);
  assert.throws(() => threeEdges.fromPosition(threeEdges.position(remote.state).replace('(v2)', '(v3)')), /Not a Crosscurrent position/);
});

test('J12: three distinct star-connected edges qualify only after the shift; both players are checked', () => {
  const s: CrosscurrentState = { ...position(['...O...', '...O...', '...O...', '.OO*...', '...O...', '...O...', '...O...']), ruleset: 'three-edges-v2' };
  assert.equal(threeEdges.outcome(s), null, 'two opposite edges alone do not win');
  assert.deepEqual(crosscurrentGroup(s, 1).edges, [true, true, false, false]);
  assert.equal(threeEdges.outcome(threeEdges.play(s, 'A4 ROW 4 RIGHT').state), null, 'the shift breaks the third-edge connection');
  const win = threeEdges.play(s, 'A4 COL G DOWN').state;
  assert.deepEqual(threeEdges.outcome(win), { winner: 0, reason: 'Circle connected at least three edges with the star' });
  const walk = crosscurrentConnection(win, 1)!;
  assert.ok(walk.includes(24) && walk.includes(3) && walk.includes(45) && walk.includes(21));
  for (let i = 1; i < walk.length; i++) assert.equal(Math.abs(walk[i]! % 7 - walk[i - 1]! % 7) + Math.abs(Math.floor(walk[i]! / 7) - Math.floor(walk[i - 1]! / 7)), 1);
  assert.throws(() => threeEdges.play(win, 'A1 ROW 1 LEFT'), /already over/);
  const opponent = { ...s, turn: 2 as const, board: [...s.board] }; opponent.board[21] = 1; opponent.board[3] = 0; opponent.board[4] = 1;
  assert.equal(threeEdges.outcome(opponent), null);
  assert.equal(threeEdges.outcome(threeEdges.play(opponent, 'G7 ROW 1 LEFT').state)?.winner, 0, 'a remote shift can give the opponent a win');
  const both = threeEdges.start();
  for (const at of [17, 10, 3, 2, 1, 0, 31, 38, 45, 46, 47, 48]) both.board[at] = 1;
  for (const at of [23, 22, 21, 28, 35, 42, 25, 26, 27, 20, 13, 6]) both.board[at] = 2;
  assert.deepEqual(threeEdges.outcome(both), { winner: null, reason: 'both players connected at least three edges with the star' });
  const full: CrosscurrentState = { ...position(['.OXOXOO', 'XOXOXOX', 'OXOXOXO', 'XOX*XOX', 'OXOXOXO', 'XOXOXOX', 'OXOXOXO'], 2), ruleset: 'three-edges-v2' };
  assert.deepEqual(threeEdges.outcome(threeEdges.play(full, 'A1 ROW 1 RIGHT').state), { winner: null, reason: 'the board is full with no winning connection' });
});

test('J12: production Three Edges agrees with the independent research engine on legal games and random boards', () => {
  const rules = VARIANTS.find(r => r.id === 'three-edges')!, random = rng(120026);
  const check = (s: CrosscurrentState) => {
    const oracle = analyze(fromBoard(s.board, s.turn), rules).winner, actual = threeEdges.outcome(s);
    assert.equal(actual === null ? null : actual.winner === null ? 0 : actual.winner + 1, oracle);
  };
  for (let game = 0; game < 40; game++) {
    let research = start(), production = threeEdges.start();
    while (analyze(research, rules).winner === null) {
      const actions = rawActions(research, rules), action = actions[Math.floor(random() * actions.length)]!;
      research = apply(research, action, rules); production = threeEdges.play(production, label(action)).state;
      assert.deepEqual(production.board, [...research.board]); assert.equal(production.turn, research.turn); check(production);
      assert.equal(production.board.filter(v => v === 3).length, 1);
      assert.deepEqual(threeEdges.fromPosition(threeEdges.position(production)), production);
    }
    assert.deepEqual(threeEdges.legal(production), []);
  }
  for (let n = 0; n < 2000; n++) {
    const board = Array.from({ length: 49 }, () => Math.floor(random() * 3)); board[Math.floor(random() * 49)] = 3;
    check({ size: 7, ruleset: 'three-edges-v2', resting: null, board, turn: 1 });
  }
});

test('J8 Crosscurrent: seeded 7x7 games preserve one star, round-trip and end within 48 turns', () => {
  let seed = 7123;
  for (let game = 0; game < 36; game++) {
    let state = crosscurrent.start(), plies = 0;
    while (!crosscurrent.outcome(state)) {
      const moves = crosscurrent.legal(state);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      state = crosscurrent.play(state, moves[seed % moves.length]!).state; plies++;
      assert.equal(state.board.filter(v => v === 1).length, Math.ceil(plies / 2));
      assert.equal(state.board.filter(v => v === 2).length, Math.floor(plies / 2));
      assert.equal(state.board.filter(v => v === CROSSCURRENT_STAR).length, 1);
      assert.deepEqual(crosscurrent.fromPosition(crosscurrent.position(state)), state);
      assert.ok(plies <= 48);
    }
    assert.deepEqual(crosscurrent.legal(state), []);
  }
});
