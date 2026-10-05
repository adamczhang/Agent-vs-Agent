import test from 'node:test';
import assert from 'node:assert/strict';
import { crosscurrent, crosscurrentClassic, crosscurrentThreeEdges, crosscurrentLineId, crosscurrentParse, crosscurrentRestingLine } from '../src/games/crosscurrent.js';
import { gameEngine } from '../src/games/index.js';
import { gameBrief, judgeReply, movePrompt, replay } from '../src/games/referee.js';
import { conversationConfig, type GameSetup } from '../src/types.js';
import { COMBOS, actions, analyze, apply, label, start } from '../scripts/research/crosscurrent-combos.js';
import { rng } from '../scripts/research/crosscurrent.js';

test('J14: cooldown is the new default, while both older rulesets retain their moves and briefs', () => {
  const base: GameSetup = { kind: 'crosscurrent', first: 'cli1', moveMs: 300_000, maxIllegal: 3 };
  const current = conversationConfig('Crosscurrent', { mode: 'game', game: base }).game!;
  assert.equal(current.ruleset, 'three-edges-cooldown-v3'); assert.equal(gameEngine(current), crosscurrent);
  assert.equal(gameEngine(base), crosscurrentClassic);
  const old = { ...base, ruleset: 'three-edges-v2' as const };
  assert.equal(gameEngine(old), crosscurrentThreeEdges);
  const moves = ['A1 COL D DOWN', 'G1 COL D UP'];
  assert.doesNotThrow(() => replay(old, moves)); assert.throws(() => replay(current, moves), /COL D is resting/);
  assert.match(gameBrief(current, 'cli1'), /Cooldown:.*in either direction/);
  assert.match(movePrompt(current, [moves[0]!], 'cli2'), /Resting line: COL D\./);
  assert.doesNotMatch(gameBrief(old, 'cli1'), /Cooldown|Resting line/);
  assert.doesNotMatch(movePrompt(old, moves, 'cli1'), /Resting line/);
});

test('J14: cooldown rejects either direction without mutation, permits placement and perpendicular shifts, then expires', () => {
  const s = crosscurrent.play(crosscurrent.start(), 'A1 ROW 1 RIGHT').state, before = structuredClone(s);
  assert.equal(s.resting, 0); assert.equal(crosscurrent.legal(s).length, 47 * 26);
  for (const direction of ['LEFT', 'RIGHT']) assert.throws(() => crosscurrent.play(s, `C1 ROW 1 ${direction}`), /ROW 1 is resting/);
  assert.deepEqual(s, before);
  const next = crosscurrent.play(s, 'C1 COL B DOWN').state;
  assert.equal(next.board[2], 2, 'placing on the resting row is allowed');
  assert.equal(next.board[8], 1, 'a crossing column can still move its stones');
  assert.equal(next.resting, 8);
  const released = crosscurrent.play(next, 'D1 ROW 1 LEFT').state;
  assert.equal(released.resting, 0);
  assert.deepEqual(crosscurrentRestingLine(released)?.cells, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(crosscurrentRestingLine(next)?.name, 'COL B');
  for (const direction of ['UP', 'DOWN']) assert.throws(() => crosscurrent.play(next, `A2 COL B ${direction}`), /COL B is resting/);
});

test('J14: even an unchanged empty-line shift starts cooldown; rejected replies preserve the position', () => {
  const setup: GameSetup = { kind: 'crosscurrent', ruleset: 'three-edges-cooldown-v3', first: 'cli1', moveMs: 300_000, maxIllegal: 3 };
  const s = crosscurrent.play(crosscurrent.start(), 'A1 ROW 7 LEFT').state;
  assert.equal(s.board[0], 1); assert.equal(s.board[24], 3); assert.equal(s.resting, 6);
  const verdict = judgeReply(setup, ['A1 ROW 7 LEFT'], 'MOVE: B1 ROW 7 RIGHT');
  assert.equal(verdict.kind, 'illegal');
  assert.equal(judgeReply(setup, ['A1 ROW 7 LEFT'], 'MOVE: B1 ROW 6 RIGHT').kind, 'move');
  assert.equal(crosscurrent.start().resting, null);
  assert.equal(crosscurrent.legal(crosscurrent.start()).length, 1344);
});

test('J14: positions carry complete cooldown state and reject missing, malformed or inconsistent markers', () => {
  const initial = crosscurrent.position(crosscurrent.start());
  assert.match(initial, /Three Edges \+ Cooldown \(v3\)/); assert.match(initial, /Resting line: none\./);
  assert.deepEqual(crosscurrent.fromPosition(initial), crosscurrent.start());
  const s = crosscurrent.play(crosscurrent.start(), 'A1 COL D DOWN').state, text = crosscurrent.position(s);
  assert.deepEqual(crosscurrent.fromPosition(`Move 1, Diamond to play.\n${text}\nReply with: MOVE: <move>`), s);
  assert.deepEqual(crosscurrent.fromPosition(text.replace(/\n/g, '\r\n')), s);
  for (const replacement of ['', 'Resting line: none.\n', 'Resting line: ROW 8.\n', 'Resting line: COL H.\n', 'Resting line: COL D\n', 'Resting line: COL D.\nResting line: ROW 1.\n']) {
    assert.throws(() => crosscurrent.fromPosition(text.replace('Resting line: COL D.\n', replacement)), /resting line/);
  }
  assert.throws(() => crosscurrent.fromPosition(initial.replace('none.', 'ROW 1.')), /turn history/);
  assert.throws(() => crosscurrent.fromPosition(text.replace(' + Cooldown (v3)', ' (v2)')), /no resting line/);
  const older = crosscurrentThreeEdges.position(crosscurrentThreeEdges.start());
  assert.equal(crosscurrent.fromPosition(older).resting, null);
  assert.throws(() => crosscurrent.fromPosition(older.replace('(v2)', '+ Cooldown (v3)')), /resting line/);
});

test('J14: complete cooldown games agree with the tested J13 prototype, including every legal shift', () => {
  const r = COMBOS.find(r => r.id === 'rest')!, random = rng(140026);
  for (let game = 0; game < 40; game++) {
    let oracle = start(r), s = crosscurrent.start();
    while (analyze(oracle, r).winner === null) {
      const legal = actions(oracle, r);
      assert.deepEqual(crosscurrent.legal(s).sort(), legal.map(label).sort());
      const a = legal[Math.floor(random() * legal.length)]!, previous = s.resting;
      oracle = apply(oracle, a, r); s = crosscurrent.play(s, label(a)).state;
      assert.deepEqual(s.board, [...oracle.board]); assert.equal(s.turn, oracle.turn); assert.equal(s.resting, oracle.resting);
      assert.notEqual(s.resting, previous); assert.equal(crosscurrentLineId(7, crosscurrentParse(7, label(a))!), s.resting);
      assert.deepEqual(crosscurrent.fromPosition(crosscurrent.position(s)), s);
      const outcome = crosscurrent.outcome(s);
      assert.equal(outcome === null ? null : outcome.winner === null ? 0 : outcome.winner + 1, analyze(oracle, r).winner);
      assert.ok(oracle.ply <= 48);
    }
    assert.deepEqual(crosscurrent.legal(s), []);
  }
});
