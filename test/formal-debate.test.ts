import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { Store } from '../src/store.js';
import { ConversationController } from '../src/controller.js';
import { debateBrief, judgePrompt, maxEffort, parseBallot } from '../src/debate.js';
import { conversationConfig, SEATS, type Pair, type Run, type Seat } from '../src/types.js';
import { FakeClock, FakeParticipant, TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const until = async (check: () => boolean, ms = 3000) => { for (const end = Date.now() + ms; !check();) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };
const ballot = (winner: string, a = [4, 3, 4], b = [3, 4, 3]) => JSON.stringify({ scores: { proposition: { evidence: a[0], clash: a[1], stance: a[2] }, opposition: { evidence: b[0], clash: b[1], stance: b[2] } }, winner, reason: 'The Proposition answered the key clash.', notes: { proposition: 'Strong evidence.', opposition: 'Good rebuttals.' }, issues: [{ debater: 'opposition', claim: 'A made-up figure', problem: 'No such study.' }] });

// G6: in a formal debate each turn is a speech for the agent's assigned side: an opening, rebuttals, a closing.
test('a formal debate: no in-room briefing, and each speech is the opening, a rebuttal or the closing for its side', async () => {
  const store = new Store(':memory:'), pair = store.createPair('formal'), agents = { cli1: new FakeParticipant('one'), cli2: new FakeParticipant('two') };
  for (const seat of SEATS) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.sessionId = agents[seat].sessionId; });
  const engine = new ConversationController(store, new FakeClock());
  const run = engine.start(pair.id, conversationConfig('This house would ban cars downtown', { paceMs: 0, completion: 'rounds', rounds: 3, stances: { cli1: 'against', cli2: 'for' }, instructions: { cli1: 'PRIVATE-ONE', cli2: 'PRIVATE-TWO' } }), 'start', agents);
  try {
    await flush();
    assert.deepEqual(SEATS.map(s => agents[s].calls.length), [1, 0], 'the agents were briefed through their 1:1 lines, so nobody is briefed here');
    const first = agents.cli1.calls[0]!.request.text;
    assert.match(first, /formal debate, arguing for the Opposition, against the motion/); assert.match(first, /Round 1 of 3: your opening speech/);
    assert.match(first, /Never invent a fact/); assert.doesNotMatch(first, /PRIVATE-ONE/, 'the private brief came through the 1:1 line');
    agents.cli1.answer('Opening against'); await flush();
    assert.match(agents.cli2.calls[0]!.request.text, /arguing for the Proposition, for the motion/);
    assert.match(agents.cli2.calls[0]!.request.text, /Round 1 of 3: your opening speech.*already opened/s);
    agents.cli2.answer('Opening for'); await flush();
    assert.match(agents.cli1.calls[1]!.request.text, /Round 2 of 3: a rebuttal/);
    agents.cli1.answer('Rebuttal'); await flush(); agents.cli2.answer('Rebuttal'); await flush();
    assert.match(agents.cli1.calls[2]!.request.text, /Round 3 of 3: your closing speech. No new arguments/);
    agents.cli1.answer('Closing'); await flush(); agents.cli2.answer('Closing'); await flush();
    assert.deepEqual([store.run(run.id).status, store.run(run.id).reason, store.run(run.id).requests], ['completed', 'rounds_done', 6]);
  } finally { engine.stop(run.id); await flush(); store.close(); }
});

// A speech time limit: a speech that runs over is cut off and forfeited; the debate goes on, and everyone (the judge
// too) is told the limit.
test('a speech that runs past its time limit is forfeited, and the debate goes on', async () => {
  const store = new Store(':memory:'), pair = store.createPair('timed'), agents = { cli1: new FakeParticipant('one'), cli2: new FakeParticipant('two') }, clock = new FakeClock();
  for (const seat of SEATS) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.sessionId = agents[seat].sessionId; });
  const engine = new ConversationController(store, clock);
  const config = conversationConfig('This house would X', { paceMs: 0, completion: 'rounds', rounds: 2, stances: { cli1: 'for', cli2: 'against' }, speechMs: 120_000 });
  assert.ok(config.perTurnMs >= 180_000, 'the turn backstop leaves room for the speech limit');
  const run = engine.start(pair.id, config, 'timed', agents);
  try {
    await flush();
    assert.match(agents.cli1.calls[0]!.request.text, /Time limit: each speech must be finished within 2 minutes, thinking and any web searches included/);
    await clock.advance(119_000); assert.equal(store.messages(run.id).filter(m => m.sender === 'cli1').length, 0);
    await clock.advance(1_000); await flush();
    const forfeit = store.messages(run.id).find(m => m.sender === 'cli1')!;
    assert.equal(forfeit.text, '[Out of time: this speech ran past its 2 minutes limit and was forfeited.]');
    assert.equal(store.run(run.id).status, 'running', 'the debate goes on');
    assert.match(agents.cli2.calls[0]!.request.text, /Out of time/);
    agents.cli2.answer('Opening'); await flush();
    agents.cli1.answer('Rebuttal in time'); await flush(); agents.cli2.answer('Closing'); await flush();
    assert.deepEqual([store.run(run.id).status, store.run(run.id).reason], ['completed', 'rounds_done']);
    assert.match(judgePrompt(store.run(run.id).config, store.messages(run.id), ''), /2 minutes time limit. A speech marked "Out of time" was forfeited/);
    assert.throws(() => conversationConfig('X', { stances: { cli1: 'for', cli2: 'against' }, speechMs: 10_000 }), /30 seconds to 30 minutes/);
    assert.equal(conversationConfig('X', { speechMs: 120_000 }).speechMs, undefined, 'only a formal debate has speech times');
  } finally { engine.stop(run.id); await flush(); store.close(); }
});

test('the brief, the judge\'s prompt and the ballot', () => {
  const config = conversationConfig('This house would ban smartphones in schools', { completion: 'rounds', stances: { cli1: 'for', cli2: 'against' }, opening: 'cli1', instructions: { cli1: 'SECRET-ONE', cli2: 'SECRET-TWO' } });
  const brief = debateBrief(config, 'cli2', config.instructions.cli2, 'Internet access: off.');
  for (const part of [/formal debate/, /Motion: This house would ban smartphones/, /Your side: the Opposition, against the motion\. Sides are assigned/, /7 rounds/, /Your opponent gives the first speech/,
    /How you will be judged.*Factual accuracy and evidence.*Challenging the opposition’s strongest points.*A cohesive stance/s, /SECRET-TWO/, /reply with one short line: READY/]) assert.match(brief, part);
  assert.doesNotMatch(brief, /SECRET-ONE/);
  const messages = [{ id: 'u', seq: 1, runId: 'r', sender: 'user' as const, text: config.topic, state: 'committed' as const, turnId: null },
    { id: 'a', seq: 2, runId: 'r', sender: 'cli1' as const, text: 'Phones distract.', state: 'committed' as const, turnId: 't1' },
    { id: 'b', seq: 3, runId: 'r', sender: 'cli2' as const, text: 'Evidence is mixed.', state: 'committed' as const, turnId: 't2' }];
  const prompt = judgePrompt(config, messages, 'Internet access: on.');
  assert.match(prompt, /Proposition, round 1:\nPhones distract\./); assert.match(prompt, /Opposition, round 1:\nEvidence is mixed\./);
  assert.doesNotMatch(prompt, /SECRET|cli1|cli2|Codex|Claude/, 'the judge never sees the briefs or who the debaters are');
  // Scores map back to the seats by side, whichever seat argued which.
  const result = parseBallot(`Some thinking first. ${ballot('opposition')}`, { cli1: 'against', cli2: 'for' });
  assert.deepEqual(result.scores, { cli1: { evidence: 3, clash: 4, stance: 3 }, cli2: { evidence: 4, clash: 3, stance: 4 } });
  assert.equal(result.winner, 'cli1'); assert.deepEqual(result.issues, [{ seat: 'cli1', claim: 'A made-up figure', problem: 'No such study.' }]);
  assert.throws(() => parseBallot(ballot('proposition', [6, 3, 4]), config.stances!), /whole number from 1 to 5/);
  assert.throws(() => parseBallot(ballot('draw'), config.stances!), /winner/);
  assert.throws(() => parseBallot('No JSON here.', config.stances!), /ballot/);
  // The judge's effort: "max" where offered, else the highest there is.
  const effort = (values: string[]) => maxEffort([{ id: 'reasoning_effort', name: 'Effort', currentValue: values[0]!, options: values.map(value => ({ value, name: value })) }])?.value;
  assert.deepEqual([effort(['low', 'high', 'xhigh', 'max', 'ultra']), effort(['default', 'low', 'high', 'xhigh']), effort(['low'])], ['max', 'xhigh', undefined]);
});

function fixture() {
  const factory = new TestFactory(), service = new AvAService(tempDir('ava-formal-'), factory, 'simulation');
  return { factory, service, close: async () => { await service.shutdown(); service.store.close(); } };
}
async function debaters(service: AvAService, thread: string) {
  const pair = await service.call('pair.create', { thread }) as Pair;
  for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
  return pair;
}
const options = { paceMs: 0, completion: 'rounds', rounds: 1, stances: { cli1: 'for', cli2: 'against' }, judge: { provider: 'claude' }, instructions: { cli1: 'BRIEF-FOR', cli2: 'BRIEF-AGAINST' } };

test('each debater is briefed through its 1:1 line before the debate starts; the judge then scores both', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await debaters(service, 'formal-judged');
    // The agent limit doesn't hold the judge back: with both debaters active, the limit is full.
    await service.call('resources.configure', { maxActiveAgents: 2, requestId: 'limit' });
    const starting = service.call('run.start', { pairId: pair.id, text: 'This house would ban smartphones in schools', requestId: 'start', options }) as Promise<Run>;
    await until(() => factory.agents.every(a => a.calls.length === 2));
    const [one, two] = [factory.agents[0]!.calls[1]!.request.text, factory.agents[1]!.calls[1]!.request.text];
    assert.match(one, /Private message from the operator/); assert.match(one, /Your side: the Proposition/); assert.match(one, /BRIEF-FOR/); assert.doesNotMatch(one, /BRIEF-AGAINST/);
    assert.match(two, /Your side: the Opposition/); assert.match(two, /BRIEF-AGAINST/);
    assert.equal(service.store.pair(pair.id).activeRunId, null, 'the debate waits for both');
    factory.agents[0]!.raw('READY, for the motion.'); factory.agents[1]!.raw('READY, against.');
    const run = await starting;
    const thread = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string }> }).threads[0]!.id;
    const direct = (await service.call('thread.get', { threadId: thread }) as { direct: { messages: Array<{ seat: Seat; sender: string; text: string }> } }).direct.messages;
    for (const seat of SEATS) {
      assert.ok(direct.some(m => m.seat === seat && m.sender === 'user' && /formal debate/.test(m.text)), `${seat}'s brief is in its 1:1 line`);
      assert.ok(direct.some(m => m.seat === seat && m.sender === 'agent' && /READY/.test(m.text)), `${seat}'s reply too`);
    }
    await flush(); factory.agents[0]!.answer('Opening for'); await flush(); factory.agents[1]!.answer('Opening against'); await flush();
    assert.equal(service.store.run(run.id).reason, 'rounds_done');
    // The judge: a fresh session (its readiness check, then the ballot), not counted against the limit.
    await until(() => factory.agents.length === 3 && factory.agents[2]!.calls.length === 2);
    const judgeText = factory.agents[2]!.calls[1]!.request.text;
    assert.match(judgeText, /You are the judge of a formal debate/); assert.doesNotMatch(judgeText, /BRIEF-|Codex|codex/);
    assert.equal(service.store.run(run.id).judgment?.status, 'judging');
    factory.agents[2]!.raw(ballot('opposition')); await until(() => service.store.run(run.id).judgment?.status === 'done');
    const judgment = service.store.run(run.id).judgment!;
    assert.deepEqual([judgment.winner, judgment.scores?.cli1.evidence, judgment.scores?.cli2.clash, judgment.judge.provider], ['cli2', 4, 4, 'claude']);
    await until(() => factory.agents[2]!.closed, 2000);
    // Q4: once it has scored, the judge's session is forgotten: its pair (and its saved session state) goes.
    await until(() => !service.resources.pairs().some(p => p.thread.startsWith('debate-judge-')), 2000);
    // Judge again works on an ended debate; a failed answer is reported, not lost.
    await service.call('debate.judge', { runId: run.id, provider: 'codex' });
    await until(() => factory.agents.length === 4 && factory.agents[3]!.calls.length === 2);
    // Q4: a judge at work doesn't count against the limit for others either: with a limit of 3, a third agent starts.
    await service.call('resources.configure', { maxActiveAgents: 3, requestId: 'limit-3' });
    const other = await service.call('pair.create', { thread: 'formal-judged-other' }) as Pair;
    await service.call('slot.configure', { pairId: other.id, seat: 'cli1', config: { provider: 'codex', model: 'model', auth: 'provider-login' } });
    await service.call('slot.activate', { pairId: other.id, seat: 'cli1' });
    assert.equal(service.store.pair(other.id).slots.cli1.state, 'ready');
    factory.agents[3]!.raw('I cannot decide.'); await until(() => service.store.run(run.id).judgment?.status === 'failed');
    assert.match(service.store.run(run.id).judgment!.error!, /did not answer with a ballot/);
  } finally { await close(); }
});

test('shutting down while the debaters are still being briefed ends the start instead of waiting for them', async () => {
  const { factory, service } = fixture();
  const pair = await debaters(service, 'formal-shutdown');
  const starting = service.call('run.start', { pairId: pair.id, text: 'This house would Z', requestId: 'z', options });
  await until(() => factory.agents.every(a => a.calls.length === 2));
  const started = Date.now(); await service.shutdown(); service.store.close();
  assert.ok(Date.now() - started < 5000, 'shutdown didn\'t wait for the briefs');
  await assert.rejects(starting);
});
test('a debater that can\'t take its brief stops the start; a debate without a judge, or stopped, isn\'t judged on its own', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await debaters(service, 'formal-brief-fails');
    const starting = service.call('run.start', { pairId: pair.id, text: 'This house would X', requestId: 'fail', options });
    await until(() => factory.agents.every(a => a.calls.length === 2));
    factory.agents[0]!.calls[1]!.resolve({ status: 'cancelled', text: '' }); factory.agents[0]!.calls[1]!.settled = true; factory.agents[1]!.raw('READY');
    await assert.rejects(starting, /Agent 1 didn’t take its debate brief/);
    assert.equal(service.store.pair(pair.id).activeRunId, null);
    // Q3: a failed brief leaves the sessions with that brief (and its side), so the retry gives both fresh sessions first.
    const { judge: _judge, ...noJudge } = options, live = () => factory.agents.filter(a => !a.closed);
    const starting2 = service.call('run.start', { pairId: pair.id, text: 'This house would Y', requestId: 'no-judge', options: noJudge }) as Promise<Run>;
    await until(() => factory.agents.length === 4 && live().length === 2 && live().every(a => a.calls.length === 2)); live()[0]!.raw('READY'); live()[1]!.raw('READY');
    const run = await starting2; await flush();
    await assert.rejects(service.call('debate.judge', { runId: run.id }), /once it has ended/);
    live()[0]!.answer('Opening'); await flush(); live()[1]!.answer('Answer'); await flush();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(service.store.run(run.id).judgment, undefined, 'no judge chosen: not judged');
    assert.equal(factory.agents.length, 4, 'and no judge started');
  } finally { await close(); }
});
