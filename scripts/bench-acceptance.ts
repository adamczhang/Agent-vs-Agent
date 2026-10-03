// B3 acceptance: three tasks, one fresh Codex/Claude pair per task, capped at 12 participant requests.
import { mkdtempSync,existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { AvAService,type ServiceFactory } from '../src/service.js';
import { NativeFactory,loadProviderSetups } from '../src/providers.js';
import { BenchmarkFactory } from '../test/bench-fakes.js';
import type { BenchJob } from '../src/bench-runner.js';
import type { ProviderConfig } from '../src/types.js';

const args=process.argv.slice(2),live=args.includes('--live'),at=args.indexOf('--out');
const out=resolve(at>=0?args[at+1]!:`pilot-evidence/stage-d/b3-benchmark-${live?'live':'mock'}.json`);
if(existsSync(out))throw new Error('Choose a new evidence filename; the previous batch must be preserved.');
const data=mkdtempSync(join(tmpdir(),'ava-b3-acceptance-')),ceiling=12;
let requests=0;
const factory:ServiceFactory=live?new NativeFactory(data,loadProviderSetups(data)):new BenchmarkFactory(data);
const open=factory.open.bind(factory);
factory.open=async(...params:Parameters<typeof factory.open>)=>{const participant=await open(...params),request=participant.request.bind(participant);participant.request=input=>{if(requests>=ceiling)throw new Error('Acceptance request ceiling reached');requests++;return request(input);};return participant;};
const service=new AvAService(data,factory,live?'live':'simulation');
const configs:Record<'cli1'|'cli2',ProviderConfig>={cli1:{provider:'codex',model:live?'gpt-6-luna':'fixture',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},cli2:{provider:'claude',model:live?'haiku':'fixture',auth:'provider-login'}};
console.log(JSON.stringify({mode:live?'live':'mock',ceiling,agents:configs}));
let job:BenchJob|undefined;
try{
  await service.call('bench.validate',{taskIds:['invoice-total','tip-calculator','discount-review']});
  job=await service.call('bench.start',{taskIds:['invoice-total','tip-calculator','discount-review'],agents:configs,repeats:1,stopOnFailure:true,requestId:'acceptance'}) as BenchJob;
  let previous='';
  while(['queued','running'].includes(job.status)){
    const state=JSON.stringify({jobId:job.id,status:job.status,task:job.current?.taskId,finished:job.results.length,requests});if(state!==previous){console.log(state);previous=state;}
    await new Promise(r=>setTimeout(r,500));job=service.benchmarks.get(job.id);
  }
  const passed=job.status==='completed'&&job.results.length===6&&job.results.every(r=>r.status==='pass');
  const checks=job.results.map(r=>{const result=service.benchmarks.attempt(r.id);return {task:r.taskId,seat:r.seat,model:result.agent.model,status:r.status,checks:result.checks,error:result.error};});
  const evidence={status:passed?'passed':'failed',mode:live?'live':'mock',recordedAt:new Date().toISOString(),ceiling,requests,dataRoot:data,jobId:job.id,jobStatus:job.status,error:job.error,checks};
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(evidence,null,2).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]')+'\n');
  console.log(JSON.stringify({status:evidence.status,requests,attempts:job.results.length,jobStatus:job.status,error:job.error}));if(!passed)process.exitCode=1;
}finally{await service.shutdown();service.store.close();}
