// Live check: does each agent's internet switch really change what it can do?
// For each provider: one request with the switch off, then one with it on (restarting the agent in the same session
// when its provider fixes web access at launch, as AvA does). Records web tool calls and the gate's decisions.
// Usage: node --import tsx scripts/probe-internet.ts [--only codex|claude|grok-build|antigravity] [--out <json>]
// Live: 2 requests per provider (provider-login). Temporary data folder.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {PROVIDERS,type Activity,type Provider,type ProviderConfig} from '../src/types.js';
import type {ConfiguredParticipant} from '../src/activation.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const root=mkdtempSync(join(tmpdir(),'ava-internet-probe-')),factory=new NativeFactory(root,loadProviderSetups(installedDataRoot(resolve('.'))));
const cut=(s:string,n=400)=>s.replace(/\s+/g,' ').slice(0,n);
const fast:Partial<Record<Provider,Partial<ProviderConfig>>>={codex:{model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'}},claude:{model:'default',effort:{key:'effort',value:'low'}}};
async function ask(p:ConfiguredParticipant,text:string){
  const events:Activity[]=[],started=Date.now();
  const r=await p.request({id:randomUUID(),text,signal:AbortSignal.timeout(300_000),onStarted(){},onEvent(e){events.push(e);}});
  return {status:r.status,ms:Date.now()-started,reply:cut(r.text),tools:events.filter(e=>e.type==='tool').map(e=>cut(e.text,140)),gate:events.filter(e=>e.type==='status'&&/^Web access/.test(e.text)).map(e=>cut(e.text,140))};
}
// Used the web: a web tool call that completed (a refused or failed one doesn't count).
const web=(r:{tools:string[]})=>r.tools.some(t=>/web|search|fetch|http/i.test(t)&&/completed/i.test(t))&&!r.tools.some(t=>/rejected|refused/i.test(t));
const result:Record<string,unknown>={recordedAt:new Date().toISOString(),route:'provider-login'};
// Diagnostic for Grok: start with web off, then restart (same session) with web on, asking explicitly for its web tool.
if(option('--only')==='grok-forward'){
  let internet=false;const config={provider:'grok-build',model:'',auth:'provider-login'} as ProviderConfig,scope={pairId:'probe',seat:'cli1' as const,generation:40};
  let p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet});
  const off=await ask(p,'Remember the code word ORCA-7. Reply with just OK. Do not run commands.');
  internet=true;const id=p.sessionId;await p.close();p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet,resumeSessionId:id});
  const on=await ask(p,'Internet access is now on for you: use your web_search tool directly. What code word did I give you? Then search the web for the current population of Oslo and cite the source. Do not run terminal commands.');await p.close();
  console.log(JSON.stringify({sameSession:p.sessionId===id,off,on,webWhenOn:web(on)},null,1));process.exit(0);
}
// Diagnostic for Grok: start with web on, then restart (same session) with web off. Does the setting follow the process?
if(option('--only')==='grok-reverse'){
  let internet=true;const config={provider:'grok-build',model:'',auth:'provider-login'} as ProviderConfig,scope={pairId:'probe',seat:'cli1' as const,generation:30};
  let p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet});
  const on=await ask(p,'Remember the code word ORCA-7. Then search the web for the current population of Reykjavik and cite the source. If you cannot search the web, say so plainly.');
  internet=false;const id=p.sessionId;await p.close();p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet,resumeSessionId:id});
  const off=await ask(p,'What code word did I give you? Then search the web for the current population of Oslo and cite the source. If you cannot search the web, say so plainly.');await p.close();
  console.log(JSON.stringify({sameSession:p.sessionId===id,on,off,webWhenOn:web(on),webWhenOff:web(off)},null,1));process.exit(0);
}
// The subscription CLIs (provider-login); the Gateway has its own probe (probe-vercel.ts).
for(const provider of (option('--only')?[option('--only') as Provider]:PROVIDERS.filter(p=>p!=='vercel'))){
  let internet=false;
  const config={provider,model:'',auth:'provider-login',...fast[provider]} as ProviderConfig,scope={pairId:'probe',seat:'cli1' as const,generation:PROVIDERS.indexOf(provider)+10};
  try{
    let p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet});
    const off=await ask(p,'Remember the code word PELICAN-42 for later. Then search the web for the current population of Reykjavik and cite the source. If you cannot search the web right now, say plainly that you have no web access.');
    internet=true;let restarted=false;
    if(p.launchedWithInternet!==undefined){const id=p.sessionId;await p.close();p=await factory.open(config,scope,AbortSignal.timeout(180_000),{internet:()=>internet,resumeSessionId:id});restarted=true;}
    const on=await ask(p,'Your tools may have changed. What code word did I ask you to remember? Then search the web for the current population of Reykjavik and cite the source. If you cannot search the web, say so plainly.');
    await p.close();
    result[provider]={restarted,off,on,webWhenOff:web(off),webWhenOn:web(on),remembered:/PELICAN-42/.test(on.reply)};
  }catch(error){result[provider]={error:error instanceof Error?error.message:String(error)};}
  console.log(provider,JSON.stringify(result[provider],null,1));
}
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
process.exit(0);
