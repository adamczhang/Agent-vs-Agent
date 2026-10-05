import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, puzzleCatalog, gradePuzzle, puzzlePrompt } from '../src/games/crosscurrent-puzzles.js';
import { crosscurrent } from '../src/games/crosscurrent.js';
import { fromProduction, stateKey, wins, actionText } from '../src/games/crosscurrent-tactics.js';
import { AvAService } from '../src/service.js';
import { SimulationFactory } from '../src/simulation.js';
import type { PuzzleJob } from '../src/puzzle-runner.js';
import type { Pair } from '../src/types.js';
import { tempDir } from './temp.js';

test('K2: twenty distinct, reachable puzzles have valid reference solutions and hidden answers', () => {
  assert.equal(PUZZLES.length, 20); assert.equal(new Set(PUZZLES.map(p => p.position)).size, 20);
  for (const goal of ['win', 'defend', 'cooldown', 'force']) assert.equal(PUZZLES.filter(p => p.goal === goal).length, 5);
  for (const p of PUZZLES) {
    assert.equal(crosscurrent.position(p.source.prefix.reduce((s, m) => crosscurrent.play(s, m).state, crosscurrent.start())), p.position);
    assert.equal(gradePuzzle(p, `MOVE: ${p.solution}`).status, 'pass', p.id);
    assert.equal(gradePuzzle(p, 'MOVE: D99 ROW 2 LEFT').status, 'illegal');
    assert.equal('solution' in puzzleCatalog().find(x => x.id === p.id)!, false);
    assert.ok(!puzzlePrompt(p, 60000).includes(`Solution: ${p.solution}`));
  }
  const p = PUZZLES.find(p => p.goal === 'win')!, alternatives = wins(fromProduction(crosscurrent.fromPosition(p.position)));
  assert.ok(alternatives.length > 1); for (const a of alternatives) assert.equal(gradePuzzle(p, actionText(a)).status, 'pass');
});

class PuzzleFactory extends SimulationFactory {
  seen: string[] = []; fail = false; hang = false;
  override async open(...args: Parameters<SimulationFactory['open']>) {
    const agent = await super.open(...args), original = agent.request.bind(agent), seat = args[1].seat;
    agent.request = async request => {
      if (!request.text.startsWith('Crosscurrent puzzle:')) return original(request);
      this.seen.push(agent.sessionId); request.onStarted();
      if (this.fail) throw new Error('Provider failure fixture');
      if (this.hang) return new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: '' }), { once: true }));
      const p = PUZZLES.find(p => request.text.includes(p.position))!;
      return { status: 'completed', text: `MOVE: ${seat === 'cli1' ? p.solution : 'Z9 LEFT'}` };
    };
    return agent;
  }
}
const until = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };
async function setup(factory = new PuzzleFactory(1)) {
  const data = tempDir('ava-puzzles-'), service = new AvAService(data, factory, 'simulation');
  const pair = await service.call('pair.create', { thread: 'puzzle-test' }) as Pair;
  for (const seat of ['cli1', 'cli2']) await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } });
  return { service, pair, data, factory, close: async () => { await service.shutdown(); service.store.close(); } };
}
test('K2: paired puzzle jobs grade independently, use fresh sessions, retain settings and are idempotent', async () => {
  const { service, pair, factory, close } = await setup();
  try {
    const params = { pairId: pair.id, ids: PUZZLES.slice(0, 2).map(p => p.id), timeMs: 30000, requestId: 'puzzles' };
    const [job, duplicate] = await Promise.all([service.call('puzzles.start', params), service.call('puzzles.start', params)]) as PuzzleJob[];
    assert.equal(job!.id, duplicate!.id);
    await until(() => service.puzzles.get(job!.id).status === 'completed');
    const saved = service.puzzles.get(job!.id); assert.equal(saved.requestsAdmitted, 8); assert.equal(saved.requestCeiling, 8);
    assert.deepEqual(saved.attempts.map(a => a.status), ['pass', 'illegal', 'pass', 'illegal']);
    assert.equal(new Set(factory.seen).size, 4); assert.equal(service.resources.active().length, 0);
    assert.equal(service.store.pair(pair.id).slots.cli1.state, 'configuring');
  } finally { await close(); }
});
test('K2: provider failures stop the batch; cancellation settles and restart never resends', async () => {
  const { service, pair, factory, close } = await setup();
  try {
    factory.fail = true;
    const input = { pairId: pair.id, ids: PUZZLES.slice(0, 3).map(p => p.id), timeMs: 30000 };
    const failed = await service.call('puzzles.start', { ...input, requestId: 'failure' }) as PuzzleJob;
    await until(() => service.puzzles.get(failed.id).status === 'failed'); assert.equal(factory.seen.length, 2);
    factory.fail = false; factory.hang = true;
    const cancelled = await service.call('puzzles.start', { ...input, requestId: 'cancel' }) as PuzzleJob;
    await until(() => factory.seen.length === 4); await service.call('puzzles.cancel', { jobId: cancelled.id, requestId: 'stop' });
    await until(() => service.puzzles.get(cancelled.id).status === 'cancelled');
    assert.equal(service.resources.active().length, 0);
    const interrupted = { ...service.puzzles.get(cancelled.id), id: 'restart-fixture', status: 'running' };
    service.store.db.prepare('INSERT INTO puzzle_jobs VALUES(?,?)').run(interrupted.id, JSON.stringify(interrupted));
    const { PuzzleRunner } = await import('../src/puzzle-runner.js'); const restarted = new PuzzleRunner(service);
    assert.equal(restarted.get(interrupted.id).status, 'interrupted'); assert.equal(factory.seen.length, 4);
  } finally { await close(); }
});
