import { createHash, randomUUID } from 'node:crypto';
import type { AvAService } from './service.js';
import { AvAError, SEATS, type JudgmentOrderCheck } from './types.js';
import { blindDebate, orderCheckPrompt, parseBallot } from './debate.js';
import { experimentError, experimentRequest, retireExperimentPair } from './experiment-session.js';
export class JudgingChecks {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(private service: AvAService) {
    for (const row of service.store.db.prepare("SELECT id,data FROM runs WHERE data LIKE '%\"orderChecks\"%'").all()) {
      const run = JSON.parse(String(row.data));
      if (run.judgment?.orderChecks?.some((c: JudgmentOrderCheck) => c.status === 'running')) service.store.updateRun(String(row.id), r => {
        for (const check of r.judgment!.orderChecks!) if (check.status === 'running') { check.status = 'interrupted'; check.error = 'The service restarted. Uncertain judging was not resent.'; check.finishedAt = new Date().toISOString(); }
      });
    }
  }
  get busy() { return this.active.size > 0; }
  has(runId: string) { return this.active.has(runId); }
  start(runId: string) {
    const run = this.service.store.run(runId), judgment = run.judgment;
    if (!['completed', 'stopped'].includes(run.status) || !run.config.stances || judgment?.status !== 'done' || !judgment.judge.model || SEATS.some(s => judgment.panel?.[s]?.status === 'reviewing')) throw new AvAError('JUDGE_NOT_READY', 'Wait for the debate and all its ballots to finish.');
    if (this.active.has(runId)) throw new AvAError('CHECK_BUSY', 'A presentation-order check is already running for this debate.');
    const limit = this.service.resources.limit;
    if (limit && this.service.resources.active().length + 1 > limit) throw new AvAError('CHECK_CAPACITY', 'A presentation-order check needs one free agent slot.');
    const names = SEATS.flatMap(s => [run.participants?.[s].model ?? '', run.participants?.[s].modelName ?? '']);
    const blind = blindDebate(run.config, this.service.store.messages(runId), names);
    const check: JudgmentOrderCheck = { id: randomUUID(), status: 'running', judge: structuredClone(judgment.judge), startedAt: new Date().toISOString(), requestCeiling: 4, requestsAdmitted: 0, originalWinner: judgment.winner, transcriptFingerprint: createHash('sha256').update(JSON.stringify(blind.messages.map(m => [m.sender, m.text]))).digest('hex').slice(0, 16), ballots: [] };
    this.service.store.updateRun(runId, r => { (r.judgment!.orderChecks ??= []).push(check); });
    const abort = new AbortController(), done = Promise.resolve().then(() => this.drive(runId, check, blind.messages, abort.signal)).finally(() => this.active.delete(runId));
    this.active.set(runId, { abort, done }); void done.catch(() => {}); return structuredClone(check);
  }
  cancel(runId: string) { this.active.get(runId)?.abort.abort(new AvAError('CANCELLED', 'Presentation-order check cancelled.')); return { cancelling: this.active.has(runId) }; }
  cancelAll() { for (const id of this.active.keys()) this.cancel(id); }
  async shutdown() { this.cancelAll(); await Promise.allSettled([...this.active.values()].map(x => x.done)); }
  private save(runId: string, check: JudgmentOrderCheck) { this.service.store.updateRun(runId, r => { const at = r.judgment?.orderChecks?.findIndex(c => c.id === check.id) ?? -1; if (at < 0) throw new Error('The judging check no longer exists.'); r.judgment!.orderChecks![at] = structuredClone(check); }); }
  private async drive(runId: string, check: JudgmentOrderCheck, messages: import('./types.js').RoomMessage[], signal: AbortSignal) {
    const run = this.service.store.run(runId), admitted = () => { signal.throwIfAborted(); if (check.requestsAdmitted >= check.requestCeiling) throw new Error('Judging-check request ceiling reached.'); check.requestsAdmitted++; this.save(runId, check); };
    try {
      for (const first of SEATS) {
        signal.throwIfAborted(); const pair = this.service.store.createPair(`benchmark-order-check-${check.id}-${first}`);
        const cancel = () => this.service.activation.cancel(pair.id, 'cli1'); signal.addEventListener('abort', cancel, { once: true });
        try {
          await this.service.activation.configure(pair.id, 'cli1', check.judge); this.service.store.setSlotInternet(pair.id, 'cli1', true);
          admitted(); await this.service.activation.activate(pair.id, 'cli1', check.judge); signal.throwIfAborted();
          const participant = this.service.activation.get(pair.id, 'cli1')!;
          const settings = (c: typeof check.judge) => JSON.stringify([c.provider, c.model, c.effort ?? null, c.speed ?? null, c.auth]);
          if (settings(participant.accepted) !== settings(check.judge)) throw new Error('The judge accepted different settings; the order check was stopped.');
          admitted(); const reply = await experimentRequest(participant, orderCheckPrompt(run.config, messages, first, 'Web search is available to verify material factual claims. Do not infer the authors’ identities.'), signal, 1200000);
          const ballot = parseBallot(reply.answer, run.config.stances!);
          check.ballots.push({ first, winner: ballot.winner!, scores: ballot.scores!, reason: ballot.reason ?? '' }); this.save(runId, check);
        } finally { signal.removeEventListener('abort', cancel); await retireExperimentPair(this.service, pair.id); }
      }
      check.status = 'done'; check.consistent = check.ballots[0]!.winner === check.ballots[1]!.winner;
    } catch (error) { check.status = signal.aborted ? 'cancelled' : 'failed'; check.error = experimentError(error); }
    check.finishedAt = new Date().toISOString(); this.save(runId, check);
  }
}
