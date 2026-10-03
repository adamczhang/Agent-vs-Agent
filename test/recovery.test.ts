import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { Store } from '../src/store.js';
import { listProcesses, survivors, type LedgerProcess, type Survivor } from '../src/census.js';
import { runCommand } from '../src/text-client.js';
import { conversationConfig, SEATS, type Pair, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const config = { provider: 'codex', model: 'model', auth: 'provider-login' } as const;
async function activate(service: AvAService, pairId: string) { for (const seat of SEATS) { await service.call('slot.configure', { pairId, seat, config }); await service.call('slot.activate', { pairId, seat }); } }
function fakeCensus() {
  const census = { alive: [] as Survivor[], calls: [] as LedgerProcess[][], run: async (recorded: LedgerProcess[]) => { census.calls.push(recorded); return census.alive; } };
  return census;
}
// A service that died mid-opening: both turns admitted, one submitted, one recorded provider process.
function crashedState() {
  const dir = tempDir('ava-recovery-'), store = new Store(join(dir, 'ava.sqlite')), pair = store.createPair('recovery');
  for (const seat of SEATS) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.generation = 1; s.config = config; s.sessionId = 'old-' + seat; s.verifiedAt = 1; });
  const { run } = store.start(pair.id, conversationConfig('topic'), 'start');
  const turns = store.admit(run.id, SEATS, store.queued(run.id)[0]!.id); store.started(turns[0]!.id);
  store.spawned({ pid: 4_000_001, pairId: pair.id, seat: 'cli1', generation: 1 });
  store.close();
  return { dir, pairId: pair.id, runId: run.id };
}

test('census counts a recorded process only if its start time matches, and includes orphaned descendants', () => {
  const t = Date.parse('2026-10-02T12:00:00Z'), iso = (ms: number) => new Date(ms).toISOString();
  const recorded = [{ pid: 10, spawnedAt: iso(t), ownerPid: 1 }, { pid: 20, spawnedAt: iso(t), ownerPid: 1 }, { pid: 30, spawnedAt: iso(t), ownerPid: 1 }];
  const processes = [
    { pid: 10, ppid: 1, started: t + 200, name: 'adapter.exe' },        // recorded and alive
    { pid: 11, ppid: 10, started: t + 900, name: 'codex.exe' },          // child of a live adapter
    { pid: 21, ppid: 20, started: t + 500, name: 'claude.exe' },         // orphan: its adapter (20) is gone
    { pid: 30, ppid: 4, started: t + 3_600_000, name: 'unrelated.exe' }, // PID 30 reused an hour later
    { pid: 31, ppid: 30, started: t + 3_600_500, name: 'unrelated-child.exe' },
    { pid: 99, ppid: 1, started: t, name: 'other.exe' },
    { pid: 40, ppid: 30, started: t + 1000, name: 'orphan-of-30.exe' }, // child of the original PID 30, older than the impostor
  ];
  assert.deepEqual(survivors(recorded, processes).map(s => s.pid).sort((a, b) => a - b), [10, 11, 21, 40]);
  assert.deepEqual(survivors([], processes), []);
  // An adapter whose exit was recorded is no survivor itself, but the CLI it started can be.
  const exited = [{ pid: 50, spawnedAt: iso(t), ownerPid: 1, exited: true }];
  assert.deepEqual(survivors(exited, [{ pid: 51, ppid: 50, started: t + 300, name: 'claude.exe' }]).map(s => s.pid), [51]);
  assert.deepEqual(survivors(exited, [{ pid: 50, ppid: 1, started: t + 200, name: 'adapter.exe' }]).map(s => s.pid), [50], 'a still-running original counts despite a recorded exit');
});
test('the real process listing includes this process with its start time', async () => {
  const self = (await listProcesses()).find(p => p.pid === process.pid);
  assert.ok(self, 'this process is listed');
  assert.ok(Math.abs(self.started - (Date.now() - process.uptime() * 1000)) < 10_000, 'start time is accurate enough to guard PID reuse');
  assert.deepEqual(survivors([{ pid: process.pid, spawnedAt: new Date(self.started).toISOString(), ownerPid: process.ppid }], [self]).map(s => s.pid), [process.pid]);
});
test('after a restart, release is refused while a recorded process survives, then frees the pair without resending', async () => {
  const { dir, pairId, runId } = crashedState(), census = fakeCensus(), factory = new TestFactory();
  const service = new AvAService(dir, factory, 'simulation', { census: census.run });
  try {
    assert.equal(factory.ledger, service.store);
    const view = await service.call('pair.get', { pairId }) as Pair & { activeRun: { status: string; reason: string } };
    assert.deepEqual([view.activeRun.status, view.activeRun.reason], ['needs_attention', 'service_interrupted']);
    const before = await service.call('run.get', { runId }) as { attention: { uncertainTurns: number; ownedHere: boolean }; messages: unknown[] };
    assert.deepEqual(before.attention, { uncertainTurns: 2, ownedHere: false });
    census.alive = [{ pid: 4_000_001, parentPid: 1, name: 'adapter.exe' }];
    await assert.rejects(service.call('run.reconcile', { runId, requestId: 'r1' }), /still running: adapter\.exe \(PID 4000001\)/);
    assert.deepEqual(census.calls[0]!.map(p => p.pid), [4_000_001]);
    assert.equal(service.store.run(runId).status, 'needs_attention'); assert.equal(service.store.pair(pairId).activeRunId, runId);
    census.alive = [];
    const released = await service.call('run.reconcile', { runId, requestId: 'r2', note: 'checked by hand' }) as { released: boolean; abandonedTurns: number };
    assert.deepEqual([released.released, released.abandonedTurns], [true, 2]);
    const run = service.store.run(runId), pair = service.store.pair(pairId);
    assert.deepEqual([run.status, run.reason, pair.activeRunId], ['stopped', 'reconciled', null]);
    for (const seat of SEATS) assert.deepEqual([pair.slots[seat].state, pair.slots[seat].sessionId, pair.slots[seat].generation], ['configuring', null, 2]);
    assert.ok(service.store.turns(runId).every(t => t.status === 'abandoned'));
    assert.deepEqual(service.store.openProcesses(pairId), [], 'the ledger rows the census cleared are closed');
    assert.equal((await service.call('run.get', { runId }) as { messages: unknown[] }).messages.length, before.messages.length);
    const events = service.store.events(runId).length;
    assert.deepEqual(await service.call('run.reconcile', { runId, requestId: 'r2', note: 'checked by hand' }), released);
    assert.equal(service.store.events(runId).length, events, 'a replayed release changes nothing');
    assert.equal(factory.agents.length, 0, 'release starts no provider work');
    await assert.rejects(service.call('run.start', { pairId, text: 'next', requestId: 'next', options: { paceMs: 0 } }), /not connected and verified/);
    await activate(service, pairId);
    const next = await service.call('run.start', { pairId, text: 'next', requestId: 'next', options: { paceMs: 0 } }) as Run;
    await service.call('run.control', { runId: next.id, action: 'stop' }); await flush();
  } finally { await service.shutdown(); service.store.close(); }
});
test('release inside the owning process closes its own sessions first', async () => {
  const census = fakeCensus(), factory = new TestFactory(), service = new AvAService(tempDir('ava-recovery-'), factory, 'simulation', { census: census.run });
  try {
    const pair = await service.call('pair.create', { thread: 'owned' }) as Pair; await activate(service, pair.id);
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 'start', options: { paceMs: 0 } }) as Run; await flush();
    await assert.rejects(service.call('run.reconcile', { runId: run.id, requestId: 'early' }), /needs attention/);
    factory.agents[0]!.raw('not json'); await flush(); factory.agents[0]!.raw('still not json'); await flush();
    const state = await service.call('run.get', { runId: run.id }) as { run: Run; attention: { ownedHere: boolean } };
    assert.deepEqual([state.run.status, state.attention.ownedHere], ['needs_attention', true]);
    await service.call('run.reconcile', { runId: run.id, requestId: 'release' });
    assert.ok(factory.agents.every(a => a.closed), 'owned sessions were closed before release');
    assert.equal(service.store.pair(pair.id).activeRunId, null);
    assert.equal((await service.call('run.get', { runId: run.id }) as { attention?: unknown }).attention, undefined);
  } finally { await service.shutdown(); service.store.close(); }
});
test('/ava reconcile reports when there is nothing to release', async () => {
  const service = new AvAService(tempDir('ava-recovery-'), new TestFactory(), 'simulation', { census: async () => [] });
  try {
    const text = await runCommand({ rpc: (method, params) => service.call(method, params), thread: 'quiet', command: '/ava reconcile', roomUrl: id => id });
    assert.equal(text, 'This pair has no conversation that needs attention.');
  } finally { await service.shutdown(); service.store.close(); }
});
