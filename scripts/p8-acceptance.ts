// P8 acceptance against a packaged/installed core and its actual MCP wrapper, with isolated data.
// --plugin <root> --host codex|claude --suite essential|timed|provider [--provider grok-build|antigravity|vercel]
// --mock exercises the complete harness without providers (the timed clock is compressed to 900 ms).
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {installedDataRoot} from '../src/paths.js';
import type {AgentRequest,Pair,Provider,ProviderConfig,Run,Seat} from '../src/types.js';
import type {ServiceFactory} from '../src/service.js';
import type {ParticipantOptions} from '../src/providers.js';

const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const plugin=resolve(option('--plugin')??'release/marketplace/plugins/agent-vs-agent'),host=option('--host')??'codex',suite=option('--suite')??'essential',mock=args.includes('--mock');
if(!['codex','claude'].includes(host)||!['essential','timed','provider'].includes(suite))throw new Error('Invalid host or suite');
const provider=option('--provider') as Provider|undefined;
if(suite==='provider'&&!['grok-build','antigravity','vercel'].includes(provider??''))throw new Error('Choose a provider for the provider suite');
const ceiling=suite==='timed'?18:suite==='provider'?4:20;
console.log(`P8 ${host}/${suite}${provider?'/'+provider:''}: ${mock?'MOCK':'LIVE'}, request ceiling ${ceiling}; stop at first failed check.`);
const out=resolve(option('--out')??`pilot-evidence/stage-d/p8-${host}-${suite}${provider?'-'+provider:''}${mock?'-mock':''}.json`);
if(existsSync(out))throw new Error('Evidence already exists; choose a new --out path');
const root=mkdtempSync(join(tmpdir(),'ava-p8-data-')),shared=installedDataRoot(resolve('.'));
const core=async(name:string)=>import(pathToFileURL(join(plugin,'dist','src',name+'.js')).href);
const {AvAService}=await core('service') as typeof import('../src/service.js');
const {NativeFactory,loadProviderSetups}=await core('providers') as typeof import('../src/providers.js');
const {listen}=await core('http') as typeof import('../src/http.js');
const {participantWorkspace}=await core('workspace') as typeof import('../src/workspace.js');
const settings:Record<Provider,ProviderConfig>={
  codex:{provider:'codex',model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},
  claude:{provider:'claude',model:'default',effort:{key:'effort',value:'low'},auth:'provider-login'},
  'grok-build':{provider:'grok-build',model:'grok-4.7',auth:'provider-login'},
  antigravity:{provider:'antigravity',model:'gemini-3.7-flash-high',auth:'provider-login'},
  cursor:{provider:'cursor',model:'composer-2.5[fast=true]',auth:'provider-login'},
  vercel:{provider:'vercel',model:'openai/gpt-5.6-luna',effort:{key:'model_reasoning_effort',value:'low'},auth:'api'},
};
if(!mock&&provider==='vercel')process.env.AVA_GATEWAY_KEY_DIR=shared;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
class MockFactory implements ServiceFactory{
  list(){return [];}
  async discover(p:Provider){return {provider:p,currentModel:settings[p].model,models:[{id:settings[p].model,name:settings[p].model}],controls:[]};}
  async doctor(){return {modelRequests:0 as const,clis:[],gateway:{key:'none' as const,status:'missing' as const}};}
  async open(config:ProviderConfig,scope:{pairId:string;seat:Seat;generation:number},_signal:AbortSignal,options:ParticipantOptions={}){
    const cwd=participantWorkspace(root,scope);mkdirSync(cwd,{recursive:true});
    return {accepted:config,evidence:'mock',sessionId:randomUUID(),close:async()=>{},setBuildAccess:async()=>{},request:async(request:AgentRequest)=>{
      request.onStarted();await pause(2);let text='';
      const nonce=request.text.match(/AVA_READY_[\w-]+/);
      if(nonce)text=nonce[0];
      else if(request.text.includes('P8_PRIVATE'))text='P8_PRIVATE';
      else if(request.text.includes('You are reviewing'))text='src/cart.js: first item skipped at index 0; SAVE10 needs >= 100; src/dates.js: month is zero-based.';
      else if(request.text.includes('You are building software')||request.text.includes('You are building on')){
        const folder=request.text.match(/(?:folder for it is|folder) "([^"]+)"/)?.[1];
        if(!folder||!options.workspace?.())throw new Error('Mock build has no workspace');
        writeFileSync(join(cwd,folder,'index.html'),'<!doctype html><title>P8_APP</title><h1>P8_APP</h1>');text=`Built it.\nAPP: ${folder}/index.html`;
      }else if(request.text.includes('P8_PROVIDER'))text='P8_PROVIDER';
      else if(request.text.includes('7319'))text='7319';
      else text=JSON.stringify({message:'Small projects benefit from clear documentation and tests.',stop_requested:false,stop_reason:null});
      request.onEvent({type:'output',text});return {status:'completed' as const,text,usage:{input:100,output:20}};
    }};
  }
}
const factory:ServiceFactory=mock?new MockFactory():new NativeFactory(root,loadProviderSetups(shared));
let requests=0;
const open=factory.open.bind(factory);
factory.open=async(...input)=>{const participant=await open(...input),request=participant.request.bind(participant);participant.request=async r=>{
  if(requests>=ceiling)throw new Error('P8 request ceiling reached');requests++;return request(r);
};return participant;};
const service=new AvAService(root,factory,mock?'simulation':'live'),http=await listen(service,join(plugin,'dist','web'));
const env=Object.fromEntries(Object.entries({...process.env,AVA_DATA_DIR:root,AVA_IDLE_TIMEOUT_MS:'60000'}).filter((v):v is [string,string]=>v[1]!==undefined));
const client=new Client({name:'ava-p8-acceptance',version:'0.1.2'});
const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[];
const check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,...(detail!==undefined?{detail}:{})});console.log(`${pass?'PASS':'FAIL'} ${name}`);if(!pass)throw new Error(name);};
const call=<T=any>(method:string,params:unknown)=>service.call(method,params) as Promise<T>;
const mcp=async(name:string,input:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:input});if(r.isError)throw new Error('MCP tool failed: '+name);return (r.content as Array<{text?:string}>).map(c=>c.text??'').join('');};
const command=(thread:string,text:string)=>mcp('ava_command',{thread,command:text});
const wait=async<T>(read:()=>Promise<T|undefined>,timeout:number)=>{const end=Date.now()+timeout;for(;;){const result=await read();if(result!==undefined)return result;if(Date.now()>end)throw new Error('P8 operation timed out');await pause(mock?5:500);}};
async function pair(label:string,one:Provider='codex',two:Provider='claude'){
  const thread=(host==='claude'?'claude-':'')+`p8-${label}-${randomUUID()}`;
  const p=await call<Pair>('pair.create',{thread});
  check(`${label}: wrapper menu`,/Choose a CLI/.test(await command(thread,'/ava CLI1')));
  for(const [seat,who] of [['cli1',one],['cli2',two]] as const){
    await call('slot.configure',{pairId:p.id,seat,config:settings[who]});
    const menu=JSON.parse(await mcp('ava_activation_menu',{thread,seat}));
    const index=menu.choices.findIndex((c:{value:string})=>c.value==='activate');
    if(index<0)throw new Error('Activation choice absent');
    await mcp('ava_choose',{pairId:p.id,seat,menuId:menu.id,choice:String(index+1)});
  }
  const ready=await call<Pair>('pair.get',{pairId:p.id});check(`${label}: both agents verified`,Object.values(ready.slots).every(s=>s.state==='ready'));
  return {pair:ready,thread};
}
async function finish(run:Run,timeout=360000){
  return wait(async()=>{const view=await call('run.get',{runId:run.id});return ['completed','stopped','needs_attention'].includes(view.run.status)?view:undefined;},timeout);
}
const start=(pairId:string,text:string,options:Record<string,unknown>,extra:Record<string,unknown>={})=>call<Run>('run.start',{pairId,text,requestId:randomUUID(),options,...extra});
let status='failed',failure:string|undefined,timed:unknown;
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(plugin,'dist','src','server.js'),'--mcp'],cwd:plugin,env,stderr:'pipe'}));
  check('installed core is 0.1.2',(await call('health',{})).version==='0.1.2');
  check('help routes through the wrapper',/\/ava doctor/.test(await command('p8-help','/ava')));
  check('doctor routes without model requests',/0 model requests/.test(await command('p8-help','/ava doctor'))&&requests===0);
  if(suite==='essential'){
    const main=await pair('main'),p=main.pair;
    const room=JSON.parse(await command(main.thread,'/ava start'));check('room opens for the same pair',(await call('room.get',{roomId:room.roomId})).pair.id===p.id);
    const note=await call('attachment.add',{name:'p8.txt',mediaType:'text/plain',data:Buffer.from('The number is 7319.').toString('base64')});
    const prompt=await start(p.id,'Read the attachment and reply with only its number (7319).',{mode:'benchmark'},{attachments:[note.id]});
    const answered=await finish(prompt);check('Prompt: both replies and attachment read',answered.run.reason==='benchmark_done'&&answered.messages.filter((m:any)=>m.sender!=='user').length===2&&answered.messages.filter((m:any)=>m.sender!=='user').every((m:any)=>/7319/.test(m.text)));
    const direct=await call('direct.send',{pairId:p.id,seat:'cli1',text:'Reply exactly P8_PRIVATE.',requestId:randomUUID()});
    const directView=await wait(async()=>{const view=await call('thread.get',{threadId:direct.threadId});return view.direct.messages.find((m:any)=>m.id===direct.id)?.state!=='pending'?view:undefined;},180000);
    check('private line replies only to its seat',directView.direct.messages.some((m:any)=>m.sender==='agent'&&m.seat==='cli1'&&/P8_PRIVATE/.test(m.text))&&directView.direct.messages.every((m:any)=>m.seat==='cli1'));
    const debate=await start(p.id,'Discuss practical tradeoffs between documentation and tests for a small personal software project. Keep each reply to two sentences and engage with the other agent.',{maxRequests:4,paceMs:0,completion:'duration',durationMs:120000});
    const discussed=await finish(debate);check('Debate: paired opening then replies within budget',discussed.run.reason==='request_limit'&&discussed.run.requests===4&&discussed.messages.filter((m:any)=>m.sender!=='user').length>=3);
    const savedTurns=service.store.db.prepare("SELECT text FROM turns WHERE run_id=? AND seat='cli2'").all(debate.id);
    check('private text not forwarded to the other agent',savedTurns.every(r=>!String(r.text).includes('P8_PRIVATE')));
    const stats=await call('run.stats',{runId:prompt.id});check('Stats uses reported token counts',stats.seats.every((s:any)=>s.tokenSource==='reported'&&s.outputTokens>0),stats.seats.map((s:any)=>({provider:s.provider,source:s.tokenSource,output:s.outputTokens})));
    await call('thread.rename',{threadId:direct.threadId,title:'P8 acceptance'});
    check('rename and export preserve history',(await call('threads.list',{pairId:p.id})).threads.some((t:any)=>t.title==='P8 acceptance')&&(await call('run.export',{runId:prompt.id})).json.messages.length===3);
    await call('pair.clear',{pairId:p.id,requestId:randomUUID()});
    const fresh=await call<Pair>('pair.get',{pairId:p.id});check('Clear Session gives both agents new sessions',(['cli1','cli2'] as const).every(s=>fresh.slots[s].sessionId!==p.slots[s].sessionId));
    const building=await pair('build');
    const built=await start(building.pair.id,'Create index.html displaying the text P8_APP. Use plain HTML, with no dependencies or server. End with the required APP line.',{mode:'build',durationMs:300000},{build:{kind:'build'}});
    check('Build completes for both agents',(await finish(built)).run.reason==='build_done');
    for(const seat of ['cli1','cli2'] as const){
      const preview=await call('build.preview',{runId:built.id,seat}),opened=await fetch(preview.url,{redirect:'manual'}),cookie=opened.headers.get('set-cookie')?.split(';')[0];
      const page=await fetch(new URL(opened.headers.get('location')!,preview.url),{headers:{cookie:cookie??''}});
      check(`Build ${seat}: preview and changes`,page.ok&&/P8_APP/.test(await page.text())&&(await call('build.changes',{runId:built.id,seat})).files.some((f:any)=>f.path==='index.html'));
    }
    const reviewing=await pair('review'),fixture=resolve('scripts/fixtures/buggy-shop');
    const fingerprint=()=>createHash('sha256').update(readFileSync(join(fixture,'src/cart.js'))).update(readFileSync(join(fixture,'src/dates.js'))).digest('hex');
    const before=fingerprint(),review=await start(reviewing.pair.id,'Find the bugs in this small project. Name the files and explain the first-item, discount-boundary and date-month errors. Do not fix the code.',{mode:'build',durationMs:300000},{build:{kind:'review',path:fixture}});
    const reviewed=await finish(review);check('Review finds planted issues in both copies',reviewed.run.reason==='build_done'&&reviewed.messages.filter((m:any)=>m.sender!=='user').every((m:any)=>/cart\.js/.test(m.text)&&/dates\.js/.test(m.text)&&/100/.test(m.text)));
    check('original project is unchanged',before===fingerprint());
    await call('history.clear',{requestId:randomUUID()});check('Clear history removes test history',(await call('runs.list',{})).runs.length===0);
  }else if(suite==='provider'){
    const current=await pair(provider!,provider!,provider!);
    const prompt=await start(current.pair.id,'Reply exactly P8_PROVIDER. Use no tools.',{mode:'benchmark',durationMs:180000});
    const done=await finish(prompt);check(`${provider}: subscription/API activation and Prompt`,done.run.reason==='benchmark_done'&&done.messages.filter((m:any)=>m.sender!=='user').length===2&&done.messages.filter((m:any)=>m.sender!=='user').every((m:any)=>m.text.trim()==='P8_PROVIDER'));
  }else{
    const current=await pair('timed'),durationMs=mock?900:300000;
    const run=await start(current.pair.id,'Debate tradeoffs in designing a small personal software project: tests, documentation, simplicity, maintenance, usability and accessibility. Engage with the preceding reply, explore a new practical angle each turn, and keep each response to two sentences. Continue until the controller ends the timed discussion.',{durationMs,completion:'duration',maxRequests:16,perTurnMs:120000,paceMs:mock?90:30000});
    let minute=-1;
    const ended=await wait(async()=>{
      const view=await call('run.get',{runId:run.id}),next=Math.floor(view.run.elapsedMs/60000);
      if(next!==minute){minute=next;console.log(`Timed Debate: minute ${minute}, ${view.run.requests} requests, ${view.run.status}`);}
      return ['completed','stopped','needs_attention'].includes(view.run.status)?view:undefined;
    },durationMs+180000);
    const events=service.store.db.prepare('SELECT type,time FROM events WHERE run_id=? ORDER BY seq').all(run.id).map(e=>({type:String(e.type),time:String(e.time)})),started=events.find(e=>e.type==='run_started')!,admissions=events.filter(e=>e.type==='phase_admitted');
    const lastAdmissionMs=Math.max(...admissions.map(e=>Date.parse(e.time)-Date.parse(started.time)));
    timed={durationMs,elapsedMs:ended.run.elapsedMs,reason:ended.run.reason,requests:ended.run.requests,replies:ended.messages.filter((m:any)=>m.sender!=='user').length,lastAdmissionMs,pauses:events.filter(e=>e.type==='paused').length};
    check(mock?'mock timed gate reaches its full duration':'full uninterrupted 5-minute Debate',ended.run.status==='completed'&&ended.run.reason==='duration_reached'&&ended.run.elapsedMs>=durationMs&&lastAdmissionMs<durationMs&&!events.some(e=>e.type==='paused'),timed);
  }
  status='passed';
}catch(error){failure=error instanceof Error?error.message:String(error);console.error('P8 stopped: '+failure.replace(/\b[a-f0-9]{64}\b/g,'REDACTED'));}
finally{
  await client.close().catch(()=>{});await http.close().catch(()=>{});service.store.close();
  const scrub=(s:string)=>s.replace(/\b[a-f0-9]{64}\b|vck_[\w-]+/g,'REDACTED').split(homedir().replaceAll('\\','\\\\')).join('%USERPROFILE%').split(homedir()).join('%USERPROFILE%');
  mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,scrub(JSON.stringify({status,mode:mock?'mock':'live',host,suite,provider,version:'0.1.2',recordedAt:new Date().toISOString(),ceiling,requests,timed,checks,failure},null,2)));
  console.log(JSON.stringify({status,mode:mock?'mock':'live',host,suite,requests,checks:checks.length}));
}
if(status!=='passed')process.exitCode=1;
