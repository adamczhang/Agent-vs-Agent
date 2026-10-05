import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { SimulationFactory } from '../src/simulation.js';
import { seriesSummary, seriesReport, type SeriesJob } from '../src/series.js';
import { SeriesRunner } from '../src/series-runner.js';
import type { Pair, Seat } from '../src/types.js';
import { tempDir } from './temp.js';
class SeriesFactory extends SimulationFactory {
  requests = 0; moves = 0; hold = false; fail = false; pairMoves = new Map<string, number>(); sessions = new Set<string>();
  override async open(...args: Parameters<SimulationFactory['open']>) {
    const agent = await super.open(...args), original = agent.request.bind(agent); this.sessions.add(agent.sessionId);
    agent.request = async request => {
      this.requests++;
      if (/Reply with: MOVE: <move>$/.test(request.text)) {
        request.onStarted(); this.moves++;
        if (this.fail) throw new Error('Series provider failure fixture');
        if (this.hold) return new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: '' }), { once: true }));
        const scope = args[1] as { seat: Seat; pairId: string };
        const ply = this.pairMoves.get(scope.pairId) ?? 0; this.pairMoves.set(scope.pairId, ply + 1);
        return { status: 'completed', text: `MOVE: ${['f3', 'e5', 'g4', 'Qh4#'][ply]}` };
      }
      return original(request);
    };
    return agent;
  }
}
const until = async (check: () => boolean) => { for (let i = 0; i < 600 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };
async function setup() {
  const factory = new SeriesFactory(1), service = new AvAService(tempDir('ava-series-'), factory, 'simulation');
  const pair = await service.call('pair.create', { thread: 'series-test' }) as Pair;
  for (const seat of ['cli1', 'cli2']) await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } });
  return { factory, service, pair, close: async () => { await service.shutdown(); service.store.close(); } };
}
const game = { kind: 'chess', first: 'cli1', moveMs: 30000, maxIllegal: 3 };
test('K3: a paired game series swaps colors, freezes settings, counts every request and retains replay/report', async () => {
  const { factory, service, pair, close } = await setup();
  try {
    const params = { pairId: pair.id, kind: 'game', pairs: 1, game, requestId: 'series' };
    const [a, b] = await Promise.all([service.call('series.start', params), service.call('series.start', params)]) as SeriesJob[];
    assert.equal(a!.id, b!.id); await until(() => service.series.get(a!.id).status === 'completed');
    const job = service.series.get(a!.id); assert.equal(job.matches.length, 2); assert.deepEqual(job.matches.map(m => m.winner), ['cli2', 'cli1']);
    assert.deepEqual(job.matches.map(m => m.config.game!.first), ['cli1', 'cli2']); assert.equal(factory.sessions.size, 4);
    assert.equal(job.requestsAdmitted, 16); assert.equal(job.requestsAdmitted, factory.requests); assert.ok(job.requestsAdmitted <= job.requestCeiling);
    assert.equal(seriesSummary(job).cli1Score, .5); assert.deepEqual(seriesSummary(job).interval95, [0, 1]);
    assert.match(seriesReport(job), /Complete pairs: 1/); assert.ok(job.matches.every(m => m.threadId && m.moves.at(-1) === 'Qh4#'));
    assert.equal(service.resources.active().length, 0); assert.equal(service.store.pair(pair.id).slots.cli1.state, 'configuring');
  } finally { await close(); }
});
test('K3: debate series swaps stance and opening, saves all three ballots, and freezes the independent judge', async () => {
  const { factory, service, pair, close } = await setup();
  try {
    const start = await service.call('series.start', { pairId: pair.id, kind: 'debate', pairs: 1, motion: 'Testing a claim', rounds: 1, speechMs: 30000, judge: 'claude', requestId: 'debates' }) as SeriesJob;
    await until(() => !['queued', 'running'].includes(service.series.get(start.id).status)); const job = service.series.get(start.id);
    assert.equal(job.status, 'completed', job.error ?? ''); assert.deepEqual(job.matches.map(m => m.config.stances!.cli1), ['for', 'against']);
    assert.deepEqual(job.matches.map(m => m.config.opening), ['cli1', 'cli2']); assert.equal(job.requestsAdmitted, factory.requests);
    assert.ok(job.requestsAdmitted <= job.requestCeiling); assert.equal(job.matches[0]!.judgment!.judge.model, job.matches[1]!.judgment!.judge.model);
    for (const m of job.matches) for (const seat of ['cli1', 'cli2'] as const) assert.equal(m.judgment!.panel![seat]!.status, 'done');
    assert.equal(service.resources.active().length, 0);
  } finally { await close(); }
});
test('K3: provider failure, cancellation and restart stop a series; incomplete pairs are excluded', async () => {
  const { factory, service, pair, close } = await setup();
  try {
    factory.fail = true;
    const params = { pairId: pair.id, kind: 'game', pairs: 2, game };
    const failed = await service.call('series.start', { ...params, requestId: 'fail' }) as SeriesJob;
    await until(() => service.series.get(failed.id).status === 'failed'); assert.equal(factory.moves, 1);
    assert.equal(seriesSummary(service.series.get(failed.id)).cli1Score, null);
    factory.fail = false; factory.hold = true;
    const stopped = await service.call('series.start', { ...params, requestId: 'hold' }) as SeriesJob;
    await until(() => factory.moves === 2); service.series.cancel(stopped.id);
    await until(() => service.series.get(stopped.id).status === 'cancelled'); assert.equal(service.resources.active().length, 0);
    const fixture = { ...service.series.get(stopped.id), id: 'interrupted-series', status: 'running' };
    service.store.db.prepare('INSERT INTO series_jobs VALUES(?,?)').run(fixture.id, JSON.stringify(fixture));
    const restarted = new SeriesRunner(service); assert.equal(restarted.get(fixture.id).status, 'interrupted'); assert.equal(factory.moves, 2);
  } finally { await close(); }
});
