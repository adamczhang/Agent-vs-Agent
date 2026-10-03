// Benchmark acceptance (B3, X1): starter tasks, one fresh Codex/Claude pair per task, capped at 4 participant requests
// per task (2 activations and 2 answers).
// Usage: node --import tsx scripts/bench-acceptance.ts [--live] [--suite <folder>] [--tasks id,id|all] [--keep-going] [--judge <provider>]
//        [--codex-model m] [--claude-model m] [--out <new.json>]
// --keep-going scores a whole suite: a failed check is a result, not a stop; the run fails only on errors.
import { mkdtempSync,existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { AvAService,type ServiceFactory } from '../src/service.js';
import { NativeFactory,loadProviderSetups } from '../src/providers.js';
import { BenchmarkFactory } from '../test/bench-fakes.js';
import type { BenchJob } from '../src/bench-runner.js';
import { loadSuite } from '../src/bench-tasks.js';
import { LIVE_CONFIGS } from './live-configs.js';
import { installedDataRoot } from '../src/paths.js';
import type { ProviderConfig } from '../src/types.js';

const args=process.argv.slice(2),live=args.includes('--live'),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const out=resolve(option('--out')??`pilot-evidence/stage-d/b3-benchmark-${live?'live':'mock'}.json`);
if(existsSync(out))throw new Error('Choose a new evidence filename; the previous batch must be preserved.');
const suite=option('--suite')?resolve(option('--suite')!):undefined,keepGoing=args.includes('--keep-going');
// --judge <provider>: a third agent (its live-configs.ts settings) scores attempts at tasks with a rubric.
const judge=option('--judge')?LIVE_CONFIGS[option('--judge') as keyof typeof LIVE_CONFIGS]:undefined;if(option('--judge')&&!judge)throw new Error('Unknown --judge provider.');
// A Gateway judge uses the key stored in the shared folder (read from there; it never enters this process's environment).
if(judge?.provider==='vercel')process.env.AVA_GATEWAY_KEY_DIR??=installedDataRoot(resolve('.'));
const tasks=option('--tasks')==='all'?loadSuite(suite??resolve('benchmarks/starter')).map(t=>t.spec.id):(option('--tasks')??'invoice-total,tip-calculator,discount-review').split(',');
const data=mkdtempSync(join(tmpdir(),'ava-b3-acceptance-')),ceiling=tasks.length*4+(judge?tasks.length*2+1:0);
let requests=0;
const factory:ServiceFactory=live?new NativeFactory(data,loadProviderSetups(data)):new BenchmarkFactory(data);
const open=factory.open.bind(factory);
factory.open=async(...params:Parameters<typeof factory.open>)=>{const participant=await open(...params),request=participant.request.bind(participant);participant.request=input=>{if(requests>=ceiling)throw new Error('Acceptance request ceiling reached');requests++;return request(input);};return participant;};
const service=new AvAService(data,factory,live?'live':'simulation');
const configs:Record<'cli1'|'cli2',ProviderConfig>={cli1:{provider:'codex',model:live?option('--codex-model')??'gpt-6-luna':'fixture',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},cli2:{provider:'claude',model:live?option('--claude-model')??'haiku':'fixture',auth:'provider-login'}};
console.log(JSON.stringify({mode:live?'live':'mock',tasks,ceiling,agents:configs}));
let job:BenchJob|undefined;
try{
  await service.call('bench.validate',{taskIds:tasks,...(suite?{suite}:{})});
  job=await service.call('bench.start',{taskIds:tasks,...(suite?{suite}:{}),agents:configs,...(judge?{judge}:{}),repeats:1,stopOnFailure:!keepGoing,requestId:'acceptance'}) as BenchJob;
  let previous='';
  while(['queued','running'].includes(job.status)){
    const state=JSON.stringify({jobId:job.id,status:job.status,task:job.current?.taskId,finished:job.results.length,requests});if(state!==previous){console.log(state);previous=state;}
    await new Promise(r=>setTimeout(r,500));job=service.benchmarks.get(job.id);
  }
  const passed=job.status==='completed'&&job.results.length===tasks.length*2&&job.results.every(r=>r.status==='pass'||keepGoing&&r.status==='fail');
  const checks=job.results.map(r=>{const result=service.benchmarks.attempt(r.id);return {task:r.taskId,seat:r.seat,model:result.agent.model,status:r.status,checks:result.checks,error:result.error,...(result.rubric?{rubric:{judge:`${result.rubric.judge.provider}:${result.rubric.judge.model}`,score:result.rubric.score,reason:result.rubric.reason,error:result.rubric.error}}:{})};});
  const scores=Object.fromEntries((['cli1','cli2'] as const).map(seat=>{const mine=job!.results.filter(r=>r.seat===seat);return [seat,{model:configs[seat].model,passed:mine.filter(r=>r.status==='pass').length,attempts:mine.length,failed:mine.filter(r=>r.status!=='pass').map(r=>r.taskId)}];}));
  if(keepGoing)console.log(JSON.stringify({scores}));
  const evidence={status:passed?'passed':'failed',mode:live?'live':'mock',recordedAt:new Date().toISOString(),ceiling,requests,dataRoot:data,jobId:job.id,jobStatus:job.status,error:job.error,scores,checks};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(evidence,null,2).replace(/(?<!sha256:)\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]')+'\n');
  console.log(JSON.stringify({status:evidence.status,requests,attempts:job.results.length,jobStatus:job.status,error:job.error}));if(!passed)process.exitCode=1;
}finally{await service.shutdown();service.store.close();}
