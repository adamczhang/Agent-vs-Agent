import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { survivors,type SystemProcess } from '../src/census.js';
import type { ResourceSnapshot } from '../src/resources.js';
import type { Pair,Run,Seat } from '../src/types.js';
import { TestFactory,flush } from './fakes.js';
import { tempDir } from './temp.js';

const config={provider:'codex',model:'model',auth:'provider-login'} as const;
async function pair(service:AvAService,name:string){return await service.call('pair.create',{thread:name}) as Pair;}
async function activate(service:AvAService,p:Pair,seat:Seat){await service.call('slot.configure',{pairId:p.id,seat,config});await service.call('slot.activate',{pairId:p.id,seat});}
test('the activation limit reserves pending seats atomically and persists across restarts',async()=>{
  const data=tempDir('ava-resource-limit-'),factory=new TestFactory(),service=new AvAService(data,factory,'simulation',{processes:async()=>[]});
  let release!:()=>void;const wait=new Promise<void>(r=>{release=r;}),original=factory.open.bind(factory);
  factory.open=async(...args)=>{await wait;return original(...args);};
  try{
    await service.call('resources.configure',{maxActiveAgents:2,requestId:'limit'});
    const a=await pair(service,'one'),b=await pair(service,'two'),c=await pair(service,'three');
    for(const p of [a,b,c])await service.call('slot.configure',{pairId:p.id,seat:'cli1',config});
    const first=service.call('slot.activate',{pairId:a.id,seat:'cli1'}),second=service.call('slot.activate',{pairId:b.id,seat:'cli1'});
    await assert.rejects(service.call('slot.activate',{pairId:c.id,seat:'cli1'}),/limit of 2/);
    assert.equal(factory.agents.length,0);release();await Promise.all([first,second]);
    assert.equal(factory.agents.length,2);assert.equal((await service.call('resources.get',{}) as ResourceSnapshot).activeAgents,2);
    await assert.rejects(service.call('resources.configure',{maxActiveAgents:1,requestId:'bad'}),/2–32/);
  }finally{release();await service.shutdown();service.store.close();}
  const reopened=new AvAService(data,new TestFactory(),'simulation',{processes:async()=>[]});
  try{assert.equal(reopened.resources.limit,2);}finally{await reopened.shutdown();reopened.store.close();}
});
test('memory accounts for owned descendants, excludes unrelated PIDs, and shares a cached sample',async()=>{
  let samples=0;const rows:SystemProcess[]=[];
  const service=new AvAService(tempDir('ava-resource-memory-'),new TestFactory(),'simulation',{processes:async()=>{samples++;return rows;}});
  try{
    const p=await pair(service,'memory');await activate(service,p,'cli1');await activate(service,p,'cli2');
    const now=Date.now();
    for(const [seat,pid,memoryBytes] of [['cli1',4000,100],['cli2',5000,200]] as const){service.store.spawned({pid,pairId:p.id,seat,generation:service.store.pair(p.id).slots[seat].generation});rows.push({pid,ppid:0,name:'owned',started:now,memoryBytes});}
    rows.push({pid:4001,ppid:4000,name:'child',started:now+1,memoryBytes:300},{pid:9000,ppid:0,name:'unrelated',started:now,memoryBytes:9000});
    const [first,second]=await Promise.all([service.call('resources.get',{}),service.call('resources.get',{})]) as ResourceSnapshot[];
    assert.equal(samples,1);assert.equal(first!.memoryBytes,600);assert.equal(first!.processCount,3);assert.equal(second!.agents[0]!.memoryBytes,400);
    await service.call('resources.get',{});assert.equal(samples,1);
  }finally{await service.shutdown();service.store.close();}
});
test('unavailable memory stays unknown instead of being reported as zero',async()=>{
  const service=new AvAService(tempDir('ava-resource-unknown-'),new TestFactory(),'simulation',{processes:async()=>{throw new Error('unavailable');}});
  try{const p=await pair(service,'unknown');await activate(service,p,'cli1');assert.equal((await service.call('resources.get',{}) as ResourceSnapshot).memoryBytes,null);}
  finally{await service.shutdown();service.store.close();}
});
test('Stop all closes owned agents and descendants, keeps history, and retries cannot stop new work',async()=>{
  const factory=new TestFactory();let rows:SystemProcess[]=[],killed:number[]=[];
  const service=new AvAService(tempDir('ava-stop-all-'),factory,'simulation',{processes:async()=>rows,census:async recorded=>survivors(recorded,rows),stopProcesses:async pids=>{killed=pids;rows=rows.filter(p=>!pids.includes(p.pid));}});
  try{
    const p=await pair(service,'stop-all');for(const seat of ['cli1','cli2'] as const)await activate(service,p,seat);
    const now=Date.now();service.store.spawned({pid:4000,pairId:p.id,seat:'cli1',generation:service.store.pair(p.id).slots.cli1.generation});
    rows=[{pid:4000,ppid:0,name:'owned',started:now},{pid:4001,ppid:4000,name:'child',started:now+1},{pid:9000,ppid:0,name:'foreign',started:now}];
    const run=await service.call('run.start',{pairId:p.id,text:'Keep this conversation',requestId:'start',options:{paceMs:0}}) as Run;await flush();
    const before=service.store.messages(run.id).length;
    const stopped=await service.call('resources.stop',{requestId:'stop'}) as {status:string};
    assert.equal(stopped.status,'stopped');assert.deepEqual(killed.sort(),[4000,4001]);assert.equal(rows[0]!.pid,9000);
    assert.equal(service.store.messages(run.id).length,before);assert.equal(service.store.run(run.id).status,'stopped');assert.ok(factory.agents.every(a=>a.closed));
    await activate(service,service.store.pair(p.id),'cli1');const fresh=factory.agents.at(-1)!;
    assert.deepEqual(await service.call('resources.stop',{requestId:'stop'}),stopped);assert.equal(fresh.closed,false,'a lost acknowledgement must not stop agents activated later');
  }finally{await service.shutdown();service.store.close();}
});
test('Stop all blocks activations while cleanup is pending and reports census failures',async()=>{
  const factory=new TestFactory(),service=new AvAService(tempDir('ava-stop-admission-'),factory,'simulation',{processes:async()=>{throw new Error('census down');}});
  let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
  try{
    const p=await pair(service,'stopping');await activate(service,p,'cli1');await service.call('slot.configure',{pairId:p.id,seat:'cli2',config});
    const original=factory.agents[0]!.close.bind(factory.agents[0]!);factory.agents[0]!.close=async()=>{await wait;await original();};
    const stop=service.call('resources.stop',{requestId:'stop'});await flush();
    await assert.rejects(service.call('slot.activate',{pairId:p.id,seat:'cli2'}),/stopping its agents/);
    release();const result=await stop as {status:string;errors:string[]};assert.equal(result.status,'needs_attention');assert.match(result.errors.join(' '),/Could not verify/);
  }finally{release();await service.shutdown();service.store.close();}
});
test('a provider that fails to close keeps its capacity reservation',async()=>{
  const factory=new TestFactory(),service=new AvAService(tempDir('ava-capacity-close-'),factory,'simulation',{processes:async()=>[]});
  let restore:(()=>void)|undefined;
  try{
    await service.call('resources.configure',{maxActiveAgents:2,requestId:'limit'});
    const p=await pair(service,'held'),other=await pair(service,'other');await activate(service,p,'cli1');await activate(service,p,'cli2');
    const agent=factory.agents[0]!,close=agent.close.bind(agent);restore=()=>{agent.close=close;};agent.close=async()=>{throw new Error('still closing');};
    await assert.rejects(service.call('slot.configure',{pairId:p.id,seat:'cli1',config}),/still closing/);
    await assert.rejects(activate(service,other,'cli1'),/limit of 2/);
  }finally{restore?.();await service.shutdown();service.store.close();}
});
