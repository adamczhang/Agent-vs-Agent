import { randomUUID } from 'node:crypto';
import { existsSync,lstatSync,mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename,dirname,join,resolve } from 'node:path';
import type { AvAService } from './service.js';
import { AvAError,SEATS,type Pair,type ProviderConfig,type Run,type Seat } from './types.js';
import { projectRoot,packageVersion } from './paths.js';
import { loadSuite,putFiles,treeFiles,type BenchTask } from './bench-tasks.js';
import { validateTask,validated } from './bench-validation.js';
import { checkTask,type CheckResult } from './bench-checks.js';
import type { RunStats,TokenStat } from './stats.js';
import { participantWorkspace } from './workspace.js';

export interface BenchInput {suite?:string;taskIds:string[];repeats:number;agents:Record<Seat,ProviderConfig>;stopOnFailure:boolean}
export interface AttemptSummary {id:string;taskId:string;repeat:number;seat:Seat;status:BenchAttempt['status']}
export interface BenchAttempt {id:string;jobId:string;taskId:string;taskVersion:number;digest:string;title:string;suite:string;taskMode:BenchTask['spec']['mode'];prompt:string;checkSpecs:BenchTask['spec']['checks'];repeat:number;seat:Seat;agent:ProviderConfig;status:'pass'|'fail'|'error'|'cancelled'|'interrupted';createdAt:string;finishedAt:string;version:string;simulation:boolean;answer:string;checks:CheckResult[];runId?:string;durationMs:number|null;inputTokens:number|null;outputTokens:number|null;tokenSource:TokenStat['tokenSource'];artifact?:string;error?:string}
export interface BenchJob {id:string;createdAt:string;updatedAt:string;status:'queued'|'running'|'completed'|'failed'|'cancelled'|'interrupted';input:BenchInput;requestCeiling:number;requestsAdmitted:number;totalAttempts:number;results:AttemptSummary[];current?:{taskId:string;repeat:number;pairId?:string;runId?:string;pending:BenchAttempt[]};error?:string}
const safeError=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]').slice(0,2000);
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
  suite(path?:string){return loadSuite(path?resolve(path):join(projectRoot,'benchmarks','starter'));}
  private blocked(task:BenchTask){return this.service.mode!=='simulation'&&task.spec.checks.some(c=>'run'in c)?'Live program verifiers require an execution sandbox (F1). Offline mock runs remain available.':'';}
  catalog(path?:string){return this.suite(path).map(t=>({id:t.spec.id,title:t.spec.title??t.spec.id,mode:t.spec.mode,version:t.spec.version,digest:t.digest,prompt:t.spec.prompt,checks:t.spec.checks.length,minutes:t.spec.time_limit_minutes,validated:!!validated(this.service.dataRoot,t),blockedReason:this.blocked(t)}));}
  async validate(ids:string[],path?:string){const tasks=this.select(ids,path);const results=[];for(const task of tasks)results.push(await validateTask(task,this.service.dataRoot));return results;}
  private select(ids:string[],path?:string){const suite=this.suite(path);const tasks=ids.map(id=>suite.find(t=>t.spec.id===id));if(tasks.some(t=>!t)||new Set(ids).size!==ids.length)throw new AvAError('BENCH_TASK','Select distinct tasks from the suite.');return tasks as BenchTask[];}
  jobs(){return this.service.store.db.prepare('SELECT data FROM bench_jobs ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.data)) as BenchJob);}
  get(id:string){const row=this.service.store.db.prepare('SELECT data FROM bench_jobs WHERE id=?').get(id);if(!row)throw new AvAError('NOT_FOUND','Benchmark job not found.');return JSON.parse(String(row.data)) as BenchJob;}
  attempt(id:string){const row=this.service.store.db.prepare('SELECT data FROM bench_attempts WHERE id=?').get(id);if(!row)throw new AvAError('NOT_FOUND','Benchmark attempt not found.');return JSON.parse(String(row.data)) as BenchAttempt;}
  private save(job:BenchJob){job.updatedAt=new Date().toISOString();this.service.store.db.prepare('UPDATE bench_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);}
  private record(job:BenchJob,attempt:BenchAttempt){
    if(job.results.some(r=>r.id===attempt.id))return;
    this.service.store.transaction(()=>{
      this.service.store.db.prepare('INSERT INTO bench_attempts VALUES(?,?,?,?,?,?,?,?,?,?)').run(attempt.id,job.id,attempt.taskId,attempt.taskVersion,attempt.digest,attempt.agent.provider,attempt.agent.model,attempt.status,attempt.createdAt,JSON.stringify(attempt));
      job.results.push({id:attempt.id,taskId:attempt.taskId,repeat:attempt.repeat,seat:attempt.seat,status:attempt.status});this.save(job);
    });
  }
  start(input:BenchInput){
    if(this.busy)throw new AvAError('BENCH_BUSY','A benchmark job is already running in this pool.');
    if(this.service.resources.limit&&this.service.resources.active().length+2>this.service.resources.limit)throw new AvAError('BENCH_CAPACITY','Benchmarks need two free agent slots. Stop agents or raise the limit in Resources.');
    const tasks=this.select(input.taskIds,input.suite);
    // A trusted verifier can import untrusted candidate code. Closing agent sessions does not sandbox that code.
    for(const task of tasks)if(this.blocked(task))throw new AvAError('BENCH_SANDBOX_REQUIRED',`${task.spec.id}: ${this.blocked(task)}`);
    for(const task of tasks)if(!validated(this.service.dataRoot,task))throw new AvAError('BENCH_NOT_VALIDATED',`${task.spec.id} needs validation for its current contents.`);
    input={...input,suite:resolve(input.suite??join(projectRoot,'benchmarks','starter'))};
    const job:BenchJob={id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'queued',input,requestCeiling:tasks.length*input.repeats*4,requestsAdmitted:0,totalAttempts:tasks.length*input.repeats*2,results:[]};
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
  private async drive(job:BenchJob,tasks:BenchTask[],signal:AbortSignal){
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
            if(building){const candidate=join(participantWorkspace(this.service.dataRoot,{pairId:pair.id,seat,generation:run.generations[seat]}),run.config.build!.folder);putFiles(artifact,treeFiles(candidate));}
            putFiles(artifact,task.files.filter(f=>f.path.startsWith('tests/')));
            const checks=await checkTask(task,output,artifact,signal),usage=stats.seats.find(s=>s.seat===seat)!;
            signal.throwIfAborted();
            this.record(job,{...pending,agent:run.participants?.[seat]??pending.agent,status:checks.every(c=>c.passed)?'pass':'fail',finishedAt:new Date().toISOString(),answer:output.slice(0,256000).replace(/\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/g,'[redacted]'),checks,runId:run.id,durationMs:usage.avgDurationMs,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,tokenSource:usage.tokenSource,artifact});
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
