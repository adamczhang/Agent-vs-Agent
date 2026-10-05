import test from 'node:test';
import assert from 'node:assert/strict';
import { crosscurrentThreeEdges as crosscurrent } from '../src/games/crosscurrent.js';
import { COMBOS, actions, analyze, apply, BOTS, choose, commonOpening, key, label, restore, start, successors, type Combo, type State } from '../scripts/research/crosscurrent-combos.js';
import { rng } from '../scripts/research/crosscurrent.js';
const rule = (id: string) => COMBOS.find(r => r.id === id)!;
const code = (at: number, line: number, positive = false, distance = 1) => at * 56 + line * 4 + Number(positive) * 2 + distance - 1;
// Independent, direct row/column interpreter and flood-fill oracle.
function oracle(s: State, a: number, r: Combo) {
  const at = Math.floor(a / 56), line = Math.floor(a % 56 / 4), n = a % 2 + 1, delta = a % 4 < 2 ? -n : n;
  assert.equal(s.board[at], 0); if (r.cooldown) assert.notEqual(line, s.resting);
  const before = [...s.board]; before[at] = s.turn;
  const indices = Array.from({ length: 7 }, (_, k) => line < 7 ? line * 7 + k : k * 7 + line - 7);
  if (r.control) { const own = indices.filter(i => before[i] === s.turn).length, other = indices.filter(i => before[i] === 3 - s.turn).length; assert.ok(own > 0 && own >= other); }
  if (n === 2) assert.ok(r.power === 'reserve' ? s.reserve & (1 << (s.turn - 1)) : r.power === 'star' && indices.includes(s.star));
  const after = [...before]; indices.forEach((i, k) => { after[i] = before[indices[(k - delta + 7) % 7]!]!; });
  return after;
}
function winner(board: number[]) {
  const star = board.indexOf(3), found = [1, 2].map(color => {
    const seen = new Set([star]), pending = [star], edges = new Set<number>();
    for (const i of pending) {
      const row = Math.floor(i / 7), col = i % 7;
      if (!row) edges.add(0); if (row === 6) edges.add(1); if (!col) edges.add(2); if (col === 6) edges.add(3);
      for (const [rr, cc] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
        if (rr! < 0 || rr! > 6 || cc! < 0 || cc! > 6) continue;
        const j = rr! * 7 + cc!; if (board[j] === color && !seen.has(j)) { seen.add(j); pending.push(j); }
      }
    }
    return edges.size >= 3;
  });
  return found[0] && found[1] ? 0 : found[0] ? 1 : found[1] ? 2 : board.includes(0) ? null : 0;
}
test('J13: baseline prototype matches production Three Edges throughout seeded games', () => {
  const r = rule('baseline'), random = rng(1301);
  for (let game = 0; game < 20; game++) {
    let s = start(r), p = crosscurrent.start();
    while (analyze(s, r).winner === null) {
      const legal = actions(s, r), a = legal[Math.floor(random() * legal.length)]!;
      s = apply(s, a, r); p = crosscurrent.play(p, label(a)).state;
      assert.deepEqual([...s.board], p.board); const outcome = crosscurrent.outcome(p);
      assert.equal(analyze(s, r).winner, outcome === null ? null : outcome.winner === null ? 0 : outcome.winner + 1);
    }
  }
});
test('J13: every combination preserves legality, stone counts and termination against independent oracles', () => {
  const random = rng(1302);
  for (const r of COMBOS) for (let game = 0; game < 8; game++) {
    let s = start(r);
    while (analyze(s, r).winner === null) {
      const legal = actions(s, r); assert.ok(legal.length > 0, r.id);
      const a = legal[Math.floor(random() * legal.length)]!, expected = oracle(s, a, r), before = key(s), next = apply(s, a, r);
      assert.equal(key(s), before); assert.deepEqual([...next.board], expected);
      assert.equal(next.board[next.star], 3); assert.equal(expected.filter(v => v === 3).length, 1);
      assert.equal(expected.filter(v => v === 1).length, Math.ceil(next.ply / 2)); assert.equal(expected.filter(v => v === 2).length, Math.floor(next.ply / 2));
      assert.equal(analyze(next, r).winner, winner(expected)); assert.ok(next.ply <= 48); s = next;
    }
  }
});
test('J13: control uses post-placement counts, allows ties, excludes the neutral star and empty lines', () => {
  const r = rule('control'), s = start(r); s.board[0] = 1; s.board[1] = 2; s.board[2] = 2; s.ply = 3; s.turn = 1;
  assert.throws(() => apply(s, code(48, 0), r));
  assert.doesNotThrow(() => apply(s, code(3, 0), r), 'placement ties the line');
  assert.throws(() => apply(s, code(48, 3), r), 'the star alone does not own a line');
  assert.throws(() => apply(s, code(48, 5), r), 'empty lines are excluded');
  assert.equal(actions(start(r), r).length, 192);
});
test('J13: cooldown forbids both directions of exactly one line, and state keys retain future move rights', () => {
  const r = rule('rest'), s = apply(start(r), code(0, 1), r);
  assert.throws(() => apply(s, code(1, 1, true), r)); assert.throws(() => apply(s, code(1, 1), r));
  assert.doesNotThrow(() => apply(s, code(1, 8), r));
  const other = apply(start(r), code(0, 2), r);
  assert.deepEqual([...s.board], [...other.board]); assert.notEqual(key(s), key(other));
  const base = rule('baseline'); assert.equal(key(apply(start(base), code(0, 1), base)), key(apply(start(base), code(0, 2), base)));
});
test('J13: reserve and star powers permit atomic two-cell shifts with correct eligibility and bookkeeping', () => {
  const r = rule('double'); let s = start(r);
  const single = apply(s, code(0, 1), r), spent = apply(s, code(0, 1, false, 2), r);
  assert.deepEqual([...single.board], [...spent.board]); assert.notEqual(key(single), key(spent)); assert.equal(spent.reserve, 2);
  s = apply(spent, code(1, 2, true, 2), r); assert.equal(s.reserve, 0);
  assert.throws(() => apply(s, code(2, 3, true, 2), r));
  const star = rule('star'); assert.throws(() => apply(start(star), code(0, 0, false, 2), star));
  const moved = apply(start(star), code(0, 3, false, 2), star); assert.equal(moved.star, 22); assert.equal(moved.reserve, 0);
  assert.doesNotThrow(() => apply(moved, code(1, 8, true, 2), star));
  const atomic = start(r);
  for (const at of [4, 10, 17, 21, 22, 23, 31, 38, 45]) atomic.board[at] = 1;
  for (const at of [0, 5, 6, 11, 12, 13, 18, 19, 20]) atomic.board[at] = 2;
  atomic.ply = 18;
  assert.equal(analyze(apply(atomic, code(47, 0), r), r).winner, 1);
  assert.equal(analyze(apply(atomic, code(47, 0, false, 2), r), r).winner, null, 'the intermediate one-cell win does not terminate a double shift');
});
test('J13: common openings are legal under every combination and all search policies take immediate wins', () => {
  for (const ply of [4, 16, 46]) for (const r of COMBOS) { const s = restore(r, commonOpening(ply, 1313 + ply)); assert.equal(s.ply, ply); assert.equal(analyze(s, r).winner, null); }
  const r = rule('double'), s = start(r);
  for (const at of [3, 10, 17, 22, 23, 31, 38, 45]) s.board[at] = 1;
  s.ply = 8;
  for (const name of ['greedy', 'ab8k', 'ab32k', 'uct8k', 'uct32k']) {
    const before = key(s), chosen = choose(s, r, BOTS[name]!, 13);
    assert.equal(analyze(apply(s, chosen.action, r), r).winner, 1); assert.equal(key(s), before); assert.ok(chosen.stats.evaluations <= BOTS[name]!.budget);
  }
  for (const r of COMBOS) assert.ok(successors(start(r), r).length > 0);
});
