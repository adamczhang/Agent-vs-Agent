import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { AvAService } from '../src/service.js';
import { buildPermission } from '../src/providers.js';
import { Previews, appTarget, pageIn } from '../src/preview.js';
import { checkProject, copyProject, inlineProject, participantWorkspace, projectChanges, startProject } from '../src/workspace.js';
import { SEATS, type Pair, type Run } from '../src/types.js';
import type { AgentJobs } from '../src/jobs.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const project = (git: boolean) => {
  const dir = tempDir('ava-project-');
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.js'), 'export const a = 1;\n'); writeFileSync(join(dir, 'node_modules', 'lib', 'x.js'), 'ignored');
  if (git) {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    const run = (...a: string[]) => spawnSync('git', a, { cwd: dir, windowsHide: true });
    run('init', '-q'); run('add', '-A'); run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'src', 'uncommitted.js'), 'export const b = 2;\n');
  }
  return dir;
};

test('a project copy takes the working tree (uncommitted work included, build output left out) and records a baseline', () => {
  for (const git of [true, false]) {
    const parent = tempDir('ava-copy-'), source = project(git), target = join(parent, 'copy'), history = join(parent, 'baselines', 'copy.git'), copied = copyProject(source, target, history);
    assert.ok(existsSync(join(target, 'src', 'a.js')) && !existsSync(join(target, 'node_modules')), `${git ? 'git' : 'plain'}: sources copied, node_modules skipped`);
    if (git) assert.ok(existsSync(join(target, 'src', 'uncommitted.js')), 'uncommitted files come along');
    assert.equal(copied.gitSource, git);
    assert.equal(copied.baseline, true, 'a baseline commit in the copy, so changes can be shown later');
    assert.ok(existsSync(join(history, 'HEAD')), 'and AvA\'s own record of it, outside the copy');
    assert.throws(() => copyProject(source, target), /already exists/);
  }
});

test('only a real project folder can be handed to the agents', () => {
  const data = tempDir('ava-data-'), source = project(false);
  assert.equal(checkProject(source, data), source);
  assert.throws(() => checkProject('relative/path', data), /full path/);
  assert.throws(() => checkProject(join(source, 'missing'), data), /not a folder/);
  assert.throws(() => checkProject(process.platform === 'win32' ? 'C:\\' : '/', data), /not a whole drive/);
  assert.throws(() => checkProject(data, data), /Agent vs Agent data/);
});

test('in a build run the gate allows work inside the agent\'s copy and nothing outside it', () => {
  const root = process.platform === 'win32' ? 'C:\\ava\\workspaces\\p\\cli1\\1' : '/ava/workspaces/p/cli1/1';
  const ask = (rawInput: unknown, locations: Array<{ path: string }> = []) => buildPermission({ raw: { toolCall: { kind: 'edit', rawInput, locations, title: 't' } } }, root).decision;
  assert.deepEqual(ask({ file_path: join(root, 'shop', 'src', 'cart.js') }), { outcome: 'allow_once' }, 'an edit in the copy');
  assert.equal(ask({ command: 'npm test' }), undefined, 'a working directory cannot confine arbitrary test scripts');
  assert.deepEqual(ask({ path: 'shop/src' }), { outcome: 'allow_once' }, 'a relative path inside');
  assert.equal(ask({ file_path: join(root, '..', '..', 'other', 'secret.txt') }), undefined, 'a path outside the copy');
  assert.equal(ask({}, [{ path: process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts' }]), undefined, 'a location outside');
  assert.equal(ask({ command: 'curl x', sandbox_permissions: 'require_escalated' }), undefined, 'a request to leave the sandbox');
});

test('a build run copies the project into each agent\'s own workspace, grants access only while it runs, and never touches the original', async () => {
  const data = tempDir('ava-build-'), factory = new TestFactory(), service = new AvAService(data, factory, 'simulation'), source = project(true);
  try {
    const pair = await service.call('pair.create', { thread: 'build' }) as Pair;
    for (const [seat, provider] of [['cli1', 'codex'], ['cli2', 'claude']] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider, model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const [codex, claude] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const before = readFileSync(join(source, 'src', 'a.js'), 'utf8');
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Find bugs', requestId: 'nobuild', options: { mode: 'build' } }), /project folder/);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Find bugs in the cart', requestId: 'r1', options: { mode: 'build' }, build: { kind: 'review', path: source } }) as { id: string; config: { build: { folder: string } } };
    await flush();
    const roots = (['cli1', 'cli2'] as const).map(seat => participantWorkspace(data, { pairId: pair.id, seat, generation: service.store.pair(pair.id).slots[seat].generation }));
    for (const root of roots) assert.ok(existsSync(join(root, run.config.build.folder, 'src', 'a.js')), 'each agent has its own copy in its workspace');
    assert.ok([codex, claude].every(a => a.calls.at(-1)!.request.text.includes(`folder "${run.config.build.folder}"`) && a.calls.at(-1)!.request.text.includes('Find bugs in the cart')), 'both get the same task pointing at their copy');
    // A small project's files come with the prompt, numbered by line, for agents that read files only through commands.
    assert.ok([codex, claude].every(a => a.calls.at(-1)!.request.text.includes(`--- src/a.js ---\n   1 | ${before.split(/\r?\n/)[0]}`)), 'the review prompt carries the numbered files');
    assert.deepEqual([codex.options.workspace!(), claude.options.workspace!()], roots, 'the gate knows each agent\'s workspace while the run is active');
    assert.deepEqual(codex.buildAccess, [true], 'Codex is switched to workspace-write for the run');
    assert.deepEqual(await service.call('run.start', { pairId: pair.id, text: 'Find bugs in the cart', requestId: 'r1', options: { mode: 'build' }, build: { kind: 'review', path: source } }), service.store.run(run.id), 'a retried start returns the same run and copies nothing again');
    codex.raw('1. src/a.js:1 low: fine.'); claude.raw('No issues found.'); await flush(); await flush();
    const done = service.store.run(run.id);
    assert.deepEqual([done.status, done.reason], ['completed', 'build_done']);
    assert.deepEqual([codex.options.workspace!(), claude.options.workspace!()], [undefined, undefined], 'no build access once the run is over');
    assert.equal(readFileSync(join(source, 'src', 'a.js'), 'utf8'), before, 'the original is untouched');
    const view = await service.call('thread.get', { threadId: (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string; mode: string }> }).threads[0]!.id }) as { thread: { mode: string } };
    assert.equal(view.thread.mode, 'build');
    // A 1:1 message afterwards: Codex is back to read-only first.
    await service.call('direct.send', { pairId: pair.id, seat: 'cli1', text: 'Thanks', requestId: 'd1' }); await flush();
    assert.deepEqual(codex.buildAccess, [true, false]);
  } finally { await service.shutdown(); service.store.close(); }
});

test('changes since the baseline list new, edited and deleted files, without touching the agent\'s own git state', async () => {
  const parent = tempDir('ava-copy-'), copy = join(parent, 'copy'), history = join(parent, 'copy.git'); copyProject(project(false), copy, history);
  writeFileSync(join(copy, 'src', 'a.js'), 'export const a = 2;\nexport const c = 3;\n');
  writeFileSync(join(copy, 'index.html'), '<h1>hi</h1>\n');
  writeFileSync(join(copy, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  spawnSync('git', ['add', 'index.html'], { cwd: copy, windowsHide: true });
  const staged = () => spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: copy, encoding: 'utf8', windowsHide: true }).stdout;
  const before = staged(), changes = await projectChanges(copy, history);
  assert.deepEqual(changes.files.map(f => [f.path, f.status]).sort(), [['index.html', 'added'], ['logo.png', 'added'], ['src/a.js', 'modified']]);
  assert.deepEqual(changes.files.find(f => f.path === 'src/a.js'), { path: 'src/a.js', status: 'modified', added: 2, removed: 1 });
  assert.equal(changes.files.find(f => f.path === 'logo.png')!.added, null, 'a binary file has no line counts');
  assert.match(changes.patch, /\+export const c = 3;/);
  assert.equal(staged(), before, 'the agent\'s own index is untouched');
  rmSync(join(copy, 'src', 'a.js'));
  assert.equal((await projectChanges(copy, history)).files.find(f => f.path === 'src/a.js')!.status, 'deleted');
  // A copy made before AvA kept its own record reads the baseline from the copy's objects, with the same result.
  assert.deepEqual((await projectChanges(copy)).files, (await projectChanges(copy, history)).files);
  // The agent's own commits, and even a removed .git, don't move the baseline AvA compares with.
  spawnSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@a', 'commit', '-qam', 'agent'], { cwd: copy, windowsHide: true });
  rmSync(join(copy, '.git'), { recursive: true, force: true });
  assert.equal((await projectChanges(copy, history)).files.find(f => f.path === 'src/a.js')!.status, 'deleted');
  await assert.rejects(projectChanges(copy), /no baseline/);
  const emptyParent = tempDir('ava-empty-'), empty = join(emptyParent, 'app'), emptyHistory = join(emptyParent, 'app.git');
  assert.equal(startProject(empty, emptyHistory).baseline, true, 'building from scratch starts with an empty baseline');
  assert.deepEqual((await projectChanges(empty, emptyHistory)).files, []);
});

const raw = (port: number, path: string, headers: Record<string, string>) => new Promise<number>((done, fail) => {
  request({ host: '127.0.0.1', port, path, headers }, res => { res.resume(); done(res.statusCode!); }).on('error', fail).end();
});

test('Build preparation leaves the event loop and health responsive, and locks conflicting pair changes',async()=>{
  const service=new AvAService(tempDir('ava-copy-responsive-'),new TestFactory(),'simulation');
  try{
    const pair=await service.call('pair.create',{thread:'copy-responsive'}) as Pair;
    for(const seat of ['cli1','cli2']){
      await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:'codex',model:'model',auth:'provider-login'}});
      await service.call('slot.activate',{pairId:pair.id,seat});
    }
    let finished=false;
    const copy=service.call('run.start',{pairId:pair.id,text:'Review',requestId:'async-copy',options:{mode:'build'},build:{kind:'review',path:project(false)}}).then(result=>{finished=true;return result;});
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(finished,false,'copy and git work run off the service thread');
    assert.equal((await service.call('health',{}) as {mode:string}).mode,'simulation');
    await assert.rejects(service.call('history.clear',{requestId:'clear-during-copy'}),/being prepared/);
    await assert.rejects(service.call('slot.cancel',{pairId:pair.id,seat:'cli1'}),/being prepared/);
    await copy;
  }finally{await service.shutdown();service.store.close();}
});
test('a preview serves an agent\'s copy on its own port, only through the room\'s link, and nothing outside the copy', async () => {
  const dir = tempDir('ava-site-'); mkdirSync(join(dir, 'dist', 'assets'), { recursive: true }); mkdirSync(join(dir, 'dist', '.git'));
  writeFileSync(join(dir, 'dist', 'index.html'), '<script src="/assets/app.js"></script>'); writeFileSync(join(dir, 'dist', 'assets', 'app.js'), '1');
  writeFileSync(join(dir, 'dist', '.git', 'config'), 'x'); writeFileSync(join(dir, 'secret.txt'), 'outside the served folder');
  const previews = new Previews(), place = pageIn(dir);
  try {
    assert.deepEqual([place.entry, place.page], ['dist/index.html', 'index.html'], 'a built site is found in dist/ and served from there');
    const opened = await previews.open('run:cli1', place.root, place.page), url = new URL(opened.url);
    const get = (path: string, cookie?: string) => fetch(`${url.origin}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    assert.equal((await get('/index.html')).status, 403, 'no cookie, no file');
    assert.equal((await get(`/__ava/open?key=${'f'.repeat(64)}&path=index.html`)).status, 403, 'a wrong key');
    const open = await get(url.pathname + url.search);
    assert.equal(open.status, 302); assert.equal(open.headers.get('location'), '/index.html');
    assert.match(open.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
    const cookie = open.headers.get('set-cookie')!.split(';')[0]!;
    const page = await get('/index.html', cookie);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type')!, /text\/html/);
    assert.equal(await (await get('/assets/app.js', cookie)).text(), '1', 'root-relative links resolve inside the served folder');
    for (const bad of ['/..%2fsecret.txt', '/..%5csecret.txt', '/.git/config', '/missing.js']) assert.equal((await get(bad, cookie)).status, 404, bad);
    assert.equal(await raw(Number(url.port), '/index.html', { host: 'evil.example', cookie }), 403, 'another host name (DNS rebinding) is refused');
    assert.equal((await previews.open('run:cli1', place.root, place.page)).url, opened.url, 'the same server is reused');
  } finally { previews.closeAll(); }
});

test('in a prompt or build, an agent whose provider ends its turn leaves its answer out; the other agent still answers', async () => {
  for (const mode of ['benchmark', 'build'] as const) {
    const data = tempDir('ava-unfinished-'), factory = new TestFactory(), service = new AvAService(data, factory, 'simulation');
    try {
      const pair = await service.call('pair.create', { thread: 'unfinished' }) as Pair;
      for (const seat of ['cli1', 'cli2'] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'claude', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
      const [one, two] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
      const run = await service.call('run.start', { pairId: pair.id, text: 'Build a game', requestId: 'u1', options: { mode }, ...(mode === 'build' ? { build: { kind: 'build' } } : {}) }) as { id: string };
      await flush();
      // Agent 1's provider ends the turn itself (as Grok Build does after a refused permission).
      const call = one.calls.at(-1)!; call.settled = true; call.resolve({ status: 'cancelled', text: '' }); await flush(); await flush();
      assert.equal(service.store.run(run.id).status, 'running', `${mode}: the run keeps going for the other agent`);
      two.raw('Here is my answer.');
      for (let i = 0; i < 100 && service.store.run(run.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
      assert.deepEqual([service.store.run(run.id).status, service.store.run(run.id).reason], ['completed', 'agent_unfinished'], mode);
      assert.deepEqual(service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.sender), ['cli2']);
      const notes = service.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='activity'").all(run.id).map(r => JSON.parse(String(r.data)) as { seat: string; text: string });
      assert.ok(notes.some(n => n.seat === 'cli1' && /Stopped without finishing: Provider cancelled the turn/.test(n.text)), 'its screen says why');
    } finally { await service.shutdown(); service.store.close(); }
  }
});

test('the app an agent names at the end of its report: a page in its workspace or a local server, nothing else', () => {
  const ws = tempDir('ava-ws-'); mkdirSync(join(ws, 'app-1')); writeFileSync(join(ws, 'app-1', 'index.html'), 'x');
  assert.deepEqual(appTarget('Done.\nAPP: app-1/index.html', ws), { kind: 'page', path: join('app-1', 'index.html') });
  assert.deepEqual(appTarget('Done.\n**APP:** `./app-1/index.html`.', ws), { kind: 'page', path: join('app-1', 'index.html') }, 'markdown and punctuation around it');
  assert.deepEqual(appTarget(`APP: ${join(ws, 'app-1')}`, ws), { kind: 'page', path: 'app-1' }, 'an absolute path inside the workspace, or a folder');
  assert.deepEqual(appTarget('APP: http://localhost:5173/', ws), { kind: 'server', url: 'http://localhost:5173/', port: 5173 });
  assert.deepEqual(appTarget('APP: [app](http://127.0.0.1:8080/play)', ws), { kind: 'server', url: 'http://127.0.0.1:8080/play', port: 8080 });
  for (const bad of ['APP: https://example.com/', 'APP: ../outside.html', 'APP: app-1/missing.html', 'No app line', 'APP: http://localhost/']) assert.equal(appTarget(bad, ws), undefined, bad);
  assert.deepEqual(appTarget('APP: app-1\nfixed it\nAPP: app-1/index.html', ws), { kind: 'page', path: join('app-1', 'index.html') }, 'the last one counts');
});

test('a Build session: 1:1 setup with tools, an empty folder per agent, the named app, cleanup, changes, previews, Clear Session and Clear history', async () => {
  const data = tempDir('ava-build-'), factory = new TestFactory(), stopped: number[][] = [];
  let pairId = '', runId = '', at = 0;
  // cli1's recorded adapter (4242) runs its CLI (4243, from before the run). During the run it started an app server
  // (cmd 5000 running node 5001, listening on 5173) and a watcher (5002); cli2's tree has nothing left.
  const processes = () => {
    const since = runId ? Date.parse(service.store.run(runId).createdAt!) : 0;
    return [{ pid: 4242, ppid: 1, started: at, name: 'node.exe' }, { pid: 4243, ppid: 4242, started: at - 1000, name: 'claude.exe' },
      { pid: 5000, ppid: 4243, started: since + 1000, name: 'cmd.exe' }, { pid: 5001, ppid: 5000, started: since + 1500, name: 'node.exe' },
      { pid: 5002, ppid: 4243, started: since + 2000, name: 'tsc.exe' }, { pid: 6000, ppid: 1, started: since + 1000, name: 'other.exe' },
      // A CLI helper started during the turn (kept, with its console host); a shell it ran is still a leftover.
      { pid: 5100, ppid: 4243, started: since + 500, name: 'codex-command-runner-0.159.3.exe' }, { pid: 5101, ppid: 5100, started: since + 600, name: 'conhost.exe' },
      { pid: 5102, ppid: 5100, started: since + 700, name: 'pwsh.exe' },
      // Left the tree (its parent, 9999, has exited): only cli1's job object still knows it.
      { pid: 5200, ppid: 9999, started: since + 800, name: 'orphan.exe' }];
  };
  const jobs = { scopeMembers: async (prefix: string) => prefix.startsWith(`${pairId}/cli1/`) ? [4243, 5000, 5001, 5002, 5200] : [], dispose() {} } as unknown as AgentJobs;
  const service: AvAService = new AvAService(data, factory, 'simulation', {
    processes: async () => processes(), stopProcesses: async pids => { stopped.push(pids); }, listeners: async port => port === 5173 ? [5001] : [], jobs,
  });
  try {
    const pair = await service.call('pair.create', { thread: 'scratch' }) as Pair; pairId = pair.id;
    for (const seat of ['cli1', 'cli2'] as const) { await service.call('slot.configure', { pairId, seat, config: { provider: seat === 'cli1' ? 'claude' : 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId, seat }); }
    const generation = (seat: 'cli1' | 'cli2') => service.store.pair(pairId).slots[seat].generation;
    service.store.spawned({ pid: 4242, pairId, seat: 'cli1', generation: generation('cli1') }); at = Date.parse(service.store.seatProcesses(pairId, 'cli1', generation('cli1'))[0]!.spawnedAt);
    const [one, two] = factory.agents as [typeof factory.agents[number], typeof factory.agents[number]];
    const workspaces = (['cli1', 'cli2'] as const).map(seat => participantWorkspace(data, { pairId, seat, generation: generation(seat) }));

    // Before the prompt: a 1:1 line can prepare files inside its workspace without approving execution.
    await service.call('direct.send', { pairId, seat: 'cli2', text: 'Prepare the starter files', requestId: 'd1', tools: true }); await flush();
    assert.equal(two.options.workspace!(), workspaces[1], 'its workspace is open to it while it answers');
    assert.deepEqual(two.buildAccess, [true], 'Codex may write there for it');
    assert.match(two.calls.at(-1)!.request.text, /You may use scoped file tools/);
    assert.match(two.calls.at(-1)!.request.text, /Ask mode refuses command execution/);
    two.raw('Files ready.'); for (let i = 0; i < 50 && two.options.workspace!(); i++) await new Promise(r => setTimeout(r, 2));
    assert.equal(two.options.workspace!(), undefined, 'and closed again once it has answered');

    await assert.rejects(service.call('run.start', { pairId, text: 'Review it', requestId: 'r0', options: { mode: 'build' }, build: { kind: 'review' } }), /folder for the agents to review/);
    await new Promise(r => setTimeout(r, 5));
    const run = await service.call('run.start', { pairId, text: 'Build a Snake game', requestId: 'r1', options: { mode: 'build' }, build: { kind: 'build' } }) as { id: string; generations: { cli1: number }; config: { build: { folder: string; source: string } } };
    runId = run.id; await flush();
    assert.equal(run.config.build.source, '');
    const copies = workspaces.map(w => join(w, run.config.build.folder));
    assert.ok(copies.every(c => existsSync(join(c, '.git'))), 'each agent gets its own empty folder with a baseline');
    const prompt = one.calls.at(-1)!.request.text;
    assert.ok(prompt.includes('it starts empty') && prompt.includes('You may use existing files') && prompt.includes(`APP: ${run.config.build.folder}/index.html`), 'the prompt: an empty folder, earlier files, and the APP line');
    assert.match(prompt, /Ask mode permits scoped file tools only/);
    await assert.rejects(service.call('run.broadcast', { runId: run.id, text: 'Faster!', requestId: 'b1' }), /no further messages/, 'no steering during a build');
    mkdirSync(join(copies[1]!, 'game')); writeFileSync(join(copies[1]!, 'game', 'index.html'), '<h1>Snake 2</h1>\n');
    writeFileSync(join(copies[0]!, 'server.js'), 'listen(5173)\n');
    one.raw('Built a Snake server.\nAPP: http://localhost:5173/'); two.raw(`Built Snake.\nAPP: ${run.config.build.folder}/game/index.html`);
    for (let i = 0; i < 200 && service.store.run(run.id).status !== 'completed'; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(service.store.run(run.id).reason, 'build_done');

    // Cleanup: the watcher, the shell under the CLI's helper, and the process only its job still holds are stopped; the
    // app server it named keeps running (with its cmd parent); the helper itself, the agent and unrelated processes are not touched.
    assert.deepEqual(stopped.map(s => [...s].sort()), [[5002, 5102, 5200]]);
    const events = service.store.db.prepare("SELECT type,data FROM events WHERE run_id=? AND type IN ('build_cleanup','build_server','activity')").all(run.id).map(r => ({ type: String(r.type), data: JSON.parse(String(r.data)) }));
    assert.deepEqual(events.find(e => e.type === 'build_cleanup')!.data.stopped.map((p: { pid: number }) => p.pid).sort(), [5002, 5102, 5200]);
    assert.deepEqual(events.find(e => e.type === 'build_server')!.data.processes.map((p: { pid: number }) => p.pid).sort(), [5000, 5001]);
    assert.ok(events.some(e => e.type === 'activity' && /keeps running at http:\/\/localhost:5173\//.test(e.data.text)) && events.some(e => e.type === 'activity' && /Stopped 3 processes it left running: .*orphan\.exe/.test(e.data.text)), 'the agent screen says what was kept and stopped');
    // Closing the agent leaves its kept app server running.
    assert.deepEqual((await one.options.keep!()).sort(), [5000, 5001]); assert.deepEqual(await two.options.keep!(), []);


    const changes = await service.call('build.changes', { runId: run.id, seat: 'cli1' }) as { files: Array<{ path: string; status: string }> };
    assert.deepEqual(changes.files.map(f => [f.path, f.status]), [['server.js', 'added']]);
    // Q1: AvA compares with its own record of the baseline, so even a copy whose .git the agent removed still shows them.
    rmSync(join(participantWorkspace(service.dataRoot, { pairId, seat: 'cli1', generation: run.generations.cli1 }), run.config.build.folder, '.git'), { recursive: true, force: true });
    assert.deepEqual(await service.call('build.changes', { runId: run.id, seat: 'cli1' }), changes);
    assert.deepEqual((await service.call('build.preview', { runId: run.id, seat: 'cli1' }) as { kind: string; url: string }), { kind: 'server', url: 'http://localhost:5173/', origin: 'http://localhost:5173', entry: 'http://localhost:5173/', named: true }, 'a server app opens at its own address');
    const preview = await service.call('build.preview', { runId: run.id, seat: 'cli2' }) as { kind: string; url: string; entry: string; named: boolean };
    assert.deepEqual([preview.kind, preview.entry, preview.named], ['static', `${run.config.build.folder}/game/index.html`, true], 'the page it named');
    const opened = await fetch(preview.url, { redirect: 'manual' }), cookie = opened.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal(await (await fetch(new URL('/index.html', preview.url), { headers: { cookie } })).text(), '<h1>Snake 2</h1>\n');

    // A 1:1 line after a Debate-only thread can't use tools. Clear Session stops the kept server (topmost process).
    stopped.length = 0;
    await service.call('pair.clear', { pairId, requestId: 'c1' });
    assert.deepEqual(stopped, [[5000]], 'Clear Session stops the app server it kept');
    const debate = await service.call('run.start', { pairId, text: 'Talk', requestId: 'r4', options: { mode: 'conversation' } }) as { id: string };
    await service.call('run.control', { runId: debate.id, action: 'stop' }); for (let i = 0; i < 100 && service.store.pair(pairId).activeRunId; i++) await new Promise(r => setTimeout(r, 5));
    await assert.rejects(service.call('direct.send', { pairId, seat: 'cli1', text: 'clone', requestId: 'd2', tools: true }), /Only a Build session/);

    // Clear history: everything saved goes, old workspaces too; the room's agents get fresh sessions.
    const before = service.store.pair(pairId).slots.cli1.generation;
    const cleared = await service.call('history.clear', { pairId, requestId: 'h1' }) as { threads: number; runs: number; workspacesRemoved: number };
    assert.equal(cleared.runs, 2); assert.ok(cleared.threads >= 2); assert.equal(cleared.workspacesRemoved, 2, 'the build session\'s workspaces (the fakes make no others)');
    assert.ok(!existsSync(copies[0]!), 'the build folders are gone');
    assert.ok(service.store.pair(pairId).slots.cli1.generation > before, 'fresh sessions');
    assert.deepEqual((await service.call('threads.list', { pairId }) as { threads: Array<{ empty: boolean }> }).threads.filter(t => !t.empty), []);
    assert.equal(service.store.db.prepare('SELECT COUNT(*) AS n FROM direct_messages').get()!.n, 0);
  } finally { await service.shutdown(); service.store.close(); }
});

test('a Review prompt inlines a small project without build output, likely secrets or binary files, and never fails the run', () => {
  const dir = tempDir('ava-inline-');
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src', 'a.js'), 'one\r\ntwo\n');
  writeFileSync(join(dir, '.env'), 'API_KEY=secret-value'); writeFileSync(join(dir, '.env.example'), 'API_KEY=');
  writeFileSync(join(dir, 'server.pem'), '-----BEGIN PRIVATE KEY-----');
  mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist', 'bundle.js'), 'built');
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0, 1]));
  const text = inlineProject(dir);
  assert.match(text, /--- src\/a\.js ---\n {3}1 \| one\n {3}2 \| two/);
  assert.match(text, /--- \.env\.example ---/, 'an example environment file holds no secrets');
  assert.ok(!text.includes('secret-value') && !text.includes('PRIVATE KEY') && !text.includes('bundle.js') && !text.includes('logo.png'), text);
  assert.match(text, /Not shown here because they may hold secrets: \.env, server\.pem\./);
  // The size decides before anything is read: a project over the limit inlines nothing.
  writeFileSync(join(dir, 'data.csv'), 'x'.repeat(70_000)); assert.equal(inlineProject(dir), '');
  assert.equal(inlineProject(join(dir, 'missing')), '', 'a folder that cannot be read inlines nothing');
});
test('H1: each build is its own thread: the next one gets fresh sessions for the same agents and copies of its own, and the earlier copies stay', async () => {
  const data = tempDir('ava-build-threads-'), factory = new TestFactory();
  const service = new AvAService(data, factory, 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'builds' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: seat === 'cli1' ? 'claude' : 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const live = () => factory.agents.filter(a => !a.closed);
    const build = async (text: string, requestId: string) => {
      const run = await service.call('run.start', { pairId: pair.id, text, requestId, options: { mode: 'build' }, build: { kind: 'build' } }) as Run;
      await flush(); for (const agent of live()) agent.raw(`Done.\nAPP: ${run.config.build!.folder}/index.html`);
      for (let i = 0; i < 200 && service.store.run(run.id).status !== 'completed'; i++) await new Promise(r => setTimeout(r, 5));
      return service.store.run(run.id);
    };
    const copyOf = (run: Run, seat: 'cli1' | 'cli2') => join(participantWorkspace(data, { pairId: pair.id, seat, generation: run.generations[seat] }), run.config.build!.folder);
    const first = await build('Build a clock', 'b1');
    assert.equal(first.reason, 'build_done');
    const second = await build('Build a timer', 'b2');
    assert.equal(second.reason, 'build_done', 'no Clear Session needed between builds');
    assert.ok(SEATS.every(s => second.generations[s] > first.generations[s]), 'fresh sessions');
    assert.deepEqual(SEATS.map(s => service.store.pair(pair.id).slots[s].config?.provider), ['claude', 'codex'], 'the same agents');
    assert.ok(SEATS.every(s => existsSync(copyOf(first, s)) && existsSync(join(copyOf(second, s), '.git'))), 'each build has its own copies, and the first keeps its own');
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ runIds: string[] }> }).threads.filter(t => t.runIds.length);
    assert.deepEqual(threads.map(t => t.runIds.length), [1, 1], 'one build per thread');
    // A run of another mode in this pair starts its own thread as well, so a thread never mixes modes.
    const talk = await service.call('run.start', { pairId: pair.id, text: 'Talk', requestId: 'c1', options: { mode: 'conversation', paceMs: 0 } }) as Run;
    assert.ok(SEATS.every(s => talk.generations[s] > second.generations[s]));
  } finally { await service.shutdown(); service.store.close(); }
});
