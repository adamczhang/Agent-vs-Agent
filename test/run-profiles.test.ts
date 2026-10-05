import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { SimulationFactory } from '../src/simulation.js';
import { profileChoice, RUN_PROFILES, type ProfilePlan } from '../src/run-profiles.js';
import type { Catalog, ConfigOption } from '../src/providers.js';
import type { Pair, Provider, ProviderConfig, Run } from '../src/types.js';
import type { PuzzleJob } from '../src/puzzle-runner.js';
import { tempDir } from './temp.js';
const controls: ConfigOption[] = [{ id: 'effort', name: 'Effort', currentValue: 'high', options: ['low', 'medium', 'high'].map(value => ({ value, name: value })) }];
const config: ProviderConfig = { provider: 'codex', model: 'sim-model', auth: 'provider-login', effort: { key: 'effort', value: 'high' } };
class ProfileFactory extends SimulationFactory {
  override async discover(provider: Provider): Promise<Catalog> { return { provider, currentModel: 'sim-model', models: [{ id: 'sim-model', name: 'Simulation' }], controls }; }
}
test('K4: profiles select supported effort and disclose fallbacks without changing models or speed', () => {
  for (const p of ['quick', 'standard', 'deep'] as const) { const selected = profileChoice(config, controls, p); assert.equal(selected.effort, RUN_PROFILES[p].effort); assert.equal(selected.config.model, config.model); }
  assert.equal(profileChoice(config, [], 'quick').config.effort?.value, 'high'); assert.match(profileChoice(config, [], 'quick').note!, /no selectable effort/);
  const fallback = profileChoice(config, [{ ...controls[0]!, options: [{ value: 'medium', name: 'Medium' }] }], 'quick');
  assert.equal(fallback.effort, 'medium'); assert.match(fallback.note!, /low is unavailable/);
});
test('K4: profile preview is read-only and a new run applies actual effort, clock and saved profile', async () => {
  const service = new AvAService(tempDir('ava-profiles-'), new ProfileFactory(1), 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'profiles' }) as Pair;
    for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const before = service.store.pair(pair.id), plan = await service.call('profile.plan', { pairId: pair.id, profile: 'quick' }) as ProfilePlan;
    assert.equal(plan.agents.cli1.effort, 'low'); assert.deepEqual(service.store.pair(pair.id), before);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Preset game', requestId: 'profile-game', options: { mode: 'game', profile: 'quick', paceMs: 0, game: { kind: 'chess', first: 'cli1', moveMs: 300000, maxIllegal: 3 } } }) as Run;
    assert.equal(run.config.game!.moveMs, 60000); assert.equal(run.config.profile, 'quick'); assert.equal(run.participants!.cli1.effort!.value, 'low');
    assert.notEqual(run.sessions.cli1, before.slots.cli1.sessionId);
    assert.equal(run.participants!.cli1.model, config.model);
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Wrong time', requestId: 'busy-profile', options: { mode: 'benchmark', profile: 'deep' } }));
    assert.equal(service.store.pair(pair.id).slots.cli1.config!.effort!.value, 'low');
  } finally { await service.shutdown(); service.store.close(); }
});
test('K4: puzzle jobs snapshot the selected profile and clock while leaving the room configuration intact', async () => {
  const service = new AvAService(tempDir('ava-profile-puzzles-'), new ProfileFactory(1), 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'profile-puzzles' }) as Pair;
    for (const seat of ['cli1', 'cli2']) await service.call('slot.configure', { pairId: pair.id, seat, config });
    const job = await service.call('puzzles.start', { pairId: pair.id, ids: ['cc-win-1'], timeMs: 30000, profile: 'standard', requestId: 'profile-puzzle' }) as PuzzleJob;
    assert.equal(job.input.timeMs, 120000); assert.equal(job.input.profile, 'standard'); assert.equal(job.input.agents.cli1.effort!.value, 'medium');
    assert.equal(service.store.pair(pair.id).slots.cli1.config!.effort!.value, 'high');
    service.puzzles.cancel(job.id);
  } finally { await service.shutdown(); service.store.close(); }
});
