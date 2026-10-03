// Regression tests for the codebase review (B21): each one pins a bug that was found and fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AvAService } from '../src/service.js';
import { listen } from '../src/http.js';
import { NativeFactory, buildPermission, webPermission } from '../src/providers.js';
import { survivors } from '../src/census.js';
import { Previews, appTarget } from '../src/preview.js';
import { COPY_LIMITS, copyProject, projectChanges } from '../src/workspace.js';
import { claimOwner, ownerAlive, processStarted } from '../src/ownership.js';
import type { Pair } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

for (const key of ['AI_GATEWAY_API_KEY', 'AVA_GATEWAY_KEY_DIR', 'CODEX_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const root = process.platform === 'win32' ? 'C:\\ava\\ws' : '/ava/ws', outside = process.platform === 'win32' ? 'C:\\Windows\\x.txt' : '/etc/x';
const call = (kind: string, title: string, rawInput: unknown = {}) => ({ inferredKind: kind, raw: { toolCall: { kind, title, rawInput, locations: [] } } });

test('the Build gate reads paths by shape, refuses a CLI settings folder and sandbox escapes, and ignores file content', () => {
  const allowed = (rawInput: unknown) => buildPermission(call('edit', 'Write', rawInput), root).decision?.outcome === 'allow_once';
  assert.ok(allowed({ file_path: join(root, 'App.jsx'), content: '<div dangerouslySetInnerHTML={x} /> // escalate' }), 'words in file content are not requests');
  assert.ok(!allowed({ command: 'npm i', sandbox_permissions: 'require_escalated' }), 'Codex asking to leave its sandbox');
  assert.ok(!allowed({ command: 'npm i', with_escalated_permissions: true }));
  assert.ok(allowed({ command: 'npm i', sandbox_permissions: 'use_default', with_escalated_permissions: false }), 'the default sandbox is fine');
  assert.ok(!allowed({ edits: [{ changes: [{ target: outside }] }] }), 'a path nested in arrays is still found');
  assert.ok(!allowed({ note: outside }), 'an absolute path under any key counts');
  assert.ok(!allowed({ file_path: join(root, '.claude', 'settings.local.json') }), 'its own settings would change its permissions');
  assert.ok(!allowed({ file_path: join(root, 'sub', '.CODEX', 'config.toml') }));
  assert.ok(allowed({ url: 'https://example.com/a', file_path: join(root, '.claude-notes.md') }), 'a URL is not a path; a similar name is fine');
  assert.ok(allowed({ command: `type ${outside}` }), 'command text is not read as paths (commands run in the copy)');
});

test('web tools are recognized by the name leading their title, never by a mention', () => {
  assert.ok(webPermission(call('search', 'Run search_web?'), true));
  assert.ok(webPermission(call('other', 'WebSearch: vikings'), true));
  assert.ok(webPermission(call('fetch', 'anything'), true), 'kind fetch is always web');
  assert.equal(webPermission(call('search', 'grep "web search" src'), true), undefined, 'a file search mentioning it');
  assert.equal(webPermission(call('edit', 'WebSearch notes.md'), true), undefined, 'edits are never web tools');
  assert.equal(webPermission(call('execute', 'web-fetch.sh'), true), undefined);
  assert.equal(webPermission(call('search', 'Run search_web?'), false), undefined, 'and only with the internet on');
});

test('a recorded parent that exited only owns children it started before exiting', () => {
  const t = Date.parse('2026-10-02T12:00:00Z'), iso = (ms: number) => new Date(t + ms).toISOString();
  const recorded = [{ pid: 100, spawnedAt: iso(0), ownerPid: 1, exited: true, exitedAt: iso(60_000) }];
  const found = survivors(recorded, [{ pid: 200, ppid: 100, started: t + 5_000, name: 'node.exe' }, { pid: 300, ppid: 100, started: t + 600_000, name: 'other.exe' }]);
  assert.deepEqual(found.map(p => p.pid), [200], 'the later child belongs to whatever took PID 100 next');
});

test('previews never serve git data or Windows alias names, and follow no link out of the copy', async () => {
  const ws = tempDir('ava-preview-'), out = tempDir('ava-preview-out-');
  writeFileSync(join(ws, 'index.html'), 'ok'); mkdirSync(join(ws, '.git')); writeFileSync(join(ws, '.git', 'config'), 'secret');
  writeFileSync(join(out, 'index.html'), 'outside');
  const linked = join(ws, 'escape'); symlinkSync(out, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(appTarget('APP: escape/index.html', ws), undefined, 'a junction leading out of the copy is not an app');
  assert.deepEqual(appTarget('APP: index.html', ws), { kind: 'page', path: 'index.html' });
  const previews = new Previews();
  try {
    const [a, b] = await Promise.all([previews.open('r:cli1', ws, 'index.html'), previews.open('r:cli1', ws, 'index.html')]);
    assert.equal(a.origin, b.origin, 'two opens at once share one server');
    const opened = await fetch(a.url, { redirect: 'manual' }), cookie = opened.headers.get('set-cookie')!.split(';')[0]!;
    const get = async (path: string) => (await fetch(`${a.origin}${path}`, { headers: { cookie } })).status;
    assert.equal(await get('/index.html'), 200);
    for (const path of ['/.git/config', '/.GIT/config', '/.git./config', '/.git%20/config', '/index.html::$DATA', '/escape/index.html']) assert.equal(await get(path), 404, path);
  } finally { previews.closeAll(); }
});

test('a copy that fails part-way leaves nothing behind; changed git settings stop the change view', () => {
  const source = tempDir('ava-src-'), parent = tempDir('ava-dst-'), target = join(parent, 'copy');
  writeFileSync(join(source, 'a.txt'), 'x'.repeat(64)); writeFileSync(join(source, 'b.txt'), 'y'.repeat(64));
  const limit = COPY_LIMITS.bytes; COPY_LIMITS.bytes = 100;
  try { assert.throws(() => copyProject(source, target), /PROJECT_TOO_LARGE|smaller folder/); } finally { COPY_LIMITS.bytes = limit; }
  assert.deepEqual(readdirSync(parent), [], 'no partial folder and no target');
  copyProject(source, target);
  if (spawnSync('git', ['--version']).status !== 0) return;
  assert.ok(Array.isArray(projectChanges(target).files));
  writeFileSync(join(target, '.git', 'config'), '[core]\n\tfsmonitor = calc.exe\n');
  assert.throws(() => projectChanges(target), /git settings in this copy were changed/);
});

test('the Gateway needs the API route and a key; a subscription CLI refuses a stray API key', async () => {
  const factory = new NativeFactory(tempDir('ava-auth-')), scope = { pairId: 'p', seat: 'cli1' as const, generation: 1 }, signal = new AbortController().signal;
  await assert.rejects(factory.open({ provider: 'vercel', model: 'm', auth: 'provider-login' }, scope, signal), /uses an API key/);
  await assert.rejects(factory.open({ provider: 'vercel', model: 'm', auth: 'api' }, scope, signal), /needs a key/);
  process.env.OPENAI_API_KEY = 'sk-test';
  try { await assert.rejects(factory.open({ provider: 'codex', model: 'm', auth: 'provider-login' }, scope, signal), /API credentials are present \(OPENAI_API_KEY\)/); }
  finally { delete process.env.OPENAI_API_KEY; }
  await assert.rejects(factory.open({ provider: 'codex', model: 'm', auth: 'api' }, scope, signal), /No API credential/);
});

function fixture() { const factory = new TestFactory(), service = new AvAService(tempDir('ava-review-'), factory, 'simulation'); return { factory, service }; }
async function activate(service: AvAService, pair: Pair, seats: Array<'cli1' | 'cli2'> = ['cli1', 'cli2']) {
  for (const seat of seats) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
}

test('a retried broadcast does its work once; an ended run stays ended; history waits for the running prompt', async () => {
  const { factory, service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'review' }) as Pair; await activate(service, pair);
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 'start', options: { paceMs: 0 } }) as { id: string }; await flush();
    const first = await service.call('run.broadcast', { runId: run.id, text: 'also this', requestId: 'b1' }) as { messageId: string };
    const again = await service.call('run.broadcast', { runId: run.id, text: 'also this', requestId: 'b1' }) as { messageId: string };
    assert.equal(again.messageId, first.messageId);
    assert.equal(service.store.messages(run.id).filter(m => m.text === 'also this').length, 1);
    await assert.rejects(service.call('history.clear', { pairId: pair.id, requestId: 'h1' }), /Stop the running prompt first/);
    await service.call('run.control', { runId: run.id, action: 'stop' }); await flush();
    for (const agent of factory.agents) for (let i = 0; i < agent.calls.length; i++) if (!agent.calls[i]!.settled) agent.answer('ok', false, i);
    await flush();
    const ended = service.store.run(run.id).status;
    assert.ok(['stopped', 'completed'].includes(ended), ended);
    await assert.rejects(service.call('run.control', { runId: run.id, action: 'pause' }));
    assert.equal(service.store.run(run.id).status, ended, 'pausing an ended run changes nothing');
  } finally { await service.shutdown(); service.store.close(); }
});

test('a 1:1 line needs the shared thread; nothing starts while an agent restarts for its internet switch', async () => {
  const { factory, service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'restart' }) as Pair; await activate(service, pair, ['cli1']);
    await assert.rejects(service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'hi', requestId: 'd1' }), /Activate both agents first/);
    await activate(service, pair, ['cli2']);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const open = factory.open.bind(factory);
    factory.open = async (config, scope, signal, options = {}) => { if (options.resumeSessionId) await gate; return open(config, scope, signal, options); };
    const switching = service.call('slot.internet', { pairId: pair.id, seat: 'cli1', enabled: true, requestId: 'i1' }); await flush();
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'go', requestId: 's1', options: { paceMs: 0 } }), /restarting to change its internet access/);
    await assert.rejects(service.call('slot.internet', { pairId: pair.id, seat: 'cli2', enabled: true, requestId: 'i2' }), /restarting/);
    release(); await switching;
    assert.equal(service.store.pair(pair.id).slots.cli1.internet, true);
  } finally { await service.shutdown(); service.store.close(); }
});

test('an owner record counts only while its PID is the same process (Windows reuses PIDs)', () => {
  const started = processStarted();
  assert.equal(ownerAlive(process.pid, started), true, 'this very process');
  assert.equal(ownerAlive(process.pid, started - 3_600_000), false, 'the PID now belongs to a process that started later');
  assert.equal(ownerAlive(process.pid, null), true, 'a record from an older version: PID alone');
  assert.equal(ownerAlive(2 ** 30, started), false, 'no such process');
  const data = tempDir('ava-owner-'), release = claimOwner(data, 'first');
  assert.throws(() => claimOwner(data, 'second'), /already owns/);
  release(); claimOwner(data, 'third')();
});

test('HTTP says which side failed: a refusal is 409, a malformed request 400', async t => {
  const { service } = fixture(), http = await listen(service, join(process.cwd(), 'dist', 'web'));
  t.after(async () => { await http.close(); service.store.close(); });
  const post = (body: string) => fetch(`http://127.0.0.1:${http.port}/api`, { method: 'POST', headers: { Authorization: `Bearer ${http.token}` }, body });
  const refused = await post(JSON.stringify({ method: 'room.get', params: { roomId: 'missing' } }));
  assert.deepEqual([refused.status, (await refused.json() as { code: string }).code], [409, 'NOT_FOUND']);
  const invalid = await post(JSON.stringify({ method: 'pair.create', params: { thread: 7 } }));
  assert.deepEqual([invalid.status, (await invalid.json() as { code: string }).code], [400, 'INVALID_REQUEST']);
  assert.equal((await post('{not json')).status, 400);
  assert.ok(existsSync(join(service.dataRoot, 'server.json')));
});
