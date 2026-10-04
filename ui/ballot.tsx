import { JUDGE_CATEGORIES, type Judgment, type Seat } from '../src/types.js';
import { names, seats, type ThreadRun } from './model.js';

// A formal debate's ballot (G7): the independent judge's scores out of 5 in each category, the winner and why, and any
// factual claims it found wrong or unsupported. While it works, who is judging; if it failed, why, and Judge again.
const SIDE = { for: 'Proposition', against: 'Opposition' } as const;
const judgeName = (j: Judgment) => [names[j.judge.provider] ?? j.judge.provider, j.judge.modelName ?? j.judge.model, j.judge.effort ? `${j.judge.effort.value} effort` : ''].filter(Boolean).join(' · ');
export function Ballot({ run, canJudge, busy, onJudge }: { run: ThreadRun; canJudge: boolean; busy: boolean; onJudge: () => void }) {
  const stances = run.config.stances, judgment = run.judgment;
  if (!stances) return null;
  const who = (seat: Seat) => { const p = run.participants?.[seat]; return `Agent ${seat === 'cli1' ? 1 : 2}${p ? ` · ${names[p.provider] ?? p.provider}` : ''}`; };
  if (!judgment) return canJudge ? <div className="ballot pending"><span>Not judged yet.</span><button className="button" disabled={busy} onClick={onJudge}>Judge this debate</button></div> : null;
  if (judgment.status === 'judging') return <div className="ballot pending" role="status"><span className="judging-dot" aria-hidden="true"/><span>The judge is scoring this debate{judgment.judge.model ? ` · ${judgeName(judgment)}` : ''}. This can take a few minutes.</span></div>;
  if (judgment.status === 'failed') return <div className="ballot failed" role="alert"><span>The judge couldn’t finish: {judgment.error ?? 'no reason given'}.</span>{canJudge && <button className="button" disabled={busy} onClick={onJudge}>Judge again</button>}</div>;
  const scores = judgment.scores!, totals = Object.fromEntries(seats.map(s => [s, JUDGE_CATEGORIES.reduce((sum, c) => sum + scores[s][c.key], 0)])) as Record<Seat, number>;
  return <section className="ballot" aria-label="Judge’s ballot">
    <header><h3>Judge’s ballot</h3><span>{judgeName(judgment)}</span></header>
    <p className="ballot-winner">Winner: <strong>{who(judgment.winner!)}</strong>, {SIDE[stances[judgment.winner!]]}</p>
    <table>
      <thead><tr><th scope="col">Category</th>{seats.map(s => <th key={s} scope="col" className={judgment.winner === s ? 'won' : ''}><span className={`seat-dot ${s}`}/>{who(s)}<small>{SIDE[stances[s]]}</small></th>)}</tr></thead>
      <tbody>
        {JUDGE_CATEGORIES.map(c => <tr key={c.key}><th scope="row">{c.label}</th>{seats.map(s => <td key={s}>{scores[s][c.key]}<small>/5</small></td>)}</tr>)}
        <tr className="total"><th scope="row">Total</th>{seats.map(s => <td key={s}>{totals[s]}<small>/15</small></td>)}</tr>
      </tbody>
    </table>
    {judgment.reason && <p className="ballot-reason">{judgment.reason}</p>}
    {seats.some(s => judgment.notes?.[s]) && <ul className="ballot-notes">{seats.filter(s => judgment.notes?.[s]).map(s => <li key={s}><strong>{who(s)}:</strong> {judgment.notes![s]}</li>)}</ul>}
    {!!judgment.issues?.length && <details className="ballot-issues"><summary>{judgment.issues.length} factual claim{judgment.issues.length === 1 ? '' : 's'} the judge questioned</summary>
      <ul>{judgment.issues.map((issue, i) => <li key={i}><strong>{who(issue.seat)}:</strong> “{issue.claim}” {issue.problem}</li>)}</ul></details>}
    {canJudge && <button className="link" disabled={busy} onClick={onJudge}>Judge again</button>}
  </section>;
}
