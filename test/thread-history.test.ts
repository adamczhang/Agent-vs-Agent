import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { SEATS, type AttachmentRef, type Pair, type Run } from '../src/types.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const until = async (check: () => boolean, ms = 3000) => { for (const end = Date.now() + ms; !check();) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };
const ballot = JSON.stringify({ scores: { proposition: { evidence: 4, clash: 4, stance: 5 }, opposition: { evidence: 3, clash: 3, stance: 4 } }, winner: 'proposition', reason: 'Clearer case.', notes: {}, issues: [] });
function fixture() {
  const root = tempDir('ava-history-'), factory = new TestFactory(), service = new AvAService(root, factory, 'simulation');
  return { root, factory, service, close: async () => { await service.shutdown(); service.store.close(); } };
}
type Threads = { threads: Array<{ id: string; title: string; runIds: string[]; current: boolean; verdict?: { status: string; winner?: string; totals?: Record<string, number> } | null }> };
const options = { paceMs: 0, completion: 'rounds', rounds: 1, stances: { cli1: 'for', cli2: 'against' }, judge: { provider: 'claude' } };
// The agents the service has opened so far, and which of them are open now (a debate's fresh sessions open new ones).
const open = (factory: TestFactory) => factory.agents.filter(a => !a.closed);
async function debate(service: AvAService, factory: TestFactory, pair: Pair, motion: string, judged = true) {
  const { judge: _judge, ...unjudged } = options;
  const starting = service.call('run.start', { pairId: pair.id, text: motion, requestId: motion, options: judged ? options : unjudged }) as Promise<Run>;
  // Both debaters' briefs (in fresh sessions after an earlier debate), then one speech each.
  await until(() => open(factory).filter(a => a.calls.length && !a.calls.at(-1)!.settled).length === 2);
  for (const agent of open(factory).slice(0, 2)) agent.raw('READY');
  const run = await starting; await flush();
  const [one, two] = SEATS.map(s => open(factory).find(a => a.sessionId === service.store.pair(pair.id).slots[s].sessionId)!);
  one!.answer('Opening for'); await flush(); two!.answer('Opening against'); await flush();
  if (judged) { await until(() => open(factory).some(a => a.calls.length === 2 && !a.calls[1]!.settled && /judge of a formal debate/.test(a.calls[1]!.request.text))); open(factory).find(a => /judge of a formal debate/.test(a.calls[1]?.request.text ?? ''))!.raw(ballot); await until(() => service.store.run(run.id).judgment?.status === 'done'); }
  return run;
}
async function debaters(service: AvAService, thread: string) {
  const pair = await service.call('pair.create', { thread }) as Pair;
  for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
  return pair;
}

// C: each formal debate is its own thread, with its ballot; the thread list shows the result.
test('each debate is its own thread, kept in history with the judge\'s result', async () => {
  const { factory, service, close } = fixture();
  try {
    const pair = await debaters(service, 'history');
    const first = await debate(service, factory, pair, 'This house would A');
    const second = await debate(service, factory, pair, 'This house would B');
    const threads = (await service.call('threads.list', { pairId: pair.id }) as Threads).threads.filter(t => t.runIds.length);
    assert.deepEqual(threads.map(t => t.runIds).sort(), [[first.id], [second.id]].sort(), 'one debate per thread');
    assert.ok(threads.every(t => t.verdict?.status === 'done' && t.verdict.winner === 'cli1' && t.verdict.totals?.cli1 === 13 && t.verdict.totals?.cli2 === 10));
    assert.notEqual(service.store.run(first.id).sessions.cli1, service.store.run(second.id).sessions.cli1, 'the second debate had fresh sessions');
    const view = await service.call('thread.get', { threadId: threads.find(t => t.runIds[0] === first.id)!.id }) as { runs: Array<{ judgment: { winner: string } | null }> };
    assert.equal(view.runs[0]!.judgment?.winner, 'cli1', 'the ballot is kept with the thread for review');
  } finally { await close(); }
});

// D: deleting one thread from history.
test('deleting a thread removes it and what only it used; an active thread must be closed first', async () => {
  const { root, factory, service, close } = fixture();
  try {
    const pair = await debaters(service, 'delete');
    const kept = await debate(service, factory, pair, 'This house would keep', false);
    const gone = await debate(service, factory, pair, 'This house would go', false);
    const list = async () => (await service.call('threads.list', { pairId: pair.id }) as Threads).threads.filter(t => t.runIds.length);
    const keptId = (await list()).find(t => t.runIds[0] === kept.id)!.id, goneId = (await list()).find(t => t.runIds[0] === gone.id)!.id;
    // The current thread's agents are active: refused.
    await assert.rejects(service.call('thread.delete', { threadId: goneId, requestId: 'r1' }), /Close the thread first/);
    // An attachment used only by the deleted thread's messages goes; the earlier thread's folders stay.
    const file = service.store.saveAttachment('note.txt', 'text/plain', 'text', Buffer.from('x')) as AttachmentRef;
    service.store.db.prepare('UPDATE messages SET attachments=? WHERE run_id=? AND sender=?').run(JSON.stringify([file]), kept.id, 'user');
    const folder = join(root, 'workspaces', pair.id, 'cli1', String(kept.generations.cli1)); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'a.txt'), 'x');
    const result = await service.call('thread.delete', { threadId: keptId, requestId: 'r2' }) as { runs: number; attachments: number };
    assert.deepEqual([result.runs, result.attachments], [1, 1]);
    assert.ok(!(await list()).some(t => t.id === keptId)); assert.ok((await list()).some(t => t.id === goneId));
    assert.throws(() => service.store.run(kept.id)); assert.equal(service.store.messages(kept.id).length, 0);
    assert.ok(!existsSync(folder), 'its session folders went too');
    // Retried with the same request: the same answer, nothing more deleted.
    assert.deepEqual(await service.call('thread.delete', { threadId: keptId, requestId: 'r2' }), result);
    // Once closed, the current thread can go too.
    await service.call('pair.close', { pairId: pair.id, requestId: 'close' });
    await service.call('thread.delete', { threadId: goneId, requestId: 'r3' });
    assert.equal((await list()).length, 0);
  } finally { await close(); }
});
