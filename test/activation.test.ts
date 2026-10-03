import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivationManager, type ConfiguredParticipant, type ParticipantFactory } from '../src/activation.js';
import { Store } from '../src/store.js';
import { type ProviderConfig } from '../src/types.js';
import { FakeClock, FakeParticipant, flush } from './fakes.js';

const config:ProviderConfig={provider:'codex',model:'test-model',auth:'provider-login'};
function connection(id:string){const p=new FakeParticipant(id) as FakeParticipant&ConfiguredParticipant;p.accepted=config;p.evidence='fake';return p;}
test('activation verifies the actual model reply; browsing state sends nothing',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('activate'),clock=new FakeClock(),agent=connection('session-1');
  const manager=new ActivationManager(store,{open:async()=>agent},clock,1000);
  store.pair(pair.id);assert.equal(agent.calls.length,0);
  const pending=manager.activate(pair.id,'cli1',config);await flush();
  assert.equal(store.pair(pair.id).slots.cli1.state,'verifying');
  const marker=agent.calls[0]!.request.text.match(/AVA_READY_[\w-]+/)![0];agent.raw(marker);
  const receipt=await pending;assert.equal(receipt.slot.sessionId,'session-1');assert.equal(receipt.slot.state,'ready');
  assert.equal(store.pair(pair.id).slots.cli2.state,'empty');await manager.closeAll();store.close();
});
test('a newer generation fences a late successful activation',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('generations'),clock=new FakeClock();
  let release!:(p:ConfiguredParticipant)=>void;
  const late=connection('late'),current=connection('current');let calls=0;
  const factory:ParticipantFactory={open:async()=>++calls===1?new Promise(resolve=>release=resolve):current};
  const manager=new ActivationManager(store,factory,clock,1000);
  const first=manager.activate(pair.id,'cli1',config).catch(e=>e);await flush();
  const second=manager.activate(pair.id,'cli1',config);await flush();
  current.raw(current.calls[0]!.request.text.match(/AVA_READY_[\w-]+/)![0]);await second;
  release(late);await first;await flush();
  assert.equal(store.pair(pair.id).slots.cli1.sessionId,'current');assert.equal(late.closed,true);assert.equal(late.calls.length,0);
  await manager.closeAll();store.close();
});
test('whole activation deadline covers a hung session creation and disposes a late connection',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('timeout'),clock=new FakeClock(),late=connection('late');
  let release!:(p:ConfiguredParticipant)=>void;
  const manager=new ActivationManager(store,{open:()=>new Promise(resolve=>release=resolve)},clock,50);
  const pending=manager.activate(pair.id,'cli1',config).catch(e=>e);await flush();await clock.advance(50);
  assert.equal((await pending).code,'ACTIVATION_TIMEOUT');assert.equal(store.pair(pair.id).slots.cli1.state,'failed');
  release(late);await flush();assert.equal(late.closed,true);assert.equal(late.calls.length,0);store.close();
});
test('failed readiness or unsupported provider settings cannot produce a Ready slot',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('bad-ready'),agent=connection('bad');
  const manager=new ActivationManager(store,{open:async()=>agent});
  const pending=manager.activate(pair.id,'cli1',config);await flush();agent.raw('Sign in required');
  await assert.rejects(pending,/readiness marker/);await flush();assert.equal(store.pair(pair.id).slots.cli1.state,'failed');assert.equal(agent.closed,true);
  const rejecting=new ActivationManager(store,{open:async()=>{throw new Error('Unsupported effort');}});
  await assert.rejects(rejecting.activate(pair.id,'cli2',config),/Unsupported effort/);assert.equal(store.pair(pair.id).slots.cli2.state,'failed');store.close();
});
test('cleanup failure is reported and keeps the owned participant available for recovery',async()=>{
  const store=new Store(':memory:'),pair=store.createPair('cleanup'),agent=connection('cleanup');
  const manager=new ActivationManager(store,{open:async()=>agent});
  const pending=manager.activate(pair.id,'cli1',config);await flush();agent.raw(agent.calls[0]!.request.text.match(/AVA_READY_[\w-]+/)![0]);await pending;
  agent.close=async()=>{throw new Error('still running');};
  await assert.rejects(manager.closeAll(),/did not confirm cleanup/);assert.equal(manager.get(pair.id,'cli1'),agent);store.close();
});
