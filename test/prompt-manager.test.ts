import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AvAService } from '../src/service.js';
import { TestFactory } from './fakes.js';
import { tempDir } from './temp.js';
import type { AttachmentRef } from '../src/types.js';

// Exercise the real React editor and real service, without a browser connection or any provider requests.
// JSDOM does not render CSS: these tests cover interactions and RPC payloads, not visual layout.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/' });
for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FileReader', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'MouseEvent'] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: dom.window.addEventListener.bind(dom.window) });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
const { act, createElement } = await import('react');
// tsx uses the classic JSX transform for UI sources outside its test entrypoint.
Object.defineProperty(globalThis, 'React', { configurable: true, value: await import('react') });
const { createRoot } = await import('react-dom/client');
const { PromptManager } = await import('../ui/prompt-manager.js');
type Props = import('react').ComponentProps<typeof PromptManager>;
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text);
  assert.ok(found, `button: ${text}`); return found;
}
async function click(text: string) { await act(async () => button(text).click()); await tick(); }
async function fill(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`); assert.ok(element, label);
  await act(async () => {
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : element instanceof dom.window.HTMLSelectElement ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new dom.window.Event(element instanceof dom.window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function fixture(t: import('node:test').TestContext, overrides: Partial<Props> | ((service: AvAService) => Promise<Partial<Props>>) = {}) {
  const factory = new TestFactory(), service = new AvAService(tempDir('prompt-ui-'), factory, 'simulation'), calls: string[] = [], used: Array<{ prepared: import('../ui/prompt-manager.js').PreparedPrompt; run: boolean }> = [];
  let closed = 0;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body)); calls.push(request.method);
    try { return new Response(JSON.stringify({ result: await service.call(request.method, request.params) }), { status: 200 }); }
    catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error), code: 'INVALID_REQUEST' }), { status: 409 }); }
  };
  sessionStorage.clear();
  const root = createRoot(document.getElementById('root')!);
  t.after(async () => { await act(async () => root.unmount()); await service.shutdown(); service.store.close(); });
  const props: Props = { mode: 'benchmark', buildKind: 'build', draft: '', draftFiles: [], draftBlocked: false, startWithDraft: false, runBlocked: () => '', onUse: async (prepared, run) => { used.push({ prepared, run }); }, onClose: () => { closed++; }, ...(typeof overrides === 'function' ? await overrides(service) : overrides) };
  await act(async () => root.render(createElement(PromptManager, props))); await tick();
  return { service, factory, calls, used, closed: () => closed };
}

test('editor creates, searches, reloads, and loads a Markdown prompt without agent work', async t => {
  const { service, factory, used, closed } = await fixture(t);
  await click('New prompt'); await fill('Prompt name', 'Saved through the editor'); await fill('Saved prompt text', '# Exact text\n\nCafé 🐈');
  await fill('Saved prompt mode', 'all'); await click('Save prompt');
  const saved = service.prompts.list().prompts.find(p => p.name === 'Saved through the editor'); assert.ok(saved);
  assert.equal(service.prompts.get(saved.id).text, '# Exact text\n\nCafé 🐈');
  await fill('Search saved prompts', 'saved through'); assert.equal(document.querySelectorAll('.library-list > button').length, 1);
  await fill('Saved prompt text', 'Unsaved replacement'); await click('Reload saved version');
  assert.match(document.querySelector('.library-confirm')!.textContent!, /Discard/); await click('Discard changes');
  assert.equal((document.querySelector('[aria-label="Saved prompt text"]') as HTMLTextAreaElement).value, '# Exact text\n\nCafé 🐈');
  await click('Load into composer'); assert.equal(used.length, 1); assert.equal(used[0]!.run, false); assert.equal(closed(), 1); assert.equal(factory.agents.length, 0);
});

test('editor uploads, previews, renames, and removes attached files', async t => {
  const { service } = await fixture(t); await click('New prompt'); await fill('Prompt name', 'Prompt with files'); await fill('Saved prompt text', 'Read the attachment.');
  const upload = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
  Object.defineProperty(upload, 'files', { configurable: true, value: [new dom.window.File(['A reference line'], 'context.md', { type: 'text/markdown' })] });
  await act(async () => { upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); }); await tick();
  await click('Preview context.md'); assert.equal(document.querySelector('.library-preview pre')?.textContent, 'A reference line');
  await fill('Filename for context.md', 'renamed.md'); await click('Save prompt');
  const saved = service.prompts.list().prompts.find(p => p.name === 'Prompt with files')!; assert.equal(saved.files[0]!.name, 'renamed.md');
  await click('Remove saved file renamed.md'); await click('Save prompt'); assert.equal(service.prompts.get(saved.id).files.length, 0);
});

test('Markdown import stays unsaved until Save and preserves the file contents', async t => {
  const { service } = await fixture(t);
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".md,.markdown,.txt"]')!;
  // File.text is a browser API not yet implemented by JSDOM's File.
  const file = new dom.window.File(['# Imported\n\nKeep this text.'], 'my-import.md', { type: 'text/markdown' }); Object.defineProperty(file, 'text', { value: async () => '# Imported\n\nKeep this text.' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))); await tick();
  assert.equal(service.prompts.list().prompts.length, 22);
  await click('Save prompt'); const saved = service.prompts.list().prompts.find(p => p.name === 'my-import')!;
  assert.equal(service.prompts.get(saved.id).text, '# Imported\n\nKeep this text.');
});

test('search covers the whole prompt rather than only its displayed excerpt', async t => {
  await fixture(t); await click('New prompt'); await fill('Prompt name', 'Long instructions'); await fill('Saved prompt text', 'Read this carefully. '.repeat(50) + 'unique-ending'); await click('Save prompt');
  await fill('Search saved prompts', 'unique-ending'); assert.equal(document.querySelectorAll('.library-list > button').length, 1);
  assert.match(document.querySelector('.library-list')!.textContent!, /Long instructions/);
});

for (const mode of ['benchmark', 'conversation', 'build'] as const) {
  test(`Run now prepares the prompt and calls the room launch flow in ${mode} mode`, async t => {
    const { factory, used, closed } = await fixture(t, { mode });
    await click('Run now'); assert.equal(used.length, 1); assert.equal(used[0]!.run, true); assert.equal(used[0]!.prepared.prompt.mode, mode); assert.equal(closed(), 1); assert.equal(factory.agents.length, 0);
  });
}

test('blocked runs remain loadable, while unsaved edits and replacing a draft require an explicit choice', async t => {
  const { used, closed } = await fixture(t, { runBlocked: () => 'Activate both agents first.', draft: 'Keep my existing draft' });
  assert.equal(button('Run now').disabled, true);
  await click('Load into composer'); assert.equal(used.length, 0); await click('Cancel'); assert.equal(closed(), 0);
  await fill('Saved prompt text', 'Some unsaved edits'); await click('Close prompt library'); assert.equal(closed(), 0); await click('Cancel');
  await click('Load into composer'); await click('Replace draft'); assert.equal(used[0]!.prepared.prompt.text, 'Some unsaved edits');
});

test('an editor opened from the composer saves its files and mode without changing the original attachment', async t => {
  let attached!: AttachmentRef;
  const { service, used } = await fixture(t, async service => {
    attached = await service.call('attachment.add', { name: 'draft.txt', mediaType: 'text/plain', data: Buffer.from('From composer').toString('base64') }) as AttachmentRef;
    return { startWithDraft: true, draft: 'Composer text', draftFiles: [attached], mode: 'conversation' };
  });
  await click('Save prompt'); const saved = service.prompts.list().prompts.find(p => p.name === 'Composer text')!;
  await click('Load into composer'); await click('Replace draft');
  assert.equal(used[0]!.prepared.prompt.mode, 'conversation'); assert.equal(used[0]!.prepared.attachments[0]!.name, 'draft.txt');
  assert.equal(service.store.attachmentData(attached.id).toString('utf8'), 'From composer'); assert.equal(saved.files.length, 1);
});

// G2: every Debate prompt is the debate template: the topic, each agent's private context and internet, and the rounds.
test('a Debate prompt is written as the debate template and loads with it', async t => {
  const { service, used } = await fixture(t, { mode: 'conversation' });
  await click('Debate'); await click('New prompt');
  assert.ok(document.querySelector('[aria-label="Debate setup"]'), 'a new prompt in the Debate tab is a debate template');
  await fill('Prompt name', 'Car ban'); await fill('Saved prompt text', 'Should cities ban private cars downtown?');
  await fill('Private context for Agent 1', 'You argue for the ban.'); await fill('Private context for Agent 2', 'You argue against it.');
  await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Internet for Agent 2"]')!.click()); await tick();
  // Sides are assigned and opposite: putting Agent 1 against the motion puts Agent 2 for it.
  await fill('Side for Agent 1', 'against');
  assert.equal((document.querySelector('[aria-label="Side for Agent 2"]') as HTMLSelectElement).value, 'for');
  await fill('Debate rounds', '0'); assert.equal(button('Save prompt').disabled, true, 'rounds must be 1 to 100');
  await fill('Debate rounds', '6'); await click('Save prompt');
  const saved = service.prompts.list().prompts.find(p => p.name === 'Car ban')!;
  assert.deepEqual(saved.debate, { rounds: 6, agents: { cli1: { stance: 'against', context: 'You argue for the ban.', internet: false }, cli2: { stance: 'for', context: 'You argue against it.', internet: true } } });
  assert.match(document.querySelector('.library-list')!.textContent!, /Debate · 6 rounds · internet/);
  await click('Load into composer'); assert.deepEqual(used[0]!.prepared.prompt.debate, saved.debate);
});
test('Use current draft in Debate takes the room\'s debate options as the template', async t => {
  const draftDebate = { rounds: 9, agents: { cli1: { stance: 'for' as const, context: 'Room context 1', internet: true }, cli2: { stance: 'against' as const, context: 'Room context 2', internet: false } } };
  const { service } = await fixture(t, { mode: 'conversation', startWithDraft: true, draft: 'Room topic', draftDebate });
  assert.equal((document.querySelector('[aria-label="Private context for Agent 1"]') as HTMLTextAreaElement).value, 'Room context 1');
  await click('Save prompt'); assert.deepEqual(service.prompts.list().prompts.find(p => p.name === 'Room topic')!.debate, draftDebate);
});

test('deletion requires confirmation and does not re-seed the removed starter', async t => {
  const { service } = await fixture(t);
  const name = (document.querySelector('[aria-label="Prompt name"]') as HTMLInputElement).value;
  await click('Delete prompt'); await click('Cancel'); assert.ok(service.prompts.list().prompts.some(p => p.name === name));
  await click('Delete prompt');
  const confirm = document.querySelector<HTMLButtonElement>('.library-confirm .destructive')!; await act(async () => confirm.click()); await tick();
  assert.equal(service.prompts.list().prompts.some(p => p.name === name), false);
});

test('a stale editor cannot silently run a prompt that changed in another window', async t => {
  const { service, used } = await fixture(t);
  const name = (document.querySelector('[aria-label="Prompt name"]') as HTMLInputElement).value;
  const current = service.prompts.list().prompts.find(p => p.name === name)!;
  const original = service.prompts.get(current.id);
  service.prompts.save({ id: current.id, revision: original.revision, name: original.name, text: 'Someone changed the instructions', mode: original.mode, buildKind: original.buildKind, files: [] });
  await click('Run now'); assert.equal(used.length, 0); assert.match(document.querySelector('[role="alert"]')!.textContent!, /changed in another window/);
});
