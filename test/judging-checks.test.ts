import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { JudgingChecks } from '../src/judging-checks.js';
import { SimulationFactory } from '../src/simulation.js';
import { orderCheckPrompt, panelResult } from '../src/debate.js';
import { conversationConfig, type JudgmentOrderCheck, type Pair } from '../src/types.js';
import { tempDir } from './temp.js';
class CheckFactory extends SimulationFactory {
  checks: string[] = []; sessions: string[] = []; hang = false; malformed = false;
  override async open(...args: Parameters<SimulationFactory['open']>) {
    const p = await super.open(...args), original = p.request.bind(p);
    p.request = async request => {
      if (!request.text.includes('Group presentation order is NOT')) return original(request);
      request.onStarted(); this.checks.push(request.text); this.sessions.push(p.sessionId);
      if (this.malformed) return { status: 'completed', text: 'Not a ballot.' };
      if (this.hang) return new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: '' }), { once: true }));
      const first = request.text.indexOf('\n\nProposition:\n') < request.text.indexOf('\n\nOpposition:\n') ? 'proposition' : 'opposition';
      return { status: 'completed', text: JSON.stringify({ scores: { proposition: { evidence: 3, clash: 3, stance: 3 }, opposition: { evidence: 3, clash: 3, stance: 3 } }, winner: first, reason: 'Synthetic position-biased judge.' }) };
    };
    return p;
  }
}
const until = async (check: () => boolean) => { for (let i = 0; i < 600 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check()); };
async function fixture() {
  const factory = new CheckFactory(1), service = new AvAService(tempDir('ava-order-check-'), factory, 'simulation');
  const pair = await service.call('pair.create', { thread: 'judge-checks' }) as Pair;
  for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
  const { run } = service.store.start(pair.id, conversationConfig('Check a motion', { stances: { cli1: 'for', cli2: 'against' }, rounds: 2 }), 'fixture');
  for (const [i, text] of ['opening-p', 'opening-o', 'closing-p', 'closing-o'].entries()) service.store.addMessage(run.id, i % 2 ? 'cli2' : 'cli1', text, 'committed', null);
  service.store.updateRun(run.id, r => { r.status = 'completed'; r.reason = 'rounds_done'; r.judgment = { status: 'done', judge: { provider: 'codex', model: 'sim-model', auth: 'provider-login' }, startedAt: new Date().toISOString(), winner: 'cli1', reason: 'Original assessment', scores: { cli1: { evidence: 4, clash: 4, stance: 4 }, cli2: { evidence: 3, clash: 3, stance: 3 } } }; });
  const p = service.store.pair(pair.id); p.activeRunId = null; service.store.savePair(p);
  return { service, factory, run: service.store.run(run.id), close: async () => { await service.shutdown(); service.store.close(); } };
}
test('K5: reversing presentation preserves every speech, round and original speaking-order marker', async () => {
  const { service, run, close } = await fixture();
  try {
    const messages = service.store.messages(run.id), a = orderCheckPrompt(run.config, messages, 'cli1', ''), b = orderCheckPrompt(run.config, messages, 'cli2', '');
    for (const prompt of [a, b]) for (const [i, word] of ['opening-p', 'opening-o', 'closing-p', 'closing-o'].entries()) assert.ok(prompt.includes(`original speaking order ${i + 1}:\n${word}`));
    assert.ok(a.indexOf('opening-p') < a.indexOf('opening-o')); assert.ok(b.indexOf('opening-o') < b.indexOf('opening-p'));
    assert.ok(b.indexOf('opening-p') < b.indexOf('closing-p'));
  } finally { await close(); }
});
test('K5: paired fresh judge sessions reveal a changed verdict without changing the original vote', async () => {
  const { service, factory, run, close } = await fixture();
  try {
    const old = structuredClone(run.judgment), params = { runId: run.id, requestId: 'check' };
    const [a, b] = await Promise.all([service.call('debate.checkOrder', params), service.call('debate.checkOrder', params)]) as JudgmentOrderCheck[];
    assert.equal(a!.id, b!.id);
    await until(() => service.store.run(run.id).judgment!.orderChecks?.at(-1)?.status === 'done');
    const saved = service.store.run(run.id).judgment!, check = saved.orderChecks!.at(-1)!;
    assert.equal(check.requestsAdmitted, 4); assert.equal(check.consistent, false); assert.equal(new Set(factory.sessions).size, 2);
    assert.deepEqual(check.ballots.map(b => b.winner), ['cli1', 'cli2']); assert.equal(saved.winner, old!.winner); assert.deepEqual(saved.scores, old!.scores); assert.equal(panelResult(saved)!.winner, old!.winner);
    assert.equal(service.resources.active().length, 2);
  } finally { await close(); }
});
test('K5: cancellation and restart preserve partial diagnostics and never resend uncertain judging', async () => {
  const { service, factory, run, close } = await fixture();
  try {
    factory.hang = true; await service.call('debate.checkOrder', { runId: run.id, requestId: 'held' });
    await until(() => factory.checks.length === 1);
    await assert.rejects(service.call('debate.judge', { runId: run.id }), /presentation-order check/);
    await service.call('debate.cancelOrderCheck', { runId: run.id, requestId: 'cancel-check' });
    await until(() => service.store.run(run.id).judgment!.orderChecks!.at(-1)!.status === 'cancelled');
    service.store.updateRun(run.id, r => { r.judgment!.orderChecks!.at(-1)!.status = 'running'; });
    new JudgingChecks(service); assert.equal(service.store.run(run.id).judgment!.orderChecks!.at(-1)!.status, 'interrupted'); assert.equal(factory.checks.length, 1);
    assert.equal(service.store.run(run.id).judgment!.winner, 'cli1');
  } finally { await close(); }
});
test('K5: an invalid first ballot stops the check before another judge request and preserves the match', async () => {
  const { service, factory, run, close } = await fixture();
  try {
    factory.malformed = true; await service.call('debate.checkOrder', { runId: run.id, requestId: 'invalid-ballot' });
    await until(() => service.store.run(run.id).judgment!.orderChecks!.at(-1)!.status === 'failed');
    const saved = service.store.run(run.id).judgment!;
    assert.equal(saved.orderChecks!.at(-1)!.requestsAdmitted, 2); assert.equal(factory.checks.length, 1); assert.equal(saved.winner, 'cli1');
  } finally { await close(); }
});
