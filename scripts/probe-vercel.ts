// Live check of the Vercel AI Gateway agent (B20) through the real service in a temporary data folder.
// - With a key (AI_GATEWAY_API_KEY, or AvA's stored key in the shared data folder): for each model given, activate a seat
//   (one short access check) and ask one tool-free question in Prompt mode. Usage:
//   node --import tsx scripts/probe-vercel.ts --models openai/gpt-5.6-luna,anthropic/claude-haiku-4.5 [--out <json>]
// - With --wiring-only: a placeholder key; checks that the Codex agent starts on the Gateway with the chosen model, and
//   that the Gateway's refusal of the key surfaces as a clear activation failure. Sends nothing billable.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {AvAService} from '../src/service.js';
import {NativeFactory} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {gatewayKey} from '../src/gateway.js';
import type {Pair,Seat} from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const wiringOnly=args.includes('--wiring-only'),models=(option('--models')??'openai/gpt-5.6-luna').split(',').map(s=>s.trim()).filter(Boolean);
const shared=installedDataRoot(resolve('.'));
if(wiringOnly)process.env.AI_GATEWAY_API_KEY='vck_placeholder_not_a_real_key_000000000000';
else{process.env.AVA_GATEWAY_KEY_DIR??=shared;if(!gatewayKey(shared))throw new Error('No AI Gateway key: set AI_GATEWAY_API_KEY, or store one with npm run gateway-key -- set.');}
const root=mkdtempSync(join(tmpdir(),'ava-vercel-'));
const service=new AvAService(root,new NativeFactory(root),'live');
const call=<T=any>(method:string,params:unknown)=>service.call(method,params) as Promise<T>;
const results:Array<Record<string,unknown>>=[],started=Date.now();
const scrub=(s:string)=>s.replace(/vck_[A-Za-z0-9_-]+/g,'vck_…');
try{
  for(const [i,model] of models.entries()){
    const pair=await call<Pair>('pair.create',{thread:`vercel-${i}`}),seat:Seat='cli1',t0=Date.now();
    const entry:Record<string,unknown>={model};results.push(entry);
    await call('slot.configure',{pairId:pair.id,seat,config:{provider:'vercel',model,effort:{key:'model_reasoning_effort',value:'low'},auth:'api'}});
    try{await call('slot.activate',{pairId:pair.id,seat});entry.activated=true;}
    catch(error){entry.activated=false;entry.error=scrub(error instanceof Error?error.message:String(error));}
    entry.activationMs=Date.now()-t0;
    const slot=service.store.pair(pair.id).slots[seat];entry.state=slot.state;entry.acceptedModel=slot.config?.model;
    console.log(`${entry.activated?'PASS':wiringOnly?'NOTE':'FAIL'} activate ${model}: ${entry.activated?'verified':entry.error}`);
    if(entry.activated&&!wiringOnly){
      // A second agent (same model) so a Prompt run has its two seats.
      await call('slot.configure',{pairId:pair.id,seat:'cli2',config:{provider:'vercel',model,auth:'api'}});await call('slot.activate',{pairId:pair.id,seat:'cli2'});
      const run=await call<{id:string}>('run.start',{pairId:pair.id,requestId:`q${i}`,options:{mode:'benchmark',durationMs:300_000},text:'In one sentence: what is the capital of Australia, and which model are you?'});
      for(const end=Date.now()+300_000;Date.now()<end;await new Promise(r=>setTimeout(r,1000))){if(['completed','stopped','needs_attention'].includes(service.store.run(run.id).status))break;}
      const r=service.store.run(run.id),answers=service.store.messages(run.id).filter(m=>m.sender!=='user').map(m=>m.text.slice(0,200));
      entry.run={status:r.status,reason:r.reason,answers,canberra:answers.some(a=>/canberra/i.test(a))};
      console.log(`${r.status==='completed'&&answers.length===2&&answers.every(a=>/canberra/i.test(a))?'PASS':'FAIL'} answer ${model}: ${answers[0]?.slice(0,100)}`);
    }
  }
}finally{await service.shutdown().catch(()=>{});service.store.close();}
const out=option('--out');
const record={recordedAt:new Date().toISOString(),wiringOnly,minutes:Math.round((Date.now()-started)/600)/100,results};
if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(record,null,2));}
console.log(JSON.stringify(record.results.map(r=>({model:r.model,activated:r.activated,state:r.state}))));
