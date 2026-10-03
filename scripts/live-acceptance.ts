// Live acceptance (B14): every room feature against real agents, for one provider at a time (both seats the same CLI).
// Drives the real service (AvAService + NativeFactory) in a temporary data folder; provider-login only.
// Usage: node --import tsx scripts/live-acceptance.ts --provider codex|claude|grok-build|antigravity|vercel [--model <gateway model>] [--out <json>]
// About 16 live requests: 4 activations, 4 direct (1:1), 3 debate, 2 benchmark, 2 internet, plus a 1:1 after Clear Session.
// Also checks which installed CLI each agent runs (S1) and the context ring's data (B23).
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {deflateSync,crc32} from 'node:zlib';
import {AvAService} from '../src/service.js';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {LIVE_CONFIGS} from './live-configs.js';
import type {Pair,Provider,ProviderConfig,Seat} from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const provider=option('--provider') as Provider;if(!provider)throw new Error('Pass --provider.');
const CONFIGS:Record<Provider,ProviderConfig>={...LIVE_CONFIGS};
const root=mkdtempSync(join(tmpdir(),`ava-acceptance-${provider}-`)),shared=installedDataRoot(resolve('.'));
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
async function until<T>(read:()=>T|undefined|false|Promise<T|undefined|false>,ms:number,what:string){for(const end=Date.now()+ms;Date.now()<end;await sleep(500)){const v=await read();if(v)return v;}throw new Error(`Timed out waiting for ${what}`);}
// A 64x64 solid red PNG, so "what color is the square" has one right answer.
function redPng(){
  const chunk=(type:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(type),data]),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body)>>>0);return Buffer.concat([len,body,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=2;
  const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(64*3).fill(Buffer.from([220,30,30]))]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(Array(64).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
let pair:Pair,threadId='';
const direct=async(seat:Seat,text:string,label:string)=>{
  const sent=await call<{id:string;threadId:string}>('direct.send',{pairId:pair.id,seat,text,requestId:`${label}-${Date.now()}`});
  const view=await until(async()=>{const v=await call('thread.get',{threadId:sent.threadId});const q=v.direct.messages.find((m:any)=>m.id===sent.id);return q&&q.state!=='pending'?v:undefined;},300_000,`1:1 reply (${label})`);
  const i=view.direct.messages.findIndex((m:any)=>m.id===sent.id),q=view.direct.messages[i],reply=view.direct.messages.slice(i+1).find((m:any)=>m.seat===seat&&m.sender==='agent');
  return {threadId:sent.threadId,state:q.state,error:q.error,reply:reply?.text??''};
};
const finish=(runId:string,ms=600_000)=>until(()=>{const r=service.store.run(runId);return ['completed','stopped','needs_attention'].includes(r.status)?r:undefined;},ms,'run end');
const events=(runId:string)=>service.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='activity'").all(runId).map(r=>JSON.parse(String(r.data)) as {seat:Seat;type:string;text:string});
const result:Record<string,unknown>={provider,config:CONFIGS[provider],recordedAt:new Date().toISOString(),route:CONFIGS[provider].auth};
try{
  // 1. Activation (one access check each).
  pair=await call('pair.create',{thread:`acceptance-${provider}`});
  const activations:string[]=[];
  for(const seat of ['cli1','cli2'] as const){await call('slot.configure',{pairId:pair.id,seat,config:CONFIGS[provider]});activations.push((await call<{evidence:string}>('slot.activate',{pairId:pair.id,seat})).evidence);}
  pair=await call('pair.get',{pairId:pair.id});
  check('both agents activate and verify',pair.slots.cli1.state==='ready'&&pair.slots.cli2.state==='ready');
  // S1: Codex (and the Gateway, which runs on it) and Claude Code run as the user's installed CLI, which activation names.
  const installed=activations.map(e=>/Installed (\w+) (\d+\.\d+\.\d+)/.exec(e)?.slice(1).join(' ')??'');result.cli=installed;
  if(['codex','claude','vercel'].includes(provider))check('both agents run the installed CLI at a supported version',installed.every(v=>v.startsWith(provider==='claude'?'claude ':'codex ')),installed);
  // B23: the context ring's data, as the room receives it after each agent's access check.
  type Usage={context?:{used:number;size:number};tokens?:Record<string,number>;cost?:{amount?:number};credit?:{balance:number}}|null;
  const usageNow=async()=>((await call('pair.get',{pairId:pair.id})) as {usage?:Record<Seat,Usage>}).usage??{cli1:null,cli2:null};
  const reportsContext=['codex','claude','vercel'].includes(provider),firstUsage=await usageNow();result.usageAfterActivation=firstUsage;
  check(reportsContext?'the context ring has both agents\' context window after activation':'the context ring: this CLI reports no context (expected)',reportsContext?(['cli1','cli2'] as const).every(s=>(firstUsage[s]?.context?.used??0)>0&&(firstUsage[s]?.context?.size??0)>0):true,firstUsage,!reportsContext);
  if(provider==='vercel')check('the Gateway agent\'s ring shows the key\'s credit',await until(async()=>typeof (await usageNow()).cli1?.credit?.balance==='number',30_000,'Gateway credit').then(()=>true,()=>false),(await usageNow()).cli1?.credit);
  const images=(pair as any).images as Record<Seat,boolean>;result.images=images;

  // 2. 1:1 priming: a secret for Agent 2, a role for Agent 1. Private to each.
  const secret=await direct('cli2','Remember the code word ORCA-7 for later. It is private: never mention it in the shared conversation. Reply with just OK.','secret');
  threadId=secret.threadId;
  check('1:1 to Agent 2 gets a plain-text reply',secret.state==='answered'&&secret.reply.length>0,cut(secret.reply,120));
  const role=await direct('cli1','In the debate that follows, you are the CEO of the company. Argue from that role. Reply with just OK.','role');
  check('1:1 to Agent 1 gets a plain-text reply',role.state==='answered'&&role.reply.length>0,cut(role.reply,120));

  // 3. Debate: Agent 1 speaks first, then they alternate (3 requests). It ends at its request limit only (completion by
  // duration): with "either", a model may end a brief debate after one turn (seen with a Gateway model), as it may.
  const debate=await call<{id:string}>('run.start',{pairId:pair.id,text:'Debate briefly, two sentences per turn: should a 50-person company offer 15 or 25 days of paid time off?',requestId:'debate',options:{mode:'conversation',opening:'cli1',completion:'duration',maxRequests:3,paceMs:0,perTurnMs:240_000}});
  const ended=await finish(debate.id);
  const view=await call('thread.get',{threadId});
  const room=view.messages.filter((m:any)=>m.runId===debate.id);
  check('debate ends cleanly at its request limit',ended.status==='stopped'&&ended.reason==='request_limit'||ended.status==='completed',{status:ended.status,reason:ended.reason});
  check('Agent 1 speaks first, then they alternate',JSON.stringify(room.map((m:any)=>m.sender))===JSON.stringify(['user','cli1','cli2','cli1']),room.map((m:any)=>m.sender));
  const turns=service.store.db.prepare('SELECT seat,text FROM turns WHERE run_id=?').all(debate.id).map(r=>({seat:String(r.seat),text:String(r.text)}));
  check('no debate prompt carries a 1:1 message or reply',turns.every(t=>!/ORCA-7|Remember the code word|you are the CEO/i.test(t.text)),turns.length);
  check('the shared room never shows the private code word',room.every((m:any)=>!/ORCA-7/.test(m.text)),room.map((m:any)=>cut(m.text,160)));
  check('Agent 1 argues as the CEO it was told to be (privately)',room.filter((m:any)=>m.sender==='cli1').some((m:any)=>/CEO|our company|as (the )?(employer|leadership)|I run|my company|we can afford/i.test(m.text)),room.filter((m:any)=>m.sender==='cli1').map((m:any)=>cut(m.text,200)),true);
  result.debate=room.map((m:any)=>({sender:m.sender,text:cut(m.text,400)}));
  const afterDebate=await usageNow();result.usageAfterDebate=afterDebate;
  if(reportsContext)check('the context ring grows as the conversation does',(afterDebate.cli1?.context?.used??0)>(firstUsage.cli1?.context?.used??0),{before:firstUsage.cli1?.context,after:afterDebate.cli1?.context},provider==='vercel');

  // 4. Same session across 1:1 and the debate: Agent 2 still knows its private code word.
  const recall=await direct('cli2','What code word did I give you earlier? Reply with just the word.','recall');
  check('Agent 2 remembers its 1:1 code word after the debate (same session)',/ORCA-7/i.test(recall.reply),cut(recall.reply,120));

  // 5. Benchmark with attachments: the same prompt to both at once; plain-text answers; one round.
  const note=await call<{id:string}>('attachment.add',{name:'note.txt',mediaType:'text/plain',data:Buffer.from('The secret number is 7319.').toString('base64')});
  const png=await call<{id:string}>('attachment.add',{name:'square.png',mediaType:'image/png',data:redPng().toString('base64')});
  const canSee=images.cli1&&images.cli2;
  if(!canSee){
    let refused='';try{await call('run.start',{pairId:pair.id,text:'Describe the image.',requestId:'img-refused',options:{mode:'benchmark'},attachments:[png.id]});}catch(e){refused=e instanceof Error?e.message:String(e);}
    check('an image is refused up front for an agent that can\'t read images',/can't read images/.test(refused),refused);
  }
  const bench=await call<{id:string}>('run.start',{pairId:pair.id,text:`Answer in one short line: what is the secret number in the attached file?${canSee?' Also name the color of the square in the attached image.':''}`,requestId:'bench',options:{mode:'benchmark',durationMs:600_000},attachments:canSee?[note.id,png.id]:[note.id]});
  const benchEnd=await finish(bench.id);
  const answers=(await call('thread.get',{threadId})).messages.filter((m:any)=>m.runId===bench.id&&m.sender!=='user');
  check('benchmark: both agents answer once and it ends',benchEnd.status==='completed'&&benchEnd.reason==='benchmark_done'&&answers.length===2,{status:benchEnd.status,reason:benchEnd.reason,answers:answers.length});
  check('benchmark: both read the attached text file',answers.length===2&&answers.every((m:any)=>/7319/.test(m.text)),answers.map((m:any)=>cut(m.text,160)));
  if(canSee)check('benchmark: both read the attached image',answers.every((m:any)=>/red/i.test(m.text)),answers.map((m:any)=>cut(m.text,160)));
  const benchTurns=service.store.db.prepare('SELECT text FROM turns WHERE run_id=?').all(bench.id).map(r=>String(r.text));
  check('benchmark: both agents got the identical prompt',benchTurns.length===2&&benchTurns[0]===benchTurns[1]);

  // 6. Internet switch: Agent 1 on, Agent 2 off, judged by what each actually did.
  const switched=await call<{restarted:boolean}>('slot.internet',{pairId:pair.id,seat:'cli1',enabled:true,requestId:'net-on'});
  const net=await call<{id:string}>('run.start',{pairId:pair.id,text:'Search the web for the current population of Reykjavik and cite the source. If you have no web access, reply exactly NO_WEB.',requestId:'net',options:{mode:'benchmark',durationMs:600_000}});
  const netEnd=await finish(net.id);
  const netAnswers=Object.fromEntries((await call('thread.get',{threadId})).messages.filter((m:any)=>m.runId===net.id&&m.sender!=='user').map((m:any)=>[m.sender,m.text]));
  const activity=events(net.id),webBy=(seat:Seat)=>activity.filter(e=>e.seat===seat&&(e.type==='tool'&&/web|search|fetch|http/i.test(e.text)||e.type==='status'&&/^Web access/.test(e.text))).map(e=>cut(e.text,120));
  const usedWeb=(seat:Seat)=>activity.some(e=>e.seat===seat&&(e.type==='status'&&/Web access allowed/.test(e.text)||e.type==='tool'&&/(web search|search_web|fetch).*completed|completed.*(population|reykjav)/i.test(e.text)));
  result.internet={restarted:switched.restarted,status:netEnd.status,cli1:{web:webBy('cli1'),answer:cut(netAnswers.cli1??'',300)},cli2:{web:webBy('cli2'),answer:cut(netAnswers.cli2??'',300)}};
  // A Gateway agent has no hosted web search (by design: Codex's search isn't offered through the Gateway); its switch
  // governs command network access instead, so "on" is only noted for it.
  check(provider==='vercel'?'internet on: the Gateway agent has no hosted web search (by design)':'internet on: Agent 1 searched the web and answered with a source',usedWeb('cli1')&&!/NO_WEB/.test(netAnswers.cli1??'')&&/\d/.test(netAnswers.cli1??''),result.internet,provider==='vercel');
  check('internet off: Agent 2 did not use the web',!usedWeb('cli2'),result.internet);
  check('internet off: Agent 2 says it has no web access',/NO_WEB|no web access|can(no|')t (search|access)/i.test(netAnswers.cli2??''),cut(netAnswers.cli2??'',160),true);

  // 7. Stats and renaming (no model requests).
  const stats=await call('thread.stats',{threadId});
  check('thread stats cover all three prompts',stats.prompts===3&&stats.turns.length===service.store.db.prepare('SELECT COUNT(*) n FROM turns t JOIN runs r ON r.id=t.run_id WHERE r.pair_id=?').get(pair.id)!.n,{prompts:stats.prompts,turns:stats.turns.length,firstToken:stats.avgFirstActivityMs,tokPerSec:stats.estimatedTokensPerSec});
  await call('thread.rename',{threadId,title:`${provider} acceptance`});
  check('the thread can be renamed',(await call('threads.list',{pairId:pair.id})).threads.some((t:any)=>t.id===threadId&&t.title===`${provider} acceptance`));
  result.stats={prompts:stats.prompts,replies:stats.replies,avgFirstTokenMs:stats.avgFirstActivityMs,avgReplyMs:stats.avgDurationMs,estTokensPerSec:stats.estimatedTokensPerSec,maxParallel:stats.maxParallel};

  // 8. Clear Session: fresh sessions forget everything; a new thread.
  await call('pair.clear',{pairId:pair.id,requestId:'clear'});
  const fresh=await direct('cli2','Did I give you a code word earlier in this conversation? If you have no record of one, reply UNKNOWN.','fresh');
  check('Clear Session starts a new thread',fresh.threadId!==threadId);
  check('after Clear Session, Agent 2 no longer knows the code word',!/ORCA-7/i.test(fresh.reply),cut(fresh.reply,120));
}catch(error){check('acceptance ran to the end without an unexpected error',false,error instanceof Error?error.message:String(error));}
finally{await service.shutdown().catch(()=>{});service.store.close();}
const failed=checks.filter(c=>!c.pass&&!c.soft);
Object.assign(result,{status:failed.length?'failed':'passed',minutes:Math.round((Date.now()-started)/600)/100,checks});
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
console.log(JSON.stringify({provider,status:result.status,failed:failed.map(c=>c.name)}));
process.exit(failed.length?1:0);
