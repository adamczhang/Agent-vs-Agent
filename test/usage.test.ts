import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { NativeParticipant } from '../src/providers.js';
import { parseCredits } from '../src/gateway.js';
import { SimulationFactory } from '../src/simulation.js';
import type { Pair } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

// A stand-in for the ACPX runtime: one turn that streams the given events, then a session record with usage totals.
function fakeRuntime(events: unknown[], usage?: unknown) {
  return {
    startTurn: () => ({ promptStarted: Promise.resolve(), events: (async function* () { for (const e of events) yield e; })(), result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }), cancel: async () => {} }),
    getStatus: async () => ({ agentSessionId: 'session-1', usage }),
    setConfigOption: async () => ({ configOptions: [] }),
  } as never;
}
test('an agent’s usage reports feed the context ring instead of its activity', async () => {
  const runtime = fakeRuntime([
    { type: 'status', text: 'usage updated: 142300/258400', tag: 'usage_update', used: 142_300, size: 258_400 },
    { type: 'text_delta', text: 'Hello', stream: 'output' },
  ], { cumulative: { inputTokens: 1_200_000, outputTokens: 34_100, cachedReadTokens: 900_000 }, cost: { amount: 0.42, currency: 'USD' } });
  const participant = new NativeParticipant(runtime, { agentSessionId: 'session-1' } as never, { provider: 'claude', model: 'm', auth: 'provider-login' }, 'evidence');
  const seen: string[] = [];
  const result = await participant.request({ id: 'r1', text: 'hi', signal: new AbortController().signal, onStarted() {}, onEvent(e) { seen.push(`${e.type}:${e.text}`); } });
  assert.equal(result.text, 'Hello');
  assert.ok(!seen.some(s => s.includes('usage updated')), 'not an activity line');
  const usage = participant.usage()!;
  assert.deepEqual(usage.context, { used: 142_300, size: 258_400 });
  assert.deepEqual(usage.tokens, { input: 1_200_000, output: 34_100, cachedRead: 900_000, total: undefined });
  assert.deepEqual(usage.cost, { amount: 0.42, currency: 'USD' });
});

test('the room shows each active agent’s latest usage, and nothing for an agent that isn’t active', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-usage-'), factory, 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'usage' }) as Pair;
    await service.call('slot.configure', { pairId: pair.id, seat: 'cli1', config: { provider: 'claude', model: 'model', auth: 'provider-login' } });
    await service.call('slot.activate', { pairId: pair.id, seat: 'cli1' }); await flush();
    const agent = factory.agents[0]! as typeof factory.agents[number] & { usage?: () => unknown };
    let view = (await service.call('pair.get', { pairId: pair.id })) as Pair & { usage: Record<string, unknown> };
    assert.deepEqual(view.usage, { cli1: null, cli2: null }, 'no report yet');
    agent.usage = () => ({ context: { used: 50_000, size: 200_000 }, at: 1 });
    view = (await service.call('pair.get', { pairId: pair.id })) as typeof view;
    assert.deepEqual(view.usage, { cli1: { context: { used: 50_000, size: 200_000 }, at: 1 }, cli2: null });
  } finally { await service.shutdown(); service.store.close(); }
});

test('the Gateway’s credit answer is read defensively', () => {
  assert.deepEqual(parseCredits({ balance: '23.34', total_used: '1.66' }), { balance: 23.34, used: 1.66 });
  assert.deepEqual(parseCredits({ balance: 5 }), { balance: 5 });
  assert.equal(parseCredits({ error: 'unauthorized' }), undefined);
  assert.equal(parseCredits(null), undefined);
});

test('simulated agents report a context window that grows with each reply', async () => {
  const factory = new SimulationFactory(5), agent = await factory.open({ provider: 'codex', model: 'm', auth: 'provider-login' }, { seat: 'cli2' });
  const before = agent.usage!()!.context!.used;
  await agent.request({ id: 'r', text: 'You are cli2 in a real two-agent conversation', signal: new AbortController().signal, onStarted() {}, onEvent() {} });
  assert.ok(agent.usage!()!.context!.used > before);
});
