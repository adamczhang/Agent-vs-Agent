import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { AvAService } from '../src/service.js';
import { listen } from '../src/http.js';
import type { Pair } from '../src/types.js';
import type { Menu } from '../src/menus.js';
import { TestFactory,flush } from './fakes.js';
import { tempDir } from './temp.js';

function fixture(){const factory=new TestFactory(),service=new AvAService(tempDir('ava-service-'),factory,'simulation');return {service,factory};}
async function activate(service:AvAService,pair:Pair){for(const seat of ['cli1','cli2']){await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:'codex',model:'model',auth:'provider-login'}});await service.call('slot.activate',{pairId:pair.id,seat});}}
test('the room opens before its agents are active (they activate from it), and reopens busy without probes',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'room'}) as Pair;
  const prepared=await service.call('room.prepare',{pairId:pair.id}) as {ticket:string};
  const room=await service.call('room.open',{ticket:prepared.ticket}) as {roomId:string};
  const before0=await service.call('room.get',{roomId:room.roomId}) as {pair:Pair};
  assert.deepEqual([before0.pair.slots.cli1.state,before0.pair.slots.cli2.state],['empty','empty'],'no agents yet; the room shows Activate');
  assert.equal(factory.agents.length,0,'opening the room starts nothing');
  await activate(service,pair);
  const before=factory.agents.map(a=>a.calls.length);
  const run=await service.call('run.start',{pairId:pair.id,text:'topic',requestId:'start',options:{paceMs:0}}) as {id:string};await flush();
  const reopened=await service.call('room.prepare',{pairId:pair.id}) as {roomId:string};assert.equal(reopened.roomId,room.roomId);
  assert.deepEqual(factory.agents.map(a=>a.calls.length),before.map(n=>n+1));
  await service.call('run.control',{runId:run.id,action:'stop'});await flush();await service.shutdown();service.store.close();
});
test('stale pair launch ticket and stale menu choices are rejected',async()=>{
  const {service}=fixture(),pair=await service.call('pair.create',{thread:'stale'}) as Pair;await activate(service,pair);
  const prepared=await service.call('room.prepare',{pairId:pair.id}) as {ticket:string};
  const menu=await service.call('menu.show',{pairId:pair.id,seat:'cli1'}) as Menu;
  await service.call('slot.configure',{pairId:pair.id,seat:'cli1',config:{provider:'claude',model:'model',auth:'provider-login'}});
  await assert.rejects(service.call('room.open',{ticket:prepared.ticket}),/not connected|changed/);
  await assert.rejects(service.call('menu.choose',{pairId:pair.id,seat:'cli1',menuId:menu.id,choice:'1'}),/out of date/);
  assert.equal(service.store.pair(pair.id).slots.cli2.state,'ready');await service.shutdown();service.store.close();
});
test('opening and cancelling menus preserves ready sessions and sends no prompts',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'menu'}) as Pair;await activate(service,pair);
  const menu=await service.call('menu.show',{pairId:pair.id,seat:'cli1'}) as Menu;
  await service.call('menu.choose',{pairId:pair.id,seat:'cli1',menuId:menu.id,choice:'x'});
  assert.equal(service.store.pair(pair.id).slots.cli1.state,'ready');assert.ok(factory.agents.every(a=>a.calls.length===1));
  await service.shutdown();service.store.close();
});
test('HTTP rejects unauthenticated, foreign-origin, invalid-token, and invalid-host requests',async(t)=>{
  const {service}=fixture();const http=await listen(service,join(process.cwd(),'dist','web'));
  t.after(async()=>{await http.close();service.store.close();});
  const url=`http://127.0.0.1:${http.port}/api`,body=JSON.stringify({method:'health',params:{}});
  const page=await fetch(`http://127.0.0.1:${http.port}/`);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);assert.match(await page.text(),/Agent vs Agent/);
  assert.equal((await fetch(url,{method:'POST',body})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+'z'.repeat(64)},body})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+http.token,Origin:'https://evil.example'},body})).status,403);
  const badHost=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(url,{method:'POST',headers:{Authorization:'Bearer '+http.token,Host:'evil.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});
  assert.equal(badHost,403);
  const good=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+http.token},body});assert.equal(good.status,200);
  assert.equal((await good.json() as {result:{mode:string}}).result.mode,'simulation');
  const unicodeBody=Buffer.from(JSON.stringify({method:'pair.create',params:{thread:'emoji-🟣'}})),split=unicodeBody.indexOf(Buffer.from('🟣'))+1;
  const unicode=await new Promise<string>((resolve,reject)=>{const req=httpRequest(url,{method:'POST',headers:{Authorization:'Bearer '+http.token,'Transfer-Encoding':'chunked'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(text));});req.on('error',reject);req.write(unicodeBody.subarray(0,split));setTimeout(()=>req.end(unicodeBody.subarray(split)),10);});
  assert.equal(JSON.parse(unicode).result.thread,'emoji-🟣');
});
test('a new service owner invalidates stale activation receipts without losing saved configuration',async()=>{
  const {service}=fixture(),pair=await service.call('pair.create',{thread:'stale-process'}) as Pair;await activate(service,pair);
  const config=service.store.pair(pair.id).slots.cli1.config,root=service.dataRoot;
  await service.shutdown();service.store.close();
  const next=new AvAService(root,new TestFactory(),'simulation');
  assert.equal(next.store.pair(pair.id).slots.cli1.state,'configuring');assert.equal(next.store.pair(pair.id).slots.cli1.sessionId,null);assert.deepEqual(next.store.pair(pair.id).slots.cli1.config,config);
  const reopened=await next.call('room.prepare',{pairId:pair.id}) as {pair:Pair};assert.equal(reopened.pair.slots.cli1.state,'configuring','the room opens and offers to activate again');
  await next.shutdown();next.store.close();
});
test('a run keeps the participant identities recorded at its start after the slots change',async()=>{
  const {service}=fixture(),pair=await service.call('pair.create',{thread:'identity'}) as Pair;await activate(service,pair);
  const run=await service.call('run.start',{pairId:pair.id,text:'topic',requestId:'start',options:{paceMs:0}}) as {id:string};await flush();
  await service.call('run.control',{runId:run.id,action:'stop'});await flush();
  await service.call('slot.configure',{pairId:pair.id,seat:'cli1',config:{provider:'claude',model:'other',auth:'provider-login'}});
  const view=await service.call('run.get',{runId:run.id}) as {run:{participants:Record<string,{provider:string;model:string}>;createdAt:string}};
  assert.deepEqual([view.run.participants.cli1!.provider,view.run.participants.cli1!.model],['codex','model']);assert.ok(Date.parse(view.run.createdAt)>0);
  const exported=await service.call('run.export',{runId:run.id}) as {markdown:string;json:{format:string;version:number;run:Record<string,unknown>&{participants:Record<string,{provider:string}>};messages:Array<{sender:string;label:string;time:string|null;text:string}>}};
  assert.match(exported.markdown,/^## user\n\ntopic/);
  assert.deepEqual([exported.json.format,exported.json.version,exported.json.run.participants.cli1!.provider],['ava-transcript',1,'codex']);
  assert.deepEqual(exported.json.messages.map(m=>[m.sender,m.label,m.text]),[['user','user','topic']]);
  assert.ok(!('sessions' in exported.json.run)&&!JSON.stringify(exported.json).includes('native-'),'session identities stay internal');
  await service.shutdown();service.store.close();
});
test('run history lists a pair\'s runs newest first, pages, and sends no provider work',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'history'}) as Pair;await activate(service,pair);
  const ids:string[]=[];
  for(const n of [1,2,3]){
    if(n>1)await service.call('pair.reset',{pairId:pair.id,requestId:'reset'+n});
    const run=await service.call('run.start',{pairId:pair.id,text:'topic '+n,requestId:'start'+n,options:{paceMs:0}}) as {id:string};ids.push(run.id);await flush();
    factory.agents.at(-2)!.answer('A'+n);factory.agents.at(-1)!.answer('B'+n);await flush();
    await service.call('run.control',{runId:run.id,action:'stop'});await flush();
  }
  const other=await service.call('pair.create',{thread:'someone-else'}) as Pair;
  const calls=factory.agents.map(a=>a.calls.length);
  const first=await service.call('runs.list',{pairId:pair.id,limit:2}) as {runs:Array<{id:string;topic:string;replies:number;participants:unknown;createdAt:string}>;next:number|null};
  assert.deepEqual(first.runs.map(r=>r.id),[ids[2],ids[1]]);assert.equal(first.runs[0]!.replies,2);assert.ok(first.runs[0]!.participants&&first.runs[0]!.createdAt);
  const second=await service.call('runs.list',{pairId:pair.id,limit:2,before:first.next}) as {runs:Array<{id:string}>;next:number|null};
  assert.deepEqual([second.runs.map(r=>r.id),second.next],[[ids[0]],null]);
  assert.deepEqual((await service.call('runs.list',{pairId:other.id}) as {runs:unknown[]}).runs,[]);
  for(const id of ids)await service.call('run.get',{runId:id});
  assert.deepEqual(factory.agents.map(a=>a.calls.length),calls,'browsing history sends nothing to the agents');
  await service.shutdown();service.store.close();
});
test('message search is case-insensitive, treats wildcards literally, stays within the pair, and sends nothing',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'search'}) as Pair;await activate(service,pair);
  const run=await service.call('run.start',{pairId:pair.id,text:'Talk about the Vikings',requestId:'start',options:{paceMs:0}}) as {id:string};await flush();
  factory.agents[0]!.answer('Offense wins 100% of the time');factory.agents[1]!.answer('Defense_first, honestly');await flush();
  await service.call('run.control',{runId:run.id,action:'stop'});await flush();
  const calls=factory.agents.map(a=>a.calls.length);
  const search=async(query:string,pairId:string=pair.id)=>(await service.call('runs.search',{pairId,query}) as {results:Array<{runId:string;sender:string;snippet:string}>}).results;
  assert.deepEqual((await search('vikings')).map(r=>[r.runId,r.sender]),[[run.id,'user']]);
  assert.deepEqual((await search('100%')).map(r=>r.sender),['cli1']);
  assert.deepEqual(await search('%'),(await search('100%')),'a bare % matches only literal percent signs');
  assert.deepEqual((await search('e_s')).map(r=>r.sender),[],'underscore is literal: as a wildcard it would match "ens" in Offense/Defense');
  assert.deepEqual((await search('defense_first')).map(r=>r.snippet),['Defense_first, honestly']);
  const other=await service.call('pair.create',{thread:'other-search'}) as Pair;assert.deepEqual(await search('vikings',other.id),[]);
  await assert.rejects(service.call('runs.search',{pairId:pair.id,query:'   '}));
  assert.deepEqual(factory.agents.map(a=>a.calls.length),calls,'searching sends nothing to the agents');
  await service.shutdown();service.store.close();
});
test('presets save, replace by name, list, delete idempotently, and refuse provider settings',async()=>{
  const {service,factory}=fixture();
  const data={instructions:{cli1:'Argue for offense',cli2:'Argue for defense'},stopWhen:{cli1:'',cli2:''},completion:'duration',minutes:'15',requests:'',pace:'5'};
  const saved=await service.call('preset.save',{requestId:'s1',name:'Vikings debate',data}) as {id:string;replaced:boolean};
  assert.equal(saved.replaced,false);
  assert.deepEqual(await service.call('preset.save',{requestId:'s1',name:'Vikings debate',data}),saved,'a retried save returns the original result');
  const replaced=await service.call('preset.save',{requestId:'s2',name:'Vikings debate',data:{...data,minutes:'5'}}) as {id:string;replaced:boolean};
  assert.deepEqual([replaced.id,replaced.replaced],[saved.id,true]);
  await service.call('preset.save',{requestId:'s3',name:'another',data});
  const list=(await service.call('preset.list',{}) as {presets:Array<{name:string;data:{minutes:string}}>}).presets;
  assert.deepEqual(list.map(p=>p.name),['another','Vikings debate']);assert.equal(list[1]!.data.minutes,'5');
  await assert.rejects(service.call('preset.save',{requestId:'s4',name:'sneaky',data:{...data,provider:'codex'}}));
  await assert.rejects(service.call('preset.save',{requestId:'s5',name:'sneaky',data:{...data,instructions:{...data.instructions,model:'x'}}}));
  assert.deepEqual(await service.call('preset.delete',{requestId:'d1',id:saved.id}),{deleted:true});
  assert.deepEqual(await service.call('preset.delete',{requestId:'d1',id:saved.id}),{deleted:true},'a retried delete returns the original result');
  assert.deepEqual((await service.call('preset.list',{}) as {presets:Array<{name:string}>}).presets.map(p=>p.name),['another']);
  assert.equal(factory.agents.length,0);await service.shutdown();service.store.close();
});
test('clear context stops the running conversation and gives both agents fresh sessions that the next run uses',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'clear'}) as Pair;await activate(service,pair);
  const first=await service.call('run.start',{pairId:pair.id,text:'first topic',requestId:'start1',options:{paceMs:0}}) as {id:string;sessions:Record<string,string>};await flush();
  const old=factory.agents.slice();
  const cleared=await service.call('pair.clear',{pairId:pair.id,requestId:'clear1'}) as Pair;
  assert.equal(service.store.run(first.id).status,'stopped');assert.equal(cleared.activeRunId,null);
  assert.equal(factory.agents.length,old.length+2,'two fresh sessions were opened');assert.ok(old.every(a=>a.closed),'the old sessions were closed');
  for(const seat of ['cli1','cli2'] as const){assert.equal(cleared.slots[seat].state,'ready');assert.notEqual(cleared.slots[seat].sessionId,first.sessions[seat]);}
  assert.deepEqual(await service.call('pair.clear',{pairId:pair.id,requestId:'clear1'}),cleared,'a retried clear is not repeated');
  assert.equal(factory.agents.length,old.length+2);
  const second=await service.call('run.start',{pairId:pair.id,text:'fresh test prompt',requestId:'start2',options:{paceMs:0}}) as {id:string};await flush();
  const fresh=factory.agents.slice(-2);
  assert.ok(fresh.every(a=>a.calls.at(-1)!.request.text.includes('fresh test prompt')),'the fresh sessions receive the new prompt');
  assert.ok(fresh.every(a=>!a.calls.some(c=>c.request.text.includes('first topic'))),'nothing from the first conversation reaches them');
  await service.call('run.control',{runId:second.id,action:'stop'});await flush();await service.shutdown();service.store.close();
});
test('clear context refuses a conversation that needs attention',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'clear-attention'}) as Pair;await activate(service,pair);
  await service.call('run.start',{pairId:pair.id,text:'topic',requestId:'start',options:{paceMs:0}});await flush();
  factory.agents[0]!.raw('not json');await flush();factory.agents[0]!.raw('still not json');await flush();
  await assert.rejects(service.call('pair.clear',{pairId:pair.id,requestId:'c'}),/needs attention/);
  await service.shutdown();service.store.close();
});
test('replayed step and reset commands do not submit additional model requests',async()=>{
  const {service,factory}=fixture(),pair=await service.call('pair.create',{thread:'duplicate-control'}) as Pair;await activate(service,pair);
  const run=await service.call('run.start',{pairId:pair.id,text:'topic',requestId:'start',options:{paceMs:0}}) as {id:string};await flush();
  await service.call('run.control',{runId:run.id,action:'pause',requestId:'pause'});
  factory.agents[0]!.answer('A');factory.agents[1]!.answer('B');await flush();
  await service.call('run.control',{runId:run.id,action:'step',requestId:'step'});await flush();
  factory.agents[0]!.answer('A stepped');await flush();
  const count=service.store.run(run.id).requests;
  assert.equal(count,3);assert.equal(service.store.run(run.id).status,'paused');
  await service.call('run.control',{runId:run.id,action:'step',requestId:'step'});await flush();assert.equal(service.store.run(run.id).requests,count);
  await assert.rejects(service.call('run.control',{runId:run.id,action:'resume',requestId:'step'}),/different input/);
  await service.call('run.control',{runId:run.id,action:'stop'});await flush();
  await Promise.all([service.call('pair.reset',{pairId:pair.id,requestId:'reset'}),service.call('pair.reset',{pairId:pair.id,requestId:'reset'})]);
  assert.equal(factory.agents.length,4);await service.call('pair.reset',{pairId:pair.id,requestId:'reset'});assert.equal(factory.agents.length,4);
  await service.shutdown();service.store.close();
});
