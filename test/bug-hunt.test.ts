import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bugReports, huntResult, plantBugs } from '../src/bug-hunt.js';
import { copyProject, participantWorkspace, projectChanges } from '../src/workspace.js';
import { AvAService } from '../src/service.js';
import { SEATS, type Pair, type PlantedBug, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const hasGit = spawnSync('git', ['--version']).status === 0;
const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', windowsHide: true });

test('planted bugs: each original piece must be there once, Windows line endings are kept, and every bug knows its lines', () => {
  const root = tempDir('ava-plant-');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'calc.py'), 'def add(a, b):\r\n    return a + b\r\n\r\ndef half(n):\r\n    return n / 2\r\n');
  const bugs: PlantedBug[] = [
    { file: 'src/calc.py', find: '    return n / 2\n', replace: '    # Halve it.\n    return n // 3\n', what: 'divides by three, with integer division' },
    { file: 'src/calc.py', find: 'return a + b', replace: 'return a - b', what: 'subtracts' },
  ];
  const old = new Date('2026-01-02T03:04:05Z'); utimesSync(join(root, 'src', 'calc.py'), old, old);
  const planted = plantBugs(root, bugs);
  assert.deepEqual(planted.map(b => [b.line, b.endLine]), [[5, 6], [2, 2]], 'lines are found after every bug is in');
  // H5: a planted file keeps its time, so a listing sorted by time doesn't point at it.
  assert.equal(statSync(join(root, 'src', 'calc.py')).mtimeMs, old.getTime());
  assert.equal(readFileSync(join(root, 'src', 'calc.py'), 'utf8'), 'def add(a, b):\r\n    return a - b\r\n\r\ndef half(n):\r\n    # Halve it.\r\n    return n // 3\r\n');
  assert.throws(() => plantBugs(root, [{ file: 'src/calc.py', find: 'return a + b', replace: 'x', what: 'gone' }]), /isn’t there/);
  assert.throws(() => plantBugs(root, [{ file: '../outside.py', find: 'a', replace: 'b', what: 'x' }]), /inside the project/);
  assert.throws(() => plantBugs(root, [{ file: 'src/missing.py', find: 'a', replace: 'b', what: 'x' }]), /isn't in the copy/);
});

test('BUG lines are read however an agent writes the path, and a planted bug counts when a report lands on it', () => {
  const reply = [
    'Findings:', '1. BUG: `src/calc.py:6` — integer division by three',
    '- **BUG:** proj-1234abcd/src/calc.py:2 – subtracts instead of adding (high)',
    'BUG: C:\\Data\\workspaces\\p\\cli1\\1\\proj-1234abcd\\src\\other.py:40-44 — not planted, maybe real', 'BUG: nothing here', 'Summary: three bugs.',
  ].join('\n');
  assert.deepEqual(bugReports(reply, 'proj-1234abcd'), [{ file: 'src/calc.py', line: 6, endLine: 6 }, { file: 'src/calc.py', line: 2, endLine: 2 }, { file: 'src/other.py', line: 40, endLine: 44 }]);
  const bugs: PlantedBug[] = [{ file: 'src/calc.py', find: '', replace: '', what: 'divides by three', line: 5, endLine: 6 }, { file: 'src/calc.py', find: '', replace: '', what: 'subtracts', line: 2, endLine: 2 }, { file: 'src/io.py', find: '', replace: '', what: 'never closes', line: 10, endLine: 10 }];
  const result = huntResult(bugs, 'proj-1234abcd', { cli1: { text: reply, ms: 90_000 }, cli2: { text: 'BUG: src\\calc.py:9 — division (3 lines below)\nBUG: src/io.py:30 — too far away', ms: 30_000 } });
  assert.deepEqual([result.seats.cli1.found, result.seats.cli1.reports, result.seats.cli2.found, result.seats.cli2.reports], [[0, 1], 3, [0], 2]);
  assert.equal(result.winner, 'cli1', 'more planted bugs found wins, though slower');
  assert.equal(huntResult(bugs, 'proj-1234abcd', { cli1: { text: 'BUG: src/calc.py:2 — x', ms: 9 }, cli2: { text: 'BUG: src/calc.py:6 — y', ms: 5 } }).winner, 'cli2', 'as many found: the sooner one');
  assert.equal(huntResult(bugs, 'proj-1234abcd', { cli1: { text: 'nothing', ms: 1 } }).winner, undefined);
});

test('a hunt\'s copy: one commit\'s files (not the folder as it is), paths left out, bugs planted before the baseline', { skip: !hasGit }, async () => {
  const source = tempDir('ava-hunt-repo-');
  mkdirSync(join(source, 'src')); mkdirSync(join(source, 'tests'));
  writeFileSync(join(source, 'src', 'app.js'), 'export const total = (a, b) => a + b;\n'); writeFileSync(join(source, 'tests', 'app.test.js'), 'assert(total(1, 2) === 3);\n'); writeFileSync(join(source, 'AGENTS.md'), 'Instructions\n');
  git(source, 'init', '-q'); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'one');
  const commit = git(source, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(source, 'src', 'app.js'), 'export const total = () => 0; // later work\n'); git(source, 'commit', '-qam', 'two');
  const parent = tempDir('ava-hunt-copy-'), target = join(parent, 'copy'), history = join(parent, 'copy.git');
  const copied = copyProject(source, target, history, { commit, exclude: ['tests', 'AGENTS.md'], plant: [{ file: 'src/app.js', find: 'a + b', replace: 'a - b', what: 'subtracts' }] });
  assert.deepEqual([copied.files, copied.planted?.[0]?.line], [1, 1]);
  assert.equal(readFileSync(join(target, 'src', 'app.js'), 'utf8'), 'export const total = (a, b) => a - b;\n', 'the commit\'s code, with the bug planted');
  assert.ok(!existsSync(join(target, 'tests')) && !existsSync(join(target, 'AGENTS.md')), 'left out');
  assert.deepEqual((await projectChanges(target, history)).files, [], 'the planted bug is part of the baseline');
  assert.equal(git(source, 'status', '--porcelain').stdout, '', 'the repository is untouched');
  assert.throws(() => copyProject(source, join(parent, 'other'), undefined, { commit: 'abcdef1234' }), /has no commit/);
  assert.throws(() => copyProject(source, join(parent, 'other'), undefined, { commit: '--help' }), /hexadecimal/);
});

test('a scored hunt runs end to end: both copies seeded, BUG lines checked when both have reported, the verdict in the thread list', { skip: !hasGit }, async () => {
  const source = tempDir('ava-hunt-service-');
  writeFileSync(join(source, 'calc.py'), 'def add(a, b):\n    return a + b\n'); git(source, 'init', '-q'); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'one');
  const commit = git(source, 'rev-parse', 'HEAD').stdout.trim(), factory = new TestFactory();
  const service = new AvAService(tempDir('ava-hunt-data-'), factory, 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'hunt' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const hunt = { commit, bugs: [{ file: 'calc.py', find: 'return a + b', replace: 'return a - b', what: 'subtracts instead of adding' }] };
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Hunt', requestId: 'bad', options: { mode: 'build' }, build: { kind: 'build', hunt } }), /belong to a bug hunt/);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Find the bug in calc.py.', requestId: 'h1', options: { mode: 'build' }, build: { kind: 'review', path: source, hunt } }) as Run;
    await flush();
    const prompt = factory.agents[0]!.calls.at(-1)!.request.text;
    assert.match(prompt, /BUG: <file path inside the project>:<line>/); assert.doesNotMatch(prompt, /subtracts instead|return a \+ b/, 'the key stays private');
    // H5: Codex reads only through commands, so under Ask a hunt lets it read and search (and nothing else).
    assert.match(prompt, /read and search the code with read-only commands inside your copy/); assert.doesNotMatch(prompt, /permits scoped file tools only/);
    for (const seat of SEATS) assert.match(readFileSync(join(participantWorkspace(service.dataRoot, { pairId: pair.id, seat, generation: run.generations[seat] }), run.config.build!.folder, 'calc.py'), 'utf8'), /return a - b/);
    factory.agents[0]!.raw('BUG: calc.py:2 — subtracts'); factory.agents[1]!.raw('No bugs found.');
    for (let i = 0; i < 200 && !service.store.run(run.id).hunt; i++) await new Promise(r => setTimeout(r, 5));
    const result = service.store.run(run.id).hunt!;
    assert.deepEqual([result.winner, result.seats.cli1.found, result.seats.cli2.found, result.bugs[0]!.line], ['cli1', [0], [], 2]);
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ verdict?: { kind?: string; found?: Record<string, number>; planted?: number } | null; runIds: string[] }> }).threads.filter(t => t.runIds.length);
    assert.deepEqual(threads[0]!.verdict, { status: 'done', kind: 'hunt', winner: 'cli1', planted: 1, found: { cli1: 1, cli2: 0 } });
    const view = await service.call('thread.get', { threadId: (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string; runIds: string[] }> }).threads.find(t => t.runIds.length)!.id }) as { runs: Array<{ config: { build: Record<string, unknown> } }> };
    assert.deepEqual(view.runs[0]!.config.build.planted, 1); assert.equal(view.runs[0]!.config.build.hunt, undefined, 'the room gets the count, and the bugs only with the result');
  } finally { await service.shutdown(); service.store.close(); }
});

test('H3: a Build prompt keeps its project and hunt in build.json; a hunt needs a bug hunt with its repository', { skip: !hasGit }, async () => {
  const data = tempDir('ava-hunt-library-'), service = new AvAService(data, new TestFactory(), 'simulation');
  try {
    const hunt = { commit: 'abcdef1', exclude: ['tests'], bugs: [{ file: 'calc.py', find: 'a + b', replace: 'a - b', what: 'subtracts' }] };
    const saved = service.prompts.save({ id: 'my-hunt', revision: null, name: 'My hunt', text: '# My hunt\n\nFind the bug.', mode: 'build', buildKind: 'review', files: [], build: { project: 'D:/Projects/calc', hunt } });
    assert.deepEqual(saved.build, { project: 'D:/Projects/calc', hunt });
    assert.deepEqual(JSON.parse(readFileSync(join(data, 'prompts', 'my-hunt', 'build.json'), 'utf8')), { version: 1, project: 'D:/Projects/calc', hunt });
    assert.deepEqual(service.prompts.list().prompts.find(p => p.id === 'my-hunt')?.build?.hunt?.bugs.length, 1);
    const app = service.prompts.save({ id: 'my-app', revision: null, name: 'App', text: '# App', mode: 'build', buildKind: 'build', files: [], build: { project: 'D:/Projects/start' } });
    assert.deepEqual(app.build, { project: 'D:/Projects/start' });
    assert.throws(() => service.prompts.save({ id: 'bad-1', revision: null, name: 'Bad', text: '# Bad', mode: 'build', buildKind: 'build', files: [], build: { project: 'D:/x', hunt } }), /bug hunt/);
    assert.throws(() => service.prompts.save({ id: 'bad-2', revision: null, name: 'Bad', text: '# Bad', mode: 'build', buildKind: 'review', files: [], build: { hunt } }), /repository/);
  } finally { await service.shutdown(); service.store.close(); }
});

test('H3: the repository check says what a copy would hold and whether each planted bug applies, without writing anything', { skip: !hasGit }, async () => {
  const source = tempDir('ava-hunt-check-');
  mkdirSync(join(source, 'tests')); writeFileSync(join(source, 'calc.py'), 'a = 1\nb = 1\n'); writeFileSync(join(source, 'tests', 't.py'), 'x');
  git(source, 'init', '-q'); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'one');
  const head = git(source, 'rev-parse', 'HEAD').stdout.trim(), service = new AvAService(tempDir('ava-hunt-check-data-'), new TestFactory(), 'simulation');
  try {
    const result = await service.call('project.check', { path: source, commit: head.slice(0, 7), exclude: ['tests'], bugs: [{ file: 'calc.py', find: 'a = 1' }, { file: 'calc.py', find: '= 1' }, { file: 'calc.py', find: 'c = 3' }, { file: 'nope.py', find: 'x' }, { file: 'tests/t.py', find: 'x' }] }) as { head: string; commitFound: boolean; files: number; bugs: string[] };
    assert.deepEqual([result.head, result.commitFound, result.files, result.bugs], [head, true, 1, ['ok', 'ambiguous', 'missing', 'no-file', 'excluded']]);
    assert.equal((await service.call('project.check', { path: source, commit: 'abcdef1' }) as { commitFound: boolean }).commitFound, false);
    assert.equal(git(source, 'status', '--porcelain').stdout, '');
  } finally { await service.shutdown(); service.store.close(); }
});

test('H4: the built-in Build prompts: five app builds, and three CLI-MODE hunts pinned to one commit, with 1, 3 and 5 planted bugs', async () => {
  const { APP_BUILDS, BUG_HUNTS } = await import('../src/build-starters.js');
  assert.equal(APP_BUILDS.length, 5);
  for (const p of APP_BUILDS) { assert.deepEqual([p.mode, p.buildKind], ['build', 'build']); assert.match(p.text, /## Requirements/); assert.match(p.text, /## How it will be judged/); }
  assert.deepEqual(BUG_HUNTS.map(h => h.build!.hunt!.bugs.length), [1, 3, 5], 'increasing difficulty');
  for (const h of BUG_HUNTS) {
    assert.deepEqual([h.mode, h.buildKind, h.build!.hunt!.commit?.length, h.build!.project], ['build', 'review', 40, 'https://github.com/adamczhang/CLI-MODE'], 'H7: on GitHub, at a public commit');
    assert.ok(h.build!.hunt!.exclude!.includes('checks'), 'CLI-MODE\'s tests are left out');
    for (const b of h.build!.hunt!.bugs) { assert.notEqual(b.find, b.replace); assert.ok(!h.text.includes(b.replace.trim()), `${h.id} doesn't show its planted code`); }
  }
  assert.match(BUG_HUNTS[0]!.text, /One bug .*names\.py/); assert.match(BUG_HUNTS[2]!.text, /Five bugs .*plugins\/cli-mode\/scripts/);
});

test('H6: decoys and a cap on BUG lines: a decoy reported counts against an agent, and only the first BUG lines count', async () => {
  const { huntRules } = await import('../src/bug-hunt.js');
  const bugs: PlantedBug[] = [
    { file: 'a.py', find: '', replace: '', what: 'off by one', line: 10, endLine: 10 },
    { file: 'b.py', find: '', replace: '', what: 'looks inverted, but the caller negates it', line: 20, endLine: 20, decoy: true },
    { file: 'c.py', find: '', replace: '', what: 'wrong key', line: 30, endLine: 30 },
  ];
  const cli1 = 'BUG: a.py:10 — off by one\nBUG: b.py:20 — inverted\nBUG: c.py:30 — wrong key', cli2 = 'BUG: a.py:11 — off by one\nBUG: z.py:1 — guess\nBUG: c.py:30 — wrong key';
  const all = huntResult(bugs, 'f', { cli1: { text: cli1, ms: 5 }, cli2: { text: cli2, ms: 9 } });
  assert.deepEqual([all.seats.cli1.found, all.seats.cli1.decoys, all.seats.cli2.found, all.seats.cli2.decoys], [[0, 2], [1], [0, 2], []]);
  assert.equal(all.winner, 'cli2', 'as many found: fewer decoys reported wins, though slower');
  assert.deepEqual(all.bugs.map(b => !!b.decoy), [false, true, false]);
  const capped = huntResult(bugs, 'f', { cli1: { text: cli1, ms: 5 }, cli2: { text: cli2, ms: 9 } }, 2);
  assert.deepEqual([capped.seats.cli1.found, capped.seats.cli2.found, capped.seats.cli2.reports, capped.maxReports], [[0], [0], 3, 2], 'the third BUG line doesn’t count');
  assert.equal(capped.winner, 'cli2');
  assert.equal(huntRules({ bugs, maxReports: 2 }), 'Only your first 2 BUG lines count, so put the ones you are surest of first. A BUG line on code that is in fact correct counts against you.');
  assert.equal(huntRules({ bugs: [bugs[0]!] }), '', 'a plain hunt says nothing more');
  assert.ok(!/decoy/i.test(huntRules({ bugs, maxReports: 2 })), 'the word decoy never reaches the agents');
});

test('H6: a hunt\'s rules reach the agents, its decoys are planted but not counted as bugs, and a hunt of decoys alone is refused', { skip: !hasGit }, async () => {
  const source = tempDir('ava-hunt-tricks-');
  writeFileSync(join(source, 'calc.py'), 'def add(a, b):\n    return a + b\n\n\n\n\n\ndef neg(a):\n    return -a\n'); git(source, 'init', '-q'); git(source, 'add', '-A'); git(source, 'commit', '-qm', 'one');
  const factory = new TestFactory(), data = tempDir('ava-hunt-tricks-data-');
  const service = new AvAService(data, factory, 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'decoys' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'claude', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const decoy = { file: 'calc.py', find: 'return -a', replace: 'return 0 - a', what: 'the same value, written oddly', decoy: true };
    const hunt = { maxReports: 3, bugs: [{ file: 'calc.py', find: 'return a + b', replace: 'return a - b', what: 'subtracts' }, decoy] };
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Hunt', requestId: 'only-decoys', options: { mode: 'build' }, build: { kind: 'review', path: source, hunt: { bugs: [decoy] } } }), /isn’t a decoy/);
    const run = await service.call('run.start', { pairId: pair.id, text: 'Find the bugs in calc.py.', requestId: 'd1', options: { mode: 'build' }, build: { kind: 'review', path: source, hunt } }) as Run;
    await flush();
    const prompt = factory.agents[0]!.calls.at(-1)!.request.text;
    assert.match(prompt, /Only your first 3 BUG lines count/); assert.match(prompt, /code that is in fact correct counts against you/); assert.doesNotMatch(prompt, /decoy|written oddly/i);
    assert.match(readFileSync(join(participantWorkspace(service.dataRoot, { pairId: pair.id, seat: 'cli1', generation: run.generations.cli1 }), run.config.build!.folder, 'calc.py'), 'utf8'), /return 0 - a/, 'the decoy is planted too');
    factory.agents[0]!.raw('BUG: calc.py:2 — subtracts\nBUG: calc.py:9 — odd negation'); factory.agents[1]!.raw('BUG: calc.py:2 — subtracts');
    for (let i = 0; i < 200 && !service.store.run(run.id).hunt; i++) await new Promise(r => setTimeout(r, 5));
    const result = service.store.run(run.id).hunt!;
    assert.deepEqual([result.winner, result.seats.cli1.decoys, result.seats.cli2.decoys], ['cli2', [1], []]);
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ verdict?: { planted?: number } | null; runIds: string[] }> }).threads.filter(t => t.runIds.length);
    assert.equal(threads[0]!.verdict?.planted, 1, 'decoys aren’t counted as planted bugs');
    const saved = service.prompts.save({ id: 'decoy-hunt', revision: null, name: 'Decoys', text: '# Decoys', mode: 'build', buildKind: 'review', files: [], build: { project: source, hunt } });
    assert.deepEqual([saved.build?.hunt?.maxReports, saved.build?.hunt?.bugs[1]?.decoy], [3, true]);
    assert.throws(() => service.prompts.save({ id: 'decoys-only', revision: null, name: 'Decoys only', text: '# D', mode: 'build', buildKind: 'review', files: [], build: { project: source, hunt: { bugs: [decoy] } } }), /isn’t a decoy/);
  } finally { await service.shutdown(); service.store.close(); }
});

test('H6: two expert hunts: no bug count given, decoys the agents never hear of, and a cap on the BUG lines that count', async () => {
  const { EXPERT_HUNTS, BUILD_STARTERS } = await import('../src/build-starters.js');
  assert.deepEqual(EXPERT_HUNTS.map(h => [h.build!.hunt!.bugs.filter(b => !b.decoy).length, h.build!.hunt!.bugs.filter(b => b.decoy).length, h.build!.hunt!.maxReports]), [[4, 1, 6], [6, 2, 8]]);
  for (const h of EXPERT_HUNTS) {
    assert.ok(BUILD_STARTERS.includes(h)); assert.match(h.text, /How many(, and where,)? isn't said/); assert.doesNotMatch(h.text, /decoy/i);
    assert.equal(h.build!.project, 'https://github.com/adamczhang/CLI-MODE'); assert.equal(h.build!.hunt!.commit?.length, 40);
    for (const b of h.build!.hunt!.bugs) { assert.notEqual(b.find, b.replace); assert.ok(!h.text.includes(b.replace.trim())); }
  }
});

test('H8: three hard app builds, each with exact behavior exposed as a function the operator can check with cases the agents weren’t given', async () => {
  const { HARD_BUILDS, BUILD_STARTERS } = await import('../src/build-starters.js');
  assert.deepEqual(HARD_BUILDS.map(b => b.id), ['build-chess', 'build-spreadsheet', 'build-regex-engine']);
  for (const [b, api] of HARD_BUILDS.map((b, i) => [b, ['window.perft(fen, depth)', 'window.evaluateSheet(cells)', 'window.regexFullMatch(pattern, text)'][i]!] as const)) {
    assert.ok(BUILD_STARTERS.includes(b)); assert.deepEqual([b.mode, b.buildKind], ['build', 'build']); assert.match(b.name, / \(hard\)$/);
    assert.ok(b.text.includes(api), `${b.id} exposes ${api}`); assert.match(b.text, /The operator also checks cases you haven't been given|positions you haven't been given/);
  }
  assert.match(HARD_BUILDS[0]!.text, /20, 400, 8902 and 197281/); assert.match(HARD_BUILDS[2]!.text, /never use JavaScript's RegExp/);
});
