import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AvAService } from '../src/service.js';
import { BenchmarkResults, passAtK } from '../src/bench-results.js';
import type { BenchAttempt, BenchJob } from '../src/bench-runner.js';
import { listen } from '../src/http.js';
import { BenchmarkFactory, agents, finishJob, startJob } from './bench-fakes.js';
import { tempDir } from './temp.js';

function fixture(t: import('node:test').TestContext) {
  const data = tempDir('bench-results-'), factory = new BenchmarkFactory(data), service = new AvAService(data, factory, 'simulation', { processes: async () => [] });
  t.after(async () => { await service.shutdown(); service.store.close(); }); return { data, factory, service, results: service.benchmarkResults };
}
function seed(service: AvAService, overrides: Partial<BenchAttempt> = {}) {
  const a: BenchAttempt = { id: crypto.randomUUID(), jobId: 'job-a', taskId: 'task-a', taskVersion: 1, digest: 'digest-v1', title: 'Task A', suite: 'suite-a', taskMode: 'prompt', prompt: 'Return 42', checkSpecs: [{ equals: '42' }], repeat: 1, seat: 'cli1', agent: { ...agents.cli1, effort: { key: 'effort', value: 'low' } }, status: 'pass', createdAt: '2026-10-03T10:00:00.000Z', finishedAt: '2026-10-03T10:00:01.000Z', version: '0.1.3', simulation: false, answer: '42', checks: [{ index: 0, kind: 'equals', passed: true, detail: 'Exact answer matched', durationMs: 1 }], durationMs: 1000, inputTokens: 100, outputTokens: 10, tokenSource: 'reported', ...overrides };
  service.store.db.prepare('INSERT OR IGNORE INTO bench_jobs VALUES(?,?)').run(a.jobId, JSON.stringify({ id: a.jobId, input: { suite: a.suite }, status: 'completed' }));
  service.store.db.prepare('INSERT INTO bench_attempts VALUES(?,?,?,?,?,?,?,?,?,?)').run(a.id, a.jobId, a.taskId, a.taskVersion, a.digest, a.agent.provider, a.agent.model, a.status, a.createdAt, JSON.stringify(a)); return a;
}

test('pass@k uses the sampling estimator and refuses insufficient or invalid sample counts', () => {
  assert.ok(Math.abs(passAtK(3, 1, 1)! - 1 / 3) < 1e-12); assert.ok(Math.abs(passAtK(3, 1, 2)! - 2 / 3) < 1e-12);
  assert.equal(passAtK(3, 1, 3), 1); assert.equal(passAtK(3, 0, 3), 0); assert.equal(passAtK(3, 3, 1), 1);
  assert.equal(passAtK(2, 1, 3), null); assert.equal(passAtK(0, 0, 0), null); assert.equal(passAtK(3, 4, 1), null);
});
test('scores separate configurations and simulation, expose ungraded work, and preserve unknown usage', t => {
  const { service, results } = fixture(t);
  seed(service); seed(service, { repeat: 2, status: 'fail', durationMs: 2000 }); seed(service, { repeat: 3, status: 'fail', durationMs: 3000, outputTokens: null, tokenSource: 'unavailable' });
  seed(service, { jobId: 'incomplete', status: 'error', durationMs: null, inputTokens: null, outputTokens: null });
  seed(service, { simulation: true }); seed(service, { agent: { ...agents.cli1, effort: { key: 'effort', value: 'high' } } });
  const board = results.scoreboard({ simulation: 'all' }); assert.equal(board.rows.length, 3); assert.equal(board.total.total, 6);
  const low = board.rows.find(r => !r.simulation && r.agent.effort?.value === 'low')!;
  assert.equal(low.passRate, 1 / 3); assert.equal(low.error, 1); assert.equal(low.graded, 3); assert.equal(low.total, 4); assert.equal(low.avgDurationMs, 2000); assert.equal(low.measuredDurations, 3);
  assert.equal(low.inputTokens, null); assert.equal(low.outputTokens, null); assert.equal(low.inconsistentBatches, 1);
  assert.ok(Math.abs(low.passAtK.find(p => p.k === 1)!.value - 1 / 3) < 1e-12); assert.equal(low.passAtK.find(p => p.k === 3)!.value, 1);
  assert.equal(board.days.length, 2, 'real and simulated daily rows remain separate');
});
test('repeats from different task versions, digests, and jobs cannot inflate pass@k sample size', t => {
  const { service, results } = fixture(t); seed(service);
  seed(service, { taskVersion: 2, digest: 'digest-v2' }); seed(service, { jobId: 'job-b' }); seed(service, { digest: 'changed-without-version' });
  const row = results.scoreboard().rows[0]!; assert.equal(row.graded, 4); assert.equal(row.passAtK.some(p => p.k === 3), false); assert.equal(row.passAtK[0]!.taskBatches, 4);
});
test('pass@k waits until a job settles so partial repeat batches are not presented as complete', t => {
  const { service, results } = fixture(t); const attempt=seed(service);
  service.store.db.prepare("UPDATE bench_jobs SET data=json_set(data,'$.status','running') WHERE id=?").run(attempt.jobId);
  assert.equal(results.scoreboard().rows[0]!.passAtK.length,0);
  service.store.db.prepare("UPDATE bench_jobs SET data=json_set(data,'$.status','completed') WHERE id=?").run(attempt.jobId);
  assert.equal(results.scoreboard().rows[0]!.passAtK[0]!.value,1);
});
test('filters are bound parameters and cursor pages remain stable when new attempts arrive', t => {
  const { service, results } = fixture(t); const first = seed(service), second = seed(service, { suite: 'suite-b', taskId: 'task-b', createdAt: '2026-10-04T00:00:00.000Z' }), third = seed(service);
  assert.deepEqual(results.page({ suite: 'suite-b' }).attempts.map(a => a.id), [second.id]);
  assert.equal(results.page({ from: '2026-10-04T00:00:00.000Z', to: '2026-10-04T23:59:59.999Z' }).total, 1);
  assert.equal(results.page({ model: "fixture' OR 1=1 --" }).total, 0);
  const page = results.page({}, undefined, 2); assert.deepEqual(page.attempts.map(a => a.id), [third.id, second.id]);
  seed(service); const next = results.page({}, page.next!, 2); assert.deepEqual(next.attempts.map(a => a.id), [first.id]); assert.equal(next.next, null);
  assert.throws(() => results.page({}, undefined, 0));
});
test('JSON and CSV exports preserve checks, apply filters, redact secret-shaped text, and neutralize spreadsheet formulas', t => {
  const { service, results, factory } = fixture(t); const tokenShape = 'a'.repeat(64);
  seed(service, { answer: '=HYPERLINK("example")\n' + tokenShape }); seed(service, { taskId: 'other-task' });
  const json = JSON.parse(results.export({ taskId: 'task-a' }, 'json').text); assert.equal(json.format, 'ava-benchmark-results'); assert.equal(json.attempts.length, 1); assert.equal(json.attempts[0].checks[0].passed, true);
  assert.match(json.attempts[0].answer, /\[redacted\]/); assert.ok(!JSON.stringify(json).includes(tokenShape));
  assert.ok(!results.export({model:tokenShape},'json').text.includes(tokenShape),'filter metadata also redacts credential-shaped values');
  const csv = results.export({ taskId: 'task-a' }, 'csv'); assert.equal(csv.count, 1); assert.match(csv.text, /"'=HYPERLINK\(""example""\)/); assert.ok(!csv.text.includes(tokenShape));
  assert.equal(factory.agents.length, 0);
});
test('attempts and evidence survive reruns, Clear history, and service restart without overwrite', async t => {
  const { service, factory, data, results } = fixture(t);
  await service.call('bench.validate', { taskIds: ['invoice-total'] });
  const one = await finishJob(service, (await startJob(service, ['invoice-total'], 'first')).id), two = await finishJob(service, (await startJob(service, ['invoice-total'], 'second')).id);
  const before = JSON.stringify(service.store.db.prepare('SELECT data FROM bench_attempts ORDER BY id').all());
  assert.equal(results.page().total, 4); assert.notEqual(one.results[0]!.id, two.results[0]!.id);
  const attempt = service.benchmarks.attempt(one.results[0]!.id); assert.ok(existsSync(attempt.artifact!)); assert.deepEqual(attempt.checkSpecs, [{ equals: '42' }]);
  const calls = factory.taskRequests; await service.call('bench.results', { filters: { simulation: 'only' } }); await service.call('bench.export', { format: 'json' });
  await service.call('history.clear', { requestId: 'clear-results-test' }); assert.equal(service.store.messages(attempt.runId!).length, 0);
  assert.equal(results.page().total, 4); assert.equal(JSON.stringify(service.store.db.prepare('SELECT data FROM bench_attempts ORDER BY id').all()), before); assert.equal(factory.taskRequests, calls);
  // Reopen the saved database with a second Store only after the owner has settled.
  await service.shutdown();
  const reopened = new AvAService(data, new BenchmarkFactory(data), 'simulation', { processes: async () => [] });
  try { assert.equal(reopened.benchmarkResults.page().total, 4); assert.equal(reopened.benchmarks.attempt(attempt.id).answer, '42'); } finally { await reopened.shutdown(); reopened.store.close(); }
});
test('result RPCs reject invalid dates and filters; CLI results and export use the same saved records', async t => {
  const { service, factory, data } = fixture(t); seed(service, { simulation: true });
  await assert.rejects(service.call('bench.results', { filters: { from: '2026-11-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } }), /start date/);
  await assert.rejects(service.call('bench.results', { filters: { unknown: true } }));
  const http = await listen(service, resolve('dist/web'));
  try {
  const exec = promisify(execFile), command = (args: string[]) => exec(process.execPath, ['--import', 'tsx', 'src/bench-cli.ts', ...args, '--data', data], { cwd: resolve('.'), windowsHide: true, timeout: 15000, maxBuffer: 1_000_000 });
  const result = JSON.parse((await command(['results'])).stdout); assert.equal(result.total, 1); assert.equal(result.scoreboard.total.pass, 1);
  const path = join(data, 'results.json'); await command(['export', 'json', '--out', path]); assert.equal(JSON.parse(readFileSync(path, 'utf8')).attempts.length, 1);
  const original = readFileSync(path, 'utf8'); await assert.rejects(command(['export', 'json', '--out', path]), /exist/i); assert.equal(readFileSync(path, 'utf8'), original); assert.equal(factory.agents.length, 0);
  } finally { await http.close(); }
});
