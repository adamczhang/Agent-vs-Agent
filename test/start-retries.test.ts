import test from 'node:test';
import assert from 'node:assert/strict';
import {AvAService} from '../src/service.js';
import {AvAError,type Pair,type Run} from '../src/types.js';
import {CommandClient} from '../ui/commands.js';
import {TestFactory,flush} from './fakes.js';
import {tempDir} from './temp.js';

async function fixture(){
  const factory=new TestFactory(),service=new AvAService(tempDir('ava-start-retry-'),factory,'simulation');
  const pair=await service.call('pair.create',{thread:'start-retry'}) as Pair;
  for(const seat of ['cli1','cli2']){
    await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:'codex',model:'model',auth:'provider-login'}});
    await service.call('slot.activate',{pairId:pair.id,seat});
  }
  const input={pairId:pair.id,text:'Build a page',options:{mode:'build'},build:{kind:'build'}};
  return {factory,service,pair,input,close:async()=>{await service.shutdown();service.store.close();}};
}

test('a reloaded client joins its unacknowledged Build start and retains the receipt until success',async()=>{
  const f=await fixture(),values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  let original:Promise<unknown>|undefined;
  try{
    const first=new CommandClient(storage,'room');
    await assert.rejects(first.execute('build','run.start',f.input,async(method,input)=>{
      original=f.service.call(method,input);
      throw new TypeError('Lost acknowledgement');
    }),/Lost acknowledgement/);
    assert.equal(values.size,1);
    const pending=JSON.parse(values.get('room')!) as {requestId:string};
    const reloaded=new CommandClient(storage,'room');
    const retry=reloaded.execute('build','run.start',f.input,async(method,input)=>{
      assert.equal((input as {requestId:string}).requestId,pending.requestId);
      try{return await f.service.call(method,input);}
      catch(error){throw Object.assign(new Error(String(error)),{definitive:true});}
    });
    await flush();assert.equal(values.size,1,'the in-flight retry is not a definitive refusal');
    const [run,replayed]=await Promise.all([original!,retry]) as Run[];
    assert.equal(run!.id,replayed!.id);assert.equal(values.size,0);
    await flush();
    assert.equal(f.service.store.db.prepare('SELECT COUNT(*) n FROM runs').get()!.n,1);
    assert.equal(f.service.store.events(run!.id).filter(e=>e.type==='build_copied').length,1);
    assert.deepEqual(f.factory.agents.map(a=>a.calls.length),[2,2],'one activation and one prompt per agent');
  }finally{await original?.catch(()=>{});await f.close();}
});

test('pending starts reject conflicting IDs or inputs without changing the original work',async()=>{
  const f=await fixture();let original:Promise<unknown>|undefined;
  const code=(expected:string)=>(error:unknown)=>error instanceof AvAError&&error.code===expected;
  try{
    const input={...f.input,requestId:'same-request'};original=f.service.call('run.start',input);
    await assert.rejects(f.service.call('run.start',{...input,text:'Different prompt'}),code('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(f.service.call('run.start',{...input,attachments:['different-file']}),code('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(f.service.call('run.start',{...input,pairId:'different-pair'}),code('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(f.service.call('run.start',{...input,requestId:'different-request'}),code('BUILD_PREPARING'));
    await assert.rejects(f.service.call('slot.cancel',{pairId:f.pair.id,seat:'cli1'}),code('BUILD_PREPARING'));
    const replay=f.service.call('run.start',input);
    const [run,replayed]=await Promise.all([original,replay]) as Run[];
    assert.equal(run!.id,replayed!.id);
    assert.equal((await f.service.call('run.start',input) as Run).id,run!.id,'completed starts still use the persisted receipt');
  }finally{await original?.catch(()=>{});await f.close();}
});

test('coalesced failures settle every caller and release preparation state for a safe retry',async()=>{
  const f=await fixture();
  try{
    let attempts=0;f.factory.agents[0]!.setBuildAccess=async()=>{if(++attempts===1)throw new Error('Build setup refused');};
    const input={...f.input,requestId:'failed-start'};
    const results=await Promise.allSettled([f.service.call('run.start',input),f.service.call('run.start',input)]);
    assert.ok(results.every(r=>r.status==='rejected'&&r.reason.message==='Build setup refused'));
    assert.equal(attempts,1);assert.equal(f.service.store.db.prepare('SELECT COUNT(*) n FROM runs').get()!.n,0);
    const retried=await f.service.call('run.start',input) as Run;
    assert.equal(retried.status,'running');assert.equal(attempts,2);
    assert.equal(f.service.store.db.prepare('SELECT COUNT(*) n FROM runs').get()!.n,1);
  }finally{await f.close();}
});
