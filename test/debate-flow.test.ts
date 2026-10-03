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
test('Debate defaults to agent 1, passes its complete answer to agent 2, and alternates',async()=>{
  const f=room();try{
    await flush();assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,0]);
    f.agents.cli1.answer('First position');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1]);
    assert.match(f.agents.cli2.calls[0]!.request.text,/Opening topic/);assert.match(f.agents.cli2.calls[0]!.request.text,/First position/);
    f.agents.cli2.answer('Counterpoint');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,1]);assert.match(f.agents.cli1.calls[1]!.request.text,/Counterpoint/);
  }finally{await f.close();}
});
test('a queued prompt waits for a turn boundary, reaches both agents once, and does not reset the speaker',async()=>{
  const f=room({opening:'cli2'});try{
    await flush();f.engine.broadcast(f.run.id,'New direction','broadcast');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[0,1]);assert.equal(f.store.queued(f.run.id).length,1);
    f.agents.cli2.answer('Opening answer');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1]);assert.match(f.agents.cli1.calls[0]!.request.text,/New direction/);
    f.agents.cli1.answer('Answer to the new direction');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,2]);
    assert.match(f.agents.cli2.calls[1]!.request.text,/New direction/);assert.match(f.agents.cli2.calls[1]!.request.text,/Answer to the new direction/);
    const shared=f.store.messages(f.run.id).find(m=>m.text==='New direction')!;assert.deepEqual([...shared.deliveredTo!].sort(),[...SEATS]);
    f.engine.broadcast(f.run.id,'New direction','broadcast');await flush();assert.equal(f.store.messages(f.run.id).filter(m=>m.text==='New direction').length,1);
    f.agents.cli2.answer('Second response');await flush();assert.doesNotMatch(f.agents.cli1.calls[1]!.request.text,/New direction/);
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
    await flush();f.engine.pause(f.run.id);f.agents.cli1.answer('First position');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
    f.engine.broadcast(f.run.id,'Consider cost','paused-prompt');await flush();
    assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[1,1]);f.agents.cli2.answer('Cost response');await flush();
    assert.equal(f.store.run(f.run.id).status,'running');assert.deepEqual(SEATS.map(s=>f.agents[s].calls.length),[2,1]);
    f.agents.cli1.answer('Cost rebuttal');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
    f.engine.step(f.run.id);await flush();f.agents.cli2.answer('One step');await flush();assert.equal(f.store.run(f.run.id).status,'paused');
  }finally{await f.close();}
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
    assert.deepEqual(service.pairView(pair.id).activeRun?.speaking,['cli1']);
    await service.call('run.broadcast',{runId:run.id,text:'Queued direction',requestId:'queue'});
    assert.equal(service.pairView(pair.id).activeRun?.queued,1);
    factory.agents[0]!.answer('Opening');await flush();assert.deepEqual(service.pairView(pair.id).activeRun?.speaking,['cli2']);
    await service.call('preset.save',{requestId:'preset',name:'Agent 2 opens',data:{opening:'cli2',instructions:{cli1:'',cli2:''},stopWhen:{cli1:'',cli2:''},completion:'auto',minutes:'',requests:'',pace:'5'}});
    assert.equal((service.store.listPresets()[0]!.data as {opening:string}).opening,'cli2');
  }finally{await service.shutdown();service.store.close();}
});
