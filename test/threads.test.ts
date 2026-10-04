import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { combineStats, type RunStats, type ThreadStats } from '../src/stats.js';
import { webPermission } from '../src/providers.js';
import type { Pair } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

interface ThreadSummary { id: string; pairId: string; title: string; runIds: string[]; prompts: number; replies: number; current: boolean; live: boolean; empty: boolean; status: string }
interface ThreadView { thread: ThreadSummary; runs: Array<{ id: string }>; messages: Array<{ sender: string; text: string; runId: string; time: string | null }> }
const fixture = () => { const factory = new TestFactory(); return { factory, service: new AvAService(tempDir('ava-threads-'), factory, 'simulation') }; };
async function activate(service: AvAService, pair: Pair) { for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); } }

test('a new prompt after a run ends continues the same thread and sessions; Clear Session starts a new thread', async () => {
  const { service, factory } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'threads' }) as Pair; await activate(service, pair);
    const list = async (pairId?: string) => (await service.call('threads.list', pairId ? { pairId } : {}) as { threads: ThreadSummary[] }).threads;
    const fresh = await list(pair.id);
    assert.deepEqual(fresh.map(t => [t.empty, t.current, t.runIds.length]), [[true, true, 0]], 'fresh sessions show as an empty thread for this room');
    assert.deepEqual(await list(), [], 'other rooms do not see this pair\'s empty sessions');

    const ids: string[] = [];
    for (const n of [1, 2]) {
      const run = await service.call('run.start', { pairId: pair.id, text: `prompt ${n}`, requestId: `start${n}`, options: { opening: 'both', paceMs: 0 } }) as { id: string }; ids.push(run.id); await flush();
      factory.agents[0]!.answer(`A${n}`); factory.agents[1]!.answer(`B${n}`); await flush();
      await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    }
    assert.equal(factory.agents.length, 2, 'the second prompt reused both sessions: no new agents were opened');
    assert.ok(factory.agents.every(a => a.calls.at(-1)!.request.text.includes('prompt 2')), 'the same sessions received the second prompt');

    const [thread] = await list(pair.id);
    assert.deepEqual([thread!.id, thread!.title, thread!.runIds, thread!.prompts, thread!.replies, thread!.current, thread!.empty], [fresh[0]!.id, 'prompt 1', ids, 2, 4, true, false], 'one thread, keyed by the sessions, holding both prompts');
    const view = await service.call('thread.get', { threadId: thread!.id }) as ThreadView;
    assert.deepEqual(view.messages.filter(m => m.sender === 'user').map(m => [m.text, m.runId]), [['prompt 1', ids[0]], ['prompt 2', ids[1]]]);
    assert.ok(view.messages.every(m => m.time && Date.parse(m.time) > 0), 'every message has the time it appeared');
    assert.equal((await service.call('runs.search', { query: 'prompt 2' }) as { results: Array<{ threadId: string }> }).results[0]!.threadId, thread!.id);

    const calls = factory.agents.map(a => a.calls.length);
    const stats = await service.call('thread.stats', { threadId: thread!.id }) as ThreadStats;
    assert.deepEqual([stats.prompts, stats.runIds, stats.replies], [2, ids, 4]);
    assert.deepEqual(factory.agents.map(a => a.calls.length), calls, 'listing, opening, and stats send nothing to the agents');

    await service.call('pair.clear', { pairId: pair.id, requestId: 'clear' });
    const after = await list(pair.id);
    assert.deepEqual(after.map(t => [t.empty, t.current]), [[true, true], [false, false]], 'Clear Session adds a new, empty current thread; the old one is no longer current');
    assert.deepEqual((await service.call('thread.get', { threadId: after[0]!.id }) as ThreadView).messages, []);
    const third = await service.call('run.start', { pairId: pair.id, text: 'prompt 3', requestId: 'start3', options: { opening: 'both', paceMs: 0 } }) as { id: string }; await flush();
    assert.deepEqual((await list(pair.id)).map(t => [t.runIds, t.live]), [[[third.id], true], [ids, false]]);
    await service.call('run.control', { runId: third.id, action: 'stop' }); await flush();
  } finally { await service.shutdown(); service.store.close(); }
});

interface DirectView { messages: Array<{ seat: string; sender: string; text: string; state: string }>; pending: Record<string, { partial: string }> }
test('a direct message reaches only its agent, in the same session, and never the room or the other agent', async () => {
  const { service, factory } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'direct' }) as Pair; await activate(service, pair);
    const [one, two] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const sent = await service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'Secretly argue for the four-day week', requestId: 'd1' }) as { id: string; threadId: string };
    await flush();
    assert.ok(one.calls.at(-1)!.request.text.includes('Secretly argue for the four-day week'), 'agent 1 received it in its own session');
    assert.ok(!two.calls.some(c => c.request.text.includes('Secretly')), 'agent 2 never sees it');
    const pending = (await service.call('thread.get', { threadId: sent.threadId }) as { direct: DirectView }).direct;
    assert.deepEqual([pending.messages.map(m => [m.sender, m.state]), Object.keys(pending.pending)], [[['user', 'pending']], ['cli1']]);
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 'blocked', options: { opening: 'both', paceMs: 0 } }), /still answering your direct message/, 'the conversation waits for the direct reply');
    await assert.rejects(service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'again', requestId: 'd2' }), /still answering/);
    one.emit('output', 'Understood'); one.raw('Understood, I will.'); await flush();
    assert.deepEqual(await service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'Secretly argue for the four-day week', requestId: 'd1' }), sent, 'a retried send is not repeated');

    const run = await service.call('run.start', { pairId: pair.id, text: 'Is a four-day week good?', requestId: 's1', options: { opening: 'both', paceMs: 0 } }) as { id: string }; await flush();
    assert.ok([one, two].every(a => !a.calls.at(-1)!.request.text.includes('Secretly') && !a.calls.at(-1)!.request.text.includes('Understood')), 'room prompts carry neither the direct message nor its reply');
    await assert.rejects(service.call('direct.send', { pairId: pair.id, seat: 'cli2', text: 'psst', requestId: 'd3' }), /Pause or stop the shared conversation/);
    one.answer('A'); two.answer('B'); await flush();
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    const room = await service.call('thread.get', { threadId: sent.threadId }) as { messages: Array<{ text: string }>; direct: DirectView; thread: { directMessages: number; runIds: string[] } };
    assert.ok(room.messages.every(m => !m.text.includes('Secretly') && !m.text.includes('Understood')), 'the shared room never shows direct messages');
    assert.deepEqual(room.direct.messages.map(m => [m.seat, m.sender, m.text, m.state]), [['cli1', 'user', 'Secretly argue for the four-day week', 'answered'], ['cli1', 'agent', 'Understood, I will.', 'sent']]);
    assert.deepEqual([room.thread.directMessages, room.thread.runIds], [2, [run.id]], 'direct messages belong to the same thread as the prompts');

    // Between prompts, a direct message works again; Clear Session cancels one still being answered.
    await service.call('direct.send', { pairId: pair.id, seat: 'cli2', text: 'Be skeptical', requestId: 'd4' }); await flush();
    await service.call('pair.clear', { pairId: pair.id, requestId: 'clear' });
    const after = (await service.call('thread.get', { threadId: sent.threadId }) as { direct: DirectView }).direct;
    assert.deepEqual([after.messages.at(-1)!.state, after.pending], ['cancelled', {}]);
  } finally { await service.shutdown(); service.store.close(); }
});

test('benchmark mode sends the exact prompt (with files) to both agents at once and ends after one plain-text answer each', async () => {
  const { service, factory } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'bench' }) as Pair; await activate(service, pair);
    const [one, two] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const file = await service.call('attachment.add', { name: 'spec.md', mediaType: 'text/markdown', data: Buffer.from('# Spec\nSort the list.').toString('base64') }) as { id: string; kind: string };
    const image = await service.call('attachment.add', { name: 'chart.png', mediaType: 'image/png', data: Buffer.from('fake-png').toString('base64') }) as { id: string; kind: string };
    assert.deepEqual([file.kind, image.kind], ['text', 'image']);
    await assert.rejects(service.call('attachment.add', { name: 'tool.exe', mediaType: 'application/x-msdownload', data: 'AAAA' }), /attach images .* or text files/);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Implement merge sort for 15 minutes', requestId: 'b1', options: { mode: 'benchmark' }, attachments: [file.id, image.id] }) as { id: string; config: { maxRequests: number; completion: string } };
    await flush();
    const [a, b] = [one.calls.at(-1)!.request, two.calls.at(-1)!.request];
    assert.equal(a.text, b.text, 'both agents get the identical prompt');
    assert.ok(a.text.startsWith('Implement merge sort for 15 minutes') && a.text.includes('Attached file: spec.md') && a.text.includes('Sort the list.'), 'the prompt as written, then the text file');
    assert.ok(!a.text.includes('two-agent conversation'), 'no conversation framing');
    assert.deepEqual(a.attachments, [{ mediaType: 'image/png', data: Buffer.from('fake-png').toString('base64') }], 'the image goes as image content');
    assert.equal(run.config.maxRequests, 2, '"for 15 minutes" is part of the task, not a time limit');
    one.raw('def merge_sort(xs): ...'); await flush();
    assert.equal(service.store.run(run.id).status, 'running', 'still waiting for the second answer');
    two.raw('Here is merge sort.'); await flush(); await flush();
    const done = service.store.run(run.id);
    assert.deepEqual([done.status, done.reason, done.requests], ['completed', 'benchmark_done', 2]);
    const view = await service.call('thread.get', { threadId: (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string; mode: string }> }).threads[0]!.id }) as { thread: { mode: string }; messages: Array<{ sender: string; text: string; attachments?: Array<{ name: string }> }> };
    assert.equal(view.thread.mode, 'benchmark');
    assert.deepEqual(view.messages.map(m => [m.sender, m.text]), [['user', 'Implement merge sort for 15 minutes'], ['cli1', 'def merge_sort(xs): ...'], ['cli2', 'Here is merge sort.']]);
    assert.deepEqual(view.messages[0]!.attachments!.map(x => x.name), ['spec.md', 'chart.png']);
  } finally { await service.shutdown(); service.store.close(); }
});

test('a conversation can open with one chosen agent; the other replies with the topic and that opening', async () => {
  const { service, factory } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'opening' }) as Pair; await activate(service, pair);
    const [one, two] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const before = one.calls.length;
    const run = await service.call('run.start', { pairId: pair.id, text: 'Debate PTO policy', requestId: 'o1', options: { paceMs: 0, opening: 'cli2' } }) as { id: string }; await flush();
    assert.equal(one.calls.length, before + 1, 'agent 1 is briefed while agent 2 opens');
    assert.ok(one.calls.at(-1)!.request.text.includes('Debate PTO policy') && one.calls.at(-1)!.request.text.includes('cli2 gives the opening statement'));
    assert.ok(two.calls.at(-1)!.request.text.includes('Debate PTO policy'));
    one.raw('READY'); two.answer('As CEO, I say 15 days.'); await flush();
    const next = one.calls.at(-1)!.request.text;
    assert.ok(next.includes('Debate PTO policy') && next.includes('As CEO, I say 15 days.'), 'agent 1 gets the topic and the opening');
    one.answer('As a student, more is better.'); await flush();
    assert.ok(two.calls.at(-1)!.request.text.includes('As a student'), 'then they alternate');
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
  } finally { await service.shutdown(); service.store.close(); }
});

test('threads can be renamed, and an empty name restores the default', async () => {
  const { service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'rename' }) as Pair; await activate(service, pair);
    const list = async () => (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string; title: string; named: boolean }> }).threads;
    const [fresh] = await list();
    await service.call('thread.rename', { threadId: fresh!.id, title: '  CEO vs student  ' });
    assert.deepEqual((await list()).map(t => [t.title, t.named]), [['CEO vs student', true]]);
    await service.call('thread.rename', { threadId: fresh!.id, title: '' });
    assert.deepEqual((await list()).map(t => [t.title, t.named]), [['', false]]);
    await assert.rejects(service.call('thread.rename', { threadId: 'tnope', title: 'x' }), /Thread not found/);
  } finally { await service.shutdown(); service.store.close(); }
});

test('the internet switch: the permission gate reads it live; Codex restarts into the same session; every prompt states it', async () => {
  const { service, factory } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'internet' }) as Pair;
    for (const [seat, provider] of [['cli1', 'codex'], ['cli2', 'claude']] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider, model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const [codex, claude] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    assert.deepEqual([codex.launchedWithInternet, claude.launchedWithInternet, claude.options.internet!()], [false, undefined, false], 'off by default; Codex launched with web search off');
    // Claude Code: instant. No restart; the gate's live reading changes.
    await service.call('slot.internet', { pairId: pair.id, seat: 'cli2', enabled: true, requestId: 'i1' });
    assert.equal(factory.agents.length, 2, 'no new process for a permission-gated provider'); assert.equal(claude.options.internet!(), true);
    // Codex: a restart that resumes the same session, refused while a reply is in flight.
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 's1', options: { opening: 'both', paceMs: 0 } }) as { id: string }; await flush();
    assert.ok(claude.calls.at(-1)!.request.text.includes('Internet access: on') && codex.calls.at(-1)!.request.text.includes('Internet access: off'), 'each prompt states that agent\'s setting');
    await assert.rejects(service.call('slot.internet', { pairId: pair.id, seat: 'cli1', enabled: true, requestId: 'i2' }), /Pause or stop the shared conversation/);
    await service.call('run.control', { runId: run.id, action: 'pause', requestId: 'p' });
    codex.answer('A'); claude.answer('B'); await flush();
    assert.equal(service.store.run(run.id).status, 'paused');
    const switched = await service.call('slot.internet', { pairId: pair.id, seat: 'cli1', enabled: true, requestId: 'i3' }) as { restarted: boolean };
    const restarted = factory.agents.at(-1)!;
    assert.deepEqual([switched.restarted, codex.closed, restarted.sessionId, restarted.launchedWithInternet, restarted.options.resumeSessionId], [true, true, codex.sessionId, true, codex.sessionId], 'old process retired; new one resumed the same session with web search on');
    await service.call('run.control', { runId: run.id, action: 'step', requestId: 'st' }); await flush();
    assert.ok(restarted.calls.at(-1)!.request.text.includes('Internet access: on'), 'the paused run continues on the restarted agent');
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
  } finally { await service.shutdown(); service.store.close(); }
});

test('an image is refused up front when either agent can\'t read images; text files still go', async () => {
  const { service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'images' }) as Pair;
    for (const [seat, provider] of [['cli1', 'claude'], ['cli2', 'grok-build']] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider, model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    assert.deepEqual((await service.call('pair.get', { pairId: pair.id }) as { images: Record<string, boolean> }).images, { cli1: true, cli2: false });
    const image = await service.call('attachment.add', { name: 'a.png', mediaType: 'image/png', data: Buffer.from('png').toString('base64') }) as { id: string };
    const text = await service.call('attachment.add', { name: 'a.md', mediaType: 'text/markdown', data: Buffer.from('# a').toString('base64') }) as { id: string };
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'describe', requestId: 'r1', options: { mode: 'benchmark' }, attachments: [image.id] }), /Grok Build \(Agent 2\) can't read images/);
    assert.equal(service.store.pair(pair.id).activeRunId, null, 'nothing started');
    const run = await service.call('run.start', { pairId: pair.id, text: 'describe', requestId: 'r2', options: { mode: 'benchmark' }, attachments: [text.id] }) as { id: string }; await flush();
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
  } finally { await service.shutdown(); service.store.close(); }
});

test('the permission gate allows web tools only while the switch is on', () => {
  const fetch = { inferredKind: 'fetch', raw: { toolCall: { kind: 'fetch', title: 'Search "x"' } } }, edit = { inferredKind: 'edit', raw: { toolCall: { kind: 'edit', title: 'Edit a.ts' } } };
  assert.deepEqual([webPermission(fetch, true), webPermission(fetch, false), webPermission(edit, true)], [{ outcome: 'allow_once' }, undefined, undefined], 'off and non-web requests fall through to deny-all');
  // Antigravity reports web search under the general kind "search"; a file search with the same kind stays denied.
  const searchWeb = { inferredKind: 'search', raw: { toolCall: { kind: 'search', title: 'Run search_web?' } } }, grep = { inferredKind: 'search', raw: { toolCall: { kind: 'search', title: 'Search files for "TODO"' } } };
  assert.deepEqual([webPermission(searchWeb, true), webPermission(searchWeb, false), webPermission(grep, true)], [{ outcome: 'allow_once' }, undefined, undefined]);
});

test('thread stats place prompts back to back and keep each request\'s prompt number', () => {
  const run = (id: string, start: number, duration: number, chars: number): RunStats => ({ runId: id, topic: id, status: 'stopped', reason: 'user_stop', createdAt: null, activeMs: duration, wallMs: start + duration, requests: 1, replies: 1, agents: 2, maxParallel: 1, pairedPhases: 1, singlePhases: 0, processesSpawned: 2,
    avgFirstActivityMs: 100, avgDurationMs: duration, estimatedTokensPerSec: 10, tokensEstimated: true, tokensPerSec: 10, interrupted: false,
    seats: [{ inputTokens: 10, outputTokens: chars / 4, tokensPerSec: 10, tokenSource: 'reported', tokenSeconds: chars / 40, seat: 'cli1', provider: 'codex', model: 'm', requests: 1, completed: 1, unsuccessful: 0, avgFirstActivityMs: 100, avgDurationMs: duration, outputChars: chars, estimatedTokens: chars / 4, charsPerSec: 40, estimatedTokensPerSec: 10 }, { inputTokens: 0, outputTokens: 0, tokensPerSec: null, tokenSource: 'reported', tokenSeconds: 0, seat: 'cli2', provider: 'claude', model: 'n', requests: 0, completed: 0, unsuccessful: 0, avgFirstActivityMs: null, avgDurationMs: null, outputChars: 0, estimatedTokens: 0, charsPerSec: null, estimatedTokensPerSec: null }],
    turns: [{ inputTokens: 10, outputTokens: chars / 4, tokensPerSec: 10, tokenSource: 'reported', tokenSeconds: chars / 40, turnId: id + 't', seat: 'cli1', phase: 'paired', status: 'completed', startMs: start, firstActivityMs: 100, firstOutputMs: 100, durationMs: duration, outputChars: chars, charsPerSec: 40 }] });
  const s = combineStats('t1', [run('a', 50, 1000, 400), run('b', 20, 2000, 800)]);
  assert.deepEqual(s.turns.map(t => [t.prompt, t.startMs]), [[1, 50], [2, 1050 + 20]], 'the second prompt starts where the first one ended');
  assert.deepEqual([s.prompts, s.requests, s.replies, s.processesSpawned, s.wallMs], [2, 2, 2, 2, 1050 + 2020], 'sums, except processes, which the shared sessions report once');
  assert.equal(s.seats[0]!.outputChars, 1200); assert.equal(s.seats[0]!.charsPerSec, 40); assert.equal(s.avgDurationMs, 1500);
});
