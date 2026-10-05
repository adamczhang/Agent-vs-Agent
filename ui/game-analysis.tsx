import { useEffect, useRef, useState } from 'react';
import { VERDICT_NAMES, type MoveAnalysis } from '../src/games/crosscurrent-analysis.js';

export function GameAnalysis({ runId, moves, onPosition, onVariation }: { runId: string; moves: string[]; onPosition: (ply: number) => void; onVariation: (ply: number, moves: string[]) => void }) {
  const [entries, setEntries] = useState<MoveAnalysis[]>([]), [status, setStatus] = useState(''), [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const signature = JSON.stringify(moves);
  useEffect(() => { worker.current?.terminate(); worker.current = null; setEntries([]); setStatus(''); setError(''); return () => { worker.current?.terminate(); worker.current = null; }; }, [runId, signature]);
  const cancel = () => { worker.current?.terminate(); worker.current = null; setStatus('cancelled'); };
  const start = () => {
    cancel(); setEntries([]); setStatus('working'); setError('');
    const job = new Worker(new URL('./game-analysis-worker.ts', import.meta.url), { type: 'module' }); worker.current = job;
    job.onmessage = (e: MessageEvent) => {
      if (worker.current !== job) return;
      if (e.data.kind === 'progress') setEntries(list => [...list, e.data.entry]);
      else { setStatus(e.data.kind === 'done' ? 'done' : 'failed'); setError(e.data.error ?? ''); job.terminate(); worker.current = null; }
    };
    job.onerror = () => { if (worker.current === job) { setError('Analysis could not finish. Try again.'); setStatus('failed'); job.terminate(); worker.current = null; } };
    job.postMessage({ moves });
  };
  const findings = entries.filter(e => e.verdict !== 'unresolved');
  return <section className="game-card game-analysis" aria-label="Game analysis">
    <header><h3>Tactical analysis</h3>{status === 'working' ? <button className="link" onClick={cancel}>Cancel analysis</button> : <button className="button" onClick={start}>{entries.length ? 'Analyze again' : 'Analyze game'}</button>}</header>
    <p className="game-note">Checks immediate wins, defenses and forcing sequences locally. Longer-term positional strength is unassessed.</p>
    {status && <p className="game-note" role="status">{status === 'working' ? `Analyzed ${entries.length} of ${moves.length} moves…` : status === 'done' ? `Analysis complete · ${entries.length} moves checked` : status === 'cancelled' ? 'Analysis cancelled; partial findings shown.' : 'Analysis failed.'}</p>}
    {error && <p role="alert">{error}</p>}
    {status === 'done' && !findings.length && <p className="game-note">No short tactical findings. This does not establish that the moves were optimal.</p>}
    {findings.map(entry => <article key={entry.ply} className="analysis-finding">
      <button className="link" onClick={() => onPosition(entry.ply)}>Turn {entry.ply}: {VERDICT_NAMES[entry.verdict]}</button>
      <p className="game-note">{entry.move} · {entry.player === 1 ? 'Circle' : 'Diamond'}</p><p className="game-note">{entry.explanation}</p>
      {entry.alternatives.map(move => <button key={move} className="button" onClick={() => onVariation(entry.ply - 1, [move])}>Explore {move}</button>)}
      {entry.winningReply && <button className="button" onClick={() => onVariation(entry.ply, [entry.winningReply!])}>Show winning reply</button>}
    </article>)}
  </section>;
}
