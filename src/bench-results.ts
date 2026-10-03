import type { Store } from './store.js';
import type { BenchAttempt } from './bench-runner.js';
import type { ProviderConfig } from './types.js';
import { AvAError } from './types.js';

export interface ResultFilter { jobId?: string; suite?: string; taskId?: string; provider?: string; model?: string; from?: string; to?: string; simulation?: 'all' | 'only' | 'exclude' }
export interface ResultSummary {
  id: string; jobId: string; jobStatus: string; taskId: string; taskVersion: number; digest: string; title: string; suite: string;
  agent: ProviderConfig; status: BenchAttempt['status']; simulation: boolean; createdAt: string; finishedAt: string; version: string;
  repeat: number; seat: string; durationMs: number | null; inputTokens: number | null; outputTokens: number | null; tokenSource: string;
}
export interface ResultCounts { total: number; pass: number; fail: number; error: number; cancelled: number; interrupted: number; graded: number; passRate: number | null }
export interface ScoreRow extends ResultCounts {
  key: string; agent: ProviderConfig; simulation: boolean; avgDurationMs: number | null; measuredDurations: number;
  inputTokens: number | null; outputTokens: number | null; tokenSource: string;
  passAtK: Array<{ k: number; value: number; taskBatches: number }>; inconsistentBatches: number;
}
const counts = (): ResultCounts => ({ total: 0, pass: 0, fail: 0, error: 0, cancelled: 0, interrupted: 0, graded: 0, passRate: null });
function count(into: ResultCounts, status: BenchAttempt['status']) {
  into.total++; into[status]++; into.graded = into.pass + into.fail; into.passRate = into.graded ? into.pass / into.graded : null;
}
// Standard pass@k estimate from n graded samples with c successes; product form avoids factorial overflow.
export function passAtK(n: number, c: number, k: number) {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k) || k < 1 || c < 0 || c > n || n < k) return null;
  if (n - c < k) return 1;
  let miss = 1; for (let i = 0; i < k; i++) miss *= (n - c - i) / (n - i); return 1 - miss;
}
const redact = (value: string) => value.replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/gi, '[redacted]');
function redactRecord(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactRecord);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactRecord(child)]));
  return value;
}
const nullable = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const SUITE = "COALESCE(json_extract(a.data,'$.suite'),json_extract(j.data,'$.input.suite'),'starter')";
const COLUMNS = `a.rowid AS row_id,a.id,a.job_id,json_extract(j.data,'$.status') AS job_status,a.task_id,a.task_version,a.digest,a.status,a.created_at,
  ${SUITE} AS suite,json_extract(a.data,'$.title') AS title,json_extract(a.data,'$.agent') AS agent,
  json_extract(a.data,'$.simulation') AS simulation,json_extract(a.data,'$.finishedAt') AS finished_at,
  json_extract(a.data,'$.version') AS version,json_extract(a.data,'$.repeat') AS repetition,json_extract(a.data,'$.seat') AS seat,
  json_extract(a.data,'$.durationMs') AS duration,json_extract(a.data,'$.inputTokens') AS input_tokens,
  json_extract(a.data,'$.outputTokens') AS output_tokens,json_extract(a.data,'$.tokenSource') AS token_source`;
const FROM = 'FROM bench_attempts a JOIN bench_jobs j ON j.id=a.job_id';
function where(filter: ResultFilter) {
  const clauses: string[] = [], args: Array<string | number> = [];
  for (const [field, value] of [['a.job_id', filter.jobId], [SUITE, filter.suite], ['a.task_id', filter.taskId], ['a.provider', filter.provider], ['a.model', filter.model]] as const) if (value !== undefined) { clauses.push(`${field}=?`); args.push(value); }
  if (filter.from) { clauses.push('a.created_at>=?'); args.push(filter.from); }
  if (filter.to) { clauses.push('a.created_at<=?'); args.push(filter.to); }
  if (filter.simulation === 'only') clauses.push("json_extract(a.data,'$.simulation')=1");
  if (filter.simulation === 'exclude') clauses.push("COALESCE(json_extract(a.data,'$.simulation'),0)=0");
  return { sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', args };
}
function summary(row: Record<string, unknown>): ResultSummary {
  return { id: String(row.id), jobId: String(row.job_id), jobStatus: String(row.job_status), taskId: String(row.task_id), taskVersion: Number(row.task_version), digest: String(row.digest), title: String(row.title ?? row.task_id), suite: String(row.suite), agent: JSON.parse(String(row.agent)), status: row.status as BenchAttempt['status'], simulation: row.simulation === 1, createdAt: String(row.created_at), finishedAt: String(row.finished_at ?? ''), version: String(row.version ?? ''), repeat: Number(row.repetition), seat: String(row.seat), durationMs: nullable(row.duration), inputTokens: nullable(row.input_tokens), outputTokens: nullable(row.output_tokens), tokenSource: String(row.token_source ?? 'unavailable') };
}
export class BenchmarkResults {
  constructor(private readonly store: Store) {}
  page(filter: ResultFilter = {}, before?: number, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new AvAError('BENCH_PAGE', 'Invalid result page.');
    const query = where(filter), total = Number(this.store.db.prepare(`SELECT count(*) AS n ${FROM} ${query.sql}`).get(...query.args)!.n);
    const cursor = before === undefined ? '' : `${query.sql ? 'AND' : 'WHERE'} a.rowid<?`;
    const rows = this.store.db.prepare(`SELECT ${COLUMNS} ${FROM} ${query.sql} ${cursor} ORDER BY a.rowid DESC LIMIT ?`).all(...query.args, ...(before === undefined ? [] : [before]), limit + 1);
    const page = rows.slice(0, limit);
    return { attempts: page.map(summary), total, next: rows.length > limit ? Number(page.at(-1)!.row_id) : null };
  }
  scoreboard(filter: ResultFilter = {}) {
    const query = where(filter), total = counts(), days = new Map<string, ResultCounts & { day: string; simulation: boolean }>();
    const groups = new Map<string, { row: ScoreRow; durations: number[]; inputs: Array<number | null>; outputs: Array<number | null>; sources: Set<string>; batches: Map<string, ResultCounts & { settled: boolean }> }>();
    // Select only small metadata columns: browsing scores never loads all answers or verifier output into memory.
    for (const raw of this.store.db.prepare(`SELECT ${COLUMNS} ${FROM} ${query.sql} ORDER BY a.rowid`).iterate(...query.args)) {
      const attempt = summary(raw), a = attempt.agent;
      const key = JSON.stringify([a.provider, a.model, a.auth, a.effort?.key, a.effort?.value, a.speed?.key, a.speed?.value, attempt.simulation]);
      let group = groups.get(key);
      if (!group) { group = { row: { key, agent: a, simulation: attempt.simulation, ...counts(), avgDurationMs: null, measuredDurations: 0, inputTokens: null, outputTokens: null, tokenSource: 'unavailable', passAtK: [], inconsistentBatches: 0 }, durations: [], inputs: [], outputs: [], sources: new Set(), batches: new Map() }; groups.set(key, group); }
      count(total, attempt.status); count(group.row, attempt.status);
      const day = attempt.createdAt.slice(0, 10), dayKey = `${day}:${attempt.simulation}`;
      if (!days.has(dayKey)) days.set(dayKey, { day, simulation: attempt.simulation, ...counts() }); count(days.get(dayKey)!, attempt.status);
      if (attempt.durationMs !== null) group.durations.push(attempt.durationMs);
      group.inputs.push(attempt.inputTokens); group.outputs.push(attempt.outputTokens); group.sources.add(attempt.tokenSource);
      const batchKey = JSON.stringify([attempt.jobId, attempt.suite, attempt.taskId, attempt.taskVersion, attempt.digest, attempt.version]);
      if (!group.batches.has(batchKey)) group.batches.set(batchKey, { ...counts(), settled: ['completed','failed','cancelled','interrupted'].includes(attempt.jobStatus) }); count(group.batches.get(batchKey)!, attempt.status);
    }
    const rows = [...groups.values()].map(group => {
      const row = group.row, complete = [...group.batches.values()].filter(b => b.settled && b.total === b.graded);
      row.measuredDurations = group.durations.length; row.avgDurationMs = row.measuredDurations ? group.durations.reduce((a, b) => a + b, 0) / row.measuredDurations : null;
      const sum = (values: Array<number | null>) => values.length && values.every((v): v is number => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
      row.inputTokens = sum(group.inputs); row.outputTokens = sum(group.outputs);
      row.tokenSource = group.sources.size === 1 ? [...group.sources][0]! : 'mixed';
      row.inconsistentBatches = complete.filter(b => b.pass > 0 && b.fail > 0).length;
      for (const k of [1, 2, 3, 5, 10]) {
        const values = complete.map(b => passAtK(b.graded, b.pass, k)).filter((v): v is number => v !== null);
        if (values.length) row.passAtK.push({ k, value: values.reduce((a, b) => a + b, 0) / values.length, taskBatches: values.length });
      }
      return row;
    }).sort((a, b) => (b.passRate ?? -1) - (a.passRate ?? -1) || a.agent.model.localeCompare(b.agent.model));
    return { total, rows, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day) || Number(a.simulation) - Number(b.simulation)) };
  }
  choices() {
    return {
      suites: this.store.db.prepare(`SELECT DISTINCT ${SUITE} AS suite ${FROM} ORDER BY suite`).all().map(r => String(r.suite)),
      tasks: this.store.db.prepare('SELECT DISTINCT task_id FROM bench_attempts ORDER BY task_id').all().map(r => String(r.task_id)),
      models: this.store.db.prepare('SELECT DISTINCT provider,model FROM bench_attempts ORDER BY provider,model').all().map(r => ({ provider: String(r.provider), model: String(r.model) })),
    };
  }
  export(filter: ResultFilter, format: 'json' | 'csv') {
    const query = where(filter), size = Number(this.store.db.prepare(`SELECT count(*) AS n ${FROM} ${query.sql}`).get(...query.args)!.n);
    if (size > 5000) throw new AvAError('BENCH_EXPORT_SIZE', 'Export at most 5,000 attempts at once. Narrow the filters.');
    const fields = ['id', 'job_id', 'suite', 'task_id', 'task_version', 'digest', 'provider', 'model', 'effort', 'speed', 'status', 'simulation', 'created_at', 'finished_at', 'ava_version', 'repeat', 'seat', 'duration_ms', 'input_tokens', 'output_tokens', 'token_source', 'checks', 'answer', 'error'];
    const cell = (value: unknown) => { let text = value === null || value === undefined ? '' : String(value); if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    const chunks: string[] = format === 'csv' ? [fields.join(',') + '\r\n'] : [`{"format":"ava-benchmark-results","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"filters":${JSON.stringify(redactRecord(filter))},"attempts":[\n`];
    let bytes = Buffer.byteLength(chunks[0]!); let index = 0;
    for (const row of this.store.db.prepare(`SELECT a.data,${SUITE} AS suite ${FROM} ${query.sql} ORDER BY a.rowid`).iterate(...query.args)) {
      const a = redactRecord(JSON.parse(String(row.data))) as BenchAttempt; a.suite ??= redact(String(row.suite));
      const line = format === 'json' ? (index ? ',\n' : '') + JSON.stringify(a) : [a.id, a.jobId, a.suite, a.taskId, a.taskVersion, a.digest, a.agent.provider, a.agent.model, a.agent.effort?.value, a.agent.speed?.value, a.status, a.simulation, a.createdAt, a.finishedAt, a.version, a.repeat, a.seat, a.durationMs, a.inputTokens, a.outputTokens, a.tokenSource, JSON.stringify(a.checks), a.answer, a.error].map(cell).join(',') + '\r\n';
      bytes += Buffer.byteLength(line); if (bytes > 16 * 1024 * 1024) throw new AvAError('BENCH_EXPORT_SIZE', 'This export exceeds 16 MiB. Narrow the filters.');
      chunks.push(line); index++;
    }
    if (format === 'json') chunks.push('\n]}\n');
    return { filename: `ava-benchmarks-${new Date().toISOString().slice(0, 10)}.${format}`, mediaType: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8', text: chunks.join(''), count: index };
  }
}
