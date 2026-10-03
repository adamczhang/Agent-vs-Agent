// Live acceptance for Build mode, Review (B15): both seats the same CLI review scripts/fixtures/buggy-shop, each in
// its own copy, through the real service (AvAService + NativeFactory) in a temporary data folder; provider-login only.
// The fixture has three planted bugs: cartTotal skips the first item, SAVE10 misses exactly 100, dueDate's month is
// off by one. Usage: node --import tsx scripts/live-build.ts --provider <cli> [--out <json>]. About 4 live requests.
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
const fixture=resolve('scripts','fixtures','buggy-shop');
const root=mkdtempSync(join(tmpdir(),`ava-build-${provider}-`)),shared=installedDataRoot(resolve('.'));
if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(root,'providers.json'));
// A Vercel AI Gateway agent uses the key stored in the shared folder (read from there; it never enters this process's
// environment, which every agent inherits).
process.env.AVA_GATEWAY_KEY_DIR??=shared;
// A Gateway model to use instead of the default.
if(option('--model')&&provider==='vercel')CONFIGS.vercel={...CONFIGS.vercel,model:option('--model')!};
const service=new AvAService(root,new NativeFactory(root,loadProviderSetups(root)),'live');
const call=<T=any>(method:string,params:unknown)=>service.call(method,params) as Promise<T>;
const checks:Array<{name:string;pass:boolean;soft?:boolean;detail?:unknown}>=[],started=Date.now();
const check=(name:string,pass:boolean,detail?:unknown,soft=false)=>{checks.push({name,pass,soft,detail});console.log(`${pass?'PASS':soft?'NOTE':'FAIL'} [${provider}] ${name}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const cut=(s:string,n=300)=>s.replace(/\s+/g,' ').slice(0,n);
const walk=(dir:string):string[]=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
const digest=(dir:string)=>createHash('sha256').update(walk(dir).sort().map(f=>f.slice(dir.length)+'\0'+readFileSync(f,'utf8')).join('\n')).digest('hex');
const BUGS:Record<string,RegExp>={
  'cartTotal skips the first item':/(i\s*=\s*1|first item|index 0|skips? (the )?first|starts? at (index )?1|off[- ]by[- ]one)/i,
  'SAVE10 misses an order of exactly 100':/(>=|≥|exactly 100|100 or more|at least 100|boundary|inclusive|> 100)/i,
  'dueDate month is off by one':/(month[\s\S]{0,80}(0-based|zero-based|0-indexed|zero-indexed|off by one|minus 1|- 1)|getMonth|(0-based|zero-based|0-indexed|zero-indexed)[\s\S]{0,60}month)/i,
};
const result:Record<string,unknown>={provider,config:CONFIGS[provider],recordedAt:new Date().toISOString(),route:CONFIGS[provider].auth};
try{
  const before=digest(fixture);
  let pair=await call<Pair>('pair.create',{thread:`build-${provider}`});
  for(const seat of ['cli1','cli2'] as const){await call('slot.configure',{pairId:pair.id,seat,config:CONFIGS[provider]});await call('slot.activate',{pairId:pair.id,seat});}
  pair=await call('pair.get',{pairId:pair.id});
  check('both agents activate and verify',pair.slots.cli1.state==='ready'&&pair.slots.cli2.state==='ready');
  const run=await call<{id:string;config:{build:{folder:string}}}>('run.start',{pairId:pair.id,requestId:'review',options:{mode:'build',durationMs:1_200_000},build:{kind:'review',path:fixture},
    text:'Find the bugs in this project. Run its tests (node --test) to help, and report each bug with its file and line.'});
  const ended=await (async()=>{for(const end=Date.now()+1_500_000;Date.now()<end;await sleep(1000)){const r=service.store.run(run.id);if(['completed','stopped','needs_attention'].includes(r.status))return r;}throw new Error('Timed out waiting for the review');})();
  const threadId=(await call('threads.list',{pairId:pair.id})).threads.find((t:any)=>t.runIds.includes(run.id)).id;
  const reports=Object.fromEntries((await call('thread.get',{threadId})).messages.filter((m:any)=>m.runId===run.id&&m.sender!=='user').map((m:any)=>[m.sender,m.text])) as Record<Seat,string>;
  check('the review ends with a report from each agent',ended.status==='completed'&&ended.reason==='build_done'&&!!reports.cli1&&!!reports.cli2,{status:ended.status,reason:ended.reason});
  const copies=(['cli1','cli2'] as const).map(seat=>join(participantWorkspace(root,{pairId:pair.id,seat,generation:pair.slots[seat].generation}),run.config.build.folder));
  check('each agent got its own copy',copies.every(c=>existsSync(join(c,'src','cart.js')))&&copies[0]!==copies[1],copies);
  check('the original project is untouched',digest(fixture)===before);
  const activity=service.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='activity'").all(run.id).map(r=>JSON.parse(String(r.data)) as {seat:Seat;type:string;text:string});
  for(const seat of ['cli1','cli2'] as const){
    const mine=activity.filter(e=>e.seat===seat),allowed=mine.filter(e=>e.type==='status'&&/^Allowed in its copy/.test(e.text)).length,refused=mine.filter(e=>e.type==='status'&&/^Refused/.test(e.text)).map(e=>cut(e.text,140));
    const tools=mine.filter(e=>e.type==='tool').map(e=>cut(e.text,120)),ranTests=tools.some(t=>/node --test|npm test|test/i.test(t));
    const found=Object.entries(BUGS).filter(([,re])=>re.test(reports[seat]??'')).map(([name])=>name);
    result[seat]={found,allowedByGate:allowed,refused,ranTests,tools:tools.slice(0,12),report:cut(reports[seat]??'',1200)};
    check(`Agent ${seat==='cli1'?1:2} found at least 2 of the 3 planted bugs`,found.length>=2,found);
    check(`Agent ${seat==='cli1'?1:2} found all 3 planted bugs`,found.length===3,found,true);
    check(`Agent ${seat==='cli1'?1:2} worked in its copy (read files or ran commands)`,tools.length>0,{tools:tools.length,allowedByGate:allowed});
    check(`Agent ${seat==='cli1'?1:2} ran the tests`,ranTests,undefined,true);
  }
  const stats=await call('thread.stats',{threadId});
  result.stats={avgReplyMs:stats.avgDurationMs,avgFirstTokenMs:stats.avgFirstActivityMs,estTokensPerSec:stats.estimatedTokensPerSec};
}catch(error){check('the review ran to the end without an unexpected error',false,error instanceof Error?error.message:String(error));}
finally{await service.shutdown().catch(()=>{});service.store.close();}
const failed=checks.filter(c=>!c.pass&&!c.soft);
Object.assign(result,{status:failed.length?'failed':'passed',minutes:Math.round((Date.now()-started)/600)/100,checks});
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
console.log(JSON.stringify({provider,status:result.status,failed:failed.map(c=>c.name)}));
process.exit(failed.length?1:0);
