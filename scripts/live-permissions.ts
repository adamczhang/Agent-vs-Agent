// Live check of per-agent permissions (B17): both seats the same CLI, through the real service in a temporary data
// folder; provider-login only. Agent 1 is set to bypass, Agent 2 stays on ask. A Prompt-mode run asks both to create
// a file in their working folder: only the bypass agent may (Codex through its full-access mode, the others through
// AvA's gate). Usage: node --import tsx scripts/live-permissions.ts --provider <cli> [--out <json>]. 4 live requests.
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {AvAService} from '../src/service.js';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {participantWorkspace} from '../src/workspace.js';
import type {Pair,Provider,ProviderConfig,Seat} from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const provider=option('--provider') as Provider;if(!provider)throw new Error('Pass --provider.');
const CONFIGS:Record<Provider,ProviderConfig>={
  codex:{provider:'codex',model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},
  claude:{provider:'claude',model:'default',effort:{key:'effort',value:'low'},auth:'provider-login'},
  'grok-build':{provider:'grok-build',model:'grok-4.7',auth:'provider-login'},
  antigravity:{provider:'antigravity',model:'gemini-3.7-flash-high',auth:'provider-login'},
  vercel:{provider:'vercel',model:'openai/gpt-5.6-luna',effort:{key:'model_reasoning_effort',value:'low'},auth:'api'},
};
const root=mkdtempSync(join(tmpdir(),`ava-perm-${provider}-`)),shared=installedDataRoot(resolve('.'));
if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(root,'providers.json'));
// A Vercel AI Gateway agent uses the key stored in the shared folder (read from there; it never enters this process's
// environment, which every agent inherits).
process.env.AVA_GATEWAY_KEY_DIR??=shared;
// A Gateway model to use instead of the default.
if(option('--model')&&provider==='vercel')CONFIGS.vercel={...CONFIGS.vercel,model:option('--model')!};
const service=new AvAService(root,new NativeFactory(root,loadProviderSetups(root)),'live');
const call=<T=any>(method:string,params:unknown)=>service.call(method,params) as Promise<T>;
const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[],started=Date.now();
const check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${provider}] ${name}${pass?'':` ${JSON.stringify(detail).slice(0,300)}`}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const result:Record<string,unknown>={provider,config:CONFIGS[provider],recordedAt:new Date().toISOString(),route:CONFIGS[provider].auth};
try{
  let pair=await call<Pair>('pair.create',{thread:`perm-${provider}`});
  for(const seat of ['cli1','cli2'] as const){await call('slot.configure',{pairId:pair.id,seat,config:CONFIGS[provider]});await call('slot.activate',{pairId:pair.id,seat});}
  await call('slot.permissions',{pairId:pair.id,seat:'cli1',level:'bypass'});
  pair=await call('pair.get',{pairId:pair.id});
  check('both agents active; Agent 1 on bypass, Agent 2 on ask',pair.slots.cli1.state==='ready'&&pair.slots.cli2.state==='ready'&&pair.slots.cli1.permissions==='bypass'&&pair.slots.cli2.permissions!=='bypass');
  const run=await call<{id:string}>('run.start',{pairId:pair.id,requestId:'perm',options:{mode:'benchmark',durationMs:600_000},
    text:'Create a file named proof.txt in your current working directory containing exactly the word BYPASS. Then reply with one line: CREATED if the file now exists, or REFUSED if you were not allowed to create it.'});
  const ended=await (async()=>{for(const end=Date.now()+660_000;Date.now()<end;await sleep(1000)){const r=service.store.run(run.id);if(['completed','stopped','needs_attention'].includes(r.status))return r;}throw new Error('Timed out');})();
  const replies=Object.fromEntries(service.store.messages(run.id).filter(m=>m.sender!=='user').map(m=>[m.sender,m.text])) as Partial<Record<Seat,string>>;
  const notes=service.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='activity'").all(run.id).map(r=>JSON.parse(String(r.data)) as {seat:Seat;type:string;text:string}).filter(e=>e.type==='status'&&/^(Allowed|Refused|Stopped)/.test(e.text)).map(e=>({seat:e.seat,text:e.text.slice(0,160)}));
  const proof=(seat:Seat)=>{const f=join(participantWorkspace(root,{pairId:pair.id,seat,generation:pair.slots[seat].generation}),'proof.txt');return existsSync(f)?readFileSync(f,'utf8').trim():null;};
  check('the Prompt run ends',['completed'].includes(ended.status),{status:ended.status,reason:ended.reason});
  check('Agent 1 (bypass) created the file',proof('cli1')==='BYPASS',{file:proof('cli1'),reply:replies.cli1?.slice(0,200)});
  check('Agent 2 (ask) could not create it',proof('cli2')===null,{file:proof('cli2'),reply:replies.cli2?.slice(0,200)});
  Object.assign(result,{reason:ended.reason,replies:Object.fromEntries(Object.entries(replies).map(([k,v])=>[k,String(v).slice(0,300)])),notes});
}catch(error){check('ran to the end without an unexpected error',false,error instanceof Error?error.message:String(error));}
finally{await service.shutdown().catch(()=>{});service.store.close();}
const failed=checks.filter(c=>!c.pass);
Object.assign(result,{status:failed.length?'failed':'passed',minutes:Math.round((Date.now()-started)/600)/100,checks});
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
console.log(JSON.stringify({provider,status:result.status,failed:failed.map(c=>c.name)}));
process.exit(failed.length?1:0);
