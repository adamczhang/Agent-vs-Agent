import { randomUUID } from 'node:crypto';
import { existsSync,lstatSync,mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename,dirname,join,resolve } from 'node:path';
import type { AvAService } from './service.js';
import { AvAError,SEATS,type Pair,type ProviderConfig,type Run,type Seat } from './types.js';
import { projectRoot,packageVersion } from './paths.js';
import { loadSuite,putFiles,suiteStamp,treeFiles,type BenchTask } from './bench-tasks.js';
// Folders of installed packages and caches, which an attempt's checks don't need.
const CANDIDATE_SKIP=new Set(['node_modules','.venv','venv','__pycache__','.pytest_cache']);
import { validateTask,validated } from './bench-validation.js';
import { checkTask,containerBackend,needsContainer,verifierGuardAvailable,type CheckResult } from './bench-checks.js';
import type { ContainerStatus } from './containers.js';
import type { RunStats,TokenStat } from './stats.js';
import { participantWorkspace } from './workspace.js';

// judge: a third agent that scores attempts at tasks with a rubric (roadmap B7). Its score is saved apart from the
// deterministic checks and never changes an attempt's status.
export interface BenchInput {suite?:string;taskIds:string[];repeats:number;agents:Record<Seat,ProviderConfig>;stopOnFailure:boolean;judge?:ProviderConfig}
export interface RubricScore {judge:ProviderConfig;score:number|null;reason?:string;error?:string}
export interface AttemptSummary {id:string;taskId:string;repeat:number;seat:Seat;status:BenchAttempt['status']}
export interface BenchAttempt {id:string;jobId:string;taskId:string;taskVersion:number;digest:string;title:string;suite:string;taskMode:BenchTask['spec']['mode'];prompt:string;checkSpecs:BenchTask['spec']['checks'];repeat:number;seat:Seat;agent:ProviderConfig;status:'pass'|'fail'|'error'|'cancelled'|'interrupted';createdAt:string;finishedAt:string;version:string;simulation:boolean;answer:string;checks:CheckResult[];runId?:string;durationMs:number|null;inputTokens:number|null;outputTokens:number|null;tokenSource:TokenStat['tokenSource'];artifact?:string;error?:string;rubric?:RubricScore}
export interface BenchJob {id:string;createdAt:string;updatedAt:string;status:'queued'|'running'|'completed'|'failed'|'cancelled'|'interrupted';input:BenchInput;requestCeiling:number;requestsAdmitted:number;totalAttempts:number;results:AttemptSummary[];current?:{taskId:string;repeat:number;pairId?:string;runId?:string;pending:BenchAttempt[]};error?:string}
const safeError=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]').slice(0,2000);
// The judge sees the task, the rubric and the attempt (its answer, and for Build tasks its source files, not the hidden
// tests), and answers with a score from 0 to 10 and a short reason.
export function judgePrompt(task:BenchTask,answer:string,files:string){
  return ['You are grading one attempt at a benchmark task against a rubric. Grade only what the rubric asks; correctness is checked separately. Do not use tools.',
    '','Task:',task.spec.prompt.trim(),'','Rubric:',task.spec.rubric!.trim(),'','The attempt\'s final answer:',answer.trim()||'(empty)',...(files?['','The attempt\'s files:',files]:[]),
    '','Reply with only a JSON object, with no Markdown fences: {"score": <integer from 0 to 10>, "reason": "<one or two sentences>"}'].join('\n');
}
// The JSON objects in a reply, outermost first: each balanced {...} (braces inside strings don't count) that parses.
// Prose around the object, braces in it included, is ignored.
function jsonObjects(text:string){
  const found:unknown[]=[];
  for(let start=text.indexOf('{');start>=0&&start<text.length;start=text.indexOf('{',start+1)){
    let depth=0,inString=false,escaped=false,end=-1;
    for(let i=start;i<text.length&&end<0;i++){
      const c=text[i];
      if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}
      else if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)end=i;
    }
    if(end<0)continue;
    try{found.push(JSON.parse(text.slice(start,end+1)));start=end;}catch{/* not JSON from here: try the next brace */}
  }
  return found;
}
export function parseJudgment(text:string):Omit<RubricScore,'judge'>{
  // The last object with a score is the answer (a judge may quote other JSON before it).
  const value=jsonObjects(text.slice(0,20000)).filter((v):v is {score?:unknown;reason?:unknown}=>!!v&&typeof v==='object'&&'score'in v).at(-1);
  if(!value)return {score:null,error:'The judge did not answer with JSON.'};
  if(typeof value.score!=='number'||!Number.isInteger(value.score)||value.score<0||value.score>10)return {score:null,error:'The judge did not give a whole score from 0 to 10.'};
  return {score:value.score,reason:String(value.reason??'').slice(0,1000)};
}
// The most participant requests a job may make: for each task and repeat, two activations and two answers; with a
// judge, for each attempt at a task with a rubric, a fresh judge session's access check and the judgment.
export function requestCeiling(tasks:Array<{spec:{rubric?:string}}|{rubric:boolean}>,repeats:number,judge:boolean){
  const rubrics=judge?tasks.filter(t=>'spec'in t?!!t.spec.rubric:t.rubric).length:0;
  return tasks.length*repeats*4+rubrics*repeats*2*2;
}
// A Build attempt's own files for the judge: no hidden tests or package file, at most 24 KB in all.
function candidateFiles(artifact:string){
  let text='',size=0;
  for(const file of treeFiles(artifact).filter(f=>!f.path.startsWith('tests/')&&f.path!=='package.json'&&!f.path.includes('node_modules/')).slice(0,20)){
    const chunk=`--- ${file.path} ---\n${file.bytes.toString('utf8').slice(0,8000)}\n`;if(size+chunk.length>24000)break;text+=chunk;size+=chunk.length;
  }
  return text;
}
export class BenchmarkRunner {
  private live=new Map<string,{abort:AbortController;done:Promise<void>}>();
  constructor(private service:AvAService){
    for(const row of this.service.store.db.prepare("SELECT data FROM bench_jobs WHERE json_extract(data,'$.status') IN ('queued','running')").all()){
      const job=JSON.parse(String(row.data)) as BenchJob;
      job.status='interrupted';job.error='The service restarted. Uncertain benchmark work was not resent.';
      for(const pending of job.current?.pending??[])if(!job.results.some(r=>r.id===pending.id))this.record(job,{...pending,status:'interrupted',finishedAt:new Date().toISOString(),error:job.error});
      this.save(job);
    }
  }
  get busy(){return this.live.size>0;}
  // The Benchmarks panel asks for the catalog every 2 s: a suite is loaded again (every file read and hashed) only when
  // its files' names, sizes or times changed (Q6).
  private loaded=new Map<string,{stamp:string;tasks:BenchTask[]}>();
  suite(path?:string){
    const root=path?resolve(path):join(projectRoot,'benchmarks','starter'),stamp=suiteStamp(root),cached=this.loaded.get(root);
    if(stamp&&cached?.stamp===stamp)return cached.tasks;
    const tasks=loadSuite(root);if(stamp)this.loaded.set(root,{stamp,tasks});return tasks;
  }
  // Live program verifiers run under the verifier guard (bench-checks.ts), which needs a Node that can deny network
  // access. Tasks must also be validated, which is the user's decision to run their verifiers on this machine. A task
  // marked for container isolation needs Docker instead (src/containers.ts); its status is checked when a job starts
  // and shown from the last check, at most 30 seconds old, in the catalog.
  // One check at a time: callers while a check runs share it (Docker can take seconds to answer, or time out).
  private container?:{at:number;status:ContainerStatus};private checking?:Promise<ContainerStatus>;
  private async containerStatus(maxAgeMs=30000){
    if(this.container&&Date.now()-this.container.at<=maxAgeMs)return this.container.status;
    return this.checking??=containerBackend.status().then(status=>{this.container={at:Date.now(),status};return status;}).finally(()=>{this.checking=undefined;});
  }
  private blocked(task:BenchTask){
    if(!task.spec.checks.some(c=>'run'in c))return '';
    if(needsContainer(task)){const status=this.container?.status;return status&&!status.available?`Needs container isolation. ${status.reason}`:'';}
    return this.service.mode!=='simulation'&&!verifierGuardAvailable()?`Live program verifiers need an execution sandbox: Node's permission model with network control (--allow-net), which Node ${process.versions.node} lacks. Offline mock runs remain available.`:'';
  }
  catalog(path?:string){
    const tasks=this.suite(path);
    if(tasks.some(needsContainer))void this.containerStatus().catch(()=>{});
    return tasks.map(t=>({id:t.spec.id,title:t.spec.title??t.spec.id,mode:t.spec.mode,version:t.spec.version,digest:t.digest,prompt:t.spec.prompt,checks:t.spec.checks.length,minutes:t.spec.time_limit_minutes,validated:!!validated(this.service.dataRoot,t),blockedReason:this.blocked(t),isolation:t.spec.isolation??null,rubric:!!t.spec.rubric}));
  }
  async validate(ids:string[],path?:string){const tasks=this.select(ids,path);const results=[];for(const task of tasks)results.push(await validateTask(task,this.service.dataRoot));return results;}
  private select(ids:string[],path?:string){const suite=this.suite(path);const tasks=ids.map(id=>suite.find(t=>t.spec.id===id));if(tasks.some(t=>!t)||new Set(ids).size!==ids.length)throw new AvAError('BENCH_TASK','Select distinct tasks from the suite.');return tasks as BenchTask[];}
  jobs(){return this.service.store.db.prepare('SELECT data FROM bench_jobs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.data)) as BenchJob);}
  get(id:string){const row=this.service.store.db.prepare('SELECT data FROM bench_jobs WHERE id=?').get(id);if(!row)throw new AvAError('NOT_FOUND','Benchmark job not found.');return JSON.parse(String(row.data)) as BenchJob;}
  attempt(id:string){const row=this.service.store.db.prepare('SELECT data FROM bench_attempts WHERE id=?').get(id);if(!row)throw new AvAError('NOT_FOUND','Benchmark attempt not found.');return JSON.parse(String(row.data)) as BenchAttempt;}
  attemptsOf(jobId:string){return this.service.store.db.prepare('SELECT data FROM bench_attempts WHERE job_id=? ORDER BY rowid').all(jobId).map(r=>JSON.parse(String(r.data)) as BenchAttempt);}
  private save(job:BenchJob){job.updatedAt=new Date().toISOString();this.service.store.db.prepare('UPDATE bench_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);}
  private record(job:BenchJob,attempt:BenchAttempt){
    if(job.results.some(r=>r.id===attempt.id))return;
    this.service.store.transaction(()=>{
      this.service.store.db.prepare('INSERT INTO bench_attempts VALUES(?,?,?,?,?,?,?,?,?,?)').run(attempt.id,job.id,attempt.taskId,attempt.taskVersion,attempt.digest,attempt.agent.provider,attempt.agent.model,attempt.status,attempt.createdAt,JSON.stringify(attempt));
      job.results.push({id:attempt.id,taskId:attempt.taskId,repeat:attempt.repeat,seat:attempt.seat,status:attempt.status});this.save(job);
    });
  }
  async start(input:BenchInput){
    const tasks=this.select(input.taskIds,input.suite);
    // Container tasks need Docker now, before any agent starts: checked fresh, never assumed from the catalog.
    const containerTasks=tasks.filter(t=>needsContainer(t)&&t.spec.checks.some(c=>'run'in c));
    if(containerTasks.length){const status=await this.containerStatus(0);if(!status.available)throw new AvAError('BENCH_CONTAINER_UNAVAILABLE',`${containerTasks[0]!.spec.id}: needs container isolation. ${status.reason}`);}
    if(this.busy||this.service.puzzles?.busy||this.service.series?.busy)throw new AvAError('BENCH_BUSY','A benchmark job is already running in this pool.');
    const needed=input.judge?3:2;
    if(this.service.resources.limit&&this.service.resources.active().length+needed>this.service.resources.limit)throw new AvAError('BENCH_CAPACITY',`Benchmarks need ${needed===3?'three':'two'} free agent slots. Stop agents or raise the limit in Resources.`);
    // A trusted verifier imports untrusted candidate code: it runs only under the verifier guard.
    for(const task of tasks)if(this.blocked(task))throw new AvAError('BENCH_SANDBOX_REQUIRED',`${task.spec.id}: ${this.blocked(task)}`);
    for(const task of tasks)if(!validated(this.service.dataRoot,task))throw new AvAError('BENCH_NOT_VALIDATED',`${task.spec.id} needs validation for its current contents.`);
    input={...input,suite:resolve(input.suite??join(projectRoot,'benchmarks','starter'))};
    const job:BenchJob={id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'queued',input,requestCeiling:requestCeiling(tasks,input.repeats,!!input.judge),requestsAdmitted:0,totalAttempts:tasks.length*input.repeats*2,results:[]};
    this.service.store.db.prepare('INSERT INTO bench_jobs VALUES(?,?)').run(job.id,JSON.stringify(job));
    const abort=new AbortController(),done=Promise.resolve().then(()=>this.drive(job,tasks,abort.signal)).finally(()=>this.live.delete(job.id));
    this.live.set(job.id,{abort,done});void done.catch(()=>{});return this.get(job.id);
  }
  cancel(id:string){const live=this.live.get(id);live?.abort.abort(new AvAError('CANCELLED','Benchmark cancelled.'));const job=this.get(id);if(job.current?.runId)this.service.engine.stop(job.current.runId);if(job.current?.pairId)for(const seat of SEATS)this.service.activation.cancel(job.current.pairId,seat);return {id,status:live?'cancelling':job.status};}
  cancelAll(){for(const id of this.live.keys())this.cancel(id);}
  async shutdown(){this.cancelAll();await Promise.allSettled([...this.live.values()].map(v=>v.done));}
  private blank(job:BenchJob,task:BenchTask,repeat:number,seat:Seat):BenchAttempt{return {id:randomUUID(),jobId:job.id,taskId:task.spec.id,taskVersion:task.spec.version,digest:task.digest,title:task.spec.title??task.spec.id,suite:job.input.suite!,taskMode:task.spec.mode,prompt:task.spec.prompt,checkSpecs:task.spec.checks,repeat,seat,agent:job.input.agents[seat],status:'error',createdAt:new Date().toISOString(),finishedAt:'',version:packageVersion,simulation:this.service.mode==='simulation',answer:'',checks:[],durationMs:null,inputTokens:null,outputTokens:null,tokenSource:'unavailable'};}
  private artifactRoot(id:string){
    let dir=resolve(this.service.dataRoot);for(const part of ['','benchmarks','artifacts',id]){if(part)dir=join(dir,part);if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new AvAError('BENCH_LINK','Benchmark artifact folders must not be links.');mkdirSync(dir,{recursive:true});}return dir;
  }
  // The judge runs in its own benchmark pair (seat cli1), retired with the job. Like the agents, it starts a fresh
  // session for every attempt (activation closes the previous one), so no score is given with earlier attempts, or the
  // other agent's answer, in its context. A judge that fails leaves a score of null with the reason; the attempt's
  // verdict is already decided by its checks.
  private async judgeAttempt(job:BenchJob,task:BenchTask,answer:string,files:string,signal:AbortSignal,state:{pairId?:string}):Promise<RubricScore>{
    const judge=job.input.judge!;
    try{
      if(!state.pairId){
        const pair=this.service.store.createPair(`benchmark-judge-${job.id}`);state.pairId=pair.id;
        await this.service.call('slot.configure',{pairId:pair.id,seat:'cli1',config:judge});
      }
      signal.throwIfAborted();job.requestsAdmitted++;this.save(job);
      await this.service.call('slot.activate',{pairId:state.pairId,seat:'cli1'});
      const participant=this.service.activation.get(state.pairId,'cli1');
      if(!participant)return {judge,score:null,error:'The judge is not active.'};
      signal.throwIfAborted();job.requestsAdmitted++;this.save(job);
      const result=await participant.request({id:randomUUID(),text:judgePrompt(task,answer,files),signal,onStarted(){},onEvent(){}});
      return result.status==='completed'?{judge,...parseJudgment(result.text)}:{judge,score:null,error:'The judge did not answer.'};
    }catch(error){if(signal.aborted)throw error;return {judge,score:null,error:safeError(error)};}
  }
  private async drive(job:BenchJob,tasks:BenchTask[],signal:AbortSignal){
    const judge:{pairId?:string}={};
    try{await this.driveTasks(job,tasks,signal,judge);}
    finally{if(judge.pairId)await this.service.retireBenchmarkPair(judge.pairId).catch(()=>{});}
  }
  private async driveTasks(job:BenchJob,tasks:BenchTask[],signal:AbortSignal,judge:{pairId?:string}){
    job.status='running';this.save(job);
    try{
      for(const task of tasks)for(let repeat=1;repeat<=job.input.repeats;repeat++){
        signal.throwIfAborted();job.current={taskId:task.spec.id,repeat,pending:SEATS.map(seat=>this.blank(job,task,repeat,seat))};this.save(job);
        const scratch=mkdtempSync(join(tmpdir(),'ava-bench-input-'));let pair:Pair|undefined,run:Run|undefined,retired=false;
        try{
          const fixture=join(scratch,'fixture');mkdirSync(fixture);putFiles(fixture,task.files,'fixture/');
          pair=this.service.store.createPair(`benchmark-${job.id}-${task.spec.id}-${repeat}`);job.current.pairId=pair.id;this.save(job);
          for(const seat of SEATS){signal.throwIfAborted();await this.service.call('slot.configure',{pairId:pair.id,seat,config:job.input.agents[seat]});signal.throwIfAborted();job.requestsAdmitted++;this.save(job);await this.service.call('slot.activate',{pairId:pair.id,seat});}
          signal.throwIfAborted();
          const building=task.spec.mode!=='prompt';
          run=await this.service.call('run.start',{pairId:pair.id,text:task.spec.prompt,requestId:randomUUID(),options:{mode:building?'build':'benchmark',durationMs:task.spec.time_limit_minutes*60000},...(building?{build:{kind:task.spec.mode==='review'?'review':'build',path:fixture}}:{})}) as Run;
          job.current.runId=run.id;job.requestsAdmitted+=2;this.save(job);
          while(['running','pausing','paused','stopping'].includes(this.service.store.run(run.id).status)){signal.throwIfAborted();await new Promise(r=>setTimeout(r,100));}
          run=this.service.store.run(run.id);signal.throwIfAborted();
          if(run.status!=='completed'||!['benchmark_done','build_done'].includes(run.reason??''))throw new AvAError('BENCH_PROVIDER',`Benchmark run ended with ${run.reason??run.status}. No retry was sent.`);
          // End the agents before revealing the hidden verifier or reading mutable candidate output.
          await this.service.retireBenchmarkPair(pair.id);retired=true;signal.throwIfAborted();
          const stats=await this.service.call('run.stats',{runId:run.id}) as RunStats;
          for(const pending of job.current.pending){
            signal.throwIfAborted();const seat=pending.seat,output=this.service.store.messages(run.id).filter(m=>m.sender===seat&&m.state==='committed').at(-1)?.text??'';
            const artifact=this.artifactRoot(pending.id);
            if(building){
              // Output the checks can't take (too many files, a link, a name they refuse) fails this attempt, not the whole job;
              // installed packages aren't copied (Q6).
              const candidate=join(participantWorkspace(this.service.dataRoot,{pairId:pair.id,seat,generation:run.generations[seat]}),run.config.build!.folder);
              let files;try{files=treeFiles(candidate,CANDIDATE_SKIP);}
              catch(error){this.record(job,{...pending,agent:run.participants?.[seat]??pending.agent,status:'error',finishedAt:new Date().toISOString(),error:safeError(error),runId:run.id});continue;}
              putFiles(artifact,files);
            }
            putFiles(artifact,task.files.filter(f=>f.path.startsWith('tests/')));
            const checks=await checkTask(task,output,artifact,signal),usage=stats.seats.find(s=>s.seat===seat)!;
            signal.throwIfAborted();
            const rubric=task.spec.rubric&&job.input.judge?await this.judgeAttempt(job,task,output,building?candidateFiles(artifact):'',signal,judge):undefined;
            signal.throwIfAborted();
            this.record(job,{...pending,agent:run.participants?.[seat]??pending.agent,status:checks.every(c=>c.passed)?'pass':'fail',finishedAt:new Date().toISOString(),answer:output.slice(0,256000).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]'),checks,runId:run.id,durationMs:usage.avgDurationMs,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,tokenSource:usage.tokenSource,artifact,...(rubric?{rubric}:{})});
          }
          if(job.input.stopOnFailure&&job.results.some(r=>r.status!=='pass'))throw new AvAError('BENCH_CHECK_FAILED','Stopped after the first task with a failed check.');
        }finally{
          if(pair&&!retired)await this.service.retireBenchmarkPair(pair.id);
          if(dirname(resolve(scratch))!==resolve(tmpdir())||!basename(scratch).startsWith('ava-bench-input-'))throw new AvAError('BENCH_CLEANUP','Refused an unsafe benchmark cleanup path.');
          rmSync(scratch,{recursive:true,force:true});
        }
      }
      job.status='completed';delete job.current;this.save(job);
    }catch(error){
      job.status=signal.aborted?'cancelled':'failed';job.error=safeError(error);
      for(const pending of job.current?.pending??[])if(!job.results.some(r=>r.id===pending.id))this.record(job,{...pending,status:signal.aborted?'cancelled':'error',finishedAt:new Date().toISOString(),error:job.error,...(job.current?.runId?{runId:job.current.runId}:{})});
      this.save(job);
    }
  }
}
