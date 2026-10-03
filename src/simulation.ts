import { randomUUID } from 'node:crypto';
import type { Catalog } from './providers.js';
import type { ConfiguredParticipant } from './activation.js';
import type { ServiceFactory } from './service.js';
import type { ProcessLedger } from './census.js';
import type { AgentRequest, AgentResult, ProviderConfig, Seat } from './types.js';

// Scripted participants for UI development (scripts/dev-sim.ts). No provider process, no model request.
// Each seat has its own voice (Agent 1 builds a case, Agent 2 pushes back) so simulated rooms read like two speakers.
const LINES: Record<Seat, string[]> = {
  cli1: [
    'Let me start with the strongest version of the idea, then we can test it against your doubts.',
    'The data I trust most points one way: when constraints are tight, focus beats breadth.',
    'Here is a concrete case. A five-person team cut meetings by half and shipped faster within a month.',
    'You are right that one team is an anecdote. The pattern holds across several, though not all.',
    'So let me narrow the claim: it works when the work is deep and the handoffs are few.',
    'I can accept that boundary. Where I still disagree is on how rare those conditions are.',
    'If we agree on the conditions, the remaining question is how a team would know it meets them.',
    'A simple test: if most of the week is focused work, try it for a quarter and measure.',
  ],
  cli2: [
    'Before we build on that, what would change your mind? I want us to argue about the same thing.',
    'Focus is real, but you are skipping the coordination cost that shows up a month later.',
    'That example is survivorship. The teams it failed for rarely write it up.',
    'Several teams is better. I would still want to know what they gave up to get there.',
    'That narrower claim I can mostly accept. Deep work, few handoffs, stable scope.',
    'They are rarer than they look: most teams have at least one role that is all handoffs.',
    'Measure it, yes. And decide up front what result would make you go back.',
    'Then we agree more than we disagree: it is a tool with conditions, not a default.',
  ],
};
export class SimulatedParticipant implements ConfiguredParticipant {
  readonly sessionId = 'sim-' + randomUUID();
  readonly evidence = 'simulation';
  private replies = 0;
  closed = false;
  // Simulated usage reports for the room's context ring: Agent 1 starts low, Agent 2 close to the warning threshold.
  private context: { used: number; size: number };
  private requests = 0;
  private reported = Date.now();
  usage() { return { context: { ...this.context }, tokens: { input: this.context.used * 3 + this.requests * 1200, output: this.requests * 850, cachedRead: this.context.used * 2 }, at: this.reported }; }
  constructor(readonly accepted: ProviderConfig, private readonly seat: Seat, private readonly delayMs: number) {
    this.context = { used: seat === 'cli1' ? 21_400 : 151_800, size: seat === 'cli1' ? 258_400 : 200_000 };
  }
  isConnected() { return !this.closed; }
  request(request: AgentRequest): Promise<AgentResult> {
    return new Promise(resolve => {
      const timers: Array<ReturnType<typeof setTimeout>> = [], at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
      const finish = (result: AgentResult) => {
        timers.forEach(clearTimeout);
        if (result.status === 'completed') { this.requests++; this.context.used = Math.min(this.context.size, this.context.used + (this.seat === 'cli1' ? 14_200 : 9_700)); this.reported = Date.now(); }
        resolve(result);
      };
      request.signal.addEventListener('abort', () => finish({ status: 'cancelled', text: '' }), { once: true });
      request.onStarted();
      const marker = request.text.match(/AVA_READY_[\w-]+/);
      if (marker) { at(50, () => finish({ status: 'completed', text: marker[0] })); return; }
      // A direct (1:1) message gets a plain-text acknowledgement, like a real agent would give.
      const direct = /^Private message from the operator/.test(request.text) ? request.text.split('Message:\n').at(-1)!.trim() : '';
      if (direct) {
        const reply = `Understood. I'll keep "${direct.slice(0, 80)}${direct.length > 80 ? '…' : ''}" in mind in the shared conversation, without mentioning it there. (simulated)`;
        at(this.delayMs * 0.3, () => request.onEvent({ type: 'output', text: reply.slice(0, 40) }));
        at(this.delayMs * 0.6, () => request.onEvent({ type: 'output', text: reply.slice(40) }));
        at(this.delayMs * 0.7, () => finish({ status: 'completed', text: reply }));
        return;
      }
      // A benchmark prompt arrives as the user wrote it (no conversation framing): work longer, answer in plain text.
      if (!/^You are cli[12] in a real two-agent conversation/.test(request.text)) {
        const pace = this.delayMs * (this.seat === 'cli1' ? 3 : 4.2), images = request.attachments?.length ?? 0;
        const answer = [`${this.seat === 'cli1' ? 'Here is my approach.' : 'Short answer first, then the reasoning.'} (simulated benchmark answer)`,
          `1. Restate the task: "${request.text.split('\n')[0]!.slice(0, 100)}"`, '2. Break it into steps and check each against the constraints.', '3. Summarize the result and the main risk.',
          images ? `I looked at ${images} attached image${images === 1 ? '' : 's'}.` : ''].filter(Boolean).join('\n');
        at(pace * 0.1, () => request.onEvent({ type: 'thought', text: 'Reading the task and planning an approach (simulated).' }));
        at(pace * 0.35, () => request.onEvent({ type: 'tool', text: 'scratchpad.write (simulated, read-only)' }));
        at(pace * 0.5, () => request.onEvent({ type: 'thought', text: 'Checking the steps against the constraints (simulated).' }));
        at(pace * 0.7, () => request.onEvent({ type: 'output', text: answer.slice(0, 120) }));
        at(pace * 0.9, () => request.onEvent({ type: 'output', text: answer.slice(120) }));
        at(pace, () => finish({ status: 'completed', text: answer }));
        return;
      }
      const script = LINES[this.seat], line = script[this.replies++ % script.length]!;
      at(this.delayMs * 0.2, () => request.onEvent({ type: 'thought', text: `Reading the newest room messages and planning a reply (simulated).` }));
      at(this.delayMs * 0.5, () => request.onEvent({ type: 'tool', text: 'notes.lookup (simulated, read-only)' }));
      at(this.delayMs * 0.8, () => request.onEvent({ type: 'output', text: line }));
      at(this.delayMs, () => finish({ status: 'completed', text: JSON.stringify({ message: line, stop_requested: false, stop_reason: null }) }));
    });
  }
  async close() { this.closed = true; }
}
export class SimulationFactory implements ServiceFactory {
  ledger?: ProcessLedger;
  constructor(private readonly delayMs = 900) {}
  list() { return [{ provider: 'simulation', mode: 'simulation' }]; }
  async discover(provider: ProviderConfig['provider']): Promise<Catalog> {
    return { provider, currentModel: 'sim-model', models: [{ id: 'sim-model', name: 'Simulated model' }, { id: 'sim-fast', name: 'Simulated fast model' }], controls: [{ id: 'reasoning_effort', name: 'Effort', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }] };
  }
  async open(config: ProviderConfig, scope: { seat: Seat }) { return new SimulatedParticipant(config, scope.seat, this.delayMs); }
}
