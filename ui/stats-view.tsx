import type { ThreadStats, TurnStat } from '../src/stats';

// Seat hues validated on the white surface with the dataviz palette checks (contrast ≥ 3:1, CVD-separated).
const SEAT_COLOR: Record<string, string> = { cli1: '#2563eb', cli2: '#d97706' };
const ms = (v: number | null) => v === null ? '—' : v < 1000 ? `${Math.round(v)} ms` : v < 59_950 ? `${(v / 1000).toFixed(1)} s` : minutes(Math.round(v / 1000));
// Whole seconds first, so 119.6 s reads 2m 0s rather than 1m 60s.
const minutes = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;
const num = (v: number | null, digits = 0) => v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits });

export function StatsView({ stats, names, loading }: { stats: ThreadStats | null; names: Record<string, string>; loading: boolean }) {
  if (!stats) return <div className="stats stats-empty">{loading ? 'Loading stats…' : 'Stats appear once a conversation has started.'}</div>;
  const seatName = (seat: string) => { const s = stats.seats.find(x => x.seat === seat); return s?.provider ? names[s.provider] ?? s.provider : seat.toUpperCase(); };
  const completed = stats.turns.filter(t => t.status === 'completed').length;
  const tiles = [
    { label: 'Conversation time', value: ms(stats.wallMs ?? stats.activeMs), sub: stats.interrupted ? 'an interruption is timed to the last recorded activity' : `${stats.prompts} ${stats.prompts === 1 ? 'prompt' : 'prompts'}, back to back` },
    { label: 'Agents in parallel', value: String(stats.maxParallel), sub: `of ${stats.agents} · ${stats.processesSpawned ? `${stats.processesSpawned} processes spawned` : 'no processes recorded'}` },
    { label: 'First token', value: ms(stats.avgFirstActivityMs), sub: 'average, to first visible activity' },
    { label: 'Reply time', value: ms(stats.avgDurationMs), sub: `average over ${completed} ${completed === 1 ? 'reply' : 'replies'}` },
    { label: 'Output speed', value: stats.tokensPerSec === null ? '—' : `${num(stats.tokensPerSec)} tok/s`, sub: stats.tokensEstimated ? 'includes estimates (characters ÷ 4)' : 'from provider reports, when available' },
  ];
  const timed = stats.turns.filter((t): t is TurnStat & { prompt: number; startMs: number; durationMs: number } => t.startMs !== null && t.durationMs !== null);
  const span = Math.max(1, ...timed.map(t => t.startMs + t.durationMs));
  const multi = stats.prompts > 1;
  const label = (t: TurnStat & { prompt: number }) => `${multi ? `P${t.prompt} · ` : ''}${seatName(t.seat)} · ${t.phase === 'paired' ? 'opening' : 'reply'}`;
  const detail = (t: TurnStat) => `started ${ms(t.startMs)} in · first activity after ${ms(t.firstActivityMs)} · finished in ${ms(t.durationMs)} · ${num(t.outputChars)} characters · ${t.tokenSource === 'estimated' ? '≈' : ''}${num(t.outputTokens)} tokens${t.tokensPerSec !== null ? ` · ${num(t.tokensPerSec)} tok/s` : ''} · ${t.status}`;
  return <div className="stats">
    <div className="stat-row">{tiles.map(t => <div className="stat" key={t.label}><span className="stat-label">{t.label}</span><strong className="stat-value">{t.value}</strong><span className="stat-sub">{t.sub}</span></div>)}</div>
    <section className="stats-section">
      <h2>By agent</h2>
      <table className="stats-table">
        <thead><tr><th scope="col">Agent</th><th scope="col">Requests</th><th scope="col">First token</th><th scope="col">Reply time</th><th scope="col">Output</th><th scope="col">Speed</th></tr></thead>
        <tbody>{stats.seats.map(s => <tr key={s.seat}><th scope="row"><span className="swatch" style={{ background: SEAT_COLOR[s.seat] }} />{seatName(s.seat)}<small>{s.model ?? 'model not recorded'}</small></th><td>{s.completed}<small>{s.unsuccessful ? ` of ${s.requests}` : ''}</small></td><td>{ms(s.avgFirstActivityMs)}</td><td>{ms(s.avgDurationMs)}</td><td>{s.tokenSource === 'estimated' || s.tokenSource === 'mixed' ? '≈' : ''}{num(s.outputTokens)} tokens<small>{s.tokenSource}{s.inputTokens !== null ? ` · ${num(s.inputTokens)} input` : ''}</small></td><td>{s.tokensPerSec === null ? '—' : `${num(s.tokensPerSec)} tok/s`}</td></tr>)}</tbody>
      </table>
    </section>
    <section className="stats-section">
      <div className="section-head"><h2>Timeline</h2><div className="legend">{(['cli1', 'cli2'] as const).map(seat => <span key={seat}><span className="swatch" style={{ background: SEAT_COLOR[seat] }} />{seatName(seat)}</span>)}<span><span className="swatch wait" />Waiting for first token</span></div></div>
      {timed.length ? <div className="timeline">{stats.turns.map(t => {
        if (t.startMs === null || t.durationMs === null) return <div className="timeline-row" key={t.turnId}><span className="timeline-label">{label(t)}</span><span className="timeline-track muted">no timing ({t.status})</span><span className="timeline-value">—</span></div>;
        const wait = Math.min(t.firstActivityMs ?? t.durationMs, t.durationMs);
        return <div className="timeline-row" key={t.turnId} title={`${label(t)}: ${detail(t)}`}>
          <span className="timeline-label">{label(t)}</span>
          <span className="timeline-track"><span className="bar-wait" style={{ left: `${t.startMs / span * 100}%`, width: `${wait / span * 100}%` }} /><span className={`bar-gen ${t.status !== 'completed' ? 'incomplete' : ''}`} style={{ left: `${(t.startMs + wait) / span * 100}%`, width: `${Math.max(0.4, (t.durationMs - wait) / span * 100)}%`, background: SEAT_COLOR[t.seat] }} /></span>
          <span className="timeline-value">{ms(t.durationMs)}</span>
        </div>;
      })}<div className="timeline-axis"><span /><span>0</span><span>{ms(span)}</span></div></div> : <p className="stats-note">No timed requests yet.</p>}
    </section>
    <details className="stats-section stats-details"><summary>Every request</summary>
      <table className="stats-table"><thead><tr><th scope="col">#</th>{multi && <th scope="col">Prompt</th>}<th scope="col">Agent</th><th scope="col">Kind</th><th scope="col">Start</th><th scope="col">First token</th><th scope="col">Duration</th><th scope="col">Characters</th><th scope="col">tok/s</th><th scope="col">Status</th></tr></thead>
        <tbody>{stats.turns.map((t, i) => <tr key={t.turnId}><td>{i + 1}</td>{multi && <td>{t.prompt}</td>}<td>{seatName(t.seat)}</td><td>{t.phase === 'paired' ? 'opening' : t.phase}</td><td>{ms(t.startMs)}</td><td>{ms(t.firstActivityMs)}</td><td>{ms(t.durationMs)}</td><td>{num(t.outputChars)}</td><td>{t.tokenSource === 'estimated' ? '≈' : ''}{num(t.tokensPerSec)}</td><td>{t.status}</td></tr>)}</tbody>
      </table>
    </details>
    <p className="stats-note">Codex, Claude Code and Gateway token counts use saved provider reports. Grok Build and Antigravity, and Cursor when it reports nothing, use estimates (characters ÷ 4), marked ≈. Missing reports stay unavailable. First token is the first activity a CLI exposed: thinking, a tool call, or text. Prompts are placed back to back, so time between your prompts isn’t counted. Everything comes from the saved event log, so past threads keep their stats.</p>
  </div>;
}
