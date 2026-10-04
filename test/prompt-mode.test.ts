import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AvAService } from '../src/service.js';
import { PromptLibrary } from '../src/prompt-library.js';
import { finalAnswer, matches, promptResult } from '../src/answer-check.js';
import { PROMPT_STARTERS } from '../src/prompt-starters.js';
import { SEATS, type Pair, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const until = async (check: () => boolean, ms = 3000) => { for (const end = Date.now() + ms; !check();) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };

test('the final ANSWER line is read and checked: numbers by value, fractions reduced, words with extra text', () => {
  assert.equal(finalAnswer('Working...\nANSWER: 12\nOn reflection:\n**Answer:** 2,131.'), '2,131.');
  assert.equal(finalAnswer('No answer line here'), null);
  assert.ok(matches('2,131.', '2131')); assert.ok(matches('2131 tilings', '2131')); assert.ok(!matches('2130', '2131'));
  assert.ok(matches('74/144', '37/72')); assert.ok(matches('37 / 72', '37/72')); assert.ok(!matches('36/72', '37/72'));
  assert.ok(matches('Monday, 13 March 2147', 'Monday')); assert.ok(matches('"dev".', 'Dev')); assert.ok(!matches('Devon', 'Dev'));
  const check = { kind: 'race' as const, answers: ['505'] };
  assert.deepEqual(promptResult(check, { cli1: { text: 'ANSWER: 505', ms: 9000 }, cli2: { text: 'ANSWER: 505', ms: 4000 } }).winner, 'cli2', 'both right: the faster wins');
  const one = promptResult(check, { cli1: { text: 'ANSWER: 505', ms: 9000 }, cli2: { text: 'ANSWER: 504', ms: 4000 } });
  assert.deepEqual([one.winner, one.seats.cli2.correct, one.seats.cli2.answer], ['cli1', false, '504']);
  assert.equal(promptResult(check, { cli1: { text: 'no idea', ms: 1 } }).winner, undefined);
});

test('the built-in Prompt prompts: ten challenges and races, each asking for an ANSWER line its own key accepts', () => {
  assert.equal(PROMPT_STARTERS.length, 10);
  assert.deepEqual([PROMPT_STARTERS.filter(p => p.check.kind === 'challenge').length, PROMPT_STARTERS.filter(p => p.check.kind === 'race').length], [6, 4]);
  for (const p of PROMPT_STARTERS) {
    assert.equal(p.mode, 'benchmark');
    assert.match(p.text, /End your reply with one line in exactly this form: ANSWER: <[^>]+>$/, p.id);
    assert.match(p.text, p.check.kind === 'race' ? /This is a race/ : /Take the time you need/);
    for (const answer of p.check.answers) assert.ok(matches(answer, answer), `${p.id} accepts its own answer`);
    for (const answer of p.check.answers) assert.ok(!p.text.includes(` ${answer}.`) || p.id === 'prompt-rising-digits', `${p.id} doesn't give its answer away`);
  }
});

function fixture() {
  const root = tempDir('ava-prompt-mode-'), factory = new TestFactory(), service = new AvAService(root, factory, 'simulation');
  return { root, factory, service, close: async () => { await service.shutdown(); service.store.close(); } };
}
async function agents(service: AvAService, thread: string) {
  const pair = await service.call('pair.create', { thread }) as Pair;
  for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
  return pair;
}
const live = (factory: TestFactory) => factory.agents.filter(a => !a.closed);

test('a Prompt run with an answer key is checked when both have answered; each run is its own thread, with the same agents kept Ready', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await agents(service, 'prompts');
    const check = { kind: 'challenge', answers: ['2131'] };
    const first = await service.call('run.start', { pairId: pair.id, text: 'Count the tilings. ANSWER: <n>', requestId: 'one', options: { mode: 'benchmark', check } }) as Run;
    await flush();
    live(factory)[0]!.raw('Thinking...\nANSWER: 2131'); live(factory)[1]!.raw('ANSWER: 2130'); await until(() => !!service.store.run(first.id).result);
    const result = service.store.run(first.id).result!;
    assert.deepEqual([result.winner, result.seats.cli1.correct, result.seats.cli2.correct, result.seats.cli2.answer], ['cli1', true, false, '2130']);
    assert.ok(result.seats.cli1.ms !== null && result.seats.cli1.ms >= 0);
    // The next prompt: fresh sessions (clean context) for the same agents, which never stop being Ready.
    const before = SEATS.map(s => service.store.pair(pair.id).slots[s].sessionId), seen: string[] = [];
    const watch = setInterval(() => { for (const s of SEATS) seen.push(service.store.pair(pair.id).slots[s].state); }, 1);
    const starting = service.call('run.start', { pairId: pair.id, text: 'Second prompt', requestId: 'two', options: { mode: 'benchmark' } }) as Promise<Run>;
    const second = await starting; clearInterval(watch); await flush();
    assert.ok(seen.every(s => s === 'ready'), 'the agents stay Ready while their fresh sessions start');
    const after = SEATS.map(s => service.store.pair(pair.id).slots[s].sessionId);
    assert.ok(after.every((id, i) => id !== before[i]), 'fresh sessions');
    assert.deepEqual(SEATS.map(s => service.store.pair(pair.id).slots[s].config?.model), ['model', 'model'], 'the same agents');
    assert.equal(factory.agents.filter(a => a.closed).length, 2, 'the old sessions closed after the switch');
    live(factory)[0]!.raw('one'); live(factory)[1]!.raw('two'); await flush(); await until(() => service.store.run(second.id).status === 'completed');
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ runIds: string[]; verdict?: { kind?: string; winner?: string } | null }> }).threads.filter(t => t.runIds.length);
    assert.deepEqual(threads.map(t => t.runIds.length), [1, 1], 'one Prompt run per thread');
    assert.deepEqual(threads.find(t => t.runIds[0] === first.id)!.verdict, { status: 'done', kind: 'challenge', winner: 'cli1', correct: { cli1: true, cli2: false } });
  } finally { await close(); }
});

test('a fresh session that fails leaves the agent with the session it had', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await agents(service, 'renew-fails');
    const old = service.store.pair(pair.id).slots.cli1;
    const original = factory.open.bind(factory);
    factory.open = async (...args: Parameters<TestFactory['open']>) => { const agent = await original(...args); agent.request = async () => ({ status: 'completed', text: 'nope' }); return agent; };
    await assert.rejects(service.activation.renew(pair.id, 'cli1'), /did not answer its check/);
    const slot = service.store.pair(pair.id).slots.cli1;
    assert.deepEqual([slot.state, slot.sessionId, slot.generation], ['ready', old.sessionId, old.generation]);
    assert.equal(service.activation.get(pair.id, 'cli1')?.sessionId, old.sessionId);
  } finally { await close(); }
});

test('Q3: an agent whose fresh session failed gets one on the retry, though the new thread looks empty', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await agents(service, 'stale');
    const first = await service.call('run.start', { pairId: pair.id, text: 'One', requestId: 'one', options: { mode: 'benchmark' } }) as Run;
    await flush(); live(factory)[0]!.raw('a'); live(factory)[1]!.raw('b'); await until(() => service.store.run(first.id).status === 'completed');
    const before = service.store.pair(pair.id).slots.cli2.sessionId;
    // Agent 2's next fresh session fails its check; Agent 1's succeeds.
    const original = factory.open.bind(factory); let failNext = true;
    factory.open = async (...args: Parameters<TestFactory['open']>) => { const agent = await original(...args); if ((args[1] as { seat: string }).seat === 'cli2' && failNext) { failNext = false; agent.request = async () => ({ status: 'completed', text: 'nope' }); } return agent; };
    await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Two', requestId: 'two', options: { mode: 'benchmark' } }), /did not answer its check/);
    assert.equal(service.store.pair(pair.id).slots.cli2.sessionId, before, 'Agent 2 still has the session that answered the first prompt');
    await service.call('run.start', { pairId: pair.id, text: 'Three', requestId: 'three', options: { mode: 'benchmark' } });
    assert.notEqual(service.store.pair(pair.id).slots.cli2.sessionId, before, 'the retry gave it a fresh session first');
  } finally { await close(); }
});

test('an older library gets the challenges and races once; the old Prompt starters go only where unedited', async () => {
  const { root, service, close } = fixture();
  try {
    const old = join(root, 'older'), prompts = join(old, 'prompts'); mkdirSync(prompts, { recursive: true });
    const write = (id: string, name: string, text: string) => { mkdirSync(join(prompts, id)); writeFileSync(join(prompts, id, 'prompt.md'), text); writeFileSync(join(prompts, id, 'prompt.json'), JSON.stringify({ version: 1, id, name, mode: 'benchmark', buildKind: 'build', createdAt: 'x', updatedAt: 'x', files: [] })); };
    write('starter-intervals', 'Merge overlapping intervals', '# Merge intervals\n\nWrite a function that merges overlapping closed intervals. Handle empty input, unsorted input, and intervals that share an endpoint. Explain its time complexity and include three tests.');
    write('starter-state-tracking', 'Track the shuffled objects', 'My own edited version');
    writeFileSync(join(prompts, '.initialized'), '3\n');
    const library = new PromptLibrary(old, service.store), ids = library.list().prompts.map(p => p.id);
    assert.ok(!ids.includes('starter-intervals') && ids.includes('starter-state-tracking'));
    assert.ok(PROMPT_STARTERS.every(p => ids.includes(p.id)));
    assert.deepEqual(library.get('prompt-day-of-week').check, { kind: 'race', answers: ['Monday'] });
    assert.deepEqual(JSON.parse(readFileSync(join(prompts, 'prompt-day-of-week', 'check.json'), 'utf8')), { version: 1, kind: 'race', answers: ['Monday'] });
    assert.ok(!readFileSync(join(prompts, 'prompt-day-of-week', 'prompt.md'), 'utf8').includes('Monday'), 'the answer stays out of the prompt');
    assert.equal(readFileSync(join(prompts, '.initialized'), 'utf8'), '4\n');
  } finally { await close(); }
});
