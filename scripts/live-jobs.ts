// X3 acceptance: every provider passes activation, cancellation and Build cleanup with job containment on.
// The real service (live) in a temporary data folder, both seats the same provider. Per provider:
//   1. activation: both agents start contained, and their processes are members of their jobs;
//   2. cancellation: a long Prompt run is stopped mid-answer, ends stopped (not needs_attention), the agents stay up;
//   3. Build cleanup: under Bypass, each agent leaves a detached background process; the run's cleanup stops it;
//   4. Stop all: nothing that was in the agents' jobs is still running.
// Ceiling: 8 participant requests per provider (4 activations, 2 cancelled answers, 2 Build answers); 40 for all five.
// The batch stops at the first failed provider.
// Usage: node --import tsx scripts/live-jobs.ts [--providers codex,claude,...] [--trace] [--out <new.json>]
//   --trace prints every process started during the Build run, with its parent and whether a job held it.
import { randomUUID } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { AvAService } from '../src/service.js';
import { NativeFactory,loadProviderSetups } from '../src/providers.js';
import { installedDataRoot } from '../src/paths.js';
import { listProcesses } from '../src/census.js';
import { LIVE_CONFIGS } from './live-configs.js';
import type { Pair,Provider,Run,Seat } from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const providers=(option('--providers')??'codex,claude,grok-build,antigravity,vercel').split(',') as Provider[];
const out=resolve(option('--out')??`pilot-evidence/stage-d/x3-jobs-live-${new Date().toISOString().slice(0,10)}.json`);
if(existsSync(out))throw new Error('Choose a new evidence filename; the previous batch must be preserved.');
const PER_PROVIDER=8,SEATS:Seat[]=['cli1','cli2'];
const BUILD_PROMPT=['This is a process-cleanup test for the tool you run in.',
  '1. Start one background process that keeps running after your command returns, detached from your shell: node -e "setInterval(()=>{},1000)". On Windows, PowerShell\'s Start-Process -WindowStyle Hidden node -ArgumentList \'-e\',\'setInterval(()=>{},1000)\' does this.',
  '2. Create index.html containing the text OK.','3. Do not wait for, check on or stop the background process.','End your reply with the line: APP: index.html'].join('\n');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until<T>(read:()=>T|undefined|false|Promise<T|undefined|false>,ms:number,what:string){for(const end=Date.now()+ms;Date.now()<end;await sleep(500)){const v=await read();if(v)return v;}throw new Error(`Timed out waiting for ${what}`);}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
// node processes whose command line holds setInterval, started at or after `since` (Windows: from the CIM process list).
async function listBackground(since:number){
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const script="Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'setInterval' } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;started=$_.CreationDate.ToUniversalTime().ToString('o')} } | ConvertTo-Json -Compress";
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
  const rows=stdout.trim()?JSON.parse(stdout) as {pid:number;started:string}|Array<{pid:number;started:string}>:[];
  return (Array.isArray(rows)?rows:[rows]).filter(r=>Date.parse(r.started)>=since-1000).map(r=>r.pid);
}

const shared=installedDataRoot(resolve('.'));process.env.AVA_GATEWAY_KEY_DIR??=shared;
console.log(JSON.stringify({providers,ceilingPerProvider:PER_PROVIDER,ceiling:PER_PROVIDER*providers.length}));
const results:Array<Record<string,unknown>>=[];let failed=false;
for(const provider of providers){
  if(failed){results.push({provider,status:'not run'});continue;}
  const root=mkdtempSync(join(tmpdir(),`ava-x3-${provider}-`));
  if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(root,'providers.json'));
  const factory=new NativeFactory(root,loadProviderSetups(root));let requests=0;
  const open=factory.open.bind(factory);
  factory.open=async(...params:Parameters<typeof factory.open>)=>{const p=await open(...params),request=p.request.bind(p);p.request=input=>{if(requests>=PER_PROVIDER)throw new Error('Request ceiling reached');requests++;return request(input);};return p;};
  const service=new AvAService(root,factory,'live'),call=<T=unknown>(m:string,p:unknown)=>service.call(m,p) as Promise<T>;
  const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[],check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} [${provider}] ${name}${pass||detail===undefined?'':` — ${JSON.stringify(detail).slice(0,300)}`}`);};
  const scope=(pair:Pair,seat:Seat)=>`${pair.id}/${seat}/${service.store.pair(pair.id).slots[seat].generation}/`;
  const members=new Set<number>();
  const pairWith=async(thread:string,bypass:boolean)=>{
    const pair=await call<Pair>('pair.create',{thread});
    for(const seat of SEATS){await call('slot.configure',{pairId:pair.id,seat,config:LIVE_CONFIGS[provider]});if(bypass)await call('slot.permissions',{pairId:pair.id,seat,level:'bypass'});}
    const evidence:string[]=[];for(const seat of SEATS)evidence.push((await call<{evidence:string}>('slot.activate',{pairId:pair.id,seat})).evidence);
    return {pair,evidence};
  };
  const started=Date.now();
  try{
    // 1. Activation, contained.
    const {pair,evidence}=await pairWith(`x3-${provider}-cancel`,false);
    check('both agents activate in Windows job objects',evidence.every(e=>/contained in a Windows job object/.test(e)),evidence);
    for(const seat of SEATS){
      const own=service.store.seatProcesses(pair.id,seat,service.store.pair(pair.id).slots[seat].generation).map(p=>p.pid),job=await service.jobs!.scopeMembers(scope(pair,seat));
      job.forEach(pid=>members.add(pid));
      check(`${seat}: the launcher and the agent it started are job members (${job.length} processes)`,own.every(pid=>job.includes(pid))&&job.length>=2,{own,job});
    }
    // 2. Cancellation mid-answer.
    let run=await call<Run>('run.start',{pairId:pair.id,text:'Write a detailed essay of about 1500 words on the history of tea. Do not use any tools.',requestId:randomUUID(),options:{mode:'benchmark',durationMs:600000}});
    await until(()=>service.store.db.prepare("SELECT COUNT(*) AS n FROM turns WHERE run_id=? AND status='submitted'").get(run.id)!.n===2,120000,'both answers to start');
    await sleep(4000);
    await call('run.control',{runId:run.id,action:'stop',requestId:randomUUID()});
    run=await until(()=>{const r=service.store.run(run.id);return ['stopped','completed','needs_attention'].includes(r.status)?r:undefined;},120000,'the run to stop');
    const view=await call<{connected:Record<Seat,boolean>}>('pair.get',{pairId:pair.id});
    check('a run stopped mid-answer ends stopped, and both agents stay connected',run.status==='stopped'&&view.connected.cli1&&view.connected.cli2,{status:run.status,reason:run.reason,connected:view.connected});
    // 3. Build cleanup under Bypass. The jobs are sampled during the run, so it shows whether the background processes
    //    were ever members; afterwards, any background process still running is reported and stopped.
    const build=await pairWith(`x3-${provider}-build`,true);
    check('both Build agents (Bypass) activate in Windows job objects',build.evidence.every(e=>/contained in a Windows job object/.test(e)),build.evidence);
    for(const seat of SEATS)(await service.jobs!.scopeMembers(scope(build.pair,seat))).forEach(pid=>members.add(pid));
    let built=await call<Run>('run.start',{pairId:build.pair.id,text:BUILD_PROMPT,requestId:randomUUID(),options:{mode:'build',durationMs:900000},build:{kind:'build'}});
    const since=Date.parse(built.createdAt!),seen=new Set<number>(),trace=new Map<number,{name:string;ppid:number;member:boolean}>();
    built=await until(async()=>{
      for(const seat of SEATS)(await service.jobs!.scopeMembers(scope(build.pair,seat)).catch(()=>[] as number[])).forEach(pid=>seen.add(pid));
      // Every process started during the run, with its parent and whether a job holds it, while it is still visible.
      if(args.includes('--trace'))for(const p of await listProcesses().catch(()=>[]))if(p.started>=since-1000&&!trace.has(p.pid))trace.set(p.pid,{name:p.name,ppid:p.ppid,member:seen.has(p.pid)});
      const r=service.store.run(built.id);return ['stopped','completed','needs_attention'].includes(r.status)?r:undefined;
    },960000,'the Build run to end');
    if(trace.size){for(const [pid,t] of trace)t.member||=seen.has(pid);console.log(JSON.stringify({trace:[...trace].map(([pid,t])=>({pid,...t,parent:trace.get(t.ppid)?.name}))}));}
    check('the Build run completes',built.status==='completed'&&built.reason==='build_done',{status:built.status,reason:built.reason});
    await sleep(1500);
    const cleanup=service.store.db.prepare("SELECT data FROM events WHERE run_id=? AND type='build_cleanup'").all(built.id).map(r=>JSON.parse(String(r.data)) as {seat:Seat;stopped:Array<{pid:number;name:string}>});
    const stoppedNode=cleanup.flatMap(c=>c.stopped.filter(p=>/node/i.test(p.name)).map(p=>({seat:c.seat,...p})));
    // Background processes the agents started: node -e "setInterval(...)" started during the run, wherever they are.
    const background=(await listBackground(since)).map(pid=>({pid,member:seen.has(pid),alive:alive(pid)}));
    seen.forEach(pid=>members.add(pid));
    check(`Build cleanup stopped the background process${stoppedNode.length===1?'':'es'} the agents left (${stoppedNode.length} stopped, ${background.length} still found)`,stoppedNode.length>=1&&stoppedNode.every(p=>!alive(p.pid))&&!background.some(b=>b.alive),{stoppedNode,background});
    for(const b of background)if(b.alive)try{process.kill(b.pid);}catch{/* gone */}
    // 4. Stop all: nothing from the agents' jobs keeps running.
    const stopped=await call<{status:string}>('resources.stop',{requestId:randomUUID()});
    await sleep(2000);
    const survivors=[...members].filter(alive);
    check('after Stop all, nothing that was in the agents\' jobs is still running',stopped.status==='stopped'&&!survivors.length,{status:stopped.status,survivors});
  }catch(error){check('the provider run completes',false,error instanceof Error?error.message:String(error));}
  finally{await service.shutdown().catch(()=>{});service.store.close();}
  const status=checks.every(c=>c.pass)?'passed':'failed';failed||=status!=='passed';
  results.push({provider,model:LIVE_CONFIGS[provider].model,status,requests,minutes:Math.round((Date.now()-started)/6000)/10,checks});
  console.log(JSON.stringify({provider,status,requests,minutes:Math.round((Date.now()-started)/6000)/10}));
}
const status=results.every(r=>r.status==='passed')?'passed':'failed';
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify({status,recordedAt:new Date().toISOString(),results},null,2).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]')+'\n');
console.log(JSON.stringify({status,out}));process.exit(status==='passed'?0:1);
