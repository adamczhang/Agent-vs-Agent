import test from 'node:test';
import assert from 'node:assert/strict';
import { gameReplay } from '../ui/game-replay.js';
import { gameEngine } from '../src/games/index.js';
import { crosscurrentStart, type CrosscurrentState } from '../src/games/crosscurrent.js';
import { replay } from '../src/games/referee.js';
import type { GameSetup } from '../src/types.js';
const setup: GameSetup = { kind: 'crosscurrent', size: 7, ruleset: 'three-edges-cooldown-v3', first: 'cli1', moveMs: 120000, maxIllegal: 3 };

test('J15: unknown saved rulesets are refused instead of silently becoming a different game', () => {
  for (const ruleset of ['future-v99', '', null, false]) {
    const bad = { ...setup, ruleset } as GameSetup;
    assert.throws(() => gameEngine(bad), /Unsupported Crosscurrent ruleset/);
    assert.throws(() => replay(bad, []), /Unsupported Crosscurrent ruleset/);
    assert.throws(() => crosscurrentStart(7, ruleset as never), /Unsupported Crosscurrent ruleset/);
    const view = gameReplay(bad, ['A1 ROW 1 RIGHT']);
    assert.match(view.error!, /Unsupported Crosscurrent ruleset/); assert.deepEqual(view.positions, []);
  }
});
test('J15: an invalid recorded move exposes the failure and the last valid position', () => {
  const moves = ['A1 ROW 1 RIGHT', 'C1 ROW 1 LEFT'];
  const view = gameReplay(setup, moves);
  assert.match(view.error!, /Recorded move 2.*ROW 1 is resting/); assert.equal(view.positions.length, 2);
  assert.equal((view.positions[1]!.state as CrosscurrentState).board.filter(Boolean).length, 2);
  assert.deepEqual(moves, ['A1 ROW 1 RIGHT', 'C1 ROW 1 LEFT']);
});
test('J15: valid replays retain every position and move highlights across rulesets and games', () => {
  for (const [game, moves] of [
    [setup, ['A1 ROW 1 RIGHT', 'C1 COL B DOWN']],
    [{ ...setup, ruleset: 'three-edges-v2' }, ['A1 ROW 1 RIGHT', 'C1 ROW 1 LEFT']],
    [{ ...setup, ruleset: undefined }, ['A1 RIGHT', 'C1 LEFT']],
    [{ ...setup, kind: 'chess', size: undefined, ruleset: undefined }, ['e4', 'e5', 'Nf3']],
    [{ ...setup, kind: 'go', size: 9, ruleset: undefined }, ['D4', 'E4', 'pass']],
  ] as Array<[GameSetup, string[]]>) {
    const view = gameReplay(game, moves);
    assert.equal(view.error, undefined); assert.equal(view.positions.length, moves.length + 1);
    assert.deepEqual(view.positions.at(-1)!.state, replay(game, moves));
  }
  const checkers = { ...setup, kind: 'checkers', size: undefined, ruleset: undefined } as GameSetup, engine = gameEngine(checkers), moves: string[] = [];
  let state = engine.start();
  for (let i = 0; i < 3; i++) { const move = engine.legal(state)[0]!; moves.push(move); state = engine.play(state, move).state; }
  const view = gameReplay(checkers, moves);
  assert.equal(view.error, undefined); assert.equal(view.positions.length, 4); assert.deepEqual(view.positions.at(-1)!.state, state);
  assert.deepEqual(view.positions.at(-1)!.last, moves.at(-1)!.split(/[-x]/).map(n => Number(n) - 1));
});
