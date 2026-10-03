import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { combineStats, computeStats, type RunStats } from '../src/stats.js';
import { conversationConfig, type Pair, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

test('stats derive first-activity time, reply time, output speed, and parallelism from recorded events', () => {
  const at = (ms: number) => new Date(Date.parse('2026-10-02T16:00:00Z') + ms).toISOString();
  const run = { id: 'r', status: 'completed', reason: 'request_limit', requests: 3, elapsedMs: 9000, config: conversationConfig('topic'), participants: { cli1: { provider: 'grok-build', model: 'm1', auth: 'provider-login' }, cli2: { provider: 'antigravity', model: 'm2', auth: 'provider-login' } } } as unknown as Run;
  const turns = [{ id: 'a', seat: 'cli1', status: 'completed', phaseId: 'p1', phaseKind: 'paired' }, { id: 'b', seat: 'cli2', status: 'completed', phaseId: 'p1', phaseKind: 'paired' }, { id: 'c', seat: 'cli1', status: 'completed', phaseId: 'p2', phaseKind: 'single' }];
  const ev = (ms: number, type: string, data: Record<string, unknown> = {}) => ({ type, time: at(ms), data });
  const events = [ev(0, 'run_started'),
    ev(100, 'prompt_started', { turnId: 'a' }), ev(120, 'prompt_started', { turnId: 'b' }),
    ev(600, 'activity', { turnId: 'a', type: 'thought', text: 'hmm' }), ev(1100, 'activity', { turnId: 'a', type: 'output', text: 'x'.repeat(400) }), ev(2100, 'turn_ended', { turnId: 'a' }),
    ev(1120, 'activity', { turnId: 'b', type: 'output', text: 'y'.repeat(800) }), ev(3120, 'turn_ended', { turnId: 'b' }),
    ev(4000, 'prompt_started', { turnId: 'c' }), ev(4500, 'activity', { turnId: 'c', type: 'output', text: 'z'.repeat(200) }), ev(5500, 'turn_ended', { turnId: 'c' }),
    ev(9500, 'run_ended')];
  const s = computeStats(run, turns, events, 3, 2);
  assert.deepEqual([s.maxParallel, s.pairedPhases, s.singlePhases, s.processesSpawned, s.wallMs, s.replies], [2, 1, 1, 2, 9500, 3]);
  const a = s.turns.find(t => t.turnId === 'a')!;
  assert.deepEqual([a.startMs, a.firstActivityMs, a.firstOutputMs, a.durationMs, a.outputChars, a.charsPerSec], [100, 500, 1000, 2000, 400, 400]);
  const cli1 = s.seats[0]!;
  assert.deepEqual([cli1.provider, cli1.requests, cli1.outputChars, cli1.estimatedTokens], ['grok-build', 2, 600, 150]);
  assert.equal(cli1.charsPerSec, 600 / 2, 'speed = output characters over generating time (1 s + 1 s)');
  assert.equal(cli1.estimatedTokensPerSec, 75);
  assert.equal(s.tokensEstimated, true);
  // A run cut off by a service restart is timed to its last recorded work, not to the restart.
  const interrupted = computeStats({ ...run, reason: 'reconciled' } as Run, turns, [...events.slice(0, -1), ev(240_000, 'run_ended', { reason: 'service_interrupted' }), ev(300_000, 'reconciled'), ev(300_000, 'run_ended', { reason: 'reconciled' })], 3, 0);
  assert.deepEqual([interrupted.wallMs, interrupted.interrupted], [5500, true], 'even after a later release');
});
test('run.stats works end to end on a stored run without sending anything to the agents', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-stats-'), factory, 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'stats' }) as Pair;
    for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 's', options: { paceMs: 0, maxRequests: 2 } }) as Run; await flush();
    factory.agents[0]!.emit('output', 'hello world'); const first = factory.agents[0]!.calls.at(-1)!; first.settled=true; first.resolve({status:'completed',text:JSON.stringify({message:'A',stop_requested:false,stop_reason:null}),usage:{input:50,output:9}}); factory.agents[1]!.answer('B'); await flush();
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    const calls = factory.agents.map(a => a.calls.length);
    const stats = await service.call('run.stats', { runId: run.id }) as RunStats;
    assert.equal(stats.seats[0]!.outputTokens,9); assert.equal(stats.seats[0]!.inputTokens,50); assert.equal(stats.seats[0]!.tokenSource,'reported');
    assert.equal(stats.seats[1]!.outputTokens,null); assert.equal(stats.seats[1]!.estimatedTokens,null);
    const combined=combineStats('synthetic-thread',[stats,stats]);
    assert.equal(combined.seats[0]!.outputTokens,18,'thread totals add request deltas, not session totals');
    assert.equal(combined.seats[1]!.outputTokens,null,'missing reports never become zero');
    assert.equal(stats.replies, 2); assert.equal(stats.maxParallel, 2); assert.equal(stats.pairedPhases, 1);
    assert.ok(stats.turns.filter(t => t.status === 'completed').every(t => t.durationMs !== null), 'completed turns have an end time');
    assert.deepEqual(factory.agents.map(a => a.calls.length), calls, 'stats are read-only');
  } finally { await service.shutdown(); service.store.close(); }
});
