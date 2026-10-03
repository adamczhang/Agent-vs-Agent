import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConversationController, parseEnvelope } from '../src/controller.js';
import { Store, SCHEMA_VERSION } from '../src/store.js';
import { conversationConfig, SEATS, type RunConfig } from '../src/types.js';
import { FakeClock, FakeParticipant, flush } from './fakes.js';
import { tempDir } from './temp.js';

function fixture(overrides:Partial<RunConfig>={},honorAbort=true) {
  const store=new Store(':memory:'),pair=store.createPair('test');
  const participants={cli1:new FakeParticipant('session-A',honorAbort),cli2:new FakeParticipant('session-B',honorAbort)};
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.generation=1;s.sessionId=participants[seat].sessionId;s.verifiedAt=1;});
  const clock=new FakeClock(),engine=new ConversationController(store,clock,100);
  const config=conversationConfig('Discuss a picnic menu',{opening:'both',completion:'duration',durationMs:10000,paceMs:0,maxRequests:20,perTurnMs:5000,...overrides});
  const run=engine.start(pair.id,config,'start-once',participants);
  return {store,pair,participants,clock,engine,config,run};
}
test('an envelope that ends a reply is accepted after narration; anything looser is not',()=>{
  const env='{"message":"139,804 residents","stop_requested":false,"stop_reason":null}';
  assert.equal(parseEnvelope(`I'll look up a current figure and cite the source.${env}`).message,'139,804 residents','seen live with Grok Build after a web search');
  assert.equal(parseEnvelope(`Checking.\n\`\`\`json\n${env}\n\`\`\``).message,'139,804 residents');
  assert.throws(()=>parseEnvelope(`${env} and then more text`),/envelope/,'the envelope must end the reply');
  assert.throws(()=>parseEnvelope('Here is my answer: 139,804.'),/envelope/);
});
test('a build report that ends with its APP line is final once the agent goes quiet, even if its turn stays open',async()=>{
  const f=fixture({mode:'build',build:{kind:'build',source:'',folder:'app-1'},durationMs:600000,perTurnMs:600000});await flush();
  // Agent 1 wrote its whole report, but a command it ran is still waiting, so its turn never ends by itself.
  f.participants.cli1.emit('output','Built it.\nAPP: app-1/index.html');f.participants.cli2.raw('Built mine.\nAPP: app-1/index.html');await flush();
  await f.clock.advance(30000);assert.equal(f.store.run(f.run.id).status,'running','still within the quiet period');
  f.participants.cli1.emit('tool','still checking');await f.clock.advance(55000);assert.equal(f.store.run(f.run.id).status,'running','any activity restarts the quiet period');
  await f.clock.advance(10000);await flush();await flush();
  assert.deepEqual([f.store.run(f.run.id).status,f.store.run(f.run.id).reason],['completed','build_done']);
  assert.equal(f.store.messages(f.run.id).find(m=>m.sender==='cli1')?.text,'Built it.\nAPP: app-1/index.html','what it wrote is its report');
  const notes=f.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='activity'").all(f.run.id).map(r=>JSON.parse(String(r.data)) as {seat:string;text:string});
  assert.ok(notes.some(n=>n.seat==='cli1'&&/takes the report as final/.test(n.text)));
});
test('a repair that the request limit leaves no room for ends the run normally, not as needing attention',async()=>{
  const f=fixture({maxRequests:2});await flush();
  f.participants.cli1.answer('A');f.participants.cli2.raw('not an envelope at all');await flush();await flush();
  const run=f.store.run(f.run.id);
  assert.deepEqual([run.status,run.reason,run.requests],['stopped','request_limit',2]);
  assert.equal(f.store.pair(f.pair.id).activeRunId,null,'the pair is free again');f.store.close();
});
test('atomic pair ownership and idempotent starts',async()=>{
  const f=fixture();await flush();
  assert.equal(f.engine.start(f.pair.id,f.config,'start-once',f.participants).id,f.run.id);
  assert.throws(()=>f.engine.start(f.pair.id,f.config,'another-start',f.participants),/already owns/);
  assert.equal(f.participants.cli1.calls.length,1);assert.equal(f.participants.cli2.calls.length,1);
  f.engine.stop(f.run.id);await flush();assert.equal(f.store.run(f.run.id).status,'stopped');f.store.close();
});
test('paired opening freezes inputs; queued broadcasts do not leak into an earlier batch',async()=>{
  const f=fixture();await flush();
  const one=f.engine.broadcast(f.run.id,'FIRST NEW TOPIC','b1');
  const two=f.engine.broadcast(f.run.id,'SECOND NEW TOPIC','b2');
  assert.equal(f.engine.broadcast(f.run.id,'FIRST NEW TOPIC','b1'),one);
  f.participants.cli1.answer('Opening A');await flush();
  assert.equal(f.participants.cli2.calls.length,1);
  assert.ok(!f.participants.cli2.calls[0]!.request.text.includes('Opening A'));
  f.participants.cli2.answer('Opening B');await flush();
  const next=f.participants.cli1.calls[1]!.request.text;assert.ok(next.includes('FIRST NEW TOPIC'));assert.ok(!next.includes('SECOND NEW TOPIC'));
  assert.equal(f.participants.cli2.calls.length,1,'the peer waits for the next turn');
  assert.equal(f.store.messages(f.run.id).find(m=>m.id===two)?.state,'queued');
  f.participants.cli1.answer('Response A1');await flush();
  assert.ok(f.participants.cli2.calls[1]!.request.text.includes('SECOND NEW TOPIC'));
  assert.ok(f.participants.cli2.calls[1]!.request.text.includes('Response A1'));
  f.participants.cli2.answer('Response B1');await flush();
  assert.ok(f.participants.cli1.calls[2]!.request.text.includes('SECOND NEW TOPIC'));
  f.engine.stop(f.run.id);await flush();f.store.close();
});
test('normal dialogue alternates and excludes own replies and private activity',async()=>{
  const f=fixture();await flush();
  f.participants.cli1.emit('thought','PRIVATE PLAN');f.participants.cli1.emit('tool','PRIVATE TOOL');
  f.participants.cli1.answer('A public');f.participants.cli2.answer('B public');await flush();
  const a=f.participants.cli1.calls[1]!.request.text;assert.ok(a.includes('B public'));assert.ok(!a.includes('A public'));assert.ok(!a.includes('PRIVATE'));
  assert.equal(f.participants.cli2.calls.length,1);
  f.participants.cli1.answer('A replies to B');await flush();
  assert.equal(f.participants.cli2.calls.length,2);
  assert.ok(f.participants.cli2.calls[1]!.request.text.includes('A replies to B'));
  assert.equal(f.store.messages(f.run.id).filter(m=>m.sender!=='user').length,3);
  f.engine.stop(f.run.id);await flush();f.store.close();
});

test('Debate length guidance defers to the operator request instead of imposing its default word count',async()=>{
  const f=fixture({topic:'Give exactly two short sentences per turn.'});await flush();
  const prompt=f.participants.cli1.calls[0]!.request.text;
  assert.ok(prompt.includes('Give exactly two short sentences per turn.'));
  assert.match(prompt,/Follow any reply-length or format limits in the discussion topic and operator messages\. Otherwise/);
  f.engine.stop(f.run.id);await flush();f.store.close();
});
test('Pause drains admitted work, freezes time only at the boundary, and Next reply is one request',async()=>{
  const f=fixture();await flush();await f.clock.advance(100);
  f.engine.pause(f.run.id);assert.equal(f.store.run(f.run.id).status,'pausing');
  await f.clock.advance(100);f.participants.cli1.answer('A');f.participants.cli2.answer('B');await flush();
  assert.equal(f.store.run(f.run.id).status,'paused');assert.equal(f.engine.snapshot(f.run.id).elapsedMs,200);
  await f.clock.advance(2000);assert.equal(f.engine.snapshot(f.run.id).elapsedMs,200);
  f.engine.step(f.run.id);await flush();assert.equal(f.participants.cli1.calls.length,2);assert.equal(f.participants.cli2.calls.length,1);
  f.participants.cli1.answer('A second');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
  f.engine.stop(f.run.id);await flush();assert.equal(f.store.run(f.run.id).elapsedMs,200);f.store.close();
});
test('deadline cancels both openings and rejects late public output',async()=>{
  const f=fixture({durationMs:100,perTurnMs:1000});await flush();
  await f.clock.advance(100);assert.equal(f.store.run(f.run.id).status,'completed');assert.equal(f.store.run(f.run.id).reason,'duration_reached');
  f.participants.cli1.raw('{"message":"late","stop_requested":false,"stop_reason":null}');await flush();
  assert.equal(f.store.messages(f.run.id).filter(m=>m.sender!=='user').length,0);
  assert.equal(f.participants.cli1.calls.length,1);f.store.close();
});
test('cancelled provider which does not settle is quarantined instead of releasing the pair',async()=>{
  const f=fixture({},false);await flush();f.engine.stop(f.run.id);await f.clock.advance(100);
  assert.equal(f.store.run(f.run.id).status,'needs_attention');assert.equal(f.store.pair(f.pair.id).activeRunId,f.run.id);
  assert.throws(()=>f.engine.start(f.pair.id,f.config,'new',f.participants),/already owns/);
  f.participants.cli1.answer('late');f.participants.cli2.answer('late');await flush();
  assert.equal(f.store.messages(f.run.id).filter(m=>m.sender!=='user').length,0);f.store.close();
});
test('one format repair cannot consume unseen peer messages',async()=>{
  const f=fixture();await flush();
  f.participants.cli2.answer('B first');f.participants.cli1.raw('not json');await flush();
  assert.equal(f.participants.cli1.calls.length,2);assert.ok(!f.participants.cli1.calls[1]!.request.text.includes('B first'));
  f.participants.cli1.answer('A repaired');await flush();
  assert.ok(f.participants.cli1.calls[2]!.request.text.includes('B first'));
  assert.equal(f.store.run(f.run.id).requests,4);
  f.engine.stop(f.run.id);await flush();f.store.close();
});
test('a second malformed response halts without publishing the invalid content',async()=>{
  const f=fixture();await flush();f.participants.cli1.raw('bad');await flush();f.participants.cli1.raw('bad again');await flush();
  assert.equal(f.store.run(f.run.id).status,'needs_attention');assert.equal(f.participants.cli1.calls.length,2);
  assert.equal(f.store.messages(f.run.id).filter(m=>m.sender!=='user').length,0);f.store.close();
});
test('request guard admits the final single turn and marks later unsent messages',async()=>{
  const f=fixture({maxRequests:3});await flush();const msg=f.engine.broadcast(f.run.id,'Another topic','next');
  f.participants.cli1.answer('A');f.participants.cli2.answer('B');await flush();
  assert.equal(f.store.run(f.run.id).requests,3);
  assert.deepEqual(f.store.messages(f.run.id).find(m=>m.id===msg)?.deliveredTo,['cli1']);
  const later=f.engine.broadcast(f.run.id,'Too late','later');f.participants.cli1.answer('Final response');await flush();
  assert.equal(f.store.run(f.run.id).reason,'request_limit');
  assert.equal(f.store.messages(f.run.id).find(m=>m.id===later)?.state,'not_delivered');f.store.close();
});
test('viewer reads have no side effects and completed reply commit is idempotent',async()=>{
  const f=fixture();await flush();f.participants.cli1.answer('A');await flush();
  const turn=String(f.store.turns(f.run.id)[0]!.id);
  assert.equal(f.store.commitReply(f.run.id,turn,'cli1','duplicate',false),false);
  for(let i=0;i<5;i++){f.engine.snapshot(f.run.id);f.store.events(f.run.id);f.store.messages(f.run.id);}
  assert.equal(f.participants.cli1.calls.length,1);assert.equal(f.participants.cli2.calls.length,1);
  f.engine.stop(f.run.id);await flush();f.store.close();
});
test('database reopening quarantines uncertain submissions without resending',()=>{
  const path=join(tempDir('ava-p0-'),'state.sqlite');
  const store=new Store(path),pair=store.createPair('recovery');
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.sessionId=seat;s.generation=1;});
  const {run}=store.start(pair.id,conversationConfig('topic'),'once');
  store.admit(run.id,SEATS,store.queued(run.id)[0]!.id);store.close();
  const recovered=new Store(path);recovered.interruptUnfinished();
  assert.equal(recovered.run(run.id).status,'needs_attention');assert.equal(recovered.pair(pair.id).activeRunId,run.id);
  assert.ok(recovered.turns(run.id).every(t=>t.status==='uncertain'));recovered.close();
});
test('the reply that completes a phase commits the next-seat decision in the same transaction',()=>{
  const store=new Store(':memory:'),pair=store.createPair('phases');
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.sessionId=seat;s.generation=1;});
  const {run}=store.start(pair.id,conversationConfig('topic',{lead:'cli2'}),'once');
  const phase=(turnId:string)=>store.db.prepare('SELECT p.status FROM phases p JOIN turns t ON t.phase_id=p.id WHERE t.id=?').get(turnId)!.status;
  const completed=()=>store.events(run.id).filter(e=>e.type==='phase_completed').length;
  const [a,b]=store.admit(run.id,SEATS,store.queued(run.id)[0]!.id);
  store.commitReply(run.id,a!.id,'cli1','opening A',false);
  assert.equal(store.run(run.id).nextSeat,'cli2');assert.equal(phase(a!.id),'open');assert.equal(completed(),0);
  store.commitReply(run.id,b!.id,'cli2','opening B',false);
  assert.equal(store.run(run.id).nextSeat,'cli2');assert.equal(phase(b!.id),'complete');assert.equal(completed(),1);
  const [single]=store.admit(run.id,['cli2']);
  store.turnEnd(single!.id,'invalid');const [repair]=store.admit(run.id,['cli2'],undefined,single!.id);
  assert.equal(phase(repair!.id),'open');assert.equal(store.run(run.id).nextSeat,'cli2');
  store.commitReply(run.id,repair!.id,'cli2','repaired B',false);
  assert.equal(store.run(run.id).nextSeat,'cli1');assert.equal(phase(single!.id),'complete');assert.equal(completed(),2);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version),SCHEMA_VERSION);store.close();
});
test('a pilot (v1) database gains the phase schema without losing turns',()=>{
  const path=join(tempDir('ava-v1-'),'state.sqlite'),v1=new DatabaseSync(path);
  v1.exec(`CREATE TABLE turns(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seat TEXT NOT NULL, inputs TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, error TEXT);
    INSERT INTO turns VALUES('old','run','cli1','[]','completed','hello',NULL);`);v1.close();
  const store=new Store(path);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version),SCHEMA_VERSION);
  const row=store.db.prepare('SELECT text,phase_id FROM turns WHERE id=?').get('old')!;assert.equal(row.text,'hello');assert.equal(row.phase_id,null);
  store.close();const reopened=new Store(path);assert.equal(Number(reopened.db.prepare('PRAGMA user_version').get()!.user_version),SCHEMA_VERSION);reopened.close();
});
test('a run stopped mid-phase leaves no phase looking in progress',async()=>{
  const f=fixture();await flush();f.participants.cli1.answer('A only');await flush();
  f.engine.stop(f.run.id);await flush();
  const statuses=f.store.db.prepare('SELECT status FROM phases WHERE run_id=?').all(f.run.id).map(r=>String(r.status));
  assert.deepEqual(statuses,['interrupted']);assert.equal(f.store.run(f.run.id).status,'stopped');f.store.close();
});
test('timed natural language is bounded and does not inherit the twenty-request default',()=>{
  const c=conversationConfig('talk about the Minnesota Vikings for 15 minutes');
  assert.equal(c.durationMs,900000);assert.equal(c.completion,'duration');assert.equal(c.maxRequests,200);
  assert.throws(()=>conversationConfig('topic',{durationMs:Infinity}),/positive/);
});
test('a queued duration change is applied at admission, not while the old turn is active',async()=>{
  const f=fixture({durationMs:10000});await flush();await f.clock.advance(1000);
  f.engine.broadcast(f.run.id,'Change topic for 15 minutes','duration');
  assert.equal(f.store.run(f.run.id).config.durationMs,10000);
  f.participants.cli1.answer('A');f.participants.cli2.answer('B');await flush();
  assert.equal(f.store.run(f.run.id).config.durationMs,901000);
  f.engine.stop(f.run.id);await flush();f.store.close();
});
test('explicit stop releases a settled failure but does not release uncertain native work',async()=>{
  const f=fixture();await flush();f.participants.cli1.raw('bad');await flush();f.participants.cli1.raw('still bad');await flush();
  assert.equal(f.store.run(f.run.id).status,'needs_attention');f.engine.stop(f.run.id);await flush();
  assert.equal(f.store.run(f.run.id).status,'stopped');assert.equal(f.store.pair(f.pair.id).activeRunId,null);f.store.close();
});
test('pause drains a bounded repair, while stop during repair publishes neither invalid nor late output',async()=>{
  const f=fixture();await flush();f.engine.pause(f.run.id);f.participants.cli1.raw('malformed');f.participants.cli2.answer('B valid');await flush();
  assert.equal(f.participants.cli1.calls.length,2);f.participants.cli1.answer('A repaired');await flush();
  assert.equal(f.store.run(f.run.id).status,'paused');assert.equal(f.store.run(f.run.id).requests,3);
  f.engine.step(f.run.id);await flush();f.participants.cli1.raw('malformed again');await flush();
  const before=f.store.messages(f.run.id).length;f.engine.stop(f.run.id);await flush();f.participants.cli1.answer('late repaired');await flush();
  assert.equal(f.store.messages(f.run.id).length,before);assert.equal(f.store.run(f.run.id).status,'stopped');f.store.close();
});
test('delayed timers after simulated sleep do not cause a catch-up dispatch burst',async()=>{
  const f=fixture({durationMs:5000,paceMs:1000});await flush();f.participants.cli1.answer('A');f.participants.cli2.answer('B');await flush();
  await f.clock.advance(1000000);
  assert.equal(f.store.run(f.run.id).status,'completed');assert.equal(f.store.run(f.run.id).requests,2);assert.equal(f.participants.cli1.calls.length,1);f.store.close();
});
test('expiry observed by a paced wake before the deadline callback ends normally without another admission',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('late-deadline'),agents={cli1:new FakeParticipant('a'),cli2:new FakeParticipant('b')};
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.generation=1;s.sessionId=agents[seat].sessionId;});
  let now=0;const timers:Array<{fn:()=>void;ms:number;active:boolean}>=[];
  const clock={now:()=>now,timer:(fn:()=>void,ms:number)=>{const t={fn,ms,active:true};timers.push(t);return()=>{t.active=false;};}};
  const engine=new ConversationController(store,clock),run=engine.start(pair.id,conversationConfig('topic',{opening:'both',completion:'duration',durationMs:1000,paceMs:500,perTurnMs:5000}),'start',agents);
  await flush();agents.cli1.answer('a');agents.cli2.answer('b');await flush();
  now=1001;timers.find(t=>t.active&&t.ms===500)!.fn();await flush();
  assert.deepEqual([store.run(run.id).status,store.run(run.id).reason,store.run(run.id).requests],['completed','duration_reached',2]);
  assert.equal(agents.cli1.calls.length,1);assert.equal(agents.cli2.calls.length,1);store.close();
});
test('a submitted call with lost acknowledgement is not blindly resent',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('lost-ack'),clock=new FakeClock();let calls=0;
  const lost={sessionId:'lost',request:()=>{calls++;return new Promise<never>(()=>{});},close:async()=>{}};
  const peer=new FakeParticipant('peer');
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.sessionId=seat==='cli1'?'lost':'peer';s.generation=1;});
  const engine=new ConversationController(store,clock,100),run=engine.start(pair.id,conversationConfig('topic',{durationMs:1000,perTurnMs:50}), 'lost',{cli1:lost,cli2:peer});
  await flush();await clock.advance(50);await clock.advance(100);
  assert.equal(calls,1);assert.equal(store.run(run.id).status,'needs_attention');assert.equal(store.pair(pair.id).activeRunId,run.id);assert.ok(store.turns(run.id).some(t=>t.status==='uncertain'));store.close();
});
