import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { participantEnvironment } from '../src/providers.js';
import { createGatewayKey, findKey, forgetGatewayKey, gatewayKey, gatewayKeyStatus, parseModels, type GatewayModel } from '../src/gateway.js';
import type { Menu } from '../src/menus.js';
import type { Pair } from '../src/types.js';
import { TestFactory } from './fakes.js';
import { tempDir } from './temp.js';

// Keys from the developer's own environment would change what these tests see (each test file has its own process).
delete process.env.AI_GATEWAY_API_KEY; delete process.env.AVA_GATEWAY_KEY_DIR;

const raw = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.split('/')[1], owned_by: id.split('/')[0], type: 'language', tags: ['tool-use'], released: 1_700_000_000, ...extra });
test('the Gateway catalog keeps tool-using language models, with the efforts the Codex agent can pass on', () => {
  const models = parseModels({ data: [
    raw('openai/gpt-x', { reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }] }),
    raw('anthropic/claude-y', { reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', max: 1000 }] }),
    raw('alibaba/qwen-z'),
    raw('openai/text-embed', { type: 'embedding' }),
    raw('meta/no-tools', { tags: ['reasoning'] }),
  ] });
  assert.deepEqual(models.map(m => m.id), ['openai/gpt-x', 'anthropic/claude-y', 'alibaba/qwen-z']);
  assert.deepEqual(models[0]!.efforts, ['none', 'low', 'medium', 'high', 'xhigh'], '"max" is not a Codex effort');
  assert.deepEqual(models[1]!.efforts, ['low', 'medium', 'high'], 'a token budget becomes efforts the Gateway maps');
  assert.deepEqual(models[2]!.efforts, []);
  assert.equal(models[1]!.maker, 'anthropic');
});

test('a Gateway key: found in the CLI’s output, stored for AvA only, never shown; the environment wins', async () => {
  const data = tempDir('ava-gw-key-'), secret = 'vck_' + 'a1B2'.repeat(10);
  assert.equal(findKey({ apiKey: { id: 'k1', apiKeyString: secret } }), secret);
  assert.equal(findKey({ id: 'k1', partialKey: '2V5z' }), undefined, 'a partial key is not a key');
  const calls: string[][] = [];
  const status = await createGatewayKey(data, 25, async args => { calls.push(args); return `Vercel CLI 62.2.0\n${JSON.stringify({ apiKey: { id: 'k1', name: 'agent-vs-agent', apiKeyString: secret } })}`; });
  assert.deepEqual(calls, [['ai-gateway', 'api-keys', 'create', '--name', 'agent-vs-agent', '--limit', '25', '--refresh-period', 'monthly', '--non-interactive']], 'fixed arguments only');
  assert.deepEqual(status, { source: 'stored', ending: secret.slice(-4), name: 'agent-vs-agent', budget: '$25 a month' });
  assert.equal(gatewayKey(data)?.key, secret);
  assert.ok(!JSON.stringify(gatewayKeyStatus(data)).includes(secret), 'the status never carries the key');
  await assert.rejects(createGatewayKey(data, 5000.5), /budget/);
  await assert.rejects(createGatewayKey(tempDir('ava-gw-none-'), 25, async () => 'no key here'), /no readable key/);
  const saved = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = 'vck_from_environment_0000000000';
  try { assert.equal(gatewayKey(data)?.source, 'environment'); } finally { if (saved === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = saved; }
  forgetGatewayKey(data); assert.equal(gatewayKey(data), undefined);
});

test('a Gateway agent is the Codex agent with Vercel’s provider settings, its model, effort and key, and no web search', () => {
  const data = tempDir('ava-gw-env-');
  const cli = { command: process.execPath, args: ['C:\\tools\\codex.js'], path: 'C:\\tools\\codex.js' };
  const env = participantEnvironment('vercel', {}, data, true, { model: 'anthropic/claude-sonnet-5', effort: 'low', key: 'vck_test_key_0000000000' }, cli);
  const config = JSON.parse(env.CODEX_CONFIG!);
  assert.equal(config.model_provider, 'vercel'); assert.equal(config.model, 'anthropic/claude-sonnet-5'); assert.equal(config.model_reasoning_effort, 'low');
  assert.deepEqual(config.model_providers.vercel, { name: 'Vercel AI Gateway', base_url: 'https://ai-gateway.vercel.sh/codex/v1', env_key: 'AI_GATEWAY_API_KEY', wire_api: 'responses' }, 'as `vercel ai-gateway setup` writes it for Codex');
  assert.equal(config.web_search, 'disabled', 'OpenAI’s hosted web search isn’t offered through the Gateway');
  assert.equal(config.sandbox_workspace_write.network_access, true, 'the internet switch governs commands');
  assert.equal(config.features.plugins, false, 'no recursive AvA');
  assert.deepEqual([env.MODEL_PROVIDER, env.AI_GATEWAY_API_KEY, env.INITIAL_AGENT_MODE], ['vercel', 'vck_test_key_0000000000', 'read-only']);
  assert.ok(env.CODEX_PATH, 'the same Codex launcher as Codex participants (the installed Codex)');
  assert.equal(JSON.parse(participantEnvironment('codex', {}, data, false, undefined, cli).CODEX_CONFIG!).model_provider, undefined, 'Codex itself is unchanged');
});

test('the Vercel menus: makers, a maker’s models a page at a time, search, per-model effort, and the Gateway key', async () => {
  const data = tempDir('ava-gw-menu-'), factory = new TestFactory(), secret = 'vck_' + 'Z9y8'.repeat(10);
  const models: GatewayModel[] = [
    ...Array.from({ length: 25 }, (_, i) => ({ id: `openai/gpt-${i}`, name: `GPT ${i}`, maker: 'openai', released: 1_700_000_000 + i * 86_400, context: 1, tags: ['tool-use'], efforts: ['low', 'high'] })),
    { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', maker: 'anthropic', released: 1_800_000_000, context: 1, tags: ['tool-use', 'vision'], efforts: ['low', 'medium', 'high'] },
    { id: 'zai/glm-5', name: 'GLM 5', maker: 'zai', released: 1_750_000_000, context: 1, tags: ['tool-use'], efforts: [] },
  ];
  factory.gatewayModels = async () => models;
  factory.runVercel = async () => JSON.stringify({ apiKey: { id: 'k2', apiKeyString: secret } });
  const service = new AvAService(data, factory, 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'gw' }) as Pair, seat = 'cli1';
    const pick = async (menu: Menu, test: RegExp) => { const i = menu.choices.findIndex(c => test.test(c.label)); assert.ok(i >= 0, `no ${test} in ${menu.choices.map(c => c.label).join(' | ')}`); return (await service.call('menu.choose', { pairId: pair.id, seat, menuId: menu.id, choice: String(i + 1) }) as { menu: Menu }).menu; };
    let menu = await service.call('menu.show', { pairId: pair.id, seat }) as Menu;
    menu = await pick(menu, /^Vercel AI Gateway/);
    assert.deepEqual(service.store.pair(pair.id).slots.cli1.config, { provider: 'vercel', model: '', auth: 'api' }, 'API access only');
    assert.match(menu.text, /Gateway key: missing/); assert.doesNotMatch(menu.text, /Speed:|Access:/);
    menu = await pick(menu, /^Model:/);
    assert.equal(menu.search, true, 'the room may offer a search box');
    assert.deepEqual(menu.choices.map(c => c.label), ['OpenAI (25)', 'Anthropic (1)', 'Z.ai (GLM) (1)'], 'makers by size');
    menu = await pick(menu, /^OpenAI/);
    assert.match(menu.title, /OpenAI models \(25\) · page 1 of 2/);
    assert.equal(menu.choices[0]!.value, 'openai/gpt-24', 'newest first'); assert.equal(menu.choices.length, 21); assert.match(menu.choices.at(-1)!.label, /More OpenAI models \(page 2 of 2\)/);
    menu = await pick(menu, /^More OpenAI/);
    assert.deepEqual(menu.choices.map(c => c.value), ['openai/gpt-4', 'openai/gpt-3', 'openai/gpt-2', 'openai/gpt-1', 'openai/gpt-0', 'page:0']);
    menu = (await service.call('menu.choose', { pairId: pair.id, seat, menuId: menu.id, choice: 'b' }) as { menu: Menu }).menu;
    assert.match(menu.title, /Choose a model maker/, 'Back from a maker goes to the makers');
    menu = await service.call('menu.search', { pairId: pair.id, seat, query: 'sonnet' }) as Menu;
    assert.deepEqual(menu.choices.map(c => c.value), ['anthropic/claude-sonnet-5']);
    assert.match(menu.choices[0]!.label, /^Anthropic · Claude Sonnet 5 \(anthropic\/claude-sonnet-5\)/);
    menu = await pick(menu, /Sonnet/);
    assert.equal(service.store.pair(pair.id).slots.cli1.config?.model, 'anthropic/claude-sonnet-5');
    menu = await pick(menu, /^Effort:/);
    assert.deepEqual(menu.choices.map(c => c.label), ['low', 'medium', 'high', 'Model default'], 'that model’s own efforts');
    menu = await pick(menu, /^medium$/);
    assert.deepEqual(service.store.pair(pair.id).slots.cli1.config?.effort, { key: 'model_reasoning_effort', value: 'medium' });
    menu = await pick(menu, /^Gateway key:/);
    assert.match(menu.choices[0]!.label, /\$25 monthly budget/);
    menu = await pick(menu, /\$25 monthly budget/);
    assert.match(menu.text, new RegExp(`Gateway key: Agent vs Agent’s key \\(…${secret.slice(-4)}, \\$25 a month\\)`));
    const database = ['ava.sqlite', 'ava.sqlite-wal'].filter(f => existsSync(join(data, f))).map(f => readFileSync(join(data, f)).toString('latin1')).join('');
    assert.ok(!menu.text.includes(secret) && !database.includes(secret), 'the key is in no menu and not in the database (or its write-ahead log)');
    assert.equal(gatewayKey(data)?.key, secret);
  } finally { await service.shutdown(); service.store.close(); }
});
