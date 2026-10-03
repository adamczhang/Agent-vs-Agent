// Child process for test/crash.test.ts. Runs a real controller on a file database and exits with
// code 137 the moment Store reaches the requested fault point, so nothing after it executes.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConversationController } from '../src/controller.js';
import { Store } from '../src/store.js';
import { conversationConfig, SEATS, type AgentRequest, type AgentResult, type Participant, type Seat } from '../src/types.js';

const [dir, point, occurrence] = process.argv.slice(2) as [string, string, string];
const log = (entry: unknown) => appendFileSync(join(dir, 'worker.jsonl'), JSON.stringify(entry) + '\n');
let hits = 0;
const store = new Store(join(dir, 'ava.sqlite'));
store.faults = reached => {
  if (reached !== point || ++hits !== Number(occurrence)) return;
  log({ type: 'crash', point, occurrence: hits });
  process.exit(137);
};
class AutoParticipant implements Participant {
  private replies = 0;
  constructor(readonly sessionId: string, private readonly seat: Seat) {}
  async request(request: AgentRequest): Promise<AgentResult> {
    // Logged first: from here on the provider has the prompt, even if the process dies inside onStarted.
    log({ type: 'request', seat: this.seat, turnId: request.id });
    request.onStarted();
    await new Promise(resolve => setImmediate(resolve));
    return { status: 'completed', text: JSON.stringify({ message: `${this.seat} reply ${++this.replies}`, stop_requested: false, stop_reason: null }) };
  }
  async close() {}
}
const pair = store.createPair('crash');
const participants = { cli1: new AutoParticipant('session-1', 'cli1'), cli2: new AutoParticipant('session-2', 'cli2') };
for (const seat of SEATS) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.generation = 1; s.sessionId = participants[seat].sessionId; s.verifiedAt = 1; });
const engine = new ConversationController(store);
const run = engine.start(pair.id, conversationConfig('Crash topic', { completion: 'duration', durationMs: 600_000, maxRequests: 6, perTurnMs: 60_000, paceMs: 0 }), 'start', participants);
log({ type: 'started', runId: run.id, pairId: pair.id });
const deadline = Date.now() + 20_000;
while (!['completed', 'stopped', 'needs_attention'].includes(store.run(run.id).status)) {
  if (Date.now() > deadline) { log({ type: 'timeout' }); process.exit(2); }
  await new Promise(resolve => setTimeout(resolve, 5));
}
log({ type: 'done', status: store.run(run.id).status, reason: store.run(run.id).reason });
store.close();
