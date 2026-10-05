import { useEffect, useRef, useState } from 'react';
import { seriesCeiling, seriesSummary, type SeriesInput, type SeriesJob } from '../src/series.js';
import { CROSSCURRENT_DEFAULT_RULESET, GAME_KINDS, type GameKind } from '../src/games/engine.js';
import type { JudgeProvider, ProviderConfig, Seat } from '../src/types.js';
import { names, type PairView } from './model.js';
import { rpc, roomId } from './api.js';
import { CommandClient } from './commands.js';
import { ProfileSelector } from './profile-selector.js';
import type { RunProfile } from '../src/run-profiles.js';
export function SeriesPanel({ pair, onClose, onOpen }: { pair: PairView | undefined; onClose: () => void; onOpen: (threadId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), commands = useRef(new CommandClient(sessionStorage, 'ava-series:' + roomId));
  const [kind, setKind] = useState<'game' | 'debate'>('game'), [game, setGame] = useState<GameKind>('crosscurrent'), [pairs, setPairs] = useState(2), [seconds, setSeconds] = useState(120), [rounds, setRounds] = useState(2), [motion, setMotion] = useState(''), [judge, setJudge] = useState<JudgeProvider>('claude'), [internet, setInternet] = useState(false);
  const [jobs, setJobs] = useState<SeriesJob[]>([]), [chosen, setChosen] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [profile, setProfile] = useState<RunProfile | ''>('');
  const job = jobs.find(j => j.id === chosen) ?? jobs[0], running = jobs.some(j => ['queued', 'running'].includes(j.status));
  const agents = { cli1: pair?.slots.cli1.config, cli2: pair?.slots.cli2.config }, ready = !!agents.cli1 && !!agents.cli2;
  const input: SeriesInput = { kind, pairs, agents: agents as Record<Seat, ProviderConfig>, internet: kind === 'debate' && internet, ...(profile ? { profile } : {}), ...(kind === 'game' ? { game: { kind: game, first: 'cli1', maxIllegal: 3, moveMs: seconds * 1000, ...(game === 'crosscurrent' ? { size: 7, ruleset: CROSSCURRENT_DEFAULT_RULESET } : game === 'go' ? { size: 9 } : {}) } } : { motion, rounds, speechMs: seconds * 1000, judge }) };
  let ceiling: number | null = null; try { ceiling = seriesCeiling(input); } catch { /* incomplete form */ }
  useEffect(() => {
    dialog.current?.showModal(); let active = true, reading = false;
    const read = async () => { if (reading) return; reading = true; try { const list = await rpc<{ jobs: SeriesJob[] }>('series.jobs', {}); if (active) setJobs(list.jobs); } catch (e) { if (active) setError(String(e)); } finally { reading = false; } };
    void read(); const timer = setInterval(() => void read(), 1000); return () => { active = false; clearInterval(timer); };
  }, []);
  const work = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const start = () => work(async () => {
    const { agents: ignored, ...settings } = input;
    const params = commands.current.pendingInput?.params ?? { ...settings, pairId: pair!.id };
    const next = await commands.current.execute(JSON.stringify(params), 'series.start', params, rpc) as SeriesJob;
    setChosen(next.id); setJobs(list => [next, ...list.filter(j => j.id !== next.id)]);
  });
  const summary = job && seriesSummary(job);
  return <dialog ref={dialog} className="resources-panel series-panel" aria-labelledby="series-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="series-title">Match series</h2><p>Paired trials with sides swapped, fresh sessions and saved settings.</p></div><button className="button" onClick={onClose}>Close series</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="series-setup">
      <h3>Set up a new series</h3>
      <label>Mode<select aria-label="Series mode" value={kind} onChange={e => setKind(e.target.value as 'game' | 'debate')}><option value="game">Games</option><option value="debate">Debates</option></select></label>
      {kind === 'game' ? <label>Game<select aria-label="Series game" value={game} onChange={e => setGame(e.target.value as GameKind)}>{GAME_KINDS.map(g => <option key={g} value={g}>{g === 'crosscurrent' ? 'Crosscurrent · 7×7 · cooldown' : g === 'go' ? 'Go · 9×9' : g[0]!.toUpperCase() + g.slice(1)}</option>)}</select></label>
        : <><label>Motion<textarea aria-label="Series motion" value={motion} maxLength={16000} onChange={e => setMotion(e.target.value)} /></label><label>Rounds<select aria-label="Series rounds" value={rounds} onChange={e => setRounds(Number(e.target.value))}>{[1, 2, 3, 5].map(n => <option key={n}>{n}</option>)}</select></label><label>Independent judge<select aria-label="Series judge" value={judge} onChange={e => setJudge(e.target.value as JudgeProvider)}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label><label><input type="checkbox" checked={internet} onChange={e => setInternet(e.target.checked)} />Internet for both debaters</label><p className="resource-note">The judge may check facts online. Its selected model and effort are frozen for the series. Participant reviews and the independent ballot are saved separately; the three-ballot result scores each debate.</p></>}
      <label>Pairs of matches<select aria-label="Series pairs" value={pairs} onChange={e => setPairs(Number(e.target.value))}>{[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n} pairs · {n * 2} matches</option>)}</select></label>
      <ProfileSelector pairId={pair?.id} agents={agents} value={profile} unit={kind === 'game' ? 'move' : 'speech'} onChange={(p, ms) => { setProfile(p); if (ms) setSeconds(ms / 1000); }} />
      <label>Seconds per {kind === 'game' ? 'move' : 'speech'}<select aria-label="Series time limit" value={seconds} onChange={e => { setProfile(''); setSeconds(Number(e.target.value)); }}>{[30, 60, 120, 300].map(n => <option key={n}>{n}</option>)}</select></label>
      <p>{(['cli1', 'cli2'] as const).map(s => { const c = agents[s]; return c ? `${names[c.provider]} · ${c.modelName ?? c.model} · ${c.effort?.value ?? 'provider-default'} effort` : 'Choose an agent model'; }).join(' versus ')}</p>
      <p className="resource-note">Up to {ceiling ?? '—'} model requests. Two free agent slots. Settings are captured at start; every match starts in a fresh session with Ask permissions. Games use the same initial board; debates keep the same motion and swap sides and speaking order.</p>
      <button className="button primary" disabled={busy || !commands.current.hasPending && (!ready || running || ceiling === null)} onClick={() => void start()}>{commands.current.hasPending ? 'Retry series start' : 'Start series'}</button>
    </div>
    {job && summary && <section aria-label="Series results"><h3>{job.input.kind === 'game' ? `${job.input.game!.kind} game` : 'Debate'} results</h3>
      <p>{job.input.kind === 'debate' ? job.input.motion : `${job.input.game!.kind}${job.input.game!.size ? ` ${job.input.game!.size}×${job.input.game!.size}` : ''}`}</p>
      <p>{(['cli1', 'cli2'] as const).map((seat, i) => { const c = (job.resolvedAgents ?? job.input.agents)[seat]; return `Agent ${i + 1}: ${names[c.provider]} · ${c.modelName ?? c.model} · ${c.effort?.value ?? 'provider-default'} effort`; }).join(' versus ')}</p>
      <p><strong>{job.status} · {job.matches.filter(m => m.status === 'completed').length}/{job.input.pairs * 2} matches {job.simulation && '· simulated'}</strong></p>
      {job.current && <p role="status">Match {job.current.index + 1} · {job.current.phase}</p>}
      {['queued', 'running'].includes(job.status) && <button className="button" disabled={busy} onClick={() => void work(async () => { await rpc('series.cancel', { jobId: job.id, requestId: crypto.randomUUID() }); })}>Cancel series</button>}
      {job.error && <p role="alert">{job.error}</p>}
      <p>{summary.completedPairs} complete pairs · Agent 1 wins {summary.cli1Wins} · Agent 2 wins {summary.cli2Wins} · Draws {summary.draws}</p>
      <p>{summary.cli1Score === null ? 'A score needs a completed pair.' : `Agent 1 points: ${(summary.cli1Score * 100).toFixed(1)}% · 95% range ${summary.interval95!.map(x => (x * 100).toFixed(1)).join('–')}%`}</p><p className="resource-note">{summary.uncertainty}</p>
      <details><summary>Recorded settings and limits</summary><pre>{JSON.stringify({ input: job.input, acceptedAgents: job.resolvedAgents, judge: job.resolvedJudge, version: job.version, engine: job.engineVersion, requests: job.requestsAdmitted, ceiling: job.requestCeiling }, null, 2)}</pre></details>
      <ol>{job.matches.map(m => <li key={m.index}>Match {m.index + 1} · Agent {m.first === 'cli1' ? 1 : 2} first · {m.status} · {m.reason}{m.threadId && <button className="link" onClick={() => { onClose(); onOpen(m.threadId!); }}>Open match replay</button>}</li>)}</ol>
      {(['json', 'md'] as const).map(format => <button key={format} className="button" onClick={() => void work(async () => {
        const report = await rpc<{ markdown: string; job: SeriesJob; summary: unknown }>('series.report', { jobId: job.id });
        const text = (format === 'md' ? report.markdown : JSON.stringify(report, null, 2)).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/gi, '[redacted]');
        const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' })), link = document.createElement('a'); link.href = url; link.download = `series-${job.id}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Export {format === 'md' ? 'Markdown' : 'JSON'}</button>)}
      {jobs.length > 1 && <label>Previous series<select aria-label="Previous series" value={job.id} onChange={e => setChosen(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString()} · {j.input.kind} · {j.status}</option>)}</select></label>}
    </section>}
  </dialog>;
}
