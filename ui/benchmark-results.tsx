import { useEffect, useRef, useState } from 'react';
import type { BenchAttempt } from '../src/bench-runner.js';
import type { ResultFilter, ResultSummary, ResultCounts, ScoreRow } from '../src/bench-results.js';
import { rpc } from './api.js';
import { names } from './model.js';
import { Icon } from './icons.js';

interface Results {
  attempts: ResultSummary[]; total: number; next: number | null;
  scoreboard: { total: ResultCounts; rows: ScoreRow[]; days: Array<ResultCounts & { day: string; simulation: boolean }> };
  choices: { suites: string[]; tasks: string[]; models: Array<{ provider: string; model: string }> };
}
const percent = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`;
const count = (n: number | null) => n === null ? '—' : n.toLocaleString();
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const suiteName = (path: string) => path.replaceAll('\\', '/').split('/').at(-1) || path;
export function BenchmarkResultsView({ simulation, refreshKey, jobId }: { simulation: boolean; refreshKey: string; jobId?: string }) {
  const [suite, setSuite] = useState(''), [task, setTask] = useState(''), [model, setModel] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [source, setSource] = useState<'all' | 'only' | 'exclude'>(simulation ? 'only' : 'exclude'), [currentJob, setCurrentJob] = useState(false);
  const [data, setData] = useState<Results>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState<BenchAttempt>();
  const [before, setBefore] = useState<number | undefined>(), [pages, setPages] = useState<Array<number | undefined>>([]), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), evidenceGeneration = useRef(0);
  const filters: ResultFilter = { simulation: source, ...(suite ? { suite } : {}), ...(task ? { taskId: task } : {}), ...(model ? JSON.parse(model) as { provider: string; model: string } : {}), ...(from ? { from: `${from}T00:00:00.000Z` } : {}), ...(to ? { to: `${to}T23:59:59.999Z` } : {}), ...(currentJob && jobId ? { jobId } : {}) };
  const signature = JSON.stringify(filters);
  useEffect(() => { setBefore(undefined); setPages([]); setAttempt(undefined); evidenceGeneration.current++; }, [signature]);
  useEffect(() => {
    const version = ++generation.current; setBusy(true); setError('');
    void rpc<Results>('bench.results', { filters: JSON.parse(signature), ...(before ? { before } : {}), limit: 25 }).then(result => { if (generation.current === version) setData(result); }).catch(e => { if (generation.current === version) setError(message(e)); }).finally(() => { if (generation.current === version) setBusy(false); });
    return () => { generation.current++; };
  }, [signature, before, refreshKey, refresh]);
  async function show(id: string) {
    const version = ++evidenceGeneration.current; setError(''); try { const result = await rpc<BenchAttempt>('bench.attempt', { attemptId: id }); if (version === evidenceGeneration.current) setAttempt(result); } catch (e) { if (version === evidenceGeneration.current) setError(message(e)); }
  }
  async function download(format: 'json' | 'csv') {
    setBusy(true); setError('');
    try {
      const exported = await rpc<{ filename: string; mediaType: string; text: string }>('bench.export', { filters, format });
      const url = URL.createObjectURL(new Blob([exported.text], { type: exported.mediaType })), link = document.createElement('a'); link.href = url; link.download = exported.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const totals = data?.scoreboard.total;
  return <section className="benchmark-results" aria-label="Saved benchmark results">
    <div className="benchmark-filters">
      <label>Runs<select aria-label="Benchmark result source" value={source} onChange={e => setSource(e.target.value as typeof source)}><option value="exclude">Real providers</option><option value="only">Simulated agents</option><option value="all">All (kept separate)</option></select></label>
      <label>Suite<select aria-label="Benchmark result suite" value={suite} onChange={e => setSuite(e.target.value)}><option value="">All suites</option>{data?.choices.suites.map(s => <option value={s} key={s}>{suiteName(s)}</option>)}</select></label>
      <label>Task<select aria-label="Benchmark result task" value={task} onChange={e => setTask(e.target.value)}><option value="">All tasks</option>{data?.choices.tasks.map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Model<select aria-label="Benchmark result model" value={model} onChange={e => setModel(e.target.value)}><option value="">All models</option>{data?.choices.models.map(a => <option key={JSON.stringify(a)} value={JSON.stringify(a)}>{names[a.provider] ?? a.provider} · {a.model}</option>)}</select></label>
      <label>From (UTC)<input aria-label="Benchmark results from date" type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
      <label>Through (UTC)<input aria-label="Benchmark results through date" type="date" value={to} onChange={e => setTo(e.target.value)}/></label>
    </div>
    <div className="benchmark-result-actions">{jobId && <label><input type="checkbox" checked={currentJob} onChange={e => setCurrentJob(e.target.checked)}/> Current job only</label>}<button className="button" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh results</button><button className="button" disabled={busy || !data?.total} onClick={() => void download('json')}>Export JSON</button><button className="button" disabled={busy || !data?.total} onClick={() => void download('csv')}>Export CSV</button></div>
    {error && <p role="alert" className="resource-error">{error}</p>}
    <p role="status">{busy ? 'Loading results…' : totals ? `${totals.total} attempts · ${totals.pass} passed · ${totals.fail} failed · ${totals.error} errors · ${totals.cancelled} cancelled · ${totals.interrupted} interrupted` : 'No results yet.'}</p>
    <h3>Scoreboard</h3>
    <p className="resource-note">Pass rate uses graded attempts only. Errors and interrupted work are shown separately. pass@k estimates at least one success from k samples, averaged over fully graded task/version batches in settled jobs with enough samples. Simulated and real results never share a row.</p>
    <div className="benchmark-table"><table aria-label="Benchmark scoreboard"><thead><tr><th>Agent / model</th><th>Graded</th><th>Pass rate</th><th>pass@1</th><th>pass@3</th><th>Mean reply</th><th>Tokens in / out</th><th>Inconsistent batches</th></tr></thead><tbody>{data?.scoreboard.rows.map(row => <tr key={row.key}><th>{names[row.agent.provider] ?? row.agent.provider}<small>{row.agent.model} · effort {row.agent.effort?.value ?? 'default'}{row.agent.speed ? ` · ${row.agent.speed.value}` : ''}{row.simulation ? ' · Simulated' : ''}</small></th><td>{row.pass}/{row.graded}<small>{row.total - row.graded} ungraded</small></td><td>{percent(row.passRate)}</td>{[1, 3].map(k => { const score = row.passAtK.find(p => p.k === k); return <td key={k} title={score ? `${score.taskBatches} fully graded task batches` : 'Not enough fully graded samples'}>{percent(score?.value)}</td>; })}<td title={`${row.measuredDurations} measured attempts`}>{row.avgDurationMs === null ? '—' : `${(row.avgDurationMs / 1000).toFixed(1)} s`}</td><td>{count(row.inputTokens)} / {count(row.outputTokens)}<small>{row.tokenSource}</small></td><td>{row.inconsistentBatches}</td></tr>)}</tbody></table>{data && !data.total && <p className="library-empty">No attempts match these filters. Run a validated task or change the filters.</p>}</div>
    {!!data?.scoreboard.days.length && <details className="benchmark-trend"><summary>Results over time (UTC)</summary><table aria-label="Benchmark daily results"><thead><tr><th>Day</th><th>Attempts</th><th>Passed / graded</th><th>Pass rate</th><th>Ungraded</th></tr></thead><tbody>{data.scoreboard.days.map(day => <tr key={`${day.day}:${day.simulation}`}><th>{day.day}<small>{day.simulation ? 'Simulated' : 'Real providers'}</small></th><td>{day.total}</td><td>{day.pass}/{day.graded}</td><td>{percent(day.passRate)}</td><td>{day.total - day.graded}</td></tr>)}</tbody></table></details>}
    <h3>Attempts</h3>
    <div className="benchmark-table"><table aria-label="Saved benchmark attempts"><thead><tr><th>Task</th><th>Model</th><th>Result</th><th>Started</th><th>Evidence</th></tr></thead><tbody>{data?.attempts.map(a => <tr key={a.id}><th>{a.title}<small>{a.taskId} · v{a.taskVersion} · #{a.repeat} · Agent {a.seat === 'cli1' ? '1' : '2'}</small></th><td>{a.agent.model}{a.simulation && <small>Simulated</small>}</td><td><span className={`benchmark-status ${a.status}`}>{a.status}</span></td><td>{new Date(a.createdAt).toLocaleString()}</td><td><button className="link" aria-label={`Inspect ${a.taskId} attempt ${a.id}`} onClick={() => void show(a.id)}>Inspect</button></td></tr>)}</tbody></table></div>
    <div className="benchmark-pagination"><button className="button" disabled={busy || !pages.length} onClick={() => { setBefore(pages.at(-1)); setPages(p => p.slice(0, -1)); }}>Newer attempts</button><span>{data?.total ?? 0} saved attempts</span><button className="button" disabled={busy || !data?.next} onClick={() => { setPages(p => [...p, before]); setBefore(data!.next!); }}>Older attempts</button></div>
    {attempt && <section className="benchmark-evidence" aria-label="Benchmark attempt evidence"><header><h3>{attempt.title} · {attempt.status}</h3><button className="icon-btn" aria-label="Close benchmark evidence" onClick={() => setAttempt(undefined)}><Icon.close/></button></header><p>{attempt.agent.provider} · {attempt.agent.model} · effort {attempt.agent.effort?.value ?? 'default'} · AvA {attempt.version} · {attempt.simulation ? 'Simulated' : 'Real provider'}</p><p className="resource-note">Task v{attempt.taskVersion} · digest {attempt.digest} · attempt {attempt.id}</p>{attempt.error && <p role="alert">{attempt.error}</p>}<h4>Checks</h4>{attempt.checks.length ? <ol>{attempt.checks.map(c => <li key={c.index}><strong>{c.passed ? 'Pass' : 'Fail'} · {c.kind}</strong><span> · {c.durationMs} ms{c.exitCode !== undefined ? ` · exit ${c.exitCode ?? 'unavailable'}` : ''}</span><pre>{c.detail}</pre>{attempt.checkSpecs?.[c.index] && <details><summary>Check definition</summary><pre>{JSON.stringify(attempt.checkSpecs[c.index], null, 2)}</pre></details>}</li>)}</ol> : <p>No checks completed.</p>}<details><summary>Saved task prompt</summary><pre>{attempt.prompt || 'Not recorded by this earlier runner.'}</pre></details><h4>Answer</h4><pre>{attempt.answer || '(No final answer)'}</pre></section>}
  </section>;
}
