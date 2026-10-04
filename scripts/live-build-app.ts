// Live acceptance for Build mode with apps (B16): both seats the same CLI, through the real service (AvAService +
// NativeFactory) in a temporary data folder; provider-login only. Two Build sessions:
//   1. A static game from scratch. A 1:1 line with tools first (the agent writes a file in its working folder), then
//      one build prompt. Checks the APP link, the preview (served on its own origin behind the cookie), the changes,
//      the one-prompt rule, and that both agents still answer afterwards.
//   2. An app with a server. Each agent gets its own port privately (1:1), builds a tiny Node server and leaves it
//      running; AvA keeps it, the link answers, and Clear Session stops it.
// Usage: node --import tsx scripts/live-build-app.ts --provider <cli> [--out <json>] [--only static|server]. About 14 live requests.
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
const only=option('--only');
const CONFIGS:Record<Provider,ProviderConfig>={
  codex:{provider:'codex',model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},
  claude:{provider:'claude',model:'default',effort:{key:'effort',value:'low'},auth:'provider-login'},
  'grok-build':{provider:'grok-build',model:'grok-4.7',auth:'provider-login'},
  antigravity:{provider:'antigravity',model:'gemini-3.7-flash-high',auth:'provider-login'},
  cursor:{provider:'cursor',model:'composer-2.5[fast=true]',auth:'provider-login'},
  vercel:{provider:'vercel',model:'openai/gpt-5.6-luna',effort:{key:'model_reasoning_effort',value:'low'},auth:'api'},
};
const PORTS:Record<Provider,[number,number]>={claude:[41711,41712],codex:[41721,41722],'grok-build':[41731,41732],antigravity:[41741,41742],cursor:[41761,41762],vercel:[41751,41752]};
const root=mkdtempSync(join(tmpdir(),`ava-app-${provider}-`)),shared=installedDataRoot(resolve('.'));
if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(root,'providers.json'));
// A Vercel AI Gateway agent uses the key stored in the shared folder (read from there; it never enters this process's
// environment, which every agent inherits).
process.env.AVA_GATEWAY_KEY_DIR??=shared;
// A Gateway model to use instead of the default.
if(option('--model')&&provider==='vercel')CONFIGS.vercel={...CONFIGS.vercel,model:option('--model')!};
const service=new AvAService(root,new NativeFactory(root,loadProviderSetups(root)),'live');
const call=<T=any>(method:string,params:unknown)=>service.call(method,params) as Promise<T>;
const checks:Array<{name:string;pass:boolean;soft?:boolean;detail?:unknown}>=[],started=Date.now();
const check=(name:string,pass:boolean,detail?:unknown,soft=false)=>{checks.push({name,pass,soft,detail});console.log(`${pass?'PASS':soft?'NOTE':'FAIL'} [${provider}] ${name}${pass||detail===undefined?'':` ${JSON.stringify(detail).slice(0,300)}`}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const cut=(s:string,n=300)=>s.replace(/\s+/g,' ').slice(0,n);
const seats=['cli1','cli2'] as const;
const result:Record<string,unknown>={provider,config:CONFIGS[provider],recordedAt:new Date().toISOString(),route:CONFIGS[provider].auth};
const until=async<T>(what:string,get:()=>T|undefined,ms:number)=>{for(const end=Date.now()+ms;Date.now()<end;await sleep(1000)){const v=get();if(v)return v;}throw new Error(`Timed out: ${what}`);};

async function direct(pairId:string,seat:Seat,text:string,requestId:string){
  const sent=await call<{id:string;threadId:string}>('direct.send',{pairId,seat,text,requestId,tools:true});
  const view=()=>service.store.db.prepare('SELECT state,error FROM direct_messages WHERE id=?').get(sent.id) as {state:string;error:string|null};
  await until(`1:1 reply from ${seat}`,()=>view().state!=='pending'?true:undefined,900_000);
  const reply=service.store.db.prepare("SELECT text FROM direct_messages WHERE thread_id=? AND seat=? AND sender='agent' ORDER BY seq DESC LIMIT 1").get(sent.threadId,seat) as {text:string}|undefined;
  return {state:view().state,error:view().error,reply:reply?.text??''};
}
async function build(pairId:string,text:string,requestId:string){
  const run=await call<{id:string;config:{build:{folder:string}}}>('run.start',{pairId,requestId,text,options:{mode:'build',durationMs:1_500_000},build:{kind:'build'}});
  const ended=await until('the build',()=>{const r=service.store.run(run.id);return ['completed','stopped','needs_attention'].includes(r.status)?r:undefined;},1_600_000);
  const reports=Object.fromEntries(service.store.messages(run.id).filter(m=>m.sender!=='user').map(m=>[m.sender,m.text])) as Record<Seat,string>;
  const events=(type:string)=>service.store.db.prepare('SELECT data FROM events WHERE run_id=? AND type=?').all(run.id,type).map(r=>JSON.parse(String(r.data)));
  // What the gate refused and how each turn ended, kept for the evidence (Clear history removes the run data later).
  const notes=events('activity').filter((e:{type:string;text:string})=>e.type==='status'&&/^(Refused|Stopped|Its |Nothing is listening)/.test(e.text)).map((e:{seat:Seat;text:string})=>({seat:e.seat,text:cut(e.text,240)}));
  const turns=service.store.db.prepare('SELECT seat,status,error FROM turns WHERE run_id=?').all(run.id);
  return {run,ended,reports,events,notes,turns};
}
// Opens a preview link the way a browser does: the link sets the cookie, then the page loads with it.
async function fetchPreview(url:string){
  const open=await fetch(url,{redirect:'manual'}),cookie=open.headers.get('set-cookie')?.split(';')[0]??'',location=open.headers.get('location')??'/';
  const page=await fetch(new URL(location,url),{headers:{cookie}}),denied=(await fetch(new URL(location,url))).status;
  return {status:page.status,type:page.headers.get('content-type')??'',html:await page.text(),withoutCookie:denied};
}

try{
  let pair=await call<Pair>('pair.create',{thread:`app-${provider}`});
  for(const seat of seats){await call('slot.configure',{pairId:pair.id,seat,config:CONFIGS[provider]});await call('slot.activate',{pairId:pair.id,seat});}
  pair=await call('pair.get',{pairId:pair.id});
  check('both agents activate and verify',pair.slots.cli1.state==='ready'&&pair.slots.cli2.state==='ready');
  const workspace=(seat:Seat)=>participantWorkspace(root,{pairId:pair.id,seat,generation:service.store.pair(pair.id).slots[seat].generation});

  if(only!=='server'){
    // Session 1: a 1:1 line with tools, then a static game from scratch.
    const primed=await direct(pair.id,'cli1','Please create a file named notes.txt in your working folder containing exactly the word PRIMED, then confirm.','s1-d1');
    const notes=join(workspace('cli1'),'notes.txt');
    check('a Build session’s 1:1 line can write in the agent’s working folder',existsSync(notes)&&readFileSync(notes,'utf8').includes('PRIMED'),{state:primed.state,error:primed.error,reply:cut(primed.reply,200)});
    const game=await build(pair.id,'Build a small browser game called "Star Catcher": stars fall from the top of a canvas, the player moves a basket with the left and right arrow keys to catch them, the score counts catches, the game ends after 3 missed stars, and a Restart button starts over. Put it all in one index.html (inline CSS and JavaScript). Test what you can, for example by checking the file for syntax errors with node.','s1-build');
    check('the build ends with a report from each agent',game.ended.status==='completed'&&game.ended.reason==='build_done'&&!!game.reports.cli1&&!!game.reports.cli2,{status:game.ended.status,reason:game.ended.reason});
    const session1:Record<string,unknown>={elapsedMs:game.ended.elapsedMs,reason:game.ended.reason,turns:game.turns,notes:game.notes,cleanup:game.events('build_cleanup'),servers:game.events('build_server')};
    for(const seat of seats){
      const n=seat==='cli1'?1:2,preview=await call<{kind:string;url:string;entry:string;named:boolean}>('build.preview',{runId:game.run.id,seat}).catch(e=>({error:String(e)} as any));
      const changes=await call<{files:Array<{path:string;status:string}>;added:number}>('build.changes',{runId:game.run.id,seat}).catch(e=>({error:String(e),files:[]} as any));
      check(`Agent ${n} named its app with an APP line`,!!preview.named,{entry:preview.entry,error:preview.error,tail:cut((game.reports[seat]??'').slice(-200),200)});
      const page=preview.url&&preview.kind==='static'?await fetchPreview(preview.url):undefined;
      check(`Agent ${n}'s app opens from its preview link (and not without the cookie)`,page?.status===200&&/text\/html/.test(page.type)&&page.withoutCookie===403,{status:page?.status,type:page?.type,withoutCookie:page?.withoutCookie});
      check(`Agent ${n}'s page is the game (a canvas, arrow keys, restart)`,!!page&&/<canvas/i.test(page.html)&&/Arrow(Left|Right)|keyCode|37|39/.test(page.html)&&/restart/i.test(page.html),{bytes:page?.html.length},true);
      check(`Agent ${n}'s changes show what it built`,changes.files.some((f:{path:string;status:string})=>/index\.html$/.test(f.path)&&f.status==='added'),{files:changes.files?.slice(0,8),error:changes.error});
      session1[seat]={entry:preview.entry,kind:preview.kind,pageBytes:page?.html.length,changedFiles:changes.files?.map((f:{path:string})=>f.path).slice(0,12),report:cut(game.reports[seat]??'',900)};
    }
    await call('run.start',{pairId:pair.id,requestId:'s1-second',text:'Add levels',options:{mode:'build'},build:{kind:'build'}}).then(()=>check('a second prompt in the same Build session is refused',false),e=>check('a second prompt in the same Build session is refused',/one prompt/.test(String(e))));
    const after=await direct(pair.id,'cli2','In one short sentence: what did you build just now?','s1-d2');
    check('the agents still answer after the build (cleanup left them alone)',after.state==='answered'&&after.reply.length>0,{state:after.state,error:after.error,reply:cut(after.reply,200)});
    result.session1=session1;
  }

  if(only!=='static'){
    // Session 2: each agent privately gets its own port, builds a tiny server app and leaves it running.
    await call('pair.clear',{pairId:pair.id,requestId:'clear-1'});
    const ports=PORTS[provider];
    for(const seat of seats){
      const port=ports[seat==='cli1'?0:1],primed=await direct(pair.id,seat,`For the build I’m about to give you, use port ${port} for your server. Just confirm; don’t start anything yet.`,`s2-${seat}`);
      check(`Agent ${seat==='cli1'?1:2} took its port privately`,primed.state==='answered',{state:primed.state,error:primed.error});
    }
    const app=await build(pair.id,'Build a tiny Node.js web app with no dependencies (only built-in modules): a server.js that serves a page at / showing the current server time, which the page fetches from /api/time as JSON {"time": "<ISO time>"}. Use the port I gave you privately. Start the server so that it keeps running after you finish, check that it answers, and name its address in your APP line.','s2-build');
    check('the server build ends with a report from each agent',app.ended.status==='completed'&&app.ended.reason==='build_done'&&!!app.reports.cli1&&!!app.reports.cli2,{status:app.ended.status,reason:app.ended.reason});
    const kept=app.events('build_server') as Array<{seat:Seat;url:string;processes:Array<{pid:number;name:string}>}>,session2:Record<string,unknown>={elapsedMs:app.ended.elapsedMs,reason:app.ended.reason,turns:app.turns,notes:app.notes,cleanup:app.events('build_cleanup'),kept};
    const urls:string[]=[];
    for(const seat of seats){
      const n=seat==='cli1'?1:2,port=ports[seat==='cli1'?0:1],preview=await call<{kind:string;url:string;named:boolean}>('build.preview',{runId:app.run.id,seat}).catch(e=>({error:String(e)} as any));
      check(`Agent ${n} named its server (APP: http://localhost:${port}/)`,preview.kind==='server'&&new URL(preview.url).port===String(port),{kind:preview.kind,url:preview.url,error:preview.error,tail:cut((app.reports[seat]??'').slice(-200),200)});
      const time=preview.kind==='server'?await fetch(new URL('/api/time',preview.url)).then(async r=>({status:r.status,body:await r.text()})).catch(e=>({status:0,body:String(e)})):undefined;
      check(`Agent ${n}'s server kept running and answers /api/time`,time?.status===200&&/"time"/.test(time.body),time);
      check(`AvA recorded Agent ${n}'s server as kept`,kept.some(k=>k.seat===seat),kept.map(k=>k.seat));
      if(preview.kind==='server')urls.push(preview.url);
      session2[seat]={url:preview.url,api:time,report:cut(app.reports[seat]??'',700)};
    }
    await call('pair.clear',{pairId:pair.id,requestId:'clear-2'});
    await sleep(2000);
    const stillUp=await Promise.all(urls.map(u=>fetch(u).then(()=>true,()=>false)));
    check('Clear Session stops the servers it kept',urls.length>0&&stillUp.every(up=>!up),{urls,stillUp});
    result.session2=session2;
  }
  // Clear history in this temporary data folder: everything saved goes.
  const cleared=await call<{threads:number;runs:number;workspacesRemoved:number}>('history.clear',{pairId:pair.id,requestId:'history'});
  const left=(await call<{threads:Array<{empty:boolean}>}>('threads.list',{pairId:pair.id})).threads.filter(t=>!t.empty).length;
  check('Clear history deletes every saved thread and the old workspaces',left===0&&cleared.runs>0&&cleared.workspacesRemoved>0,cleared);
}catch(error){check('the acceptance ran to the end without an unexpected error',false,error instanceof Error?error.message:String(error));}
finally{await service.shutdown().catch(()=>{});service.store.close();}
const failed=checks.filter(c=>!c.pass&&!c.soft);
Object.assign(result,{status:failed.length?'failed':'passed',minutes:Math.round((Date.now()-started)/600)/100,checks});
// Preview links carry a key: never written to evidence.
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,(k,v)=>typeof v==='string'?v.replace(/key=[a-f0-9]{64}/g,'key=<hidden>'):v,2));}
console.log(JSON.stringify({provider,status:result.status,failed:failed.map(c=>c.name)}));
process.exit(failed.length?1:0);
