import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { runCommand } from '../src/text-client.js';
import { describeQuick, highEffort, strongestModel, type QuickPlan } from '../src/quick.js';
import { newerVersion, packageVersion } from '../src/paths.js';
import type { Catalog } from '../src/providers.js';
import type { Pair, Provider, Seat } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

// The CLIs' catalogs as they list them (recorded live; see pilot-evidence/p1/*-catalog.json).
const CATALOGS: Partial<Record<Provider, Catalog>> = {
  claude: { provider: 'claude', currentModel: 'default', models: [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'Opus 5.5' }, { id: 'fable', name: 'Fable 5.1' }, { id: 'sonnet', name: 'Sonnet 5.5' }, { id: 'haiku', name: 'Haiku 4.5' }],
    controls: [{ id: 'effort', name: 'Effort', currentValue: 'default', options: ['default', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({ value, name: value })) }] },
  codex: { provider: 'codex', currentModel: 'gpt-6-astra', models: [{ id: 'gpt-6.1-sol', name: '6.1 Sol' }, { id: 'gpt-6-astra', name: '6 Astra' }, { id: 'gpt-6-luna', name: '6 Luna' }],
    controls: [{ id: 'reasoning_effort', name: 'Effort', currentValue: 'medium', options: ['low', 'medium', 'high', 'xhigh'].map(value => ({ value, name: value })) }, { id: 'fast-mode', name: 'Fast mode', currentValue: 'off', options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }] }] },
  'grok-build': { provider: 'grok-build', currentModel: 'grok-4.7', models: [{ id: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast' }, { id: 'grok-4.7', name: 'Grok 4.7' }], controls: [{ id: 'reasoning_effort', name: 'Effort', currentValue: 'high', options: ['xhigh', 'high', 'medium', 'low'].map(value => ({ value, name: value })) }] },
};
class CatalogFactory extends TestFactory { discovered: string[] = []; override async discover(provider?: Provider, _signal?: AbortSignal, model = '') { this.discovered.push(`${provider}:${model}`); return CATALOGS[provider!] ?? await super.discover(); } }
function fixture() {
  const factory = new CatalogFactory(), service = new AvAService(tempDir('ava-quick-'), factory, 'simulation');
  return { factory, service, close: async () => { await service.shutdown(); service.store.close(); } };
}
const view = (service: AvAService, pairId: string) => service.pairView(pairId) as ReturnType<AvAService['pairView']> & { quick: Record<Seat, QuickPlan> };

test('the strongest model each CLI lists, and high effort', () => {
  assert.equal(strongestModel('claude', CATALOGS.claude!.models)?.name, 'Opus 5.5', 'not "Default (recommended)"');
  assert.equal(strongestModel('codex', CATALOGS.codex!.models)?.id, 'gpt-6.1-sol');
  assert.equal(strongestModel('grok-build', CATALOGS['grok-build']!.models)?.id, 'grok-4.7', 'not the Fast variant');
  assert.equal(strongestModel('antigravity', [{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }, { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' }, { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)' }])?.id, 'gemini-pro-agent');
  assert.deepEqual(highEffort(CATALOGS.claude!.controls), { key: 'effort', value: 'high' });
  assert.equal(highEffort([]), undefined);
  assert.equal(describeQuick({ source: 'default', provider: 'claude', effort: 'high', permissions: 'ask', internet: false }, 'Claude Code'), 'Claude Code · its strongest model · high effort · Ask · internet off (defaults)');
});

test('Quick activate with nothing remembered: the strongest model at high effort, Ask, internet off; then it remembers', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'quick-first' }) as Pair;
    assert.deepEqual(view(service, pair.id).quick.cli1, { source: 'default', provider: 'claude', effort: 'high', permissions: 'ask', internet: false }, 'Agent 1 starts with Claude Code');
    assert.equal(view(service, pair.id).quick.cli2.provider, 'codex', 'Agent 2 with Codex');
    await service.call('slot.quick', { pairId: pair.id, seat: 'cli1' });
    const slot = service.store.pair(pair.id).slots.cli1;
    assert.equal(slot.state, 'ready');
    assert.deepEqual(slot.config, { provider: 'claude', model: 'opus', modelName: 'Opus 5.5', effort: { key: 'effort', value: 'high' }, auth: 'provider-login' });
    assert.deepEqual([slot.permissions, slot.internet], ['ask', false]);
    assert.deepEqual(factory.discovered, ['claude:', 'claude:opus'], 'the model\'s own effort choices are read');
    assert.deepEqual(view(service, pair.id).quick.cli1, { source: 'last', provider: 'claude', model: 'Opus 5.5', effort: 'high', permissions: 'ask', internet: false });
  } finally { await close(); }
});

test('Quick activate reuses the last settings, internet and permissions included, in any room', async () => {
  const { service, close } = fixture();
  try {
    const first = await service.call('pair.create', { thread: 'quick-a' }) as Pair;
    await service.call('slot.configure', { pairId: first.id, seat: 'cli2', config: { provider: 'codex', model: 'gpt-6-astra', modelName: '6 Astra', effort: { key: 'reasoning_effort', value: 'xhigh' }, speed: { key: 'fast-mode', value: 'on' }, auth: 'provider-login' } });
    await service.call('slot.activate', { pairId: first.id, seat: 'cli2' });
    await service.call('slot.internet', { pairId: first.id, seat: 'cli2', enabled: true, requestId: 'net' });
    await service.call('slot.permissions', { pairId: first.id, seat: 'cli2', level: 'bypass', requestId: 'perm' }).catch(async () => {
      const menu = await service.call('menu.show', { pairId: first.id, seat: 'cli2', phase: 'permissions' }) as { id: string };
      await service.call('menu.choose', { pairId: first.id, seat: 'cli2', menuId: menu.id, choice: '2' });
    });
    const plan = view(service, first.id).quick.cli2;
    assert.deepEqual(plan, { source: 'last', provider: 'codex', model: '6 Astra', effort: 'xhigh', speed: 'on', permissions: 'bypass', internet: true });
    assert.equal(describeQuick(plan, 'Codex'), 'Codex · 6 Astra · xhigh effort · Fast · Bypass · internet on (last used)');
    // Another room: the same agent, one click.
    const second = await service.call('pair.create', { thread: 'quick-b' }) as Pair;
    await service.call('slot.quick', { pairId: second.id, seat: 'cli2' });
    const slot = service.store.pair(second.id).slots.cli2;
    assert.deepEqual([slot.state, slot.config?.model, slot.config?.effort?.value, slot.config?.speed?.value, slot.permissions, slot.internet], ['ready', 'gpt-6-astra', 'xhigh', 'on', 'bypass', true]);
  } finally { await close(); }
});

test('Quick activate uses the CLI chosen for the agent; Gateway models must be chosen once; benchmarks are not remembered', async () => {
  const { service, close } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'quick-chosen' }) as Pair;
    const menu = await service.call('menu.show', { pairId: pair.id, seat: 'cli1' }) as { id: string; choices: Array<{ label: string; value: string }> };
    const grok = menu.choices.findIndex(c => c.value === 'grok-build') + 1;
    await service.call('menu.choose', { pairId: pair.id, seat: 'cli1', menuId: menu.id, choice: String(grok) });
    assert.equal(view(service, pair.id).quick.cli1.provider, 'grok-build');
    await service.call('slot.quick', { pairId: pair.id, seat: 'cli1' });
    assert.deepEqual([service.store.pair(pair.id).slots.cli1.config?.model, service.store.pair(pair.id).slots.cli1.config?.effort?.value], ['grok-4.7', 'high']);
    const second = await service.call('menu.show', { pairId: pair.id, seat: 'cli2' }) as { id: string; choices: Array<{ value: string }> };
    await service.call('menu.choose', { pairId: pair.id, seat: 'cli2', menuId: second.id, choice: String(second.choices.findIndex(c => c.value === 'vercel') + 1) });
    assert.equal(service.store.pair(pair.id).slots.cli2.config?.provider, 'vercel');
    await assert.rejects(service.call('slot.quick', { pairId: pair.id, seat: 'cli2' }), /Choose a Gateway model once/);
    const bench = service.store.createPair('benchmark-job-task-0');
    await service.call('slot.configure', { pairId: bench.id, seat: 'cli1', config: { provider: 'claude', model: 'haiku', auth: 'provider-login' } });
    await service.call('slot.activate', { pairId: bench.id, seat: 'cli1' });
    assert.equal(view(service, pair.id).quick.cli1.provider, 'grok-build', 'a benchmark session doesn\'t become the last settings');
  } finally { await close(); }
});

test('the menus offer Quick activate, show the model\'s name, and read speed as Default or Fast', async () => {
  const { service, close } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'quick-menu' }) as Pair;
    const text = (command: string) => runCommand({ rpc: (m, p) => service.call(m, p), thread: 'quick-menu', command, roomUrl: id => id });
    const providers = await text('/ava CLI2');
    assert.match(providers, /\d+\. Quick activate: Codex CLI · its strongest model · high effort · Ask · internet off \(defaults\) \(one short model request\)/);
    assert.match(providers, /^1\. Claude Code$/m, 'the CLI numbers are unchanged');
    // Choose Codex, then a model: the settings show its name.
    const codex = providers.split('\n').find(l => / Codex CLI$/.test(l))!.split('.')[0]!;
    await text(`/ava CLI2 ${codex}`); await text('/ava CLI2 2');
    const home = await text('/ava CLI2 1');
    assert.match(home, /Model: 6\.1 Sol/); assert.equal(service.store.pair(pair.id).slots.cli2.config?.modelName, '6.1 Sol');
    const speed = await text('/ava CLI2 4');
    assert.match(speed, /1\. Default\n2\. Fast/); assert.doesNotMatch(speed, /Normal|On|Off/);
    await text('/ava CLI2 b');
    // The home menu's last choice: Quick activate, which activates.
    const quick = (await text('/ava CLI2')).split('\n').find(l => /Quick activate/.test(l))!.split('.')[0]!;
    assert.match(await text(`/ava CLI2 ${quick}`), /Activation verified/);
    assert.equal(service.store.pair(pair.id).slots.cli2.state, 'ready');
    assert.doesNotMatch(await text('/ava CLI2'), /Quick activate/, 'not offered once the agent is active');
  } finally { await close(); }
});

test('an older service steps aside for a newer plugin, only when nothing is running', async () => {
  assert.ok(newerVersion('0.4.1', '0.4.0')); assert.ok(newerVersion('0.10.0', '0.9.9')); assert.ok(newerVersion('0.4.0', undefined));
  assert.ok(!newerVersion('0.4.0', '0.4.0')); assert.ok(!newerVersion('0.3.5', '0.4.0'));
  const { service, close } = fixture();
  try {
    assert.deepEqual((await service.call('service.retire', { version: '99.0.0' }) as { retiring: boolean }).retiring, false, 'a service without a way to stop (tests, development) never retires');
    let retired = 0; service.retire = () => { retired++; };
    assert.equal((await service.call('service.retire', { version: packageVersion }) as { retiring: boolean }).retiring, false, 'not for the same version');
    const pair = await service.call('pair.create', { thread: 'retire' }) as Pair;
    for (const seat of ['cli1', 'cli2']) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const run = await service.call('run.start', { pairId: pair.id, text: 'Topic', requestId: 'r', options: { paceMs: 0 } }) as { id: string }; await flush();
    assert.deepEqual(await service.call('service.retire', { version: '99.0.0' }), { retiring: false, reason: 'a conversation is running' });
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush(); await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await service.call('service.retire', { version: '99.0.0' }), { retiring: true, version: packageVersion });
    await new Promise(r => setTimeout(r, 80)); assert.equal(retired, 1);
  } finally { await close(); }
});
