import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { SEATS, type Pair, type Run, type RoomMessage } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

// Stage B exit gate: every viewer feature is read-only toward the agents, and history keeps what it recorded.
test('viewer features send no provider work, and history keeps identities and delivery state after the slots change', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-viewer-'), factory, 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'viewer' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const prepared = await service.call('room.prepare', { pairId: pair.id }) as { ticket: string };
    const { roomId } = await service.call('room.open', { ticket: prepared.ticket }) as { roomId: string };
    const run = await service.call('run.start', { pairId: pair.id, text: 'A searchable topic', requestId: 'start', options: { paceMs: 0 } }) as Run; await flush();
    factory.agents[0]!.emit('thought', 'private planning'); factory.agents[0]!.answer('Alpha reply'); factory.agents[1]!.answer('Beta reply'); await flush();
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    const before = await service.call('run.get', { runId: run.id }) as { run: Run; messages: RoomMessage[] };
    const calls = factory.agents.map(a => a.calls.length), agents = factory.agents.length;

    for (let i = 0; i < 20; i++) {
      await service.call('room.get', { roomId });
      await service.call('pair.get', { pairId: pair.id });
      await service.call('runs.list', { pairId: pair.id, limit: 10 });
      await service.call('runs.search', { pairId: pair.id, query: i % 2 ? 'alpha' : 'topic' });
      for (let after = 0; ;) { const page = await service.call('run.get', { runId: run.id, after }) as { events: Array<{ seq: number }> }; if (page.events.length < 300) break; after = page.events.at(-1)!.seq; }
      await service.call('run.export', { runId: run.id });
    }
    const saved = await service.call('preset.save', { requestId: 'p', name: 'gate', data: { instructions: { cli1: 'a', cli2: 'b' }, stopWhen: { cli1: '', cli2: '' }, completion: 'auto', minutes: '', requests: '', pace: '5' } }) as { id: string };
    await service.call('preset.list', {}); await service.call('preset.delete', { requestId: 'd', id: saved.id });
    await service.call('room.prepare', { pairId: pair.id }); // reopening the room is observation

    for (const seat of SEATS) await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'claude', model: 'changed', auth: 'provider-login' } });
    const after = await service.call('run.get', { runId: run.id }) as { run: Run; messages: RoomMessage[] };

    assert.deepEqual(factory.agents.map(a => a.calls.length), calls, 'no request reached an agent');
    assert.equal(factory.agents.length, agents, 'no agent was opened');
    assert.deepEqual(after.run.participants, before.run.participants, 'recorded identities are unchanged');
    assert.deepEqual(after.messages.map(m => [m.id, m.sender, m.state, m.deliveredTo, m.text]), before.messages.map(m => [m.id, m.sender, m.state, m.deliveredTo, m.text]), 'messages and delivery state are unchanged');
    assert.ok(!after.messages.some(m => m.text.includes('private planning')), 'private activity never entered the room');
  } finally { await service.shutdown(); service.store.close(); }
});
