import test from 'node:test';
import assert from 'node:assert/strict';
import { crosscurrent, crosscurrentParse, crosscurrentLineId, crosscurrentPoint, type CrosscurrentState } from '../src/games/crosscurrent.js';
import { rng } from '../scripts/research/crosscurrent.js';
import { children, fromProduction, outcome, play, safetyReport, stateKey, toProduction, wins } from '../scripts/research/crosscurrent-tactics.js';
import { label } from '../scripts/research/crosscurrent-combos.js';
const encode = (move: string) => { const m = crosscurrentParse(7, move)!; return m.at * 56 + crosscurrentLineId(7, m) * 4 + Number(m.direction === 'RIGHT' || m.direction === 'DOWN') * 2; };

test('J15: shift-first tactics agree with every legal production move at 120 seeded positions', () => {
  const random = rng(15001); let positions = 0;
  for (let game = 0; game < 40 && positions < 120; game++) {
    let s = crosscurrent.start(), ply = 0;
    while (!crosscurrent.outcome(s) && positions < 120) {
      const legal = crosscurrent.legal(s), t = fromProduction(s);
      if (ply % 5 === 0) {
        const expected = new Map<string, number | null>(), winning: number[] = [];
        for (const move of legal) {
          const next = crosscurrent.play(s, move).state, actual = crosscurrent.outcome(next), result = actual === null ? null : actual.winner === null ? 0 : actual.winner + 1;
          expected.set(stateKey(fromProduction(next)), result); if (result === s.turn) winning.push(encode(move));
          assert.deepEqual(toProduction(play(t, encode(move))), next);
        }
        const actual = children(t); assert.equal(actual.length, expected.size);
        for (const c of actual) { assert.ok(expected.has(c.key)); assert.equal(c.winner, expected.get(c.key)); }
        assert.deepEqual(wins(t).sort((a, b) => a - b), winning.sort((a, b) => a - b)); positions++;
      }
      s = crosscurrent.play(s, legal[Math.floor(random() * legal.length)]!).state; ply++;
    }
  }
  assert.equal(positions, 120);
});

test('J15: an eleven-turn outer-edge win is legal and reaches the material lower bound', () => {
  const moves = ['B2 ROW 4 LEFT', 'G7 COL C UP', 'C1 ROW 3 LEFT', 'A1 COL B UP', 'D1 ROW 2 LEFT', 'B7 COL A UP', 'E1 ROW 7 RIGHT', 'D7 ROW 6 RIGHT', 'F1 ROW 7 LEFT', 'D7 ROW 6 LEFT', 'G1 ROW 7 RIGHT'];
  let s = crosscurrent.start();
  for (const [i, move] of moves.entries()) { assert.equal(crosscurrent.outcome(s), null); s = crosscurrent.play(s, move).state; if (i < 10) assert.equal(outcome(fromProduction(s)), null); }
  assert.equal(s.board[0], 3); assert.deepEqual(s.board.slice(1, 7), [1, 1, 1, 1, 1, 1]);
  assert.equal(crosscurrent.outcome(s)?.winner, 0);
  assert.deepEqual(children(fromProduction(s)), []); assert.deepEqual(wins(fromProduction(s)), []);
});

test('J15: exact defense reports provide production-verifiable refutations', () => {
  let s = crosscurrent.start();
  for (const move of ['D3 COL D UP', 'D4 ROW 7 RIGHT', 'C1 COL D UP', 'C2 ROW 2 RIGHT', 'F1 COL E UP', 'G1 ROW 7 RIGHT', 'B1 COL G DOWN', 'F2 COL E DOWN', 'E1 ROW 2 LEFT', 'A1 ROW 7 RIGHT', 'G1 COL A DOWN']) s = crosscurrent.play(s, move).state;
  const report = safetyReport(fromProduction(s));
  assert.ok(report.safeActions.length > 0, 'the live losing side has a defense');
  const actual = fromProduction(crosscurrent.play(s, 'A1 ROW 7 RIGHT').state);
  assert.ok(wins(actual).length > 0, 'the actual losing move permits a win, even if deduplication represents it with another equivalent move');
  for (const [action, reply] of report.refutations) {
    const child = crosscurrent.play(s, label(action)).state;
    if (reply === null) assert.equal(crosscurrent.outcome(child)?.winner, 0);
    else assert.equal(crosscurrent.outcome(crosscurrent.play(child, label(reply)).state)?.winner, 0);
  }
});

test('J15: all eight board symmetries preserve cooldown play, serialization and outcomes', () => {
  const random = rng(15002);
  const map = (at: number, symmetry: number) => {
    let r = Math.floor(at / 7), c = at % 7;
    if (symmetry >= 4) c = 6 - c;
    for (let k = 0; k < symmetry % 4; k++) [r, c] = [c, 6 - r];
    return r * 7 + c;
  };
  const line = (id: number, symmetry: number) => {
    const a = map(id < 7 ? id * 7 : id - 7, symmetry), b = map(id < 7 ? id * 7 + 6 : 42 + id - 7, symmetry);
    return Math.floor(a / 7) === Math.floor(b / 7) ? Math.floor(a / 7) : 7 + a % 7;
  };
  const transform = (s: CrosscurrentState, symmetry: number) => {
    const board = Array<number>(49); s.board.forEach((v, i) => { board[map(i, symmetry)] = v; });
    return { ...s, board, resting: s.resting === null ? null : line(s.resting, symmetry) };
  };
  let s = crosscurrent.start();
  for (let sample = 0; sample < 500; sample++) {
    if (crosscurrent.outcome(s)) s = crosscurrent.start();
    const legal = crosscurrent.legal(s), text = legal[Math.floor(random() * legal.length)]!, m = crosscurrentParse(7, text)!, id = crosscurrentLineId(7, m);
    const next = crosscurrent.play(s, text).state;
    for (let symmetry = 0; symmetry < 8; symmetry++) {
      const at = id < 7 ? id * 7 + 3 : 21 + id - 7;
      const delta = m.direction === 'LEFT' ? -1 : m.direction === 'RIGHT' ? 1 : m.direction === 'UP' ? -7 : 7;
      const a = map(at, symmetry), b = map(at + delta, symmetry), horizontal = Math.floor(a / 7) === Math.floor(b / 7);
      const move = `${crosscurrentPoint(7, map(m.at, symmetry))} ${horizontal ? `ROW ${Math.floor(a / 7) + 1} ${b > a ? 'RIGHT' : 'LEFT'}` : `COL ${'ABCDEFG'[a % 7]} ${b > a ? 'DOWN' : 'UP'}`}`;
      const expected = transform(next, symmetry), transformed = crosscurrent.play(transform(s, symmetry), move).state;
      assert.deepEqual(transformed, expected); assert.equal(crosscurrent.outcome(transformed)?.winner, crosscurrent.outcome(next)?.winner);
      assert.deepEqual(crosscurrent.fromPosition(crosscurrent.position(transformed)), transformed);
    }
    s = next;
  }
});
