import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crosscurrent } from '../src/games/crosscurrent.js';
import { analyzeGame, analyzeMove, variationPosition } from '../src/games/crosscurrent-analysis.js';
import { actionFor, actionText, children, fromProduction, outcome, stateKey, wins } from '../src/games/crosscurrent-tactics.js';
import { rng } from '../scripts/research/crosscurrent.js';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/crosscurrent-tactics.json', import.meta.url), 'utf8'));
const live: string[] = fixtures.moves;
test('K1: the production analyzer reproduces the verified live-game mistake and safe alternative', () => {
  const report = analyzeGame(live);
  assert.equal(report[11]!.verdict, 'avoidable-loss'); assert.equal(report[12]!.verdict, 'win');
  let before = crosscurrent.start(); for (const move of live.slice(0, 11)) before = crosscurrent.play(before, move).state;
  const defended = variationPosition(before, report[11]!.alternatives.slice(0, 1));
  for (const move of crosscurrent.legal(defended)) assert.notEqual(crosscurrent.outcome(crosscurrent.play(defended, move).state)?.winner, 0);
  assert.equal(crosscurrent.position(before), crosscurrent.position(live.slice(0, 11).reduce((s, m) => crosscurrent.play(s, m).state, crosscurrent.start())));
  assert.equal(report.every(r => r.minimumStones >= 6 && r.minimumStones <= 9), true);
});
test('K1: unknown/legacy rules and malformed replay are refused; a missed win is not called safe', () => {
  const s = live.slice(0, 12).reduce((s, m) => crosscurrent.play(s, m).state, crosscurrent.start());
  assert.equal(analyzeMove(s, 'B2 COL A UP', 13).verdict, 'missed-win');
  assert.throws(() => analyzeMove({ ...s, ruleset: 'classic-v1' }, 'A1 RIGHT', 13), /supports/);
  assert.throws(() => analyzeGame(['A1 ROW 1 RIGHT', 'A1 ROW 1 LEFT']), /resting/);
});
test('K1: forcing sequences and already-forced losses are distinguished from mistakes', () => {
  const cases = fixtures.cases;
  const forced = crosscurrent.fromPosition(cases.cooldownForcingCase.position);
  assert.equal(analyzeMove(forced, crosscurrent.legal(forced)[0]!, 33).verdict, 'forced-loss');
  const fork = cases.earliestCertifiedFork;
  assert.equal(analyzeMove(crosscurrent.fromPosition(fork.before), fork.setup, fork.ply + 1).verdict, 'forcing');
});
test('K1: every production legal action matches the fast analyzer at 60 seeded positions', () => {
  const random = rng(16001); let s = crosscurrent.start();
  for (let i = 0; i < 60; i++) {
    if (crosscurrent.outcome(s)) s = crosscurrent.start();
    const expected = new Map<string, number | null>(), winning: number[] = [], legal = crosscurrent.legal(s);
    for (const move of legal) {
      assert.equal(actionText(actionFor(move)), move);
      const next = crosscurrent.play(s, move).state, o = crosscurrent.outcome(next), result = o === null ? null : o.winner === null ? 0 : o.winner + 1;
      expected.set(stateKey(fromProduction(next)), result); if (result === s.turn) winning.push(actionFor(move));
    }
    const actual = children(fromProduction(s)); assert.equal(actual.length, expected.size);
    for (const c of actual) { assert.equal(c.winner, expected.get(c.key)); assert.equal(outcome(c.state), c.winner); }
    assert.deepEqual(wins(fromProduction(s)).sort((a,b)=>a-b), winning.sort((a,b)=>a-b));
    s = crosscurrent.play(s, legal[Math.floor(random() * legal.length)]!).state;
  }
});
