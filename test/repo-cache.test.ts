import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkRemoteHunt, checkRepoUrl, fetchRepo, remoteHead, repoCache, repoName } from '../src/repo-cache.js';
import { copyProject, participantWorkspace } from '../src/workspace.js';
import { AvAService } from '../src/service.js';
import { SEATS, type Pair, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', windowsHide: true });
// A repository "on the web": served through file://, which speaks git's network protocol, and allows what GitHub does
// (partial fetches, and fetching an object by its hash).
function served() {
  const source = tempDir('ava-remote-');
  mkdirSync(join(source, 'src', 'parser'), { recursive: true }); mkdirSync(join(source, 'docs')); mkdirSync(join(source, 'tests'));
  writeFileSync(join(source, 'src', 'parser', 'read.py'), 'def read(text):\n    return text.split(",")\n');
  writeFileSync(join(source, 'src', 'main.py'), 'from parser.read import read\n');
  writeFileSync(join(source, 'docs', 'guide.md'), '# Guide\n'.repeat(50)); writeFileSync(join(source, 'tests', 'test_read.py'), 'assert read("a,b") == ["a", "b"]\n');
  git(source, 'init', '-q'); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'one');
  const commit = git(source, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(source, 'src', 'main.py'), '# later work\n'); git(source, 'commit', '-qam', 'two');
  for (const [k, v] of [['uploadpack.allowFilter', 'true'], ['uploadpack.allowAnySHA1InWant', 'true']]) git(source, 'config', k!, v!);
  return { source, commit, head: git(source, 'rev-parse', 'HEAD').stdout.trim(), url: checkRepoUrl(pathToFileURL(source).href) };
}
const blobs = (gitDir: string) => spawnSync('git', [`--git-dir=${gitDir}`, 'cat-file', '--batch-all-objects', '--batch-check=%(objecttype)'], { encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } }).stdout.split('\n').filter(t => t === 'blob').length;

test('H7: a repository on the web is its https address, without a user name, password or query', () => {
  assert.equal(checkRepoUrl('https://github.com/owner/repo/'), 'https://github.com/owner/repo');
  assert.equal(repoName('https://github.com/owner/repo.git'), 'repo');
  for (const bad of ['http://github.com/owner/repo', 'git@github.com:owner/repo.git', 'ssh://github.com/owner/repo', 'https://user:secret@github.com/owner/repo', 'https://github.com/owner/repo?x=1', 'https://github.com/', 'ext::sh -c touch% /tmp/x'])
    assert.throws(() => checkRepoUrl(bad), /address/, bad);
  assert.notEqual(repoCache('D:/data', 'https://github.com/a/repo'), repoCache('D:/data', 'https://github.com/b/repo'), 'one cache per address');
});

test('H7: AvA fetches one commit and only the slice\'s files, once; copies come from its cache without history', { skip: !hasGit }, async () => {
  const { source, commit, head, url } = served(), data = tempDir('ava-remote-data-');
  assert.equal(await remoteHead(url), head);
  await assert.rejects(fetchRepo(data, url, commit.slice(0, 7)), /full hash/);
  const fetched = await fetchRepo(data, url, commit, { include: ['src'], exclude: ['src/main.py'] });
  assert.deepEqual([fetched.files, blobs(fetched.gitDir)], [1, 1], 'only the slice\'s one file was downloaded');
  assert.equal(spawnSync('git', [`--git-dir=${fetched.gitDir}`, 'rev-list', '--count', '--all'], { encoding: 'utf8' }).stdout.trim(), '1', 'no history, and the commit kept by a ref');
  // A copy, with a bug planted, from the cache (bare): the slice at that commit, and only AvA's baseline as history.
  const parent = tempDir('ava-remote-copy-'), target = join(parent, 'copy');
  const copied = copyProject(fetched.gitDir, target, join(parent, 'copy.git'), { commit, include: ['src'], exclude: ['src/main.py'], plant: [{ file: 'src/parser/read.py', find: 'split(",")', replace: 'split(";")', what: 'wrong separator' }], bare: true });
  assert.deepEqual([copied.files, copied.planted?.[0]?.line], [1, 2]);
  assert.equal(readFileSync(join(target, 'src', 'parser', 'read.py'), 'utf8'), 'def read(text):\n    return text.split(";")\n');
  assert.ok(!existsSync(join(target, 'docs')) && !existsSync(join(target, 'tests')) && !existsSync(join(target, 'src', 'main.py')));
  assert.equal(git(target, 'rev-list', '--count', 'HEAD').stdout.trim(), '1');
  // The repository can go away: the cache has what the hunt needs. A wider slice needs the repository again.
  const moved = `${source}-moved`; renameSync(source, moved);
  try {
    assert.equal((await fetchRepo(data, url, commit, { include: ['src'], exclude: ['src/main.py'] })).files, 1);
    await assert.rejects(fetchRepo(data, url, commit, { include: ['docs'] }), /Could not fetch the files/);
  } finally { renameSync(moved, source); }
  assert.equal((await fetchRepo(data, url, commit, { include: ['docs'] })).files, 1);
  await assert.rejects(fetchRepo(data, url, 'f'.repeat(40)), /Could not fetch commit fffffff/);
  assert.equal(git(source, 'status', '--porcelain').stdout, '', 'the repository is untouched');
});

test('H7: the check for a repository on the web gives its default branch, fills the cache, and checks each planted bug', { skip: !hasGit }, async () => {
  const { commit, head, url } = served(), data = tempDir('ava-remote-check-');
  const result = await checkRemoteHunt(data, url, { commit, include: ['src'], bugs: [{ file: 'src/parser/read.py', find: 'split(",")' }, { file: 'docs/guide.md', find: 'Guide' }, { file: 'src/nope.py', find: 'x' }] });
  assert.deepEqual([result.folder, result.head, result.commitFound, result.files, result.bugs], [url, head, true, 2, ['ok', 'excluded', 'no-file']]);
  assert.deepEqual([(await checkRemoteHunt(data, url, {})).commitFound, (await checkRemoteHunt(data, url, {})).files], [null, 4], 'no commit: the default branch\'s');
  assert.equal((await checkRemoteHunt(data, url, { commit: head.slice(0, 7) })).commitFound, true, 'a short hash of the default branch is that commit');
  const missing = await checkRemoteHunt(data, url, { commit: 'f'.repeat(40) });
  assert.equal(missing.commitFound, false); assert.match(missing.problem ?? '', /Could not fetch commit/);
  await assert.rejects(checkRemoteHunt(data, url, { commit: 'abcdef1' }), /full hash/);
  const gone = await checkRemoteHunt(data, checkRepoUrl(pathToFileURL(join(data, 'no-such-repo')).href), {});
  assert.equal(gone.head, null); assert.match(gone.problem ?? '', /Could not reach/);
});

test('H7: a scored hunt in a repository on the web runs end to end, and records the commit it copied', { skip: !hasGit }, async () => {
  const { commit, url } = served(), factory = new TestFactory();
  const service = new AvAService(tempDir('ava-remote-service-'), factory, 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'remote-hunt' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const hunt = { commit, include: ['src/parser'], bugs: [{ file: 'src/parser/read.py', find: 'split(",")', replace: 'split(";")', what: 'wrong separator' }] };
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Hunt', requestId: 'short', options: { mode: 'build' }, build: { kind: 'review', path: url, hunt: { ...hunt, commit: commit.slice(0, 7) } } }), /full hash/);
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Hunt', requestId: 'http', options: { mode: 'build' }, build: { kind: 'review', path: 'http://example.com/repo', hunt } }), /https/);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Find the bug in the parser.', requestId: 'r1', options: { mode: 'build' }, build: { kind: 'review', path: url, hunt } }) as Run;
    await flush();
    assert.equal(run.config.build!.commit, commit); assert.match(run.config.build!.folder, /^ava-remote-/);
    for (const seat of SEATS) {
      const copy = join(participantWorkspace(service.dataRoot, { pairId: pair.id, seat, generation: run.generations[seat] }), run.config.build!.folder);
      assert.match(readFileSync(join(copy, 'src', 'parser', 'read.py'), 'utf8'), /split\(";"\)/); assert.ok(!existsSync(join(copy, 'src', 'main.py')), 'only the slice');
    }
    factory.agents[0]!.raw('BUG: src/parser/read.py:2 — splits on semicolons'); factory.agents[1]!.raw('No bugs found.');
    for (let i = 0; i < 200 && !service.store.run(run.id).hunt; i++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual([service.store.run(run.id).hunt!.winner, service.store.run(run.id).hunt!.seats.cli1.found], ['cli1', [0]]);
    // The library: a hunt on the web is saved with its full commit only.
    const save = (commitHash: string) => service.prompts.save({ id: `web-${commitHash.length}`, revision: null, name: 'Web hunt', text: '# Hunt', mode: 'build', buildKind: 'review', files: [], build: { project: url, hunt: { ...hunt, commit: commitHash } } });
    assert.throws(() => save(commit.slice(0, 7)), /full hash/);
    assert.deepEqual(save(commit).build?.hunt?.include, ['src/parser']);
  } finally { await service.shutdown(); service.store.close(); }
});
