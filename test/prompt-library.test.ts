import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { PromptLibrary } from '../src/prompt-library.js';
import type { PromptSave, SavedPrompt } from '../src/prompt-types.js';
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
  assert.equal(first.prompts.length, 6); assert.equal(factory.agents.length, 0);
  const starter = library.get('starter-state-tracking');
  library.save({ ...input(), id: starter.id, revision: starter.revision, name: 'Edited starter' });
  const removed = library.get('starter-snake'); library.delete(removed.id, removed.revision);
  const reopened = new PromptLibrary(root, service.store);
  assert.equal(reopened.get(starter.id).name, 'Edited starter');
  assert.equal(reopened.list().prompts.length, 5); assert.equal(factory.agents.length, 0);
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
  const result = library.list(); assert.equal(result.prompts.length, 6); assert.equal(result.warnings.length, 1);
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
    if(mode==='conversation'){assert.equal(factory.agents[1]!.calls.length,1,'the second agent waits for the opener');factory.agents[0]!.answer('Opening answer');await flush();}
    for (const agent of factory.agents) {
      assert.equal(agent.calls.length, 2, 'one activation plus one task');
      assert.match(agent.calls[1]!.request.text, /Use the attached reference to answer/);
      assert.match(agent.calls[1]!.request.text, /A distinctive reference line/);
    }
    library.delete(saved.id, saved.revision);
    assert.equal(service.store.messages(run.id)[0]!.attachments?.[0]?.name, 'reference.md');
    await service.call('run.control', { runId: run.id, action: 'stop', requestId: 'stop-' + mode }); await flush();
  });
}
