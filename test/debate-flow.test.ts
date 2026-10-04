import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { ConversationController } from '../src/controller.js';
import { conversationConfig, SEATS, type RunConfig } from '../src/types.js';
import { FakeClock, FakeParticipant, TestFactory, flush } from './fakes.js';
import { AvAService } from '../src/service.js';
import type { Pair, Run } from '../src/types.js';
import { tempDir } from './temp.js';

function room(options:Partial<RunConfig>={}){
  const store=new Store(':memory:'),pair=store.createPair('turn-order');
  const agents={cli1:new FakeParticipant('one'),cli2:new FakeParticipant('two')};
  for(const seat of SEATS)store.mutateSlot(pair.id,seat,s=>{s.state='ready';s.sessionId=agents[seat].sessionId;});
  const engine=new ConversationController(store,new FakeClock());
  const run=engine.start(pair.id,conversationConfig('Opening topic',{paceMs:0,completion:'duration',...options}),'start',agents);
  return {store,agents,engine,run,async close(){engine.stop(run.id);await flush();store.close();}};
}
// E7: the opening prompt reaches both agents at once. The agent who doesn't open is briefed (it replies READY, which
// isn't posted), then answers the opening.
test('Debate gives the topic to both agents at the start; agent 1 opens, agent 2 answers that opening, and they alternate',async()=>{
  const f=room();try{
    await flush();assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1]);
    const briefing=f.agents.cli2.calls[0]!.request.text;
    assert.match(briefing,/Opening topic/);assert.match(briefing,/cli1 gives the opening statement/);assert.match(briefing,/reply with exactly the word READY/);
    const topic=f.store.messages(f.run.id).find(m=>m.sender==='user')!;assert.deepEqual([...topic.deliveredTo!].sort(),[...SEATS],'both have the prompt from the start');
    f.agents.cli2.raw('READY');f.agents.cli1.answer('First position');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,2]);
    assert.match(f.agents.cli2.calls[1]!.request.text,/Opening topic/);assert.match(f.agents.cli2.calls[1]!.request.text,/First position/);
    assert.ok(!f.store.messages(f.run.id).some(m=>m.text==='READY'),'the briefing reply isn\'t posted to the room');
    f.agents.cli2.answer('Counterpoint');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,2]);assert.match(f.agents.cli1.calls[1]!.request.text,/Counterpoint/);
  }finally{await f.close();}
});
test('a debate briefing that fails only costs the head start: the agent still gets the topic with the opening',async()=>{
  const f=room();try{
    await flush();f.agents.cli2.calls[0]!.resolve({status:'cancelled',text:''});f.agents.cli2.calls[0]!.settled=true;
    f.agents.cli1.answer('First position');await flush();
    assert.equal(f.store.run(f.run.id).status,'running');assert.match(f.agents.cli2.calls[1]!.request.text,/Opening topic/);assert.match(f.agents.cli2.calls[1]!.request.text,/First position/);
  }finally{await f.close();}
});
test('a queued prompt waits for a turn boundary, reaches both agents once, and does not reset the speaker',async()=>{
  const f=room({opening:'cli2'});try{
    await flush();f.engine.broadcast(f.run.id,'New direction','broadcast');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1],'agent 2 opens while agent 1 is briefed');assert.equal(f.store.queued(f.run.id).length,1);
    f.agents.cli1.raw('READY');f.agents.cli2.answer('Opening answer');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,1]);assert.match(f.agents.cli1.calls[1]!.request.text,/New direction/);
    f.agents.cli1.answer('Answer to the new direction');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,2]);
    assert.match(f.agents.cli2.calls[1]!.request.text,/New direction/);assert.match(f.agents.cli2.calls[1]!.request.text,/Answer to the new direction/);
    const shared=f.store.messages(f.run.id).find(m=>m.text==='New direction')!;assert.deepEqual([...shared.deliveredTo!].sort(),[...SEATS]);
    f.engine.broadcast(f.run.id,'New direction','broadcast');await flush();assert.equal(f.store.messages(f.run.id).filter(m=>m.text==='New direction').length,1);
    f.agents.cli2.answer('Second response');await flush();assert.doesNotMatch(f.agents.cli1.calls[2]!.request.text,/New direction/);
  }finally{await f.close();}
});
test('Both at once is an opening option; later messages still get sequential replies',async()=>{
  const f=room({opening:'both'});try{
    await flush();assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1]);
    f.engine.broadcast(f.run.id,'Follow-up','follow-up');f.agents.cli2.answer('B opening');await flush();
    assert.equal(f.agents.cli1.calls.length,1);
    f.agents.cli1.answer('A opening');await flush();assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,1]);
    assert.match(f.agents.cli1.calls[1]!.request.text,/Follow-up/);
    f.agents.cli1.answer('A follow-up');await flush();assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,2]);
    assert.match(f.agents.cli2.calls[1]!.request.text,/A follow-up/);
  }finally{await f.close();}
});
test('sending while paused obtains one sequential response from each agent, then pauses',async()=>{
  const f=room();try{
    await flush();f.engine.pause(f.run.id);f.agents.cli2.raw('READY');f.agents.cli1.answer('First position');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
    f.engine.broadcast(f.run.id,'Consider cost','paused-prompt');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,2]);f.agents.cli2.answer('Cost response');await flush();
    assert.equal(f.store.run(f.run.id).status,'running');assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,2]);
    f.agents.cli1.answer('Cost rebuttal');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
    f.engine.step(f.run.id);await flush();f.agents.cli2.answer('One step');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
  }finally{await f.close();}
});
// G1: a debate runs for its rounds. Agents asking to stop don't end it; each turn says which round it is, the last asks
// for a closing statement, and the debate ends once each agent has spoken that many times.
test('a debate runs for its rounds: asking to stop does not end it, and the last round is a closing statement',async()=>{
  const f=room({completion:'rounds',rounds:2});try{
    assert.equal(f.store.run(f.run.id).config.maxRequests,5,'two turns a round plus the briefing');
    await flush();assert.match(f.agents.cli1.calls[0]!.request.text,/Round 1 of 2\. .*ends by itself after round 2/);
    assert.doesNotMatch(f.agents.cli1.calls[0]!.request.text,/Ask to finish|Remaining active time/);
    f.agents.cli2.raw('READY');f.agents.cli1.answer('Opening',true);await flush();
    assert.equal(f.store.run(f.run.id).status,'running','asking to stop doesn\'t end a debate with rounds');
    assert.match(f.agents.cli2.calls[1]!.request.text,/Round 1 of 2\./);
    f.agents.cli2.answer('Reply',true);await flush();
    assert.match(f.agents.cli1.calls[1]!.request.text,/Round 2 of 2: this is your last turn\. Give your closing statement/);
    f.agents.cli1.answer('Closing 1');await flush();
    assert.match(f.agents.cli2.calls[2]!.request.text,/Round 2 of 2: this is your last turn/);
    f.agents.cli2.answer('Closing 2');await flush();
    const run=f.store.run(f.run.id);
    assert.deepEqual([run.status,run.reason,run.requests],['completed','rounds_done',5]);
  }finally{await f.close();}
});
test('a stop condition the operator wrote still ends a debate with rounds',async()=>{
  const f=room({completion:'rounds',rounds:4,stopWhen:{cli1:'',cli2:'You are persuaded.'}});try{
    await flush();f.agents.cli2.raw('READY');f.agents.cli1.answer('Opening');await flush();
    assert.match(f.agents.cli2.calls[1]!.request.text,/Your stop condition: You are persuaded\./);
    f.agents.cli2.answer('Persuaded',true);await flush();
    assert.deepEqual([f.store.run(f.run.id).status,f.store.run(f.run.id).reason],['completed','agents_done']);
  }finally{await f.close();}
});
test('debates default to 7 rounds; a time in the topic, or Prompt and Build, keep their own endings',()=>{
  const debate=conversationConfig('Should cities ban cars downtown?');
  assert.deepEqual([debate.completion,debate.rounds,debate.maxRequests,debate.durationMs],['rounds',7,15,3_600_000]);
  assert.equal(conversationConfig('Motion',{stances:{cli1:'for',cli2:'against'}}).maxRequests,14,'a formal debate is briefed through the 1:1 lines, not with a request of the run');
  assert.throws(()=>conversationConfig('Motion',{stances:{cli1:'for',cli2:'for'}}),/opposite sides/);
  assert.equal(conversationConfig('Topic',{rounds:3}).maxRequests,7);
  assert.equal(conversationConfig('Topic',{rounds:3,maxRequests:40}).maxRequests,40,'a request limit you set is kept');
  const timed=conversationConfig('Debate pizza for 5 minutes');assert.deepEqual([timed.completion,timed.rounds],['duration',undefined]);
  const chosen=conversationConfig('Debate pizza for 5 minutes',{completion:'rounds',rounds:6});
  assert.deepEqual([chosen.completion,chosen.rounds,chosen.durationMs],['rounds',6,3_600_000],'rounds chosen over the topic\'s time win');
  assert.equal(conversationConfig('Topic',{completion:'either'}).rounds,undefined);
  for(const mode of ['benchmark','build'] as const){const c=conversationConfig('One answer',{mode,completion:'rounds'});assert.deepEqual([c.completion,c.rounds],['either',undefined]);}
  for(const rounds of [0,1.5,101])assert.throws(()=>conversationConfig('Topic',{rounds}),/Rounds must be a whole number/);
});
test('Prompt and Build retain simultaneous openings regardless of the Debate default',()=>{
  for(const mode of ['benchmark','build'] as const)assert.equal(conversationConfig('One answer',{mode,opening:'cli2'}).opening,'both');
});
test('a paired admission cannot partially spend the last remaining request',async()=>{
  const f=room({opening:'both',maxRequests:3});try{
    await flush();assert.throws(()=>f.store.admit(f.run.id,SEATS),/Request limit/);
    assert.equal(f.store.run(f.run.id).requests,2);assert.equal(f.store.turns(f.run.id).length,2);
  }finally{await f.close();}
});
test('the room exposes speaking and queued turns, and presets retain the selected opener',async()=>{
  const factory=new TestFactory(),service=new AvAService(tempDir('ava-turn-view-'),factory,'simulation');
  try{
    const pair=await service.call('pair.create',{thread:'turn-view'}) as Pair;
    for(const seat of SEATS){await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:'codex',model:'model',auth:'provider-login'}});await service.call('slot.activate',{pairId:pair.id,seat});}
    const run=await service.call('run.start',{pairId:pair.id,text:'Turn view',requestId:'start',options:{paceMs:0}}) as Run;await flush();
    assert.deepEqual(service.pairView(pair.id).activeRun?.speaking,['cli1'],'agent 2 reading the topic isn\'t speaking');
    await service.call('run.broadcast',{runId:run.id,text:'Queued direction',requestId:'queue'});
    assert.equal(service.pairView(pair.id).activeRun?.queued,1);
    factory.agents[1]!.raw('READY');factory.agents[0]!.answer('Opening');await flush();assert.deepEqual(service.pairView(pair.id).activeRun?.speaking,['cli2']);
    await service.call('preset.save',{requestId:'preset',name:'Agent 2 opens',data:{opening:'cli2',instructions:{cli1:'',cli2:''},stopWhen:{cli1:'',cli2:''},completion:'auto',minutes:'',requests:'',pace:'5'}});
    assert.equal((service.store.listPresets()[0]!.data as {opening:string}).opening,'cli2');
  }finally{await service.shutdown();service.store.close();}
});
