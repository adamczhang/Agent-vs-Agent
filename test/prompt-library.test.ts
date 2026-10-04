import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { PromptLibrary } from '../src/prompt-library.js';
import { DEBATE_STARTERS } from '../src/debate-starters.js';
import { debateMarkdown, parseDebateMarkdown, type PromptSave, type SavedPrompt } from '../src/prompt-types.js';
import type { AttachmentRef, Pair, Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

function fixture(t: import('node:test').TestContext) {
  const root = tempDir('prompt-library-'), factory = new TestFactory(), service = new AvAService(root, factory, 'simulation');
  t.after(async () => { await service.shutdown(); service.store.close(); }); return { root, service, factory, library: service.prompts };
}
const input = (overrides: Partial<PromptSave> = {}): PromptSave => ({ id: 'my-prompt', revision: null, name: 'My saved prompt', text: '# Task\nReturn a result.\n', mode: 'all', buildKind: 'build', files: [], ...overrides });
async function upload(service: AvAService, name = 'notes.txt', text = 'Reference material') {
  return service.call('attachment.add', { name, mediaType: 'text/plain', data: Buffer.from(text).toString('base64') }) as Promise<AttachmentRef>;
}

test('library preloads all three modes once, preserves edits/deletions across restarts, and starts no agents', async t => {
  const { service, factory, library, root } = fixture(t);
  const first = library.list(); assert.equal(first.directory, join(root, 'prompts'));
  assert.deepEqual(new Set(first.prompts.map(p => p.mode)), new Set(['benchmark', 'conversation', 'build']));
  assert.equal(first.prompts.length, 14); assert.equal(factory.agents.length, 0);
  const starter = library.get('starter-state-tracking');
  library.save({ ...input(), id: starter.id, revision: starter.revision, name: 'Edited starter' });
  const removed = library.get('starter-snake'); library.delete(removed.id, removed.revision);
  const reopened = new PromptLibrary(root, service.store);
  assert.equal(reopened.get(starter.id).name, 'Edited starter');
  assert.equal(reopened.list().prompts.length, 13); assert.equal(factory.agents.length, 0);
});

// G2: a debate prompt carries the debate template in debate.json beside prompt.md, so older versions still read the topic.
test('a debate prompt keeps its template beside the motion: each agent\'s side, private brief and internet, and rounds', async t => {
  const { library, root } = fixture(t);
  const debate = { rounds: 6, agents: { cli1: { stance: 'against' as const, context: 'Your brief.', internet: true }, cli2: { stance: 'for' as const, context: 'Theirs.', internet: false } } };
  const saved = library.save(input({ id: 'car-ban', mode: 'conversation', text: 'This house would ban cars downtown', debate }));
  assert.deepEqual(saved.debate, debate); assert.equal(saved.text, 'This house would ban cars downtown', 'the motion alone is prompt.md');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'prompts', 'car-ban', 'debate.json'), 'utf8')), { version: 1, ...debate });
  assert.deepEqual(library.list().prompts.find(p => p.id === 'car-ban')!.debate, debate);
  assert.deepEqual(library.prepare(saved.id, saved.revision).prompt.debate, debate);
  // The template is part of the revision: a change to it alone is a new revision.
  const changed = library.save(input({ id: 'car-ban', revision: saved.revision, mode: 'conversation', text: saved.text, debate: { ...debate, rounds: 10 } }));
  assert.notEqual(changed.revision, saved.revision); assert.equal(library.get('car-ban').debate!.rounds, 10);
  // Only Debate prompts carry one. A Debate prompt saved before G2 gets the default template; one saved before sides (G6)
  // argues Agent 1 for and Agent 2 against.
  assert.equal(library.save(input({ id: 'not-debate', mode: 'benchmark', debate })).debate, undefined);
  assert.ok(!existsSync(join(root, 'prompts', 'not-debate', 'debate.json')));
  assert.deepEqual(library.save(input({ id: 'older-debate', mode: 'conversation' })).debate, { rounds: 7, agents: { cli1: { stance: 'for', context: '', internet: false }, cli2: { stance: 'against', context: '', internet: false } } });
  writeFileSync(join(root, 'prompts', 'car-ban', 'debate.json'), JSON.stringify({ version: 1, rounds: 4, agents: { cli1: { context: 'a', internet: false }, cli2: { context: 'b', internet: true } } }));
  assert.deepEqual(library.get('car-ban').debate!.agents, { cli1: { stance: 'for', context: 'a', internet: false }, cli2: { stance: 'against', context: 'b', internet: true } });
  for (const bad of [{ ...debate, rounds: 0 }, { ...debate, rounds: 101 }, { ...debate, extra: 1 }, { rounds: 4, agents: { cli1: debate.agents.cli1 } }, { rounds: 4, agents: { cli1: debate.agents.cli1, cli2: { ...debate.agents.cli2, stance: 'against' } } }])
    assert.throws(() => library.save(input({ id: 'bad-debate', mode: 'conversation', debate: bad as never })));
  // A damaged debate.json makes the prompt unreadable (listed as needing attention), never half-applied.
  writeFileSync(join(root, 'prompts', 'car-ban', 'debate.json'), '{"version":1,"rounds":"many"}');
  assert.throws(() => library.get('car-ban')); assert.ok(library.list().warnings.some(w => w.startsWith('car-ban')));
});
// G8: the built-in debates are formal motions with assigned sides. An older library loses its earlier debate starters
// that are exactly as shipped, keeps edited ones, and gets the new set once.
test('built-in debates are formal motions, and replace earlier debate starters only where unedited', async t => {
  const { service, root, library: fresh } = fixture(t);
  assert.equal(DEBATE_STARTERS.length, 10);
  for (const starter of DEBATE_STARTERS) {
    assert.equal(starter.mode, 'conversation'); assert.ok(starter.debate, starter.id);
    assert.match(starter.text, /^# Motion: This house /, `${starter.id} is a motion`);
    assert.deepEqual([starter.debate.agents.cli1.stance, starter.debate.agents.cli2.stance], ['for', 'against']);
    assert.equal(starter.debate.rounds, 7);
    for (const seat of ['cli1', 'cli2'] as const) assert.ok(starter.debate.agents[seat].context.length > 150, `${starter.id} briefs ${seat}`);
  }
  assert.deepEqual(fresh.list().prompts.filter(p => p.mode === 'conversation').map(p => p.id).sort(), DEBATE_STARTERS.map(s => s.id).sort(), 'a new library has only the formal debates');
  // A library as 0.4.1 left it (marker 2): a G3 starter as shipped, one edited, and the user's own debate prompt.
  const old = join(root, 'older'), prompts = join(old, 'prompts'); mkdirSync(prompts, { recursive: true });
  const write = (id: string, name: string, text: string, debate?: object) => { mkdirSync(join(prompts, id)); writeFileSync(join(prompts, id, 'prompt.md'), text); writeFileSync(join(prompts, id, 'prompt.json'), JSON.stringify({ version: 1, id, name, mode: 'conversation', buildKind: 'build', createdAt: 'x', updatedAt: 'x', files: [] })); if (debate) writeFileSync(join(prompts, id, 'debate.json'), JSON.stringify({ version: 1, ...debate }, null, 2) + '\n'); };
  const shipped = { name: 'Is a hot dog a sandwich?', text: '# Is a hot dog a sandwich?\n\nSettle it like a court case.', debate: { rounds: 6, agents: { cli1: { context: 'You are counsel for "sandwich". Argue from definitions, structure (bread around a filling), dictionaries, and precedents such as the sub sandwich and tax rulings. Be witty, but make real arguments. Hold your side for the whole debate. Grant a fair point when you have to, then show why your case still wins. Press on the weakest part of your opponent\'s last turn, bring something new each time, and end most turns with one direct question.', internet: false }, cli2: { context: 'You are counsel for "not a sandwich". Argue from how people actually use the word, the single hinged bun, food culture, and where your opponent\'s definition leads (is a taco a sandwich?). Be witty, but make real arguments. Hold your side for the whole debate. Grant a fair point when you have to, then show why your case still wins. Press on the weakest part of your opponent\'s last turn, bring something new each time, and end most turns with one direct question.', internet: false } } } };
  write('starter-debate-hot-dog', shipped.name, shipped.text, shipped.debate);
  write('starter-debate-mammoth', 'Bring back the woolly mammoth?', 'My own mammoth motion', { rounds: 8, agents: { cli1: { context: 'x', internet: true }, cli2: { context: 'y', internet: true } } });
  write('my-debate', 'Mine', 'My motion');
  writeFileSync(join(prompts, '.initialized'), '2\n');
  const library = new PromptLibrary(old, service.store), ids = library.list().prompts.map(p => p.id);
  assert.ok(!ids.includes('starter-debate-hot-dog'), 'the starter as shipped is retired');
  assert.ok(ids.includes('starter-debate-mammoth') && ids.includes('my-debate'), 'edited and own prompts stay');
  assert.ok(DEBATE_STARTERS.every(s => ids.includes(s.id)), 'the formal debates are added');
  assert.equal(readFileSync(join(prompts, '.initialized'), 'utf8'), '3\n');
  // Once only: a formal debate the user deletes isn't added again, and a newer marker stays.
  const removed = library.get('debate-fall-of-rome'); library.delete(removed.id, removed.revision);
  assert.ok(!new PromptLibrary(old, service.store).list().prompts.some(p => p.id === 'debate-fall-of-rome'));
  writeFileSync(join(prompts, '.initialized'), '4\n'); new PromptLibrary(old, service.store).list();
  assert.equal(readFileSync(join(prompts, '.initialized'), 'utf8'), '4\n');
});
test('a debate prompt exports to one Markdown file and imports back with its template', () => {
  const debate = { rounds: 5, agents: { cli1: { stance: 'against' as const, context: 'Side A.\n\nWith a blank line.', internet: true }, cli2: { stance: 'for' as const, context: '', internet: false } } };
  const markdown = debateMarkdown('# Motion\n\nShould we?', debate);
  assert.match(markdown, /## Agent 1 \(against the motion; internet on\)\n\nSide A\./); assert.match(markdown, /## Agent 2 \(for the motion; internet off\)\n\n\(none\)/);
  assert.deepEqual(parseDebateMarkdown(markdown), { text: '# Motion\n\nShould we?', debate });
  assert.deepEqual(parseDebateMarkdown(markdown.replace(/\n/g, '\r\n')), { text: '# Motion\n\nShould we?', debate });
  // The format before sides still imports, as Agent 1 for and Agent 2 against.
  const older = '# Old\n\n---\n\n## Agent 1 (private context, internet on)\n\nA\n\n## Agent 2 (private context, internet off)\n\nB\n\nRounds: 6\n';
  assert.deepEqual(parseDebateMarkdown(older)?.debate.agents, { cli1: { stance: 'for', context: 'A', internet: true }, cli2: { stance: 'against', context: 'B', internet: false } });
  for (const plain of ['# Just a prompt', markdown.replace('Rounds: 5', 'Rounds: 0'), markdown.replace('# Motion\n\nShould we?', ''), markdown.replace('for the motion; internet off', 'against the motion; internet off')]) assert.equal(parseDebateMarkdown(plain), null);
});

test('save, rename, file preview, and preparation retain exact Markdown and bytes on disk', async t => {
  const { service, library, root } = fixture(t), file = await upload(service, 'context.txt', 'Café 🐈\r\nExact text');
  const saved = library.save(input({ name: 'First name', files: [{ id: file.id, name: file.name, attachmentId: file.id }] }));
  assert.equal(readFileSync(join(root, 'prompts', saved.id, 'prompt.md'), 'utf8'), saved.text);
  assert.equal(readFileSync(join(root, 'prompts', saved.id, 'files', 'context.txt'), 'utf8'), 'Café 🐈\r\nExact text');
  const renamed = library.save(input({ revision: saved.revision, name: 'Better name', text: 'New body', files: [{ id: file.id, name: 'renamed.md' }] }));
  assert.equal(renamed.id, saved.id); assert.equal(renamed.createdAt, saved.createdAt); assert.notEqual(renamed.revision, saved.revision);
  assert.equal(library.file(saved.id, file.id).name, 'renamed.md');
  assert.equal(Buffer.from(library.file(saved.id, file.id).data, 'base64').toString('utf8'), 'Café 🐈\r\nExact text');
  assert.equal(existsSync(join(root, 'prompts', saved.id, 'files', 'context.txt')), false);
  const prepared = library.prepare(saved.id, renamed.revision); assert.equal(prepared.prompt.text, 'New body');
  library.delete(saved.id, renamed.revision);
  assert.equal(service.store.attachmentData(prepared.attachments[0]!.id).toString('utf8'), 'Café 🐈\r\nExact text', 'a loaded/run copy outlives its saved prompt');
});

test('Clear history deletes transient attachments but leaves the library and its files reusable', async t => {
  const { service, library } = fixture(t), file = await upload(service);
  const saved = library.save(input({ files: [{ id: file.id, name: file.name, attachmentId: file.id }] }));
  await service.call('history.clear', { requestId: 'clear-history-library' });
  assert.throws(() => service.store.attachment(file.id), /not found/);
  const prepared = library.prepare(saved.id, saved.revision);
  assert.equal(service.store.attachmentData(prepared.attachments[0]!.id).toString('utf8'), 'Reference material');
});

test('stale saves, deletes, and loads are refused, including manual edits to prompt.md', t => {
  const { library, root } = fixture(t), saved = library.save(input());
  writeFileSync(join(root, 'prompts', saved.id, 'prompt.md'), 'Edited in a text editor');
  assert.throws(() => library.save(input({ revision: saved.revision })), /changed in another window/);
  assert.throws(() => library.delete(saved.id, saved.revision), /changed in another window/);
  assert.throws(() => library.prepare(saved.id, saved.revision), /changed in another window/);
  assert.equal(library.get(saved.id).text, 'Edited in a text editor');
  assert.throws(() => library.save(input()), /changed in another window/, 'creating an existing ID never overwrites it');
});

test('failed updates preserve the previous complete prompt and files', async t => {
  const { library, service } = fixture(t), file = await upload(service), saved = library.save(input({ files: [{ id: file.id, name: file.name, attachmentId: file.id }] }));
  assert.throws(() => library.save(input({ revision: saved.revision, text: 'Must not replace the saved prompt', files: [{ id: 'missing', name: 'missing.txt' }] })), /no longer exists/);
  assert.deepEqual(library.get(saved.id), saved);
  assert.throws(() => library.save(input({ revision: saved.revision, files: [{ id: file.id, name: 'x.txt' }, { id: 'another', name: 'X.txt', attachmentId: file.id }] })), /unique/);
  assert.deepEqual(library.get(saved.id), saved);
});

test('file and prompt traversal, Windows reserved names, and unsupported payloads are refused', async t => {
  const { library, service, root } = fixture(t), file = await upload(service); library.list();
  for (const id of ['../outside', '..', 'C:\\elsewhere', 'folder/name']) assert.throws(() => library.save(input({ id })));
  for (const name of ['../outside.txt', '..', 'NUL.txt', 'a:b.txt', 'trailing.', 'dir\\file.txt', ' a.txt', 'a\0.txt']) {
    assert.throws(() => library.save(input({ files: [{ id: file.id, name, attachmentId: file.id }] })));
  }
  assert.throws(() => library.save(input({ text: 'x'.repeat(16001) })));
  assert.throws(() => library.save(input({ text: '   ' })));
  await assert.rejects(service.call('attachment.add', { name: 'data.bin', mediaType: 'application/octet-stream', data: Buffer.from([0, 1, 2]).toString('base64') }), /attach images/);
  assert.equal(existsSync(join(root, 'outside.txt')), false);
});

test('linked prompt directories cannot be read, updated, or deleted', t => {
  const { library, root } = fixture(t); library.list();
  const outside = tempDir('prompt-outside-'); writeFileSync(join(outside, 'keep.txt'), 'Keep this');
  symlinkSync(outside, join(root, 'prompts', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => library.get('linked'), /Linked/);
  assert.throws(() => library.save(input({ id: 'linked' })), /Linked/);
  assert.throws(() => library.delete('linked', 'old'), /Linked/);
  assert.equal(library.list().warnings.length, 1);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'Keep this');
});

test('linked files directories and a linked library root are refused', t => {
  const { library, service, root } = fixture(t), saved = library.save(input());
  const files = join(root, 'prompts', saved.id, 'files'), outside = tempDir('prompt-linked-files-');
  renameSync(files, files + '-original'); symlinkSync(outside, files, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => library.delete(saved.id, saved.revision), /Linked/);
  const other = tempDir('prompt-linked-root-'); symlinkSync(outside, join(other, 'prompts'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new PromptLibrary(other, service.store).list(), /Linked/);
});

test('corrupt tasks do not hide healthy prompts or get overwritten', t => {
  const { library, root } = fixture(t); library.list();
  const broken = join(root, 'prompts', 'broken'); mkdirSync(broken); writeFileSync(join(broken, 'prompt.json'), 'not JSON'); writeFileSync(join(broken, 'prompt.md'), 'hello');
  const result = library.list(); assert.equal(result.prompts.length, 14); assert.equal(result.warnings.length, 1);
  assert.throws(() => library.save(input({ id: 'broken' })));
  assert.equal(readFileSync(join(broken, 'prompt.json'), 'utf8'), 'not JSON');
});

test('startup recovers a complete prompt from an interrupted directory swap', t => {
  const { library, service, root } = fixture(t), saved = library.save(input());
  renameSync(join(root, 'prompts', saved.id), join(root, 'prompts', '.previous-' + saved.id));
  const reopened = new PromptLibrary(root, service.store); assert.deepEqual(reopened.get(saved.id), saved);
  assert.equal(existsSync(join(root, 'prompts', '.previous-' + saved.id)), false);
});

test('RPC retries are idempotent; management and preparation never send model work', async t => {
  const { service, factory } = fixture(t), file = await upload(service);
  const request = { ...input({ files: [{ id: file.id, name: file.name, attachmentId: file.id }] }), requestId: 'save-once' };
  const saved = await service.call('prompt.save', request) as SavedPrompt;
  assert.deepEqual(await service.call('prompt.save', request), saved);
  await assert.rejects(service.call('prompt.save', { ...request, text: 'different' }), /different/);
  const prepare = { id: saved.id, revision: saved.revision, requestId: 'prepare-once' };
  const ready = await service.call('prompt.prepare', prepare);
  assert.deepEqual(await service.call('prompt.prepare', prepare), ready);
  const deletion = { id: saved.id, revision: saved.revision, requestId: 'delete-once' };
  assert.deepEqual(await service.call('prompt.delete', deletion), { deleted: true });
  assert.deepEqual(await service.call('prompt.delete', deletion), { deleted: true });
  assert.equal(factory.agents.length, 0);
});

for (const mode of ['benchmark', 'conversation', 'build'] as const) {
  test(`saved prompt and file are delivered to both agents in ${mode} mode`, async t => {
    const { service, factory, library } = fixture(t), file = await upload(service, 'reference.md', 'A distinctive reference line.');
    const saved = library.save(input({ mode, text: 'Use the attached reference to answer.', files: [{ id: file.id, name: file.name, attachmentId: file.id }] }));
    const pair = await service.call('pair.create', { thread: 'library-' + mode }) as Pair;
    for (const seat of ['cli1', 'cli2']) {
      await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } });
      await service.call('slot.activate', { pairId: pair.id, seat });
    }
    const ready = library.prepare(saved.id, saved.revision);
    const run = await service.call('run.start', { pairId: pair.id, text: ready.prompt.text, attachments: ready.attachments.map(f => f.id), requestId: 'run-' + mode, options: { mode, paceMs: 0 }, ...(mode === 'build' ? { build: { kind: 'build' } } : {}) }) as Run;
    await flush();
    assert.equal(factory.agents.length, 2);
    // Debate briefs the second agent with the prompt and its file while the first opens (E7).
    if(mode==='conversation'){assert.equal(factory.agents[1]!.calls.length,2,'the second agent is briefed while the opener writes');factory.agents[1]!.raw('READY');factory.agents[0]!.answer('Opening answer');await flush();}
    for (const agent of factory.agents) {
      assert.equal(agent.calls.length, mode === 'conversation' && agent === factory.agents[1] ? 3 : 2, 'one activation plus one task (and the briefing in Debate)');
      assert.match(agent.calls[1]!.request.text, /Use the attached reference to answer/);
      assert.match(agent.calls[1]!.request.text, /A distinctive reference line/);
    }
    library.delete(saved.id, saved.revision);
    assert.equal(service.store.messages(run.id)[0]!.attachments?.[0]?.name, 'reference.md');
    await service.call('run.control', { runId: run.id, action: 'stop', requestId: 'stop-' + mode }); await flush();
  });
}
