import type { Seat } from '../src/types.js';
import { duration, names, seats, type ThreadRun } from './model.js';

// A scored bug hunt's result (H2): the bugs that were planted in both copies, which of them each agent's BUG lines
// found, how many BUG lines it gave, and its time. The planted bugs are shown only once both have reported.
export function HuntResult({ run }: { run: ThreadRun }) {
  const planted = run.config.build?.planted, decoys = run.config.build?.decoys ?? 0, result = run.hunt;
  if (!planted) return null;
  const who = (seat: Seat) => { const p = run.participants?.[seat]; return `Agent ${seat === 'cli1' ? 1 : 2}${p ? ` · ${names[p.provider] ?? p.provider}` : ''}`; };
  if (!result) return <div className="ballot pending"><span>Bug hunt: {planted} planted bug{planted === 1 ? '' : 's'}{decoys ? ` and ${decoys} decoy${decoys === 1 ? '' : 's'}` : ''}. The result shows once both agents have reported.</span></div>;
  const real = result.bugs.filter(b => !b.decoy).length, hasDecoys = result.bugs.some(b => b.decoy), fell = (s: Seat) => result.seats[s].decoys?.length ?? 0;
  const time = (ms: number | null) => ms === null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : duration(ms);
  return <section className="ballot prompt-result hunt-result" aria-label="Bug hunt result">
    <header><h3>Bug hunt result</h3><span>{real} planted bug{real === 1 ? '' : 's'}{hasDecoys ? ` · ${result.bugs.length - real} decoy${result.bugs.length - real === 1 ? '' : 's'}` : ''}{result.maxReports ? ` · first ${result.maxReports} BUG lines count` : ''}</span></header>
    <p className="ballot-winner">{result.winner ? <>Winner: <strong>{who(result.winner)}</strong>, {!seats.every(s => result.seats[s].found.length === result.seats[result.winner!].found.length) ? 'more planted bugs found' : !seats.every(s => fell(s) === fell(result.winner!)) ? 'as many found, fewer decoys reported' : 'as many found, sooner'}</> : 'Neither agent found a planted bug.'}</p>
    <table>
      <thead><tr><th scope="col">Agent</th><th scope="col">Found</th>{hasDecoys && <th scope="col">Decoys reported</th>}<th scope="col">BUG lines</th><th scope="col">Time</th></tr></thead>
      <tbody>{seats.map(s => { const r = result.seats[s]; return <tr key={s} className={result.winner === s ? 'won' : ''}>
        <th scope="row"><span className={`seat-dot ${s}`}/>{who(s)}</th>
        <td>{r.found.length} of {real}</td>{hasDecoys && <td>{fell(s)}</td>}<td>{r.reports}</td><td>{time(r.ms)}</td>
      </tr>; })}</tbody>
    </table>
    <ol className="hunt-bugs">{result.bugs.map((bug, i) => <li key={i} className={bug.decoy ? 'decoy' : ''}>
      {bug.decoy && <strong>Decoy: </strong>}<code>{bug.file}{bug.line ? `:${bug.line}${bug.endLine && bug.endLine !== bug.line ? `–${bug.endLine}` : ''}` : ''}</code> {bug.what}
      <span className="hunt-found">{seats.map(s => { const ok = bug.decoy ? !result.seats[s].decoys?.includes(i) : result.seats[s].found.includes(i); return <span key={s} className={ok ? 'right' : 'wrong'}>Agent {s === 'cli1' ? 1 : 2} {bug.decoy ? (ok ? 'left it ✓' : 'reported it ✗') : ok ? '✓' : '✗'}</span>; })}</span>
    </li>)}</ol>
  </section>;
}
