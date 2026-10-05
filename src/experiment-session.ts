import { randomUUID } from 'node:crypto';
import type { ConfiguredParticipant } from './activation.js';
import type { AvAService } from './service.js';
import { AvAError, SEATS, type ProviderConfig, type Seat } from './types.js';

export const experimentError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/gi, '[redacted]').slice(0, 2000);
export function guardExperimentRequests(participant: ConfiguredParticipant, parent: AbortSignal, admitted: () => void) {
  const original = participant.request.bind(participant);
  participant.request = async request => {
    admitted(); const signal = AbortSignal.any([request.signal, parent]); signal.throwIfAborted();
    let cancel: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => { cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true }); });
    try { return await Promise.race([original({ ...request, signal }), aborted]); }
    finally { signal.removeEventListener('abort', cancel); }
  };
}
export async function experimentPair(service: AvAService, id: string, agents: Record<Seat, ProviderConfig>, signal: AbortSignal, admitted: () => void, internet = { cli1: false, cli2: false }) {
  signal.throwIfAborted(); const pair = service.store.createPair(`benchmark-experiment-${id}`);
  const cancel = () => { for (const seat of SEATS) service.activation.cancel(pair.id, seat); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (const seat of SEATS) {
      signal.throwIfAborted(); await service.activation.configure(pair.id, seat, agents[seat]);
      service.store.setSlotPermissions(pair.id, seat, 'ask'); service.store.setSlotInternet(pair.id, seat, internet[seat]);
      signal.throwIfAborted(); admitted(); await service.activation.activate(pair.id, seat, agents[seat]);
    }
    signal.throwIfAborted(); return service.store.pair(pair.id);
  } catch (error) { await retireExperimentPair(service, pair.id); throw error; }
  finally { signal.removeEventListener('abort', cancel); }
}
export async function retireExperimentPair(service: AvAService, pairId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([service.retireBenchmarkPair(pairId), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AvAError('EXPERIMENT_CLEANUP', 'An experiment session did not confirm cleanup. No further work was sent.')), service.closeWaitMs); })]); }
  finally { clearTimeout(timer); }
}
export async function experimentRequest(participant: ConfiguredParticipant, text: string, parent: AbortSignal, ms: number) {
  const abort = new AbortController(), signal = AbortSignal.any([parent, abort.signal]);
  signal.throwIfAborted(); const started = performance.now();
  const timer = setTimeout(() => abort.abort(new AvAError('EXPERIMENT_TIMEOUT', 'The answer exceeded its time limit.')), ms);
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); });
  try {
    const result = await Promise.race([participant.request({ id: randomUUID(), text, signal, onStarted() {}, onEvent() {} }), cancelled]);
    signal.throwIfAborted();
    if (result.status !== 'completed') throw new AvAError('EXPERIMENT_PROVIDER', 'The provider did not finish its answer. No retry was sent.');
    return { answer: result.text.slice(0, 32000), durationMs: performance.now() - started };
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}
