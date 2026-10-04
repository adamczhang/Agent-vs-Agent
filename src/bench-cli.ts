import { randomUUID } from 'node:crypto';
import { existsSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultDataRoot,projectRoot } from './paths.js';
import { ensureService,callEndpoint } from './connection.js';
import { loadSuite } from './bench-tasks.js';
import { exerciseFolders,importJsonl,readExercism,writeTasks } from './bench-import.js';
import { validateTask } from './bench-validation.js';
import { PROVIDERS,type ProviderConfig } from './types.js';
import { requestCeiling,type BenchJob } from './bench-runner.js';

const help='Usage: npm run bench -- import <exercise-folder|file.jsonl> --format exercism|jsonl --out <new-suite-folder> | validate <suite> | run <suite> --agents codex:model,claude:model [--repeat 1] [--task id,id] [--stop-on-failure] [--judge provider:model] | jobs | status <job-id> | cancel <job-id> | results | export json|csv --out <new-file> | report <job-id> --format html|md --out <new-file>. Results/exports accept --suite, --task, --provider, --model, --from, --to, --source all|only|exclude, --job. Add --data <folder> to use an isolated pool.';
async function main(){
  if(process.env.AVA_PARTICIPANT==='1')throw new Error('AvA participants cannot control benchmarks.');
  const {positionals,values}=parseArgs({allowPositionals:true,options:{data:{type:'string'},agents:{type:'string'},repeat:{type:'string'},task:{type:'string'},'request-id':{type:'string'},'stop-on-failure':{type:'boolean'},out:{type:'string'},suite:{type:'string'},provider:{type:'string'},model:{type:'string'},from:{type:'string'},to:{type:'string'},source:{type:'string'},job:{type:'string'},format:{type:'string'},judge:{type:'string'}}});
  const [command,target]=positionals;if(!command||positionals.length>2)throw new Error(help);
  const data=values.data?resolve(values.data):defaultDataRoot();
  // Import common formats into a new suite folder (no service needed): an Exercism exercise or a folder of them, or a
  // JSON Lines file of prompt-plus-tests tasks. Imported tasks run their verifiers in Docker.
  if(command==='import'){
    if(!target||!values.out||!['exercism','jsonl'].includes(values.format??''))throw new Error(help);
    const suite=resolve(values.out);
    const exercises=values.format==='jsonl'?[]:existsSync(join(resolve(target),'.meta','config.json'))?[resolve(target)]:exerciseFolders(target);
    if(values.format!=='jsonl'&&!exercises.length)throw new Error('No Exercism exercises found there.');
    // A folder of exercises is read in full before anything is written, like a JSON Lines file.
    const ids=values.format==='jsonl'?importJsonl(target,suite):writeTasks(suite,exercises.map(readExercism));
    console.log(JSON.stringify({imported:ids.length,suite,tasks:ids,next:`npm run bench -- validate ${suite}`}));return;
  }
  if(command==='validate'){
    if(!target)throw new Error(help);
    for(const task of loadSuite(resolve(target))){const result=await validateTask(task,data);console.log(JSON.stringify({task:task.spec.id,version:task.spec.version,validated:result.validated,oraclePassed:result.oracle.every(c=>c.passed),emptyRejected:result.empty.some(c=>!c.passed)}));if(!result.validated){process.exitCode=1;break;}}return;
  }
  if(!['run','jobs','status','cancel','results','export','report'].includes(command))throw new Error(help);
  const address=await ensureService(projectRoot,data);
  const health=await callEndpoint<{mode:string;capabilities?:{benchmarks?:boolean;benchmarkResults?:boolean}}>(address,'health',{});
  if(!health.capabilities?.benchmarks)throw new Error('The running AvA service does not support benchmarks. Use the new build with --data <isolated-folder>, or update both plugins and restart their service.');
  if(command==='results'||command==='export'){
    if(!health.capabilities?.benchmarkResults)throw new Error('The running AvA service does not support benchmark results. Use the new build with --data <isolated-folder>, or update the plugins and restart their service.');
    if(values.task?.includes(','))throw new Error('Filter results by one task ID at a time.');
    const filters={simulation:values.source??(health.mode==='simulation'?'only':'exclude'),...(values.suite?{suite:resolve(values.suite)}:{}),...(values.task?{taskId:values.task}:{}),...(values.provider?{provider:values.provider}:{}),...(values.model?{model:values.model}:{}),...(values.from?{from:values.from}:{}),...(values.to?{to:values.to}:{}),...(values.job?{jobId:values.job}:{})};
    if(command==='results'){console.log(JSON.stringify(await callEndpoint(address,'bench.results',{filters,limit:50})));return;}
    if(!values.out||!['json','csv'].includes(target??''))throw new Error(help);
    const result=await callEndpoint<{text:string;count:number}>(address,'bench.export',{filters,format:target});
    const path=resolve(values.out);writeFileSync(path,result.text,{flag:'wx',mode:0o600});console.log(JSON.stringify({exported:result.count,format:target,path}));return;
  }
  // A shareable report of one job (HTML or Markdown), written to a new file.
  if(command==='report'){
    if(!target||!values.out||!['html','md'].includes(values.format??''))throw new Error(help);
    if(!(health.capabilities as {benchmarkReports?:boolean}|undefined)?.benchmarkReports)throw new Error('The running AvA service does not make benchmark reports. Use the new build with --data <isolated-folder>, or update the plugins and restart their service.');
    const report=await callEndpoint<{text:string;filename:string}>(address,'bench.report',{jobId:target,format:values.format});
    const path=resolve(values.out);writeFileSync(path,report.text,{flag:'wx',mode:0o600});console.log(JSON.stringify({report:path,format:values.format}));return;
  }
  if(command==='jobs'){const {jobs}=await callEndpoint<{jobs:BenchJob[]}>(address,'bench.jobs',{});console.log(JSON.stringify(jobs.map(j=>({id:j.id,status:j.status,attempts:j.results.length,total:j.totalAttempts,createdAt:j.createdAt}))));return;}
  if(command==='status'){if(!target)throw new Error(help);console.log(JSON.stringify(await callEndpoint(address,'bench.get',{jobId:target})));return;}
  if(command==='cancel'){if(!target)throw new Error(help);console.log(JSON.stringify(await callEndpoint(address,'bench.cancel',{jobId:target,requestId:values['request-id']??randomUUID()})));return;}
  if(!target||!values.agents)throw new Error(help);
  const configs=values.agents.split(',').map(selector=>{const at=selector.indexOf(':'),provider=selector.slice(0,at),model=selector.slice(at+1);if(at<1||!model||!PROVIDERS.includes(provider as ProviderConfig['provider']))throw new Error('Name each agent as provider:model.');return {provider:provider as ProviderConfig['provider'],model,auth:provider==='vercel'?'api':'provider-login'} as ProviderConfig;});
  if(configs.length!==2)throw new Error('Exactly two agents are required.');
  const repeats=Number(values.repeat??1);if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('Repeat must be 1–10.');
  const suite=resolve(target),catalog=await callEndpoint<{tasks:Array<{id:string;rubric?:boolean}>}>(address,'bench.catalog',{suite});
  const taskIds=values.task?.split(',')??catalog.tasks.map(t=>t.id),requestId=values['request-id']??randomUUID();
  // --judge provider:model: a third agent scores attempts at tasks with a rubric, apart from their checks.
  const judge=values.judge?(()=>{const at=values.judge.indexOf(':'),provider=values.judge.slice(0,at),model=values.judge.slice(at+1);if(at<1||!model||!PROVIDERS.includes(provider as ProviderConfig['provider']))throw new Error('Name the judge as provider:model.');return {provider:provider as ProviderConfig['provider'],model,auth:provider==='vercel'?'api':'provider-login'} as ProviderConfig;})():undefined;
  // The ceiling is logged before anything starts, the judge's requests included (the service enforces the same one).
  const chosen=taskIds.map(id=>({rubric:!!catalog.tasks.find(t=>t.id===id)?.rubric}));
  console.log(JSON.stringify({requestId,requestCeiling:requestCeiling(chosen,repeats,!!judge),includes:`two activations and two task requests per task/repetition${judge?', and a fresh judge session (access check and judgment) per attempt at a rubric task':''}`}));
  const started=await callEndpoint<BenchJob>(address,'bench.start',{suite,taskIds,repeats,stopOnFailure:values['stop-on-failure']??false,agents:{cli1:configs[0],cli2:configs[1]},...(judge?{judge}:{}),requestId});
  let previous='';
  for(;;){const job=await callEndpoint<BenchJob>(address,'bench.get',{jobId:started.id});const progress=JSON.stringify({jobId:job.id,status:job.status,completed:job.results.length,total:job.totalAttempts,task:job.current?.taskId,repeat:job.current?.repeat,error:job.error});if(progress!==previous){console.log(progress);previous=progress;}
    if(!['queued','running'].includes(job.status)){console.log(JSON.stringify({jobId:job.id,passed:job.results.filter(r=>r.status==='pass').length,failed:job.results.filter(r=>r.status!=='pass').length,status:job.status}));if(job.status!=='completed'||job.results.some(r=>r.status!=='pass'))process.exitCode=1;return;}
    await new Promise(r=>setTimeout(r,1000));
  }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
