import test from 'node:test';
import assert from 'node:assert/strict';
import { crosscurrentClassic as crosscurrent } from '../src/games/crosscurrent.js';
import { analyze, apply, BOTS, choose, fromBoard, rawActions, rng, SHIFTS, start, successors, VARIANTS } from '../scripts/research/crosscurrent.js';

test('J11 prototype: current rules reproduce the production engine over seeded legal games', () => {
  const rules = VARIANTS[0]!, random = rng(777);
  for (let game = 0; game < 40; game++) {
    let research = start(), production = crosscurrent.start();
    while (crosscurrent.outcome(production) === null) {
      const actions = rawActions(research, rules), action = actions[Math.floor(random() * actions.length)]!, shift = SHIFTS[action % 28]!;
      const at = Math.floor(action / 28), direction = shift.horizontal ? shift.delta < 0 ? 'LEFT' : 'RIGHT' : shift.delta < 0 ? 'UP' : 'DOWN';
      const move = `${'ABCDEFG'[at % 7]}${Math.floor(at / 7) + 1} ${direction}`;
      research = apply(research, action, rules); production = crosscurrent.play(production, move).state;
      assert.deepEqual([...research.board], production.board); assert.equal(research.turn, production.turn);
      const actual = crosscurrent.outcome(production), expected = analyze(research, rules).winner;
      assert.equal(expected, actual === null ? null : actual.winner === null ? 0 : actual.winner + 1);
      assert.equal(research.board[research.star], 3);
    }
  }
});

test('J11 prototype: free shifts are independent of placement, preserve all pieces and match opening counts', () => {
  const s = start(), linked = VARIANTS[0]!, free = VARIANTS[1]!;
  assert.equal(rawActions(s, linked).length, 192); assert.equal(successors(s, linked).length, 72);
  assert.equal(rawActions(s, free).length, 1344); assert.equal(successors(s, free).length, 240);
  const action = 0 * 28 + 14 + 3 * 2 + 1; // place A1; column D down
  assert.throws(() => apply(s, action, linked), /line must contain/);
  const next = apply(s, action, free);
  assert.equal(next.board[0], 1); assert.equal(next.star, 31); assert.equal(next.board[31], 3);
  assert.equal(s.board[0], 0); assert.equal(s.star, 24);
});

test('J11 prototype: all four edges really are required, including simultaneous qualification', () => {
  const board = Array<number>(49).fill(0); board[24] = 3;
  for (const at of [3, 10, 17, 31, 38, 45]) board[at] = 1;
  const two = fromBoard(board);
  assert.equal(analyze(two, VARIANTS[0]!).winner, 1); assert.equal(analyze(two, VARIANTS[3]!).winner, null);
  for (const at of [21, 22, 23, 25, 26, 27]) board[at] = 1;
  assert.equal(analyze(fromBoard(board), VARIANTS[3]!).winner, 1);
  const simultaneous = Array<number>(49).fill(0); simultaneous[24] = 3;
  for (const at of [17, 10, 3, 2, 1, 0, 31, 38, 45, 46, 47, 48]) simultaneous[at] = 1;
  for (const at of [23, 22, 21, 28, 35, 42, 25, 26, 27, 20, 13, 6]) simultaneous[at] = 2;
  assert.deepEqual(analyze(fromBoard(simultaneous), VARIANTS[3]!).masks, [15, 15]);
  assert.equal(analyze(fromBoard(simultaneous), VARIANTS[3]!).winner, 0);
});

test('J11 prototype: weighted-path terminal detection matches an independent star-component flood fill', () => {
  const random = rng(991);
  for (let sample = 0; sample < 2000; sample++) {
    const board = Array.from({ length: 49 }, () => Math.floor(random() * 3)), star = Math.floor(random() * 49); board[star] = 3;
    const masks = [1, 2].map(color => {
      const queue = [star], seen = new Set(queue); let mask = 0;
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k]!, r = Math.floor(i / 7), c = i % 7;
        mask |= (r === 0 ? 1 : 0) | (r === 6 ? 2 : 0) | (c === 0 ? 4 : 0) | (c === 6 ? 8 : 0);
        for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as Array<[number, number]>) {
          const next = nr * 7 + nc;
          if (nr >= 0 && nr < 7 && nc >= 0 && nc < 7 && board[next] === color && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      return mask;
    });
    for (const rules of VARIANTS) for (const enemyCost of [2, 4]) {
      const expected = masks.map(m => rules.goal === 'all' ? m === 15 : rules.goal === 'three' ? [1, 2, 4, 8].filter(bit => m & bit).length >= 3 : (m & 3) === 3 || (m & 12) === 12);
      assert.equal(analyze(fromBoard(board), rules, enemyCost).winner, expected[0] && expected[1] ? 0 : expected[0] ? 1 : expected[1] ? 2 : board.includes(0) ? null : 0);
    }
  }
});

test('J11 exploratory goal: three edges accepts a third border but not merely an opposite pair', () => {
  const board = Array<number>(49).fill(0); board[24] = 3;
  for (const at of [3, 10, 17, 31, 38, 45]) board[at] = 1;
  const rules = VARIANTS.find(v => v.id === 'three-edges')!;
  assert.equal(analyze(fromBoard(board), rules).winner, null);
  for (const at of [21, 22, 23]) board[at] = 1;
  assert.equal(analyze(fromBoard(board), rules).winner, 1);
  assert.equal(analyze(fromBoard(board), VARIANTS[3]!).winner, null);
});

test('J11 search: all tiers take an immediate four-edge win and preserve their input', () => {
  const board = Array<number>(49).fill(0); board[24] = 3;
  for (const at of [3, 10, 17, 31, 38, 45, 22, 23, 25, 26, 27]) board[at] = 1;
  const s = fromBoard(board), before = [...s.board], rules = VARIANTS[3]!;
  for (const name of ['greedy', 'search4k', 'search16k']) {
    const chosen = choose(s, rules, BOTS[name]!, 1234);
    assert.equal(analyze(apply(s, chosen.action, rules), rules).winner, 1);
    assert.ok(chosen.stats.evaluations <= BOTS[name]!.budget);
    assert.deepEqual([...s.board], before);
  }
});
