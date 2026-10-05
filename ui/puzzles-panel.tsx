import { useEffect, useRef, useState } from 'react';
import type { Puzzle, PuzzleGrade } from '../src/games/crosscurrent-puzzles.js';
import { crosscurrent } from '../src/games/crosscurrent.js';
import type { PuzzleJob } from '../src/puzzle-runner.js';
import { CrosscurrentBoard } from './game-boards.js';
import type { PairView } from './model.js';
import { names } from './model.js';
import { rpc, roomId } from './api.js';
import { CommandClient } from './commands.js';
import { ProfileSelector } from './profile-selector.js';
import type { RunProfile } from '../src/run-profiles.js';
export function PuzzlesPanel({ pair, onClose }: { pair: PairView | undefined; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), commands = useRef(new CommandClient(sessionStorage, 'ava-puzzles:' + roomId));
  const [catalog, setCatalog] = useState<Puzzle[]>([]), [id, setId] = useState(''), [answer, setAnswer] = useState(''), [grade, setGrade] = useState<PuzzleGrade>(), [solution, setSolution] = useState('');
  const [jobs, setJobs] = useState<PuzzleJob[]>([]), [selectedJob, setSelectedJob] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [time, setTime] = useState(120), [all, setAll] = useState(false);
  const [profile, setProfile] = useState<RunProfile | ''>('');
  const current = catalog.find(p => p.id === id), job = jobs.find(j => j.id === selectedJob) ?? jobs[0], running = jobs.some(j => ['queued', 'running'].includes(j.status));
  useEffect(() => {
    dialog.current?.showModal(); let active = true, reading = false;
    const read = async () => { if (reading) return; reading = true; try { const result = await rpc<{ jobs: PuzzleJob[] }>('puzzles.jobs', {}); if (active) setJobs(result.jobs); } catch (e) { if (active) setError(String(e)); } finally { reading = false; } };
    void rpc<{ puzzles: Puzzle[] }>('puzzles.catalog', {}).then(result => { if (active) { setCatalog(result.puzzles); setId(result.puzzles[0]?.id ?? ''); } }).catch(e => active && setError(String(e)));
    void read(); const timer = setInterval(() => void read(), 1000); return () => { active = false; clearInterval(timer); };
  }, []);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const start = () => work(async () => {
    const params = commands.current.pendingInput?.params ?? { pairId: pair!.id, ids: all ? catalog.map(p => p.id) : [id], timeMs: time * 1000, ...(profile ? { profile } : {}) };
    const started = await commands.current.execute(JSON.stringify(params), 'puzzles.start', params, rpc) as PuzzleJob;
    setSelectedJob(started.id); setJobs(list => [started, ...list.filter(j => j.id !== started.id)]);
  });
  return <dialog ref={dialog} className="resources-panel puzzles-panel" aria-labelledby="puzzles-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="puzzles-title">Crosscurrent puzzles</h2><p>Twenty verified positions. Every legal answer that meets the goal is accepted.</p></div><button className="button" onClick={onClose}>Close puzzles</button></header>
    {error && <p role="alert">{error}</p>}
    <label>Position<select aria-label="Puzzle position" value={id} onChange={e => { setId(e.target.value); setAnswer(''); setGrade(undefined); setSolution(''); }}>{catalog.map(p => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
    {current && <div className="puzzle-layout"><CrosscurrentBoard state={crosscurrent.fromPosition(current.position)} /><section>
      <h3>{current.title}</h3><p>{current.instruction}</p><p>{crosscurrent.fromPosition(current.position).turn === 1 ? 'Circle' : 'Diamond'} to play. One answer, no repair hints in agent comparisons.</p>
      <form onSubmit={e => { e.preventDefault(); void work(async () => setGrade(await rpc<PuzzleGrade>('puzzles.grade', { id, answer }))); }}>
        <label>Your move<input aria-label="Puzzle move" placeholder="E3 ROW 4 RIGHT" value={answer} onChange={e => setAnswer(e.target.value)} /></label>
        <button className="button" disabled={busy || !answer.trim()}>Check move</button>
      </form>
      {grade && <p role="status"><strong>{grade.status === 'pass' ? 'Correct' : grade.status === 'illegal' ? 'Illegal move' : 'Goal not met'}</strong> · {grade.explanation}</p>}
      <button className="link" disabled={busy} onClick={() => void work(async () => setSolution((await rpc<{ move: string }>('puzzles.solution', { id })).move))}>Reveal one solution</button>
      {solution && <p className="puzzle-solution">{solution}</p>}
    </section></div>}
    <section className="puzzle-comparison" aria-label="Puzzle comparison">
      <h3>Compare the agents</h3>
      <ProfileSelector pairId={pair?.id} agents={{ cli1: pair?.slots.cli1.config, cli2: pair?.slots.cli2.config }} value={profile} onChange={(p, ms) => { setProfile(p); if (ms) setTime(ms / 1000); }} />
      <p>{(['cli1', 'cli2'] as const).map(seat => { const c = pair?.slots[seat].config; return c ? `${names[c.provider]} · ${c.modelName ?? c.model}${c.effort ? ` · ${c.effort.value} effort` : ''}` : 'Choose an agent model'; }).join(' versus ')}</p>
      <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} disabled={busy} />All twenty puzzles</label>
      <label>Seconds per answer<select aria-label="Puzzle answer time" value={time} onChange={e => { setProfile(''); setTime(Number(e.target.value)); }}>{[30, 60, 120, 300].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <p className="resource-note">Up to {(all ? 20 : 1) * 4} model requests. Two free agent slots are needed. Fresh sessions, Ask permissions, internet off; the room’s current sessions stay available.</p>
      <button className="button primary" disabled={busy || (!commands.current.hasPending && (running || !current || !pair?.slots.cli1.config || !pair?.slots.cli2.config))} onClick={() => void start()}>{commands.current.hasPending ? 'Retry puzzle start' : 'Compare agents on puzzles'}</button>
    </section>
    {job && <section aria-label="Puzzle results"><h3>{job.status} · {job.attempts.length}/{job.input.ids.length * 2} answers {job.simulation && '· simulated'}</h3>
      {['queued', 'running'].includes(job.status) && <button className="button" disabled={busy} onClick={() => void work(async () => { await rpc('puzzles.cancel', { jobId: job.id, requestId: crypto.randomUUID() }); })}>Cancel puzzle comparison</button>}
      {job.error && <p role="alert">{job.error}</p>}
      <table><thead><tr><th>Agent</th><th>Accuracy</th><th>Mean answer time</th><th>Illegal</th><th>Provider failures</th></tr></thead><tbody>{(['cli1', 'cli2'] as const).map(seat => {
        const entries = job.attempts.filter(a => a.seat === seat), graded = entries.filter(a => ['pass', 'fail', 'illegal'].includes(a.status)), times = graded.flatMap(a => a.durationMs === null ? [] : [a.durationMs]);
        return <tr key={seat}><td>{names[job.input.agents[seat].provider]} · {job.input.agents[seat].model}</td><td>{graded.filter(a => a.status === 'pass').length}/{graded.length}</td><td>{times.length ? `${(times.reduce((n, x) => n + x, 0) / times.length / 1000).toFixed(1)}s` : '—'}</td><td>{entries.filter(a => a.status === 'illegal').length}</td><td>{entries.length - graded.length}</td></tr>;
      })}</tbody></table>
      {job.attempts.map((a, i) => <details key={i}><summary>{a.puzzleId} · Agent {a.seat === 'cli1' ? 1 : 2} · {a.status}</summary><p>{a.move}</p><p>{a.explanation}</p><pre>{a.answer}</pre></details>)}
      <button className="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `puzzles-${job.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Export puzzle results</button>
      {jobs.length > 1 && <label>Previous comparison<select value={job.id} aria-label="Previous puzzle comparison" onChange={e => setSelectedJob(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString()} · {j.status}</option>)}</select></label>}
    </section>}
  </dialog>;
}
