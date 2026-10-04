import type { Seat } from '../src/types.js';
import { duration, names, seats, type ThreadRun } from './model.js';

// A Prompt run's checked answers (owner, 2026-10-04): the answer key, each agent's final answer, right or wrong, and its
// time; the winner is the agent that answered correctly, or the faster one when both did.
export function PromptResult({ run }: { run: ThreadRun }) {
  const check = run.config.check, result = run.result;
  if (!check) return null;
  const who = (seat: Seat) => { const p = run.participants?.[seat]; return `Agent ${seat === 'cli1' ? 1 : 2}${p ? ` · ${names[p.provider] ?? p.provider}` : ''}`; };
  const title = check.kind === 'race' ? 'Race result' : 'Challenge result';
  if (!result) return <div className="ballot pending"><span>{title}: waiting for both answers to be checked.</span></div>;
  return <section className="ballot prompt-result" aria-label={title}>
    <header><h3>{title}</h3><span>Answer key: {check.answers.join(' or ')}</span></header>
    <p className="ballot-winner">{result.winner ? <>Winner: <strong>{who(result.winner)}</strong>{seats.every(s => result.seats[s].correct) ? ', faster with the right answer' : ', the only right answer'}</> : 'No right answer this time.'}</p>
    <table>
      <thead><tr><th scope="col">Agent</th><th scope="col">Final answer</th><th scope="col">Right?</th><th scope="col">Time</th></tr></thead>
      <tbody>{seats.map(s => { const r = result.seats[s]; return <tr key={s} className={result.winner === s ? 'won' : ''}>
        <th scope="row"><span className={`seat-dot ${s}`}/>{who(s)}</th>
        <td className="answer">{r.answer ?? <em>no ANSWER line</em>}</td>
        <td className={r.correct ? 'right' : 'wrong'}>{r.correct ? '✓ Right' : '✗ Wrong'}</td>
        <td>{r.ms === null ? '—' : r.ms < 60_000 ? `${(r.ms / 1000).toFixed(1)} s` : duration(r.ms)}</td>
      </tr>; })}</tbody>
    </table>
  </section>;
}
