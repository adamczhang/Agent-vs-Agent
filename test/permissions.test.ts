import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { toolPermission } from '../src/providers.js';
import type { Menu } from '../src/menus.js';
import type { Pair } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const ask = (kind: string, title: string, rawInput: unknown = {}) => ({ inferredKind: kind, raw: { toolCall: { kind, title, rawInput, locations: [] } } });
test('the permission gate: web tools follow the internet switch; bypass approves everything else; ask allows only a Build folder', () => {
  const root = process.platform === 'win32' ? 'C:\\ava\\ws' : '/ava/ws', outside = process.platform === 'win32' ? 'C:\\Windows\\x.txt' : '/etc/x';
  const off = { internet: false, bypass: false }, bypass = { internet: false, bypass: true };
  assert.equal(toolPermission(ask('fetch', 'WebFetch'), { internet: true, bypass: false }).decision?.outcome, 'allow_once');
  assert.equal(toolPermission(ask('fetch', 'WebFetch'), bypass).decision, undefined, 'bypass does not turn the internet on');
  assert.match(toolPermission(ask('fetch', 'WebFetch'), bypass).status!, /internet off/);
  assert.equal(toolPermission(ask('execute', 'rm -rf build'), bypass).decision?.outcome, 'allow_once', 'bypass: a command');
  assert.equal(toolPermission(ask('edit', 'Write', { file_path: outside }), bypass).decision?.outcome, 'allow_once', 'bypass: a path anywhere');
  assert.match(toolPermission(ask('edit', 'Write'), bypass).status!, /permissions: bypass/);
  assert.equal(toolPermission(ask('execute', 'npm test'), off).decision, undefined, 'ask, outside Build: no tools');
  assert.match(toolPermission(ask('execute', 'npm test'), off).status!, /permissions: ask/);
  assert.equal(toolPermission(ask('edit', 'Write', { file_path: join(root, 'a.js') }), { ...off, workspace: root }).decision?.outcome, 'allow_once', 'ask, Build: inside its folder');
  assert.equal(toolPermission(ask('edit', 'Write', { file_path: outside }), { ...off, workspace: root }).decision, undefined, 'ask, Build: outside its folder');
});

test('a new thread gets its own room with no agents; threads with live agents are counted', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-rooms-'), factory, 'simulation');
  try {
    const first = await service.call('room.new', {}) as { roomId: string; pairId: string }, second = await service.call('room.new', {}) as { roomId: string; pairId: string };
    assert.notEqual(first.pairId, second.pairId, 'each new thread is its own pair of agents');
    const room = await service.call('room.get', { roomId: second.roomId }) as { pair: Pair };
    assert.deepEqual([room.pair.id, room.pair.slots.cli1.state, room.pair.slots.cli2.state], [second.pairId, 'empty', 'empty']);
    assert.deepEqual((await service.call('pairs.active', {}) as { pairs: unknown[] }).pairs, [], 'nothing runs until activation');
    await service.call('slot.configure', { pairId: first.pairId, seat: 'cli1', config: { provider: 'claude', model: 'model', auth: 'provider-login' } });
    await service.call('slot.activate', { pairId: first.pairId, seat: 'cli1' });
    assert.deepEqual((await service.call('pairs.active', {}) as { pairs: unknown[] }).pairs, [{ pairId: first.pairId, agents: 1, running: false }]);
    assert.equal(factory.agents.length, 1);
  } finally { await service.shutdown(); service.store.close(); }
});

test('permissions are a menu choice that applies at once, keeps the session, and reaches the agent and Codex', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-permissions-'), factory, 'simulation');
  try {
    const pair = await service.call('pair.create', { thread: 'perm' }) as Pair;
    for (const seat of ['cli1', 'cli2'] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: seat === 'cli1' ? 'codex' : 'claude', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const [codex, claude] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const session = service.store.pair(pair.id).slots.cli1.sessionId;
    let menu = await service.call('menu.show', { pairId: pair.id, seat: 'cli1' }) as Menu;
    const line = menu.choices.findIndex(c => c.value === 'permissions');
    assert.match(menu.choices[line]!.label, /^Permissions: Ask/);
    assert.match(menu.text, /Permissions: Ask/, 'the same line in the text menu the hosts show');
    menu = (await service.call('menu.choose', { pairId: pair.id, seat: 'cli1', menuId: menu.id, choice: String(line + 1) }) as { menu: Menu }).menu;
    assert.equal(menu.phase, 'permissions');
    const bypass = menu.choices.findIndex(c => c.value === 'bypass');
    assert.match(menu.choices[bypass]!.label, /full access/, 'named as Codex names it');
    menu = (await service.call('menu.choose', { pairId: pair.id, seat: 'cli1', menuId: menu.id, choice: String(bypass + 1) }) as { menu: Menu }).menu;
    assert.match(menu.choices.find(c => c.value === 'permissions')!.label, /Bypass \(full access\)/);
    const slot = service.store.pair(pair.id).slots.cli1;
    assert.deepEqual([slot.permissions, slot.state, slot.sessionId], ['bypass', 'ready', session], 'no new session');
    assert.equal(codex.options.bypass!(), true, 'the gate reads it live');
    assert.equal(claude.options.bypass!(), false);
    assert.deepEqual(codex.buildAccess, [false], 'Codex is re-set at once while idle (its mode then follows bypass)');
    // A 1:1 line under bypass may use tools; the RPC sets it back.
    await service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'Run the tests', requestId: 'd1' }); await flush();
    assert.match(codex.calls.at(-1)!.request.text, /You may use your tools, run commands and edit files/);
    codex.raw('Done.'); await flush();
    await service.call('slot.permissions', { pairId: pair.id, seat: 'cli1', level: 'ask' });
    assert.equal(codex.options.bypass!(), false);
  } finally { await service.shutdown(); service.store.close(); }
});
