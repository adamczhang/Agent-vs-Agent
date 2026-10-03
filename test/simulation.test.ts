import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { SimulationFactory } from '../src/simulation.js';
import { SEATS, type Pair, type Run, type RoomMessage } from '../src/types.js';
import { tempDir } from './temp.js';

test('the simulation factory runs a full conversation with activity and no provider processes', async () => {
  const service = new AvAService(tempDir('ava-sim-test-'), new SimulationFactory(20), 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'sim' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 'sim', options: { maxRequests: 4, paceMs: 0 } }) as Run;
    let state: { run: Run; messages: RoomMessage[]; events: Array<{ type: string; data: { type?: string } }> };
    for (const deadline = Date.now() + 5000; ; await new Promise(r => setTimeout(r, 20))) {
      state = await service.call('run.get', { runId: run.id }) as typeof state;
      if (!['running', 'pausing', 'stopping'].includes(state.run.status) || Date.now() > deadline) break;
    }
    assert.deepEqual([state.run.status, state.run.reason, state.run.requests], ['stopped', 'request_limit', 4]);
    assert.deepEqual(state.messages.filter(m => m.sender !== 'user').map(m => m.sender).slice(2), ['cli1', 'cli2']);
    assert.ok(state.events.some(e => e.type === 'activity' && e.data.type === 'tool'), 'simulated activity reaches the activity panes');
    assert.equal(service.store.openProcesses(pair.id).length, 0, 'no provider process is recorded');
  } finally { await service.shutdown(); service.store.close(); }
});
