import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { DEBATE_STYLE } from '../src/controller.js';
import type { Pair } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

function fixture() {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-debate-'), factory, 'simulation');
  return { factory, service, close: async () => { await service.shutdown(); service.store.close(); } };
}
async function activate(service: AvAService, pair: Pair) {
  for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
}

test('debate turns ask for short, conversational, plain-text replies, with no word count', async () => {
  const { factory, service, close } = fixture(), pair = await service.call('pair.create', { thread: 'debate-style' }) as Pair;
  try {
    await activate(service, pair);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Should cities ban cars downtown?', requestId: 'style', options: { opening: 'cli1', paceMs: 0 } }) as { id: string }; await flush();
    const prompt = factory.agents[0]!.calls.at(-1)!.request.text;
    assert.ok(prompt.includes(DEBATE_STYLE), 'the style comes with every debate turn');
    assert.doesNotMatch(prompt, /\d+\s*[–-]\s*\d+\s*words/, 'no artificial word count');
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
  } finally { await close(); }
});

// E8: Close thread ends the thread (its run stops, its agents close) and keeps both agents' settings for the next one.
test('Close thread stops the run, closes both agents, keeps their settings, and leaves the thread in history', async () => {
  const { factory, service, close } = fixture(), pair = await service.call('pair.create', { thread: 'close-thread' }) as Pair;
  try {
    await activate(service, pair);
    await service.call('slot.permissions', { pairId: pair.id, seat: 'cli2', level: 'bypass', requestId: 'perm' }).catch(() => service.store.setSlotPermissions(pair.id, 'cli2', 'bypass'));
    const run = await service.call('run.start', { pairId: pair.id, text: 'First test topic', requestId: 'first', options: { opening: 'cli1', paceMs: 0 } }) as { id: string }; await flush();
    const closed = await service.call('pair.close', { pairId: pair.id, requestId: 'close-1' }) as Pair;
    assert.equal(service.store.run(run.id).status, 'stopped'); assert.equal(closed.activeRunId, null);
    assert.ok(factory.agents.every(a => a.closed), 'both agents closed');
    assert.deepEqual(['cli1', 'cli2'].map(s => [closed.slots[s as 'cli1'].state, closed.slots[s as 'cli1'].config?.model, closed.slots[s as 'cli1'].sessionId]), [['configuring', 'model', null], ['configuring', 'model', null]], 'settings kept, sessions gone');
    assert.equal(closed.slots.cli2.permissions, 'bypass', 'permissions kept');
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ title: string; empty: boolean }> }).threads;
    assert.ok(threads.some(t => t.title === 'First test topic' && !t.empty), 'the closed thread stays in history');
    // The next thread: the same settings activate again, with fresh sessions.
    for (const seat of ['cli1', 'cli2']) await service.call('slot.activate', { pairId: pair.id, seat });
    const ready = service.store.pair(pair.id);
    assert.deepEqual([ready.slots.cli1.state, ready.slots.cli2.state], ['ready', 'ready']); assert.equal(factory.agents.length, 4);
    await service.call('run.start', { pairId: pair.id, text: 'Second test topic', requestId: 'second', options: { opening: 'cli1', paceMs: 0 } }); await flush();
    const after = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ title: string }> }).threads.map(t => t.title);
    assert.ok(after.includes('First test topic') && after.includes('Second test topic'), 'the new prompt starts a new thread; the old one stays');
  } finally { await close(); }
});
// E9: a room keeps one pair per mode. Each mode's thread and agents stay as they are while another mode is in use; a
// mode used for the first time starts with the same agent settings, not yet active.
test('a room keeps one pair per mode: switching modes keeps each thread and its agents, and a new mode starts with the same settings', async () => {
  const { service, close } = fixture();
  try {
    const open = async (thread: string) => { const pair = await service.call('pair.create', { thread }) as Pair; const ticket = (await service.call('room.prepare', { pairId: pair.id }) as { ticket: string }).ticket; return { pair, roomId: (await service.call('room.open', { ticket }) as { roomId: string }).roomId }; };
    const get = async (roomId: string, mode: string) => await service.call('room.get', { roomId, mode }) as { pair: Pair; pairIds: string[] };
    const { pair, roomId } = await open('modes'); await activate(service, pair);
    assert.equal((await get(roomId, 'conversation')).pair.id, pair.id, 'the room\'s first pair serves the first mode used');
    const run = await service.call('run.start', { pairId: pair.id, text: 'Debate topic', requestId: 'd', options: { opening: 'cli1', paceMs: 0 } }) as { id: string }; await flush();
    const build = await get(roomId, 'build');
    assert.notEqual(build.pair.id, pair.id, 'Build gets a pair of its own');
    assert.deepEqual((['cli1', 'cli2'] as const).map(s => [build.pair.slots[s].config?.model, build.pair.slots[s].state]), [['model', 'configuring'], ['model', 'configuring']], 'the same settings, not yet active');
    assert.equal(service.store.run(run.id).status, 'running', 'the debate keeps running meanwhile');
    assert.deepEqual([...build.pairIds].sort(), [pair.id, build.pair.id].sort());
    assert.equal((await get(roomId, 'build')).pair.id, build.pair.id, 'the same pair each time');
    assert.equal((await get(roomId, 'conversation')).pair.id, pair.id, 'back to Debate: its own pair and thread');
    const threads = (await service.call('threads.list', { pairId: pair.id, pairIds: build.pairIds }) as { threads: Array<{ pairId: string; mode?: string; current: boolean }> }).threads;
    assert.ok(threads.some(t => t.pairId === pair.id && t.mode === 'conversation' && t.current), 'one history across modes');
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    // A room opened before E9, whose pair already holds a debate: Debate keeps that pair even if Build is asked for first.
    const older = await open('older'); await activate(service, older.pair);
    const debate = await service.call('run.start', { pairId: older.pair.id, text: 'Older debate', requestId: 'o', options: { opening: 'cli1', paceMs: 0 } }) as { id: string }; await flush();
    assert.notEqual((await get(older.roomId, 'build')).pair.id, older.pair.id);
    assert.equal((await get(older.roomId, 'conversation')).pair.id, older.pair.id);
    await service.call('run.control', { runId: debate.id, action: 'stop' }); await flush();
  } finally { await close(); }
});