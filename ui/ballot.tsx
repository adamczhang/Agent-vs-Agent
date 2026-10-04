import { JUDGE_CATEGORIES, type JudgeCategory, type Judgment, type Seat } from '../src/types.js';
import { panelResult } from '../src/debate.js';
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
  // Three ballots (G16): each debater's own beside the judge's; the side most of them name wins, the judge breaking a tie.
  const panel = judgment.panel, result = panelResult(judgment), sum = (s: Record<Seat, Record<JudgeCategory, number>>, seat: Seat) => JUDGE_CATEGORIES.reduce((n, c) => n + s[seat][c.key], 0);
  const sideOf = (seat: Seat) => SIDE[stances[seat]], forSeat = seats.find(s => stances[s] === 'for')!, againstSeat = seats.find(s => stances[s] === 'against')!;
  return <section className="ballot" aria-label="Judge’s ballot">
    <header><h3>{panel ? 'Ballots' : 'Judge’s ballot'}</h3><span>{panel ? `Judge: ${judgeName(judgment)}` : judgeName(judgment)}</span></header>
    {panel && (result ? <p className="ballot-winner">Result: <strong>{who(result.winner)}</strong>, {sideOf(result.winner)}: {result.votes[result.winner]} of {result.ballots} ballot{result.ballots === 1 ? '' : 's'}{result.tie ? ', the judge breaking the tie' : ''}</p>
      : <p className="ballot-winner">Waiting for the debaters’ own ballots.</p>)}
    {panel && <table className="ballot-panel" aria-label="The three ballots">
      <thead><tr><th scope="col">Ballot</th><th scope="col">{SIDE.for}</th><th scope="col">{SIDE.against}</th><th scope="col">Winner</th></tr></thead>
      <tbody>
        <tr><th scope="row">The judge</th><td>{totals[forSeat]}<small>/15</small></td><td>{totals[againstSeat]}<small>/15</small></td><td>{sideOf(judgment.winner!)}</td></tr>
        {seats.map(s => { const b = panel[s]; return <tr key={s}><th scope="row">{who(s)}’s own <small>argued {sideOf(s)}</small></th>
          {b?.status === 'done' ? <><td>{sum(b.scores!, forSeat)}<small>/15</small></td><td>{sum(b.scores!, againstSeat)}<small>/15</small></td><td>{sideOf(b.winner!)}</td></>
            : <td colSpan={3} className="ballot-missing">{b?.status === 'reviewing' ? 'Scoring…' : `No ballot${b?.error ? `: ${b.error}` : ''}`}</td>}</tr>; })}
      </tbody>
    </table>}
    {panel && <h4 className="ballot-sub">The judge’s scores</h4>}
    <p className="ballot-winner">{panel ? 'Judge’s pick' : 'Winner'}: <strong>{who(judgment.winner!)}</strong>, {SIDE[stances[judgment.winner!]]}</p>
    <table>
      <thead><tr><th scope="col">Category</th>{seats.map(s => <th key={s} scope="col" className={judgment.winner === s ? 'won' : ''}><span className={`seat-dot ${s}`}/>{who(s)}<small>{SIDE[stances[s]]}</small></th>)}</tr></thead>
      <tbody>
        {JUDGE_CATEGORIES.map(c => <tr key={c.key}><th scope="row">{c.label}</th>{seats.map(s => <td key={s}>{scores[s][c.key]}<small>/5</small></td>)}</tr>)}
        <tr className="total"><th scope="row">Total</th>{seats.map(s => <td key={s}>{totals[s]}<small>/15</small></td>)}</tr>
      </tbody>
    </table>
    {judgment.reason && <p className="ballot-reason">{judgment.reason}</p>}
    {judgment.blind && <p className="ballot-blind">Judged blind: the judge didn’t know which agent argued which side, and read every speech in one typography{judgment.blind.redacted ? `, with ${judgment.blind.redacted} identifying name${judgment.blind.redacted === 1 ? '' : 's'} removed` : ''}.</p>}
    {seats.some(s => judgment.notes?.[s]) && <ul className="ballot-notes">{seats.filter(s => judgment.notes?.[s]).map(s => <li key={s}><strong>{who(s)}:</strong> {judgment.notes![s]}</li>)}</ul>}
    {!!judgment.issues?.length && <details className="ballot-issues"><summary>{judgment.issues.length} factual claim{judgment.issues.length === 1 ? '' : 's'} the judge questioned</summary>
      <ul>{judgment.issues.map((issue, i) => <li key={i}><strong>{who(issue.seat)}:</strong> “{issue.claim}” {issue.problem}</li>)}</ul></details>}
    {canJudge && <button className="link" disabled={busy} onClick={onJudge}>Judge again</button>}
  </section>;
}
