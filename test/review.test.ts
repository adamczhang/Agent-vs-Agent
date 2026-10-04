// Regression tests for the codebase reviews (B21, and Q1 of the 2026-10-04 review): each one pins a bug that was found
// and fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AvAService } from '../src/service.js';
import { listen } from '../src/http.js';
import { NativeFactory, buildPermission, participantEnvironment, webPermission } from '../src/providers.js';
import { benchPath, loadSuite } from '../src/bench-tasks.js';
import { readExercism } from '../src/bench-import.js';
import { survivors } from '../src/census.js';
import { Previews, appTarget } from '../src/preview.js';
import { COPY_LIMITS, copyProject, projectChanges } from '../src/workspace.js';
import { conversationConfig } from '../src/types.js';
import { Store } from '../src/store.js';
import { finalAnswer, matches } from '../src/answer-check.js';
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
  assert.ok(!allowed({ command: 'npm i', sandbox_permissions: 'use_default', with_escalated_permissions: false }), 'a requested sandbox setting does not prove confinement');
  assert.ok(!allowed({ edits: [{ changes: [{ target: outside }] }] }), 'a path nested in arrays is still found');
  assert.ok(!allowed({ note: outside }), 'an absolute path under any key counts');
  assert.ok(!allowed({ file_path: join(root, '.claude', 'settings.local.json') }), 'its own settings would change its permissions');
  assert.ok(!allowed({ file_path: join(root, 'sub', '.CODEX', 'config.toml') }));
  assert.ok(allowed({ file_path: join(root, '.claude-notes.md') }), 'a similar name is fine');
  assert.ok(!allowed({ url: 'file:///etc/x', file_path: join(root, 'local.md') }), 'a file URL cannot hide an outside path');
  assert.ok(!allowed({ command: `type ${outside}` }), 'command text is never evidence of confinement');
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
    // Q1: the junction's folder isn't listed either, and a short (8.3) name doesn't reach the git data where the volume
    // makes them.
    const bare = tempDir('ava-preview-bare-'); writeFileSync(join(bare, 'private.txt'), 'x');
    symlinkSync(bare, join(ws, 'peek'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await get('/peek/'), 404, 'no listing through a junction');
    if (existsSync(join(ws, 'GIT~1'))) assert.equal(await get('/GIT~1/config'), 404, 'the short name of .git');
    // Q1: a key as long as the real one but with a non-ASCII character (more bytes) is refused, and the service lives on.
    const key = new URL(a.url).searchParams.get('key')!;
    const odd = await fetch(`${a.origin}/__ava/open?key=${encodeURIComponent(`${key.slice(1)}é`)}`, { redirect: 'manual' });
    assert.equal(odd.status, 403);
    assert.equal(await get('/index.html'), 200, 'still serving');
  } finally { previews.closeAll(); }
});

test('Q1: the APP line is found quickly even after a long run of spaces or blank lines', () => {
  const ws = tempDir('ava-app-line-'); writeFileSync(join(ws, 'index.html'), 'ok');
  const started = Date.now();
  // (The old single pattern took seconds on each of these: quadratic backtracking.)
  assert.equal(appTarget(`APP: x${' '.repeat(100_000)}y`, ws), undefined);
  assert.equal(appTarget(`${'\n'.repeat(100_000)}x`, ws), undefined);
  assert.deepEqual(appTarget(`${' \n'.repeat(100_000)}APP: index.html`, ws), { kind: 'page', path: 'index.html' });
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});

test('Q1: benchmark paths refuse .git in any case; an imported exercise reads only its own files', () => {
  for (const path of ['.GIT/config', 'src/.Git/hooks/pre-commit']) assert.throws(() => benchPath.parse(path), /reserved names/, path);
  const dir = join(tempDir('ava-exercism-q1-'), 'two-fer'); mkdirSync(join(dir, '.meta'), { recursive: true });
  writeFileSync(join(dir, 'two-fer.js'), 'export const x = 1;\n'); writeFileSync(join(dir, 'two-fer.spec.js'), '');
  const config = (files: object) => writeFileSync(join(dir, '.meta', 'config.json'), JSON.stringify({ files }));
  config({ solution: ['two-fer.js'], test: ['two-fer.spec.js'], example: ['../../outside.js'] });
  assert.throws(() => readExercism(dir), /outside the exercise folder/);
  config({ solution: ['two-fer.js'], test: ['jest-shim.js'], example: ['two-fer.js'] });
  writeFileSync(join(dir, 'jest-shim.js'), '');
  assert.throws(() => readExercism(dir), /can't be imported under that name/);
});

test('Q1: an agent gets no other provider\'s API credentials, and ACPX_AUTH_ variables are dropped', () => {
  const env = participantEnvironment('claude', {}, undefined, false, undefined, { command: 'claude.exe', args: [], path: 'claude.exe' });
  for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'CURSOR_API_KEY', 'AI_GATEWAY_API_KEY']) assert.equal(env[name], '', name);
  assert.ok(!('ANTHROPIC_API_KEY' in env), 'its own route\'s variables are left as they are');
  process.env.ACPX_AUTH_OPENAI_API_KEY = 'sk-test';
  new NativeFactory(tempDir('ava-acpx-auth-'));
  assert.equal(process.env.ACPX_AUTH_OPENAI_API_KEY, undefined);
});

test('a copy that fails part-way leaves nothing behind; the copy\'s own git settings never run a program', async () => {
  const source = tempDir('ava-src-'), parent = tempDir('ava-dst-'), target = join(parent, 'copy');
  writeFileSync(join(source, 'a.txt'), 'x'.repeat(64)); writeFileSync(join(source, 'b.txt'), 'y'.repeat(64));
  const limit = COPY_LIMITS.bytes; COPY_LIMITS.bytes = 100;
  try { assert.throws(() => copyProject(source, target), /PROJECT_TOO_LARGE|smaller folder/); } finally { COPY_LIMITS.bytes = limit; }
  assert.deepEqual(readdirSync(parent), [], 'no partial folder and no target');
  const history = join(tempDir('ava-baselines-'), 'copy.git');
  copyProject(source, target, history);
  if (spawnSync('git', ['--version']).status !== 0) return;
  assert.ok(Array.isArray((await projectChanges(target, history)).files));
  // What an agent could write in its copy (Q1): settings that name a program (an fsmonitor, a clean filter, one more in
  // the worktree settings), and attributes that apply the filters to every file.
  const marker = join(parent, 'ran.txt'), program = join(parent, 'mark.cjs'), run = `node ${program.replaceAll('\\', '/')}`;
  writeFileSync(program, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);`);
  writeFileSync(join(target, '.git', 'config'), `[core]\n\trepositoryformatversion = 1\n\tfsmonitor = ${run}\n[extensions]\n\tworktreeConfig = true\n[filter "x"]\n\tclean = ${run}\n`);
  writeFileSync(join(target, '.git', 'config.worktree'), `[filter "y"]\n\tclean = ${run}\n`);
  writeFileSync(join(target, '.gitattributes'), '* filter=x\n*.txt filter=y\n'); writeFileSync(join(target, 'a.txt'), 'changed');
  spawnSync('git', ['add', '-A'], { cwd: target, windowsHide: true });
  assert.ok(existsSync(marker), 'the copy\'s own git runs the program (the attack is real)'); rmSync(marker);
  for (const changes of [await projectChanges(target, history), await projectChanges(target)]) assert.ok(changes.files.some(f => f.path === 'a.txt' && f.status === 'modified'));
  assert.ok(!existsSync(marker), 'AvA\'s git ran nothing from the copy\'s settings');
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

test('Q2: a record from before this logon session adopts nothing, even when an old PID matches a running orphan', () => {
  const t = Date.parse('2026-10-04T05:00:00Z'), iso = (ms: number) => new Date(t + ms).toISOString();
  const processes = [
    { pid: 500, ppid: 400, started: t, name: 'winlogon.exe', session: 1 },
    { pid: process.pid, ppid: 1, started: t + 60_000, name: 'node.exe', session: 1 },
    // explorer.exe's parent (userinit) has exited, and its PID once belonged to a recorded agent process.
    { pid: 600, ppid: 100, started: t + 5_000, name: 'explorer.exe', session: 1 },
  ];
  assert.deepEqual(survivors([{ pid: 100, spawnedAt: iso(-86_400_000), ownerPid: 1 }], processes), [], 'a record from an earlier session');
  assert.deepEqual(survivors([{ pid: 100, spawnedAt: iso(2_000), ownerPid: 1 }], processes).map(p => p.pid), [600], 'the same record in this session still finds an orphan');
});

test('Q2: after a restart the ledger drops earlier sessions\' records and seals an earlier service\'s gone ones; Stop all seals too', async () => {
  const dir = tempDir('ava-ledger-'), t = Date.now() - 3_600_000, iso = (ms: number) => new Date(t + ms).toISOString();
  const seed = new AvAService(dir, new TestFactory(), 'simulation'); await seed.shutdown();
  const insert = seed.store.db.prepare('INSERT INTO processes VALUES(?,?,?,?,?,?,NULL)');
  insert.run(100, 1, 'p', 'cli1', 1, iso(-86_400_000)); // an earlier session
  insert.run(200, 1, 'p', 'cli1', 1, iso(60_000));      // an earlier service in this session, gone now
  insert.run(300, 1, 'p', 'cli2', 1, iso(60_000));      // still running
  seed.store.close();
  const rows = [{ pid: 500, ppid: 400, started: t, name: 'winlogon.exe', session: 1 }, { pid: process.pid, ppid: 1, started: t + 30_000, name: 'node.exe', session: 1 }, { pid: 300, ppid: 1, started: t + 60_000, name: 'agent.exe', session: 1 }];
  const service = new AvAService(dir, new TestFactory(), 'simulation', { processes: async () => rows, census: async recorded => survivors(recorded, rows), stopProcesses: async () => {} });
  try {
    const ledger = () => Object.fromEntries(service.store.recordedProcesses().map(p => [p.pid, p.exited]));
    for (const end = Date.now() + 3000; !ledger()[200] && Date.now() < end;) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(ledger(), { 200: true, 300: false });
    rows.pop(); await service.call('resources.stop', { requestId: 'stop' });
    assert.deepEqual(ledger(), { 200: true, 300: true }, 'Stop all sealed what it proved gone');
  } finally { await service.shutdown(); service.store.close(); }
});

test('Q2: an elevated owner (EPERM) counts as alive; a short 8.3 name is refused by the Build gate', () => {
  if (process.platform === 'win32') assert.equal(ownerAlive(4), true, 'PID 4 (System) answers EPERM');
  const allowed = (path: string) => buildPermission(call('edit', 'Write', { file_path: join(root, path) }), root).decision?.outcome === 'allow_once';
  assert.ok(allowed('App.jsx'));
  if (process.platform === 'win32') for (const path of ['CLAUDE~1\settings.local.json', 'src\GIT~1\config']) assert.ok(!allowed(path), path);
});

test('Q3: debate limits: a repair to spare for every speech, a backstop that fits the speeches, the side check with a speech limit, Options time', () => {
  const formal = conversationConfig('Motion', { stances: { cli1: 'for', cli2: 'against' }, rounds: 20, speechMs: 120_000 });
  assert.deepEqual([formal.maxRequests, formal.durationMs], [80, 20 * 2 * (120_000 + 5_000) + 600_000], 'a long formal debate outlasts the old one-hour cap');
  assert.throws(() => conversationConfig('Motion', { stances: { cli1: 'for', cli2: 'for' }, speechMs: 120_000 }), /opposite sides/);
  const timedFormal = conversationConfig('Motion for 5 minutes', { stances: { cli1: 'for', cli2: 'against' }, completion: 'duration', durationMs: 300_000 });
  assert.deepEqual([timedFormal.completion, timedFormal.rounds, timedFormal.durationMs], ['rounds', 7, 4_870_000], 'a formal debate always runs by its rounds');
  assert.equal(conversationConfig('Topic', { completion: 'duration', durationMs: 3_600_000 }).maxRequests, 740, 'a time set in Options gets requests for all of it');
  assert.equal(conversationConfig('Talk for 900 minutes').maxRequests, 10_000, 'a long time in the topic is capped, not refused');
});

test('Q3: answers are checked whole: decimals, fractions and alternatives don\'t pass for a whole number; marks apply to keys too', () => {
  for (const [answer, key, right] of [['3.5', '3', false], ['3/4', '3', false], ['3 or 4', '3', false], ['2^10 = 1024', '1024', true], ['7 × 13 = 91', '91', true], ['−3', '-3', true], ['5623 (base 7)', '5623', true], ['x_1', 'x_1', true], ['0.5', '1/2', true]] as const)
    assert.equal(matches(answer, key), right, `${answer} for ${key}`);
  assert.equal(finalAnswer('**ANSWER: `5623_7`**'), '5623_7');
});

test('Q3: "…for N minutes" in a room message doesn\'t retime a debate with rounds', async () => {
  const { factory, service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'q3-broadcast' }) as Pair; await activate(service, pair);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Cats or dogs?', requestId: 'start', options: { paceMs: 0, rounds: 3 } }) as { id: string }; await flush();
    await service.call('run.broadcast', { runId: run.id, text: 'You have the floor for 2 minutes.', requestId: 'b1' });
    const live = factory.agents.filter(a => !a.closed);
    for (let turn = 0; turn < 3; turn++) { for (const agent of live) for (let i = 0; i < agent.calls.length; i++) if (!agent.calls[i]!.settled) agent.answer(`reply ${turn}`, false, i); await flush(); }
    const config = service.store.run(run.id).config;
    assert.deepEqual([config.completion, config.rounds], ['rounds', 3]);
    assert.equal(service.store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=? AND type='duration_changed'").get(run.id)!.n, 0);
  } finally { await service.shutdown(); service.store.close(); }
});

test('Q4: a run needing attention that nothing here is working on doesn\'t keep the service busy; a judge or command does', async () => {
  // A service that died mid-run: its run is quarantined at the next start, and nothing here works on it.
  const dir = tempDir('ava-busy-'), store = new Store(join(dir, 'ava.sqlite')), pair = store.createPair('busy');
  for (const seat of ['cli1', 'cli2'] as const) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.generation = 1; s.config = { provider: 'codex', model: 'model', auth: 'provider-login' }; s.sessionId = 'old-' + seat; s.verifiedAt = 1; });
  const { run } = store.start(pair.id, conversationConfig('topic'), 'start'); store.admit(run.id, ['cli1'], store.queued(run.id)[0]!.id); store.close();
  const service = new AvAService(dir, new TestFactory(), 'simulation');
  try {
    assert.equal(service.store.run(service.store.pair(pair.id).activeRunId!).status, 'needs_attention');
    assert.equal(service.busyReason(), '', 'a newer install may take over, and the daemon may exit when idle');
    (service as unknown as { judging: Map<string, symbol> }).judging.set('some-run', Symbol('some-run'));
    assert.equal(service.busyReason(), 'a judge is scoring a debate');
  } finally { await service.shutdown(); service.store.close(); }
});

test('Q4: shutdown doesn\'t wait forever for an agent that never confirms closing', async () => {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-close-wait-'), factory, 'simulation', { closeWaitMs: 300 });
  const pair = await service.call('pair.create', { thread: 'stuck' }) as Pair; await activate(service, pair, ['cli1']);
  factory.agents[0]!.close = () => new Promise<void>(() => {});
  const started = Date.now(); await service.shutdown(); service.store.close();
  assert.ok(Date.now() - started < 5000, `shutdown took ${Date.now() - started} ms`);
});

test('Q4: nothing starts on a pair while its thread is closing', async () => {
  const { factory, service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'closing' }) as Pair; await activate(service, pair);
    let release!: () => void; const held = new Promise<void>(r => { release = r; });
    for (const agent of factory.agents) { const close = agent.close.bind(agent); agent.close = async () => { await held; await close(); }; }
    const closing = service.call('pair.close', { pairId: pair.id, requestId: 'close' });
    for (let i = 0; i < 50 && !(service as unknown as { ending: Set<string> }).ending.size; i++) await new Promise(r => setTimeout(r, 5));
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Sneak in', requestId: 'sneak', options: { paceMs: 0 } }), /thread is closing/);
    release(); await closing;
  } finally { await service.shutdown(); service.store.close(); }
});

test('Q6: the room\'s event pages leave out the messages; a suite kept in git loads its task folders; a project its repository ignores is copied whole', async () => {
  const { service } = fixture();
  try {
    const pair = await service.call('pair.create', { thread: 'q6' }) as Pair; await activate(service, pair);
    const run = await service.call('run.start', { pairId: pair.id, text: 'topic', requestId: 'start', options: { paceMs: 0 } }) as { id: string }; await flush();
    const page = await service.call('run.get', { runId: run.id, eventsOnly: true }) as { messages?: unknown; events: unknown[] };
    assert.equal(page.messages, undefined); assert.ok(page.events.length);
  } finally { await service.shutdown(); service.store.close(); }
  const suite = tempDir('ava-suite-git-'); cpSync(join('benchmarks', 'starter', 'csv-parser'), join(suite, 'csv-parser'), { recursive: true });
  for (const dir of ['.git', '.github', 'scripts']) { mkdirSync(join(suite, dir)); writeFileSync(join(suite, dir, 'README'), 'not a task'); }
  assert.deepEqual(loadSuite(suite).map(t => t.spec.id), ['csv-parser']);
  if (spawnSync('git', ['--version']).status !== 0) return;
  const repo = tempDir('ava-ignoring-repo-'); spawnSync('git', ['init', '-q'], { cwd: repo, windowsHide: true }); writeFileSync(join(repo, '.gitignore'), 'project/\n');
  mkdirSync(join(repo, 'project')); writeFileSync(join(repo, 'project', 'app.js'), 'x');
  const copy = join(tempDir('ava-ignored-copy-'), 'copy');
  assert.equal(copyProject(join(repo, 'project'), copy).files, 1, 'not an empty folder');
});
