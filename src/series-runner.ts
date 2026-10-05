import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { threadKey } from './store.js';
import type { AvAService } from './service.js';
import { AvAError, SEATS, type Judgment, type PanelBallot, type ProviderConfig, type Run, type Seat } from './types.js';
import { packageVersion } from './paths.js';
import { blindDebate, judgePrompt, maxEffort, panelResult, parseBallot, reviewPrompt } from './debate.js';
import { strongestModel } from './quick.js';
import { experimentError, experimentPair, experimentRequest, guardExperimentRequests, retireExperimentPair } from './experiment-session.js';
import { seriesCeiling, seriesConfig, type SeriesInput, type SeriesJob, type SeriesMatch } from './series.js';
const configKey = (p: ProviderConfig) => JSON.stringify([p.provider, p.model, p.auth, p.effort ?? null, p.speed ?? null]);
export class SeriesRunner {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(private service: AvAService) {
    for (const job of this.jobs()) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.error = 'The service restarted. Uncertain matches were not resent.'; this.save(job); }
  }
  get busy() { return this.active.size > 0; }
  jobs(): SeriesJob[] { return this.service.store.db.prepare('SELECT data FROM series_jobs ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(String(r.data))); }
  get(id: string): SeriesJob { const r = this.service.store.db.prepare('SELECT data FROM series_jobs WHERE id=?').get(id); if (!r) throw new AvAError('NOT_FOUND', 'Series not found.'); return JSON.parse(String(r.data)); }
  private save(job: SeriesJob) { job.updatedAt = new Date().toISOString(); this.service.store.db.prepare('INSERT INTO series_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job)); }
  start(input: SeriesInput) {
    if (this.busy || this.service.puzzles.busy || this.service.benchmarks.busy) throw new AvAError('SERIES_BUSY', 'Another series, puzzle comparison or benchmark is running.');
    if (!Number.isInteger(input.pairs) || input.pairs < 1 || input.pairs > 10) throw new AvAError('SERIES_PAIRS', 'Choose 1–10 pairs of matches.');
    const first = seriesConfig(input, 0); if (input.kind === 'game') input = { ...input, game: first.game, internet: false };
    const limit = this.service.resources.limit;
    if (limit && this.service.resources.active().length + 2 > limit) throw new AvAError('SERIES_CAPACITY', 'A series needs two free agent slots. Stop agents or raise the limit in Resources.');
    // Source runs under tsx in tests, emitted JS in packaged builds; fingerprint the code actually being executed.
    const hash = createHash('sha256'); for (const name of ['games/chess', 'games/checkers', 'games/go', 'games/crosscurrent', 'debate', 'types', 'series']) {
      const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'; hash.update(readFileSync(new URL(`./${name}.${extension}`, import.meta.url)));
    }
    const job: SeriesJob = { id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: '', status: 'queued', input: structuredClone(input), version: packageVersion, engineVersion: hash.digest('hex').slice(0, 16), simulation: this.service.mode === 'simulation', requestCeiling: seriesCeiling(input), requestsAdmitted: 0, matches: [] };
    this.save(job); const abort = new AbortController(), done = Promise.resolve().then(() => this.drive(job, abort.signal)).finally(() => this.active.delete(job.id));
    this.active.set(job.id, { abort, done }); void done.catch(() => {}); return this.get(job.id);
  }
  cancel(id: string) { const job = this.get(id); this.active.get(id)?.abort.abort(new AvAError('CANCELLED', 'Series cancelled.')); if (job.current?.runId) this.service.engine.stop(job.current.runId); return { id, status: this.active.has(id) ? 'cancelling' : job.status }; }
  cancelAll() { for (const id of this.active.keys()) this.cancel(id); }
  async shutdown() { this.cancelAll(); await Promise.allSettled([...this.active.values()].map(x => x.done)); }
  private async judge(job: SeriesJob, run: Run, panel: Partial<Record<Seat, PanelBallot>>, signal: AbortSignal, admitted: () => void): Promise<Judgment> {
    const config = job.resolvedJudge!, startedAt = new Date().toISOString(), pair = this.service.store.createPair(`benchmark-experiment-judge-${job.id}-${job.current!.index}`);
    const cancel = () => this.service.activation.cancel(pair.id, 'cli1'); signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted(); await this.service.activation.configure(pair.id, 'cli1', config); this.service.store.setSlotInternet(pair.id, 'cli1', true);
      admitted(); await this.service.activation.activate(pair.id, 'cli1', config); signal.throwIfAborted();
      const participant = this.service.activation.get(pair.id, 'cli1')!;
      if (configKey(participant.accepted) !== configKey(config)) throw new Error('The judge accepted different settings; the series was stopped.');
      const names = SEATS.flatMap(s => [run.participants![s].model, run.participants![s].modelName ?? '']);
      const blind = blindDebate(run.config, this.service.store.messages(run.id), names); admitted();
      const answer = await experimentRequest(participant, judgePrompt(run.config, blind.messages, 'Use web searches to verify material factual claims when needed.'), signal, 1200000);
      return { status: 'done', judge: participant.accepted, startedAt, finishedAt: new Date().toISOString(), ...parseBallot(answer.answer, run.config.stances!), panel, blind: { redacted: blind.redacted } };
    } finally { signal.removeEventListener('abort', cancel); await retireExperimentPair(this.service, pair.id); }
  }
  private async drive(job: SeriesJob, signal: AbortSignal) {
    const admitted = () => { signal.throwIfAborted(); if (job.requestsAdmitted >= job.requestCeiling) throw new Error('Series request ceiling reached.'); job.requestsAdmitted++; this.save(job); };
    job.status = 'running'; this.save(job);
    try {
      if (job.input.kind === 'debate') {
        const provider = job.input.judge ?? 'claude', catalog = await this.service.catalog(provider), model = strongestModel(provider, catalog.models);
        if (!model) throw new Error('The judge listed no model.');
        const controls = model.id === catalog.currentModel ? catalog.controls : (await this.service.catalog(provider, model.id)).controls, effort = maxEffort(controls);
        job.resolvedJudge = { provider, model: model.id, modelName: model.name, auth: 'provider-login', ...(effort ? { effort } : {}) }; this.save(job);
      }
      for (let index = 0; index < job.input.pairs * 2; index++) {
        signal.throwIfAborted(); job.current = { index, phase: 'Activating fresh sessions' }; this.save(job);
        const config = seriesConfig(job.input, index), pair = await experimentPair(this.service, `${job.id}-${index}`, job.resolvedAgents ?? job.input.agents, signal, admitted, { cli1: job.input.internet, cli2: job.input.internet });
        job.current.pairId = pair.id; this.save(job); let run: Run | undefined, retired = false;
        const cancel = () => { if (run) this.service.engine.stop(run.id); void this.service.activation.closePair(pair.id).catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
        try {
          const actual = { cli1: pair.slots.cli1.config!, cli2: pair.slots.cli2.config! };
          if (job.resolvedAgents && SEATS.some(s => configKey(actual[s]) !== configKey(job.resolvedAgents![s]))) throw new Error('An agent accepted different settings; the series was stopped.');
          job.resolvedAgents ??= actual; this.save(job);
          // All briefs, moves/speeches and reviews pass through this request counter.
          for (const seat of SEATS) guardExperimentRequests(this.service.activation.get(pair.id, seat)!, signal, admitted);
          job.current.phase = 'Briefing players'; this.save(job);
          const { topic, ...options } = config;
          run = await this.service.call('run.start', { pairId: pair.id, text: topic, requestId: `${job.id}-${index}`, options }) as Run;
          job.current.runId = run.id; job.current.phase = job.input.kind === 'game' ? 'Playing' : 'Debating'; this.save(job);
          while (['running', 'pausing', 'paused', 'stopping'].includes(this.service.store.run(run.id).status)) { signal.throwIfAborted(); await new Promise(r => setTimeout(r, 100)); }
          run = this.service.engine.snapshot(run.id); signal.throwIfAborted();
          if (run.status !== 'completed' || !(job.input.kind === 'game' ? run.game?.result : run.reason === 'rounds_done')) throw new Error(`Match ended with ${run.reason ?? run.status}. No retry was sent.`);
          let judgment: Judgment | undefined;
          if (job.input.kind === 'debate') {
            job.current.phase = 'Participant reviews'; this.save(job);
            const panel: Partial<Record<Seat, PanelBallot>> = {};
            for (const seat of SEATS) {
              const answer = await experimentRequest(this.service.activation.get(pair.id, seat)!, reviewPrompt(run.config, seat), signal, 1200000);
              panel[seat] = { status: 'done', ...parseBallot(answer.answer, run.config.stances!) };
            }
            await retireExperimentPair(this.service, pair.id); retired = true; signal.throwIfAborted();
            job.current.phase = 'Independent judge'; this.save(job); judgment = await this.judge(job, run, panel, signal, admitted);
            this.service.store.updateRun(run.id, r => { r.judgment = judgment; });
          }
          const verdict = job.input.kind === 'game' ? run.game!.result! : panelResult(judgment)!;
          const match: SeriesMatch = { index, pair: Math.floor(index / 2), first: index % 2 ? 'cli2' : 'cli1', status: 'completed', winner: verdict.winner, reason: job.input.kind === 'game' ? run.game!.result!.reason : judgment!.reason ?? 'Panel verdict', runId: run.id, participants: actual, moves: this.service.store.messages(run.id).filter(m => m.sender !== 'user' && m.state === 'committed').map(m => m.text), config: run.config, elapsedMs: run.elapsedMs, ...(run.game ? { illegal: run.game.illegal } : {}), ...(judgment ? { judgment } : {}) };
          match.threadId = threadKey(run.pairId, run.sessions); job.matches.push(match); this.save(job);
        } catch (error) {
          if (run) { const saved = this.service.engine.snapshot(run.id); job.matches.push({ index, pair: Math.floor(index / 2), first: index % 2 ? 'cli2' : 'cli1', status: 'failed', reason: experimentError(error), runId: run.id, participants: saved.participants!, moves: this.service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text), config: saved.config, elapsedMs: saved.elapsedMs }); this.save(job); }
          throw error;
        } finally { signal.removeEventListener('abort', cancel); if (!retired) await retireExperimentPair(this.service, pair.id); }
      }
      job.status = 'completed'; delete job.current;
    } catch (error) { job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = experimentError(error); }
    this.save(job);
  }
}
