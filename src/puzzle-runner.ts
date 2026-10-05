import { randomUUID } from 'node:crypto';
import type { AvAService } from './service.js';
import { AvAError, SEATS, type ProviderConfig, type Seat } from './types.js';
import { packageVersion } from './paths.js';
import { gradePuzzle, puzzle, puzzlePrompt, type PuzzleGrade } from './games/crosscurrent-puzzles.js';
import { experimentError, experimentPair, experimentRequest, retireExperimentPair } from './experiment-session.js';
import type { RunProfile } from './run-profiles.js';
export interface PuzzleInput { ids: string[]; agents: Record<Seat, ProviderConfig>; timeMs: number; profile?: RunProfile }
export interface PuzzleAttempt { puzzleId: string; version: number; seat: Seat; agent: ProviderConfig; status: PuzzleGrade['status'] | 'error' | 'timeout'; answer: string; move?: string; explanation: string; durationMs: number | null }
export interface PuzzleJob { id: string; createdAt: string; updatedAt: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; input: PuzzleInput; version: string; simulation: boolean; requestCeiling: number; requestsAdmitted: number; attempts: PuzzleAttempt[]; current?: { puzzleId: string; pairId?: string }; error?: string }
export function puzzleScores(job: PuzzleJob) { return SEATS.map(seat => {
  const attempts = job.attempts.filter(a => a.seat === seat), graded = attempts.filter(a => ['pass', 'fail', 'illegal'].includes(a.status)), times = graded.flatMap(a => a.durationMs === null ? [] : [a.durationMs]);
  return { seat, graded: graded.length, passed: graded.filter(a => a.status === 'pass').length, illegal: attempts.filter(a => a.status === 'illegal').length, failures: attempts.length - graded.length, accuracy: graded.length ? graded.filter(a => a.status === 'pass').length / graded.length : null, meanMs: times.length ? times.reduce((n, ms) => n + ms, 0) / times.length : null };
}); }
export class PuzzleRunner {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(private service: AvAService) {
    for (const job of this.jobs()) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.error = 'The service restarted. Uncertain puzzle work was not resent.'; this.save(job); }
  }
  get busy() { return this.active.size > 0; }
  jobs(): PuzzleJob[] { return this.service.store.db.prepare('SELECT data FROM puzzle_jobs ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(String(r.data))); }
  get(id: string): PuzzleJob { const r = this.service.store.db.prepare('SELECT data FROM puzzle_jobs WHERE id=?').get(id); if (!r) throw new AvAError('NOT_FOUND', 'Puzzle job not found.'); return JSON.parse(String(r.data)); }
  private save(job: PuzzleJob) { job.updatedAt = new Date().toISOString(); this.service.store.db.prepare('INSERT INTO puzzle_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job)); }
  start(input: PuzzleInput) {
    if (this.busy || this.service.benchmarks.busy || this.service.series?.busy) throw new AvAError('PUZZLE_BUSY', 'Another puzzle or benchmark job is running.');
    if (!input.ids.length || input.ids.length > 20 || new Set(input.ids).size !== input.ids.length) throw new AvAError('PUZZLE_SELECTION', 'Choose 1–20 distinct puzzles.');
    input.ids.forEach(puzzle);
    const limit = this.service.resources.limit;
    if (limit && this.service.resources.active().length + 2 > limit) throw new AvAError('PUZZLE_CAPACITY', 'Puzzle comparisons need two free agent slots. Stop agents or raise the limit in Resources.');
    const job: PuzzleJob = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: '', status: 'queued', input: structuredClone(input), version: packageVersion, simulation: this.service.mode === 'simulation', requestCeiling: input.ids.length * 4, requestsAdmitted: 0, attempts: [] };
    this.save(job); const abort = new AbortController(), done = Promise.resolve().then(() => this.drive(job, abort.signal)).finally(() => this.active.delete(job.id));
    this.active.set(job.id, { abort, done }); void done.catch(() => {}); return this.get(job.id);
  }
  cancel(id: string) { const job = this.get(id); this.active.get(id)?.abort.abort(new AvAError('CANCELLED', 'Puzzle comparison cancelled.')); return { id, status: this.active.has(id) ? 'cancelling' : job.status }; }
  cancelAll() { for (const id of this.active.keys()) this.cancel(id); }
  async shutdown() { this.cancelAll(); await Promise.allSettled([...this.active.values()].map(x => x.done)); }
  private async drive(job: PuzzleJob, signal: AbortSignal) {
    const admitted = () => { signal.throwIfAborted(); if (job.requestsAdmitted >= job.requestCeiling) throw new Error('Puzzle request ceiling reached.'); job.requestsAdmitted++; this.save(job); };
    job.status = 'running'; this.save(job);
    try {
      for (const id of job.input.ids) {
        const p = puzzle(id); job.current = { puzzleId: id }; this.save(job);
        const pair = await experimentPair(this.service, `${job.id}-${id}`, job.input.agents, signal, admitted); job.current.pairId = pair.id; this.save(job);
        try {
          // Answers use fresh, separate sessions and identical positions. There are no retries or repair hints.
          const answers = await Promise.allSettled(SEATS.map(async seat => {
            const participant = this.service.activation.get(pair.id, seat)!; admitted();
            try {
              const answer = await experimentRequest(participant, puzzlePrompt(p, job.input.timeMs), signal, job.input.timeMs);
              signal.throwIfAborted(); const grade = gradePuzzle(p, answer.answer);
              return { puzzleId: id, version: p.version, seat, agent: participant.accepted, ...answer, ...grade } as PuzzleAttempt;
            } catch (error) {
              if (signal.aborted) throw error;
              return { puzzleId: id, version: p.version, seat, agent: participant.accepted, status: error instanceof AvAError && error.code === 'EXPERIMENT_TIMEOUT' ? 'timeout' : 'error', answer: '', explanation: experimentError(error), durationMs: null } as PuzzleAttempt;
            }
          }));
          for (const answer of answers) if (answer.status === 'fulfilled') { job.attempts.push({ ...answer.value, answer: experimentError(answer.value.answer).slice(0, 2000) }); this.save(job); }
          signal.throwIfAborted();
          if (answers.some(r => r.status === 'rejected') || job.attempts.some(a => a.status === 'error' || a.status === 'timeout')) throw new Error('Stopped after the first provider failure or timeout. No retry was sent.');
        } finally { await retireExperimentPair(this.service, pair.id); }
      }
      job.status = 'completed'; delete job.current;
    } catch (error) { job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = experimentError(error); }
    this.save(job);
  }
}
