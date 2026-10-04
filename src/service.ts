import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync,readdirSync,rmSync,statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename,dirname,join,relative } from 'node:path';
import { z } from 'zod';
import { SCHEMA_VERSION,Store,threadKey } from './store.js';
import { newerVersion,packageVersion } from './paths.js';
import { attachmentKind } from './attachment-files.js';
import { PromptLibrary,promptKeySchema,promptSaveSchema } from './prompt-library.js';
import { ConversationController,internetNote } from './controller.js';
import { ActivationManager,type ParticipantFactory } from './activation.js';
import { NativeFactory,loadProviderSetups,type Catalog } from './providers.js';
import { LABELS,Menus } from './menus.js';
import { QuickMemory,highEffort,strongestModel } from './quick.js';
import { debateBrief,judgePrompt,maxEffort,parseBallot,total } from './debate.js';
import { promptResult } from './answer-check.js';
import { listProcesses,survivors,systemCensus,type Census,type ProcessLedger,type SystemProcess } from './census.js';
import { JobHost,type AgentJobs } from './jobs.js';
import { combineStats,computeStats } from './stats.js';
import { checkProject,copyFolder,copyProject,inlineProject,participantWorkspace,projectChanges } from './workspace.js';
import { prepareProject } from './prepare-project.js';
import { Resources } from './resources.js';
import { BenchmarkRunner } from './bench-runner.js';
import { suiteReport } from './bench-report.js';
import { BenchmarkResults } from './bench-results.js';
import { protectPrivatePath } from './private-files.js';
import type { DoctorReport } from './doctor.js';
import { Previews,appTarget,pageIn } from './preview.js';
import { createGatewayKey,forgetGatewayKey,gatewayCredit,gatewayKeyStatus,gatewayModels,type GatewayModel,type RunVercel } from './gateway.js';
import { AvAError,PROVIDERS,SEATS,conversationConfig,type AgentUsage,type JudgeProvider,type Judgment,type RoomMode,type Pair,type Provider,type ProviderConfig,type Run,type RunConfig,type Seat } from './types.js';

const id=z.string().min(1).max(200),seat=z.enum(SEATS),provider=z.enum(PROVIDERS);
const resultDate=z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
const resultFilters=z.object({jobId:id.optional(),suite:z.string().min(1).max(1000).optional(),taskId:id.optional(),provider:z.string().min(1).max(100).optional(),model:z.string().min(1).max(300).optional(),from:resultDate.optional(),to:resultDate.optional(),simulation:z.enum(['all','only','exclude']).optional()}).strict().refine(p=>!p.from||!p.to||p.from<=p.to,'The start date must precede the end date.');
const choice=z.object({key:z.string().min(1).max(100),value:z.string().max(200)});
const providerConfig=z.object({provider,model:z.string().min(1).max(300),modelName:z.string().max(200).optional(),effort:choice.optional(),speed:choice.optional(),auth:z.enum(['provider-login','api'])}).strict();
// Preset data mirrors the room's settings form; .strict() keeps provider/model choices out (they belong to Codex activation).
const presetData=z.object({instructions:z.object({cli1:z.string().max(8000),cli2:z.string().max(8000)}).strict(),stopWhen:z.object({cli1:z.string().max(4000),cli2:z.string().max(4000)}).strict(),completion:z.enum(['auto','duration','either','both','rounds']),rounds:z.string().max(20).optional(),internet:z.object({cli1:z.boolean(),cli2:z.boolean()}).partial().strict().optional(),stances:z.object({cli1:z.enum(['for','against']),cli2:z.enum(['for','against'])}).strict().optional(),judge:z.enum(['claude','codex','off']).optional(),speech:z.string().max(20).optional(),minutes:z.string().max(20),requests:z.string().max(20),pace:z.string().max(20),opening:z.enum(['both','cli1','cli2']).optional()}).strict();
const runOptions=z.object({instructions:z.object({cli1:z.string().max(8000),cli2:z.string().max(8000)}).optional(),stopWhen:z.object({cli1:z.string().max(4000),cli2:z.string().max(4000)}).optional(),completion:z.enum(['duration','either','both','rounds']).optional(),rounds:z.number().int().min(1).max(100).optional(),stances:z.object({cli1:z.enum(['for','against']),cli2:z.enum(['for','against'])}).strict().optional(),judge:z.object({provider:z.enum(['claude','codex'])}).strict().optional(),speechMs:z.number().min(30_000).max(1_800_000).optional(),check:z.object({kind:z.enum(['challenge','race']),answers:z.array(z.string().trim().min(1).max(500)).min(1).max(10)}).strict().optional(),durationMs:z.number().positive().max(86400000).optional(),maxRequests:z.number().int().min(2).max(10000).optional(),perTurnMs:z.number().positive().max(3600000).optional(),paceMs:z.number().min(0).max(60000).optional(),lead:seat.optional(),mode:z.enum(['conversation','benchmark','build']).optional(),opening:z.enum(['both','cli1','cli2']).optional()}).strict();

// A direct reply is plain text; if the agent answers in the room's JSON envelope out of habit, show just its message.
function plainReply(text:string){
  try{const parsed=JSON.parse(text) as {message?:unknown};if(parsed&&typeof parsed.message==='string')return parsed.message.slice(0,32000);}catch{/* plain text */}
  return text.trim().slice(0,32000)||'(empty reply)';
}
// Executables that belong to the agent CLIs themselves (seen live: codex-code-mode-host.exe,
// codex-command-runner-<version>.exe), never treated as something an agent left running.
const AGENT_HELPER=/^(codex|claude|grok|agy|antigravity)([-_.][\w.-]*)?\.exe$/i;
// Calls that start or change runs, agents or history (refused while Clear history runs).
// A thread's title from its first prompt: a Markdown heading's text when the prompt starts with one ("# Motion: …" gives
// the motion), else the prompt as written.
const topicTitle=(topic:string)=>{const first=topic.trim().split('\n')[0]!;return /^#{1,6}\s/.test(first)?first.replace(/^#{1,6}\s+/,'').replace(/^Motion:\s*/i,''):topic;};
// The judge's own sessions (G7): kept out of the agent limit and of Quick activate's memory.
const JUDGE_PAIR='debate-judge-';
const CHANGING=new Set(['thread.delete','debate.judge','run.start','run.broadcast','run.control','run.reconcile','direct.send','pair.clear','pair.close','pair.reset','slot.configure','slot.activate','slot.quick','slot.cancel','slot.internet','slot.permissions','menu.choose','room.new','history.clear','prompt.save','prompt.delete','prompt.prepare','attachment.add','resources.configure','resources.stop','bench.validate','bench.start','bench.cancel']);
// Stops each process with its whole tree (Windows: taskkill /T; it fails for any that already exited, which is fine).
function stopTrees(pids:number[]){
  if(!pids.length)return Promise.resolve();
  if(process.platform==='win32')return new Promise<void>(done=>{execFile('taskkill',['/F','/T',...pids.flatMap(pid=>['/PID',String(pid)])],{windowsHide:true,timeout:30_000},()=>done());});
  for(const pid of pids){try{process.kill(-pid,'SIGTERM');}catch{try{process.kill(pid,'SIGTERM');}catch{/* already gone */}}}
  return Promise.resolve();
}
// The processes listening on a local TCP port.
function listeningOn(port:number){
  return new Promise<number[]>(done=>{
    const [command,args]=process.platform==='win32'?['powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`]] as const
      :['lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t']] as const;
    execFile(command,[...args],{windowsHide:true,timeout:30_000},(_error,stdout)=>done([...new Set(String(stdout??'').split(/\s+/).filter(Boolean).map(Number).filter(n=>n>0))]));
  });
}
export interface ServiceFactory extends ParticipantFactory {
  doctor?():Promise<DoctorReport>;
  cliWarnings?():Promise<Partial<Record<Provider,string>>>;
  ledger?:ProcessLedger;
  // Test doubles for the Vercel AI Gateway: its model list and the Vercel CLI.
  gatewayModels?():Promise<GatewayModel[]>;
  runVercel?:RunVercel;
  list():unknown;
  discover(provider:Provider,signal:AbortSignal,model?:string,auth?:ProviderConfig['auth']):Promise<Catalog>;
}
export class AvAService {
  readonly store:Store;
  readonly prompts:PromptLibrary;
  readonly activation:ActivationManager;
  readonly engine:ConversationController;
  readonly resources:Resources;
  readonly benchmarks:BenchmarkRunner;
  readonly benchmarkResults:BenchmarkResults;
  readonly menus:Menus;
  readonly quick:QuickMemory;
  private catalogs=new Map<string,{value:Catalog;at:number}>();
  private tickets=new Map<string,{pairId:string;generations:number[];expires:number}>();
  private operations=new Map<string,Promise<unknown>>();
  private pendingStarts=new Map<string,{input:string;task:Promise<Run>}>();
  private preparing=new Set<string>();
  private preparationDone=new Set<Promise<void>>();
  private shuttingDown=false;
  // Set by the background service (server.ts): stop it for a newer install (service.retire).
  retire?:()=>void;
  private stoppingAgents=false;
  private census:Census;
  private processes:()=>Promise<SystemProcess[]>;
  private stopProcesses:(pids:number[])=>Promise<void>;
  private listeners:(port:number)=>Promise<number[]>;
  readonly previews=new Previews();
  // Windows job objects for agents (src/jobs.ts): real agents get them by default; tests can pass their own.
  readonly jobs?:AgentJobs;
  constructor(readonly dataRoot:string,readonly factory:ServiceFactory=new NativeFactory(dataRoot,loadProviderSetups(dataRoot)),readonly mode:'live'|'simulation'='live',
    options:{census?:Census;processes?:()=>Promise<SystemProcess[]>;stopProcesses?:(pids:number[])=>Promise<void>;listeners?:(port:number)=>Promise<number[]>;jobs?:AgentJobs}={}){
    // Upgrade the existing key's permissions as well as protecting newly written secrets.
    for(const path of [join(dataRoot,'secrets'),join(dataRoot,'secrets','ai-gateway.json')])if(existsSync(path))protectPrivatePath(path);
    this.store=new Store(join(dataRoot,'ava.sqlite'));this.store.interruptUnfinished();
    this.prompts=new PromptLibrary(dataRoot,this.store);
    this.factory.ledger??=this.store;this.census=options.census??systemCensus;
    this.jobs=options.jobs??(this.factory instanceof NativeFactory?new JobHost(dataRoot):undefined);
    if(this.factory instanceof NativeFactory)this.factory.jobs??=this.jobs;
    this.processes=options.processes??listProcesses;this.stopProcesses=options.stopProcesses??stopTrees;this.listeners=options.listeners??listeningOn;
    // Persisted receipts describe the old native processes, not this new owner.
    for(const row of this.store.db.prepare('SELECT data FROM pairs').all()){
      const pair=JSON.parse(String(row.data)) as import('./types.js').Pair;
      for(const seat of SEATS){const slot=pair.slots[seat];if(slot.state==='ready'||slot.state==='verifying'){slot.state=pair.activeRunId?'failed':'configuring';slot.error='The service restarted. Activate this agent again.';if(!pair.activeRunId){slot.generation++;slot.sessionId=null;slot.verifiedAt=null;}}}
      this.store.savePair(pair);
    }
    this.activation=new ActivationManager(this.store,factory);this.engine=new ConversationController(this.store);
    this.resources=new Resources(this.store,this.activation,this.processes);
    this.activation.beforeActivate=(pairId,seat)=>{if(this.stoppingAgents)throw new AvAError('STOPPING_AGENTS','AvA is stopping its agents. Wait for cleanup to finish.');if(!this.pairOrUndefined(pairId)?.thread.startsWith(JUDGE_PAIR))this.resources.admit(pairId,seat);};
    // While a Build run is running for a pair, each agent may work in its own workspace (which holds its copy).
    // So may a Build session's 1:1 line while it is answering.
    this.activation.workspaceAccess=(pairId,seat)=>{
      const pair=this.pairOrUndefined(pairId),run=pair?.activeRunId?this.store.run(pair.activeRunId):undefined;
      const building=!!run&&run.config.mode==='build'&&['running','pausing'].includes(run.status);
      if(!pair||!building&&!this.directTools.has(`${pairId}:${seat}`))return undefined;
      return participantWorkspace(this.dataRoot,{pairId,seat,generation:pair.slots[seat].generation});
    };
    // A judge that was working when the service stopped won't finish: its ballot says so, and Judge again can retry.
    for(const row of this.store.db.prepare(`SELECT id FROM runs WHERE data LIKE '%"judging"%'`).all())this.store.updateRun(String(row.id),r=>{if(r.judgment?.status==='judging')r.judgment={...r.judgment,status:'failed',finishedAt:new Date().toISOString(),error:'The service stopped while the judge was working.'};});
    this.engine.cleanup=run=>this.stopLeftovers(run);
    // A formal debate with a judge is judged once it completes.
    this.engine.ended=run=>{
      if(run.config.stances&&run.config.judge&&run.status==='completed')try{this.startJudging(run.id,run.config.judge.provider);}catch{/* nothing to judge */}
      // A Prompt run with an answer key: each agent's answer checked, and its time.
      if(run.config.check&&run.config.mode==='benchmark')try{this.scorePrompt(run.id);}catch{/* the run stays as it is */}
    };
    this.activation.keptProcesses=(pairId,seat)=>this.keptServerProcesses(pairId,seat);
    this.engine.reviewFiles=(run,seat)=>run.config.build?inlineProject(join(participantWorkspace(this.dataRoot,{pairId:run.pairId,seat,generation:run.generations[seat]}),run.config.build.folder)):'';
    this.activation.directBusy=(pairId,seat)=>this.direct.has(`${pairId}:${seat}`);
    // Quick activate remembers each agent's settings when it activates (benchmark sessions aside).
    this.quick=new QuickMemory(this.store);this.activation.onActivated=(pairId,seat)=>this.rememberQuick(pairId,seat);
    this.menus=new Menus(this.store,this.activation,(p,m,a)=>this.catalog(p,m,a),(pairId,seat,level)=>this.setPermissions(pairId,seat,level),{
      models:()=>this.factory.gatewayModels?.()??gatewayModels(this.dataRoot),keyStatus:()=>gatewayKeyStatus(this.dataRoot),
      createKey:budget=>createGatewayKey(this.dataRoot,budget,this.factory.runVercel),forgetKey:()=>forgetGatewayKey(this.dataRoot)},()=>this.factory.cliWarnings?.()??Promise.resolve({}),
      {plan:(seat,provider)=>this.quick.plan(seat,provider),activate:(pairId,seat)=>this.quickActivate(pairId,seat)});
    this.benchmarks=new BenchmarkRunner(this);
    this.benchmarkResults=new BenchmarkResults(this.store);
  }
  async catalog(provider:Provider,model='',auth:ProviderConfig['auth']='provider-login'){
    const key=JSON.stringify([provider,model,auth]),cached=this.catalogs.get(key);
    if(cached&&Date.now()-cached.at<60000)return cached.value;
    const value=await this.factory.discover(provider,AbortSignal.timeout(120000),model,auth);this.catalogs.set(key,{value,at:Date.now()});return value;
  }
  async call(method:string,input:unknown):Promise<unknown>{
    if(this.shuttingDown&&CHANGING.has(method))throw new AvAError('SHUTTING_DOWN','The service is shutting down.');
    if(this.stoppingAgents&&CHANGING.has(method)&&method!=='resources.stop')throw new AvAError('STOPPING_AGENTS','AvA is stopping its agents. Wait for cleanup to finish.');
    if(method==='history.clear'&&this.benchmarks.busy)throw new AvAError('BENCH_BUSY','Stop the benchmark job before clearing conversation history.');
    const changingPair=input&&typeof input==='object'?(input as {pairId?:string}).pairId:undefined;
    if(method!=='run.start'&&CHANGING.has(method)&&(method==='history.clear'?this.preparing.size>0:changingPair&&this.preparing.has(changingPair)))throw new AvAError('BUILD_PREPARING','The next prompt is being prepared (a Build project, or a debate’s briefs). Wait for it to finish, then try again.');
    // While history is being cleared nothing may start or change: the clear deletes runs and agents' folders.
    if(this.clearing&&CHANGING.has(method))throw new AvAError('CLEARING','History is being cleared. Try again in a moment.');
    switch(method){
      case 'health': return {mode:this.mode,pid:process.pid,version:packageVersion,schemaVersion:1,databaseVersion:SCHEMA_VERSION,capabilities:{benchmarks:true,benchmarkResults:true,benchmarkReports:true}};
      // Handover to a newer install: a plugin newer than this service asks it to step aside. It does only when nothing is
      // running (no conversation, 1:1 reply, activation, Build preparation or benchmark); its idle agents close with it.
      case 'service.retire':{
        const p=z.object({version:z.string().max(40)}).parse(input);
        if(!this.retire||!newerVersion(p.version,packageVersion))return {retiring:false,reason:`This service (${packageVersion}) isn't older than ${p.version}.`};
        const busy=this.store.db.prepare('SELECT data FROM pairs').all().some(row=>(JSON.parse(String(row.data)) as Pair).activeRunId)?'a conversation is running'
          :this.direct.size?'an agent is answering a 1:1 message':this.preparing.size?'a project is being prepared':this.benchmarks.busy?'a benchmark is running'
          :this.store.db.prepare('SELECT data FROM pairs').all().some(row=>SEATS.some(s=>(JSON.parse(String(row.data)) as Pair).slots[s].state==='verifying'))?'an agent is activating':'';
        if(busy)return {retiring:false,reason:busy};
        this.shuttingDown=true;setTimeout(()=>this.retire?.(),50);return {retiring:true,version:packageVersion};
      }
      case 'bench.catalog':{const p=z.object({suite:z.string().max(1000).optional()}).parse(input);return {tasks:this.benchmarks.catalog(p.suite)};}
      case 'bench.validate':{const p=z.object({taskIds:z.array(id).min(1).max(20),suite:z.string().max(1000).optional()}).parse(input);return {validations:await this.benchmarks.validate(p.taskIds,p.suite)};}
      case 'bench.start':{
        const p=z.object({taskIds:z.array(id).min(1).max(20),suite:z.string().max(1000).optional(),repeats:z.number().int().min(1).max(10).default(1),stopOnFailure:z.boolean().default(false),pairId:id.optional(),agents:z.object({cli1:providerConfig,cli2:providerConfig}).strict().optional(),judge:providerConfig.optional(),requestId:id}).refine(p=>!!p.pairId!==!!p.agents,'Choose a room pair or two explicit agent configurations.').parse(input);
        return this.once('bench-start',p.requestId,{...p,requestId:undefined},async()=>{
          const pair=p.pairId?this.store.pair(p.pairId):undefined;
          const agents=p.agents??{cli1:pair!.slots.cli1.config!,cli2:pair!.slots.cli2.config!};
          if(!agents.cli1||!agents.cli2)throw new AvAError('NOT_READY','Choose both agent models in the room first.');
          return this.benchmarks.start({taskIds:p.taskIds,suite:p.suite,repeats:p.repeats,stopOnFailure:p.stopOnFailure,agents,...(p.judge?{judge:p.judge}:{})});
        });
      }
      case 'bench.jobs':return {jobs:this.benchmarks.jobs()};
      case 'bench.results':{const p=z.object({filters:resultFilters.optional(),before:z.number().int().positive().optional(),limit:z.number().int().min(1).max(200).default(50)}).strict().parse(input);const filters=p.filters??{};return {...this.benchmarkResults.page(filters,p.before,p.limit),scoreboard:this.benchmarkResults.scoreboard(filters),choices:this.benchmarkResults.choices()};}
      case 'bench.export':{const p=z.object({filters:resultFilters.optional(),format:z.enum(['json','csv'])}).strict().parse(input);return this.benchmarkResults.export(p.filters??{},p.format);}
      case 'bench.get':{const p=z.object({jobId:id}).parse(input);return this.benchmarks.get(p.jobId);}
      case 'bench.attempt':{const p=z.object({attemptId:id}).parse(input);return this.benchmarks.attempt(p.attemptId);}
      case 'bench.report':{const p=z.object({jobId:id,format:z.enum(['html','md'])}).strict().parse(input);return suiteReport(this.benchmarks.get(p.jobId),this.benchmarks.attemptsOf(p.jobId),p.format,this.dataRoot);}
      case 'bench.cancel':{const p=z.object({jobId:id,requestId:id}).parse(input);return this.once('bench-cancel',p.requestId,{jobId:p.jobId},async()=>this.benchmarks.cancel(p.jobId));}
      case 'pair.create': {const p=z.object({thread:id}).parse(input);return this.store.createPair(p.thread);}
      case 'providers.list':return this.factory.list();
      case 'doctor':if(!this.factory.doctor)throw new AvAError('SIMULATION','Diagnostics require the live provider factory (no model requests).');return this.factory.doctor();
      case 'providers.catalog':{const p=z.object({provider,model:z.string().optional(),auth:z.enum(['provider-login','api']).optional()}).parse(input);return this.catalog(p.provider,p.model,p.auth);}
      case 'menu.show':{const p=z.object({pairId:id,seat,phase:z.enum(['home','provider','model','effort','speed','auth','permissions','gateway-key']).optional()}).parse(input);return this.menus.show(p.pairId,p.seat,p.phase);}
      // The room's search over a long model list (the Vercel AI Gateway's); the result is a numbered menu like any other.
      case 'menu.search':{const p=z.object({pairId:id,seat,query:z.string().max(100)}).parse(input);return this.menus.search(p.pairId,p.seat,p.query);}
      case 'menu.current':{const p=z.object({pairId:id,seat}).parse(input);return this.menus.current(p.pairId,p.seat)??null;}
      case 'menu.choose':{const p=z.object({pairId:id,seat,menuId:id,choice:z.string().min(1).max(20)}).parse(input);return this.menus.choose(p.pairId,p.seat,p.menuId,p.choice);}
      case 'slot.configure':{const p=z.object({pairId:id,seat,config:providerConfig}).parse(input);return this.activation.configure(p.pairId,p.seat,p.config);}
      case 'slot.activate':{const p=z.object({pairId:id,seat}).parse(input);const config=this.store.pair(p.pairId).slots[p.seat].config;if(!config)throw new AvAError('NO_CONFIG','Configure the slot first.');return this.activation.activate(p.pairId,p.seat,config);}
      case 'thread.delete':{const p=z.object({threadId:z.string().min(1).max(300),requestId:id}).parse(input);return this.once('thread-delete',p.requestId,{threadId:p.threadId},async()=>this.deleteThread(p.threadId));}
      // A formal debate's judge (G7), on demand: judges again, or judges a debate that was stopped. It works in the background;
      // the ballot appears with the run.
      case 'debate.judge':{const p=z.object({runId:id,provider:z.enum(['claude','codex']).optional()}).parse(input);return this.startJudging(p.runId,p.provider);}
      // Quick activate: the agent's last settings (or the strongest model at high effort, Ask, internet off), activated.
      case 'slot.quick':{const p=z.object({pairId:id,seat}).parse(input);return this.quickActivate(p.pairId,p.seat);}
      case 'slot.cancel':{const p=z.object({pairId:id,seat}).parse(input);this.activation.cancel(p.pairId,p.seat);return this.store.pair(p.pairId);}
      case 'pair.get':{const p=z.object({pairId:id}).parse(input);return this.pairView(p.pairId);}
      case 'resources.get':return this.resources.snapshot(this.stoppingAgents);
      case 'resources.configure':{
        const p=z.object({maxActiveAgents:z.number().int().min(0).max(32).refine(n=>n!==1,'Use 0 for unlimited, or 2–32 agents.'),requestId:id}).parse(input);
        return this.once('resources-configure',p.requestId,{maxActiveAgents:p.maxActiveAgents},async()=>this.resources.configure(p.maxActiveAgents));
      }
      case 'resources.stop':{const p=z.object({requestId:id}).parse(input);return this.once('resources-stop',p.requestId,{},()=>this.stopAllAgents());}
      // An older name for Clear Session, kept for callers that still use it: one implementation for both.
      case 'pair.reset':{const p=z.object({pairId:id,requestId:id.optional()}).parse(input);return this.call('pair.clear',{pairId:p.pairId,requestId:p.requestId??randomUUID()});}
      // Clear context: stop any running conversation, then give both agents fresh native sessions so neither remembers it.
      // Each new session makes one short access check. The old transcript stays in history.
      case 'pair.clear':{
        const p=z.object({pairId:id,requestId:id}).parse(input);
        return this.once('clear',p.requestId,{pairId:p.pairId},async()=>{
          const pair=this.store.pair(p.pairId);
          if(SEATS.some(s=>!pair.slots[s].config))throw new AvAError('NOT_READY','Both agents need a saved configuration. Set them up with /ava CLI1 and /ava CLI2.');
          await this.endThread(p.pairId,true);
          return this.pairView(p.pairId);
        });
      }
      // Close thread (E8): what Clear Session does, without starting the agents again. The thread stays in history, and the
      // next one keeps both agents' settings (CLI, model, effort, speed, permissions, internet), ready to activate.
      case 'pair.close':{
        const p=z.object({pairId:id,requestId:id}).parse(input);
        return this.once('close',p.requestId,{pairId:p.pairId},async()=>{await this.endThread(p.pairId,false);return this.pairView(p.pairId);});
      }
      // The room opens whether or not its agents are ready: each one can be activated from the room itself (or with
      // /ava CLI1 and CLI2 in the host). A ticket still binds the opening to the slots as they were when it was prepared.
      case 'room.prepare':{
        const p=z.object({pairId:id}).parse(input);
        const existing=this.store.db.prepare('SELECT room_id FROM rooms WHERE pair_id=?').get(p.pairId);
        if(existing)return {roomId:existing.room_id,reopened:true,pair:this.pairView(p.pairId)};
        const pair=this.store.pair(p.pairId);
        for(const [key,old] of this.tickets)if(old.expires<Date.now())this.tickets.delete(key);
        const ticket=randomUUID();this.tickets.set(ticket,{pairId:p.pairId,generations:SEATS.map(s=>pair.slots[s].generation),expires:Date.now()+30000});
        return {ticket,pair:this.pairView(p.pairId)};
      }
      case 'room.open':{
        const p=z.object({ticket:id}).parse(input),ticket=this.tickets.get(p.ticket);
        if(!ticket||ticket.expires<Date.now())throw new AvAError('INVALID_TICKET','Prepare the room again.');
        const pair=this.store.pair(ticket.pairId);
        if(SEATS.some((s,i)=>pair.slots[s].generation!==ticket.generations[i]))throw new AvAError('STALE_TICKET','An agent changed before the room opened. Open it again.');
        const roomId=randomUUID();this.store.db.prepare('INSERT OR IGNORE INTO rooms VALUES(?,?)').run(pair.id,roomId);this.tickets.delete(p.ticket);
        return {roomId:this.store.db.prepare('SELECT room_id FROM rooms WHERE pair_id=?').get(pair.id)!.room_id,pair:this.pairView(pair.id)};
      }
      // A new thread in a page of its own: a fresh pair, whose agents the user activates from that room.
      case 'room.new':{
        z.object({}).passthrough().parse(input);
        const pair=this.store.createPair(`room-${randomUUID()}`),roomId=randomUUID();
        this.store.db.prepare('INSERT INTO rooms VALUES(?,?)').run(pair.id,roomId);
        return {roomId,pairId:pair.id};
      }
      // Threads whose agents are live (or starting) in this service: each one runs two CLI processes on this computer.
      case 'pairs.active':{
        const pairs=this.store.db.prepare('SELECT data FROM pairs').all().map(r=>JSON.parse(String(r.data)) as Pair);
        return {pairs:pairs.map(p=>({pairId:p.id,agents:SEATS.filter(s=>!!this.activation.get(p.id,s)||p.slots[s].state==='verifying').length,running:!!p.activeRunId})).filter(p=>p.agents>0)};
      }
      // mode (E9): the room's pair for that mode, made on first use. pairIds: every pair the room has, for its thread list.
      case 'room.get':{const p=z.object({roomId:id,mode:z.enum(['conversation','benchmark','build']).optional()}).parse(input);const pairId=this.roomPair(p.roomId,p.mode);return {mode:this.mode,pair:this.pairView(pairId),pairIds:this.roomPairs(p.roomId).map(r=>r.id)};}
      case 'run.start':{
        const p=z.object({pairId:id,text:z.string().min(1).max(16000),requestId:id,options:runOptions.optional(),attachments:z.array(id).max(8).optional(),
          build:z.object({kind:z.enum(['review','build']),path:z.string().max(1000).optional()}).strict().optional()}).parse(input);
        const startInput=JSON.stringify(p),pending=this.pendingStarts.get(p.requestId);
        if(pending){
          if(pending.input!==startInput)throw new AvAError('IDEMPOTENCY_CONFLICT','This request ID was already used with different input.');
          return pending.task;
        }
        const config=conversationConfig(p.text,p.options);
        // Build: the copy's folder name comes from the request ID, so a retried start finds the same run. Building may
        // start from an empty folder; a review needs a project.
        if(config.mode==='build'){
          const path=p.build?.path?.trim()??'';
          if(!p.build||!path&&p.build.kind==='review')throw new AvAError('INVALID_PROJECT','Choose the project folder for the agents to review.');
          const source=path?checkProject(path,this.dataRoot):'';config.build={kind:p.build.kind,source,folder:copyFolder(source||'app',p.requestId)};
        }
        const previous=this.store.previousStart(p.pairId,config,p.requestId);
        if(previous)return previous;
        if(this.preparing.has(p.pairId))throw new AvAError('BUILD_PREPARING','The next prompt is being prepared (a Build project, or a debate’s briefs). Wait for it to finish, then try again.');
        this.assertNotRestarting(p.pairId);
        // A Build session holds one prompt: its agents' folders and apps belong to that build.
        const openThread=this.openThreadId(this.store.pair(p.pairId)),earlier=openThread?this.store.threads().find(t=>t.id===openThread)?.runs??[]:[];
        if(earlier.length&&(config.mode==='build'||earlier[0]!.config.mode==='build'))throw new AvAError('ONE_BUILD','A Build session takes one prompt. Clear Session to start the next one.');
        // A new prompt after a run ends continues the same thread: the agents keep their sessions and remember it.
        // Clear Session (pair.clear) is how the user gives both agents fresh ones.
        this.assertNoDirect(p.pairId);
        const participants=this.activation.participants(p.pairId),attachments=this.attachable(p.pairId,p.attachments);
        let copied:ReturnType<typeof copyProject>|undefined;const made:string[]=[];
        this.preparing.add(p.pairId);
        let preparationFinished!:()=>void;
        const preparation=new Promise<void>(resolve=>{preparationFinished=resolve;});this.preparationDone.add(preparation);
        // Register before yielding to copy/setup work, so retries from another connection share its outcome.
        const task=Promise.resolve().then(async()=>{
          try{
            if(config.build){
              // Each agent gets its own copy (or empty folder), inside its own workspace; then Codex may edit and run commands there.
              const pair=this.store.pair(p.pairId);
              for(const seat of SEATS){
                const target=join(participantWorkspace(this.dataRoot,{pairId:p.pairId,seat,generation:pair.slots[seat].generation}),config.build.folder);
                copied=await prepareProject(config.build.source,target);made.push(target);
              }
            }
            // (Codex's sandbox is set again before each request; this spares its first one the switch.)
            for(const seat of SEATS)await participants[seat].setBuildAccess?.(!!config.build);
            let debaters=participants;
            // (While a prompt is still running, none of this happens: the start is refused below, as before.)
            const mode=config.mode??'conversation',idle=!this.store.pair(p.pairId).activeRunId,formal=!!config.stances&&mode==='conversation';
            // Each Prompt run and each formal debate is its own thread (owner, 2026-10-03/04): after an earlier prompt in
            // this thread, both agents get fresh sessions first (clean context, same agents, never shown as closed).
            if(idle&&earlier.length&&(mode==='benchmark'||formal)){await this.freshThread(p.pairId);debaters=this.activation.participants(p.pairId);}
            // G6: each debater is briefed through its 1:1 line, and the debate starts once both are ready.
            if(idle&&formal)await this.briefDebaters(p.pairId,config);
            if(this.shuttingDown||this.stoppingAgents)throw new AvAError('STOPPING_AGENTS','The service is stopping its agents.');
            const run=this.engine.start(p.pairId,config,p.requestId,debaters,attachments);
            if(copied)this.store.event(run.id,'build_copied',{files:copied.files,bytes:copied.bytes,gitSource:copied.gitSource,baseline:copied.baseline});
            return run;
          // A start that fails takes its copies with it, so a retry with the same request starts clean.
          }catch(error){for(const dir of made)await rm(dir,{recursive:true,force:true});throw error;}
          finally{this.pendingStarts.delete(p.requestId);this.preparing.delete(p.pairId);this.preparationDone.delete(preparation);preparationFinished();}
        });
        this.pendingStarts.set(p.requestId,{input:startInput,task});return task;
      }
      // Build results: what each agent changed in its copy, and a preview of it served on its own origin.
      case 'build.changes':{const p=z.object({runId:id,seat}).parse(input);return projectChanges(this.buildCopy(p.runId,p.seat).copy);}
      // The app the agent named (APP: …), else the page found in its folder. A server it left running opens directly.
      case 'build.preview':{
        const p=z.object({runId:id,seat}).parse(input),{copy,workspace}=this.buildCopy(p.runId,p.seat),app=this.appOf(p.runId,p.seat);
        if(app?.kind==='server')return {kind:'server',url:app.url,origin:new URL(app.url).origin,entry:app.url,named:true};
        const target=app?join(workspace,app.path):copy,file=statSync(target).isFile();
        const place=file?{root:dirname(target),page:basename(target)}:pageIn(target);
        const opened=await this.previews.open(`${p.runId}:${p.seat}`,place.root,place.page);
        return {kind:'static',...opened,entry:place.page?relative(workspace,join(place.root,place.page)).replaceAll('\\','/'):'',named:!!app};
      }
      case 'history.clear':{
        const p=z.object({pairId:id.optional(),requestId:id}).parse(input);
        return this.once('history',p.requestId,{pairId:p.pairId??null},async()=>this.clearHistory(p.pairId));
      }
      // Files for the next room message: stored first, then referenced by ID (so retries never resend the bytes).
      case 'attachment.add':{
        const p=z.object({name:z.string().trim().min(1).max(200),mediaType:z.string().max(100),data:z.string().max(12_000_000)}).parse(input),bytes=Buffer.from(p.data,'base64');
        return this.store.saveAttachment(p.name,p.mediaType||'application/octet-stream',attachmentKind(p.name,p.mediaType,bytes),bytes);
      }
      case 'attachment.get':{const p=z.object({id}).parse(input);return {...this.store.attachment(p.id),data:this.store.attachmentData(p.id).toString('base64')};}
      case 'prompt.list':return this.prompts.list();
      case 'prompt.get':{const p=z.object({id:promptKeySchema}).strict().parse(input);return this.prompts.get(p.id);}
      case 'prompt.file':{const p=z.object({id:promptKeySchema,fileId:promptKeySchema}).strict().parse(input);return this.prompts.file(p.id,p.fileId);}
      case 'prompt.save':{
        const {requestId,...p}=promptSaveSchema.extend({requestId:id}).parse(input);
        return this.once('prompt-save',requestId,p,async()=>this.prompts.save(p));
      }
      case 'prompt.delete':{
        const {requestId,...p}=z.object({id:promptKeySchema,revision:z.string().min(1).max(100),requestId:id}).strict().parse(input);
        return this.once('prompt-delete',requestId,p,async()=>this.prompts.delete(p.id,p.revision));
      }
      case 'prompt.prepare':{
        const {requestId,...p}=z.object({id:promptKeySchema,revision:z.string().min(1).max(100),requestId:id}).strict().parse(input);
        return this.once('prompt-prepare',requestId,p,async()=>this.prompts.prepare(p.id,p.revision));
      }
      case 'slot.permissions':{const p=z.object({pairId:id,seat,level:z.enum(['ask','bypass'])}).parse(input);await this.setPermissions(p.pairId,p.seat,p.level);return this.pairView(p.pairId);}
      case 'thread.rename':{
        const p=z.object({threadId:id,title:z.string().trim().max(120)}).parse(input),thread=this.findThread(p.threadId);
        this.store.setThreadTitle(thread.id,p.title||null);return {threadId:thread.id,title:p.title||null};
      }
      case 'run.get':{
        const p=z.object({runId:id,after:z.number().int().min(0).optional()}).parse(input),run=this.engine.snapshot(p.runId);
        const attention=run.status==='needs_attention'?{uncertainTurns:Number(this.store.db.prepare("SELECT COUNT(*) n FROM turns WHERE run_id=? AND status IN ('uncertain','queued','submitted')").get(p.runId)!.n),ownedHere:!!this.engine.ownership(p.runId)}:undefined;
        return {run,messages:this.store.messages(p.runId),events:this.store.events(p.runId,p.after),attention};
      }
      case 'run.stats':{const p=z.object({runId:id}).parse(input);return this.runStats(p.runId);}
      // Threads: the room's left panel. The whole pool (every chat, from every host), newest activity first. Read-only.
      case 'threads.list':{const p=z.object({pairId:id.optional(),pairIds:z.array(id).max(10).optional(),limit:z.number().int().min(1).max(500).optional()}).parse(input);return {threads:this.threadList([...(p.pairId?[p.pairId]:[]),...(p.pairIds??[])]).slice(0,p.limit??200)};}
      case 'thread.get':{const p=z.object({threadId:id}).parse(input);return this.threadView(p.threadId);}
      case 'thread.stats':{const p=z.object({threadId:id}).parse(input),thread=this.findThread(p.threadId);return combineStats(thread.id,thread.runs.map(r=>this.runStats(r.id)));}
      case 'runs.list':{const p=z.object({pairId:id.optional(),limit:z.number().int().min(1).max(200).optional(),before:z.number().int().positive().optional()}).parse(input);return this.store.listRuns(p.pairId,p.limit??50,p.before);}
      case 'preset.list':return {presets:this.store.listPresets()};
      case 'preset.save':{const p=z.object({requestId:id,name:z.string().trim().min(1).max(80),data:presetData}).parse(input);return this.once('preset-save',p.requestId,{name:p.name,data:p.data},async()=>this.store.savePreset(p.name,p.data));}
      case 'preset.delete':{const p=z.object({requestId:id,id}).parse(input);return this.once('preset-delete',p.requestId,{id:p.id},async()=>this.store.deletePreset(p.id));}
      case 'runs.search':{const p=z.object({pairId:id.optional(),query:z.string().trim().min(1).max(200),limit:z.number().int().min(1).max(200).optional()}).parse(input);return {results:this.store.searchMessages(p.pairId,p.query,p.limit??50)};}
      case 'run.reconcile':{
        const p=z.object({runId:id,requestId:id,note:z.string().max(2000).optional()}).parse(input);
        return this.once('reconcile',p.requestId,{runId:p.runId,note:p.note??null},async()=>{
          const run=this.store.run(p.runId);
          if(run.status!=='needs_attention')throw new AvAError('NOT_NEEDS_ATTENTION','Only a run that needs attention can be released.');
          if(this.engine.ownership(p.runId)?.active)throw new AvAError('OWNED_WORK_ACTIVE','A request for this run is still registered here. Stop the run and wait for cancellation first.');
          if(this.store.pair(run.pairId).activeRunId!==run.id)throw new AvAError('NOT_PAIR_OWNER','This run no longer holds its pair; nothing was released.');
          // Close this service's own sessions for the pair so nothing can produce late work, then prove that no process
          // recorded for this run's sessions (or any child of one, even if the adapter itself exited) survives.
          await this.activation.closePair(run.pairId);this.engine.detach(p.runId);
          const checked=this.store.runProcesses(run.pairId,run.generations),alive=await this.census(checked);
          if(alive.length)throw new AvAError('PROCESSES_ALIVE',`Provider processes from this pair are still running: ${alive.map(s=>`${s.name} (PID ${s.pid})`).join(', ')}. Close them, then release the pair again.`);
          return this.store.reconcile(p.runId,{note:p.note??null,checked});
        });
      }
      case 'run.broadcast':{const p=z.object({runId:id,text:z.string().min(1).max(16000),requestId:id,attachments:z.array(id).max(8).optional()}).parse(input);const pairId=this.store.run(p.runId).pairId;this.assertNoDirect(pairId);this.assertNotRestarting(pairId);
        if(['benchmark','build'].includes(this.store.run(p.runId).config.mode??''))throw new AvAError('ONE_PROMPT','Each agent answers this prompt once; it takes no further messages.');return {messageId:this.engine.broadcast(p.runId,p.text,p.requestId,this.attachable(pairId,p.attachments))};}
      case 'run.control':{
        const p=z.object({runId:id,action:z.enum(['pause','resume','step','stop']),requestId:id.optional()}).parse(input);
        return this.once('control',p.requestId??randomUUID(),{runId:p.runId,action:p.action},async()=>{
          if(p.action==='resume'||p.action==='step'){const pairId=this.store.run(p.runId).pairId;this.assertNoDirect(pairId);this.assertNotRestarting(pairId);}
          this.engine[p.action](p.runId);return this.engine.snapshot(p.runId);
        });
      }
      // The agent's internet switch: enforced instantly by AvA's permission gate, or by restarting the agent (same
      // session) when its provider fixes web access at launch (Codex).
      case 'slot.internet':{
        const p=z.object({pairId:id,seat,enabled:z.boolean(),requestId:id}).parse(input);
        return this.once('internet',p.requestId,{pairId:p.pairId,seat:p.seat,enabled:p.enabled},async()=>this.setInternet(p.pairId,p.seat,p.enabled));
      }
      case 'direct.send':{
        // tools: in a Build session, the agent may also run commands and edit files in its working folder (to clone a
        // repository before the build, say).
        const p=z.object({pairId:id,seat,text:z.string().trim().min(1).max(16000),requestId:id,tools:z.boolean().optional()}).parse(input);
        return this.once('direct',p.requestId,{pairId:p.pairId,seat:p.seat,text:p.text,tools:!!p.tools},async()=>this.sendDirect(p.pairId,p.seat,p.text,!!p.tools));
      }
      case 'run.export':{
        const p=z.object({runId:id}).parse(input);const run=this.store.run(p.runId);
        const label=(sender:string)=>{const who=run.participants?.[sender as Seat];return who?`${sender} · ${LABELS[who.provider]} (${who.modelName??who.model})`:sender;};
        const messages=this.store.messages(p.runId).filter(m=>m.state!=='queued'),times=this.store.messageTimes(p.runId);
        // Portable record: identities, settings, timing, and text. Session IDs and generations stay internal.
        const json={format:'ava-transcript',version:1,exportedAt:new Date().toISOString(),
          run:{id:run.id,createdAt:run.createdAt??null,status:run.status,reason:run.reason,elapsedMs:run.elapsedMs,requests:run.requests,participants:run.participants??null,
            settings:{topic:run.config.topic,completion:run.config.completion,...(run.config.rounds?{rounds:run.config.rounds}:{}),...(run.config.stances?{stances:run.config.stances}:{}),durationMs:run.config.durationMs,maxRequests:run.config.maxRequests,paceMs:run.config.paceMs,lead:run.config.lead,instructions:run.config.instructions,stopWhen:run.config.stopWhen},...(run.judgment?{judgment:run.judgment}:{})},
          messages:messages.map(m=>({id:m.id,seq:m.seq,sender:m.sender,label:m.sender==='user'?'user':label(m.sender),state:m.state,deliveredTo:m.deliveredTo??[],time:times.get(m.id)??null,text:m.text}))};
        return {run:{id:run.id,status:run.status,reason:run.reason,elapsedMs:run.elapsedMs,createdAt:run.createdAt??null,participants:run.participants??null},messages,markdown:messages.map(m=>`## ${label(m.sender)}\n\n${m.text}`).join('\n\n'),json};
      }
      default:throw new AvAError('UNKNOWN_METHOD','Unknown AvA method.');
    }
  }
  private async once(kind:string,requestId:string,input:unknown,work:()=>Promise<unknown>):Promise<unknown>{
    const key=`${kind}:${requestId}`,saved=this.store.beginOperation(key,input);
    if(!saved.fresh){
      if(saved.record.status==='completed')return saved.record.result;
      if(saved.record.status==='failed')throw new AvAError(String(saved.record.code),String(saved.record.error));
      const pending=this.operations.get(key);if(pending)return pending;
      throw new AvAError('OPERATION_INTERRUPTED','The earlier command has an uncertain outcome. Inspect the pair before issuing a new command.');
    }
    const task=Promise.resolve().then(work).then(result=>{this.store.finishOperation(key,{status:'completed',result});return result;},error=>{this.store.finishOperation(key,{status:'failed',code:error instanceof AvAError?error.code:'FAILED',error:error instanceof Error?error.message:String(error)});throw error;}).finally(()=>this.operations.delete(key));
    this.operations.set(key,task);return task;
  }
  private runStats(runId:string){
    const run=this.engine.snapshot(runId),rows=this.store.statsRows(runId);
    return computeStats(run,rows.turns,rows.events,rows.replies,this.store.runProcesses(run.pairId,run.generations).length);
  }
  // The pair's current sessions as a thread ID, or null while either agent has no session.
  // A room's pairs (E9): its first pair (the rooms table), then one for each further mode, named room-mode:<room>:<mode>.
  private roomPairs(roomId:string):Pair[]{
    const first=this.store.db.prepare('SELECT pair_id FROM rooms WHERE room_id=?').get(roomId);
    if(!first)throw new AvAError('NOT_FOUND','Room not found.');
    const named=this.store.db.prepare('SELECT data FROM pairs WHERE thread LIKE ?').all(`room-mode:${roomId}:%`).map(r=>JSON.parse(String(r.data)) as Pair);
    return [this.store.pair(String(first.pair_id)),...named];
  }
  // The room's pair for a mode (E9). The first pair serves the mode of its current thread, or else the first mode asked
  // for. Another mode gets a pair of its own, set up with the agent settings last verified in the room (not active: the
  // room offers Activate both). A mode's pair, its thread and its agents stay as they are while another mode is in use.
  private roomPair(roomId:string,mode?:RoomMode):string{
    const pairs=this.roomPairs(roomId),first=pairs[0]!;
    if(!mode)return first.id;
    const own=pairs.find(p=>p.roomMode===mode);if(own)return own.id;
    if(!first.roomMode){first.roomMode=this.threadMode(first)??mode;this.store.savePair(first);if(first.roomMode===mode)return first.id;}
    const verified=(p:Pair)=>Math.max(...SEATS.map(s=>p.slots[s].verifiedAt??0));
    const source=[...pairs].sort((a,b)=>verified(b)-verified(a))[0]!,pair=this.store.createPair(`room-mode:${roomId}:${mode}`);
    pair.roomMode=mode;
    for(const seat of SEATS){const slot=source.slots[seat];if(slot.config)Object.assign(pair.slots[seat],{config:slot.config,state:'configuring',permissions:slot.permissions,internet:slot.internet});}
    this.store.savePair(pair);return pair.id;
  }
  // The mode of a pair's current thread, once it has a prompt.
  private threadMode(pair:Pair):RoomMode|undefined{
    const open=this.openThreadId(pair);if(!open)return undefined;
    const runs=this.store.threads().find(t=>t.id===open)?.runs;return runs?.length?runs[0]!.config.mode??'conversation':undefined;
  }
  private openThreadId(pair:Pair){
    const sessions={cli1:pair.slots.cli1.sessionId,cli2:pair.slots.cli2.sessionId};
    return sessions.cli1&&sessions.cli2?threadKey(pair.id,sessions):null;
  }
  private pairOrUndefined(id:string){try{return this.store.pair(id);}catch{return undefined;}}
  // One summary for the thread list and the thread view. A thread with no prompts yet is "empty": the pair's fresh
  // sessions (so Clear Session visibly starts a new one), possibly with direct messages already sent to prime them.
  private summarize(thread:{id:string;pairId:string;runs:Run[]},activity:ReturnType<Store['runActivity']>,pair:Pair|undefined,direct?:{count:number;first:string;last:string}){
    const current=!!pair&&this.openThreadId(pair)===thread.id,first=thread.runs[0],last=thread.runs.at(-1);
    const live=pair?.activeRunId&&thread.runs.some(r=>r.id===pair.activeRunId)?this.engine.snapshot(pair.activeRunId):undefined,shown=live??last;
    const counts=thread.runs.map(r=>activity.get(r.id));
    const verified=current&&pair?Math.max(...SEATS.map(s=>pair.slots[s].verifiedAt??0)):0;
    const times=[...counts.map(c=>c?.lastAt),...thread.runs.map(r=>r.createdAt),direct?.last,verified?new Date(verified).toISOString():undefined].filter((t):t is string=>!!t).sort();
    const slots=current&&pair&&pair.slots.cli1.config&&pair.slots.cli2.config?{cli1:pair.slots.cli1.config,cli2:pair.slots.cli2.config}:null;
    const named=(this.titles??=this.store.threadTitles()).get(thread.id);
    // A thread's mode is its first prompt's: conversation threads and benchmark threads are listed separately.
    return {id:thread.id,pairId:thread.pairId,title:named??(first?topicTitle(first.config.topic).slice(0,300):''),named:!!named,mode:first?(first.config.mode??'conversation'):null,createdAt:first?.createdAt??direct?.first??times[0]??null,updatedAt:times.at(-1)??null,runIds:thread.runs.map(r=>r.id),
      prompts:counts.reduce((n,c)=>n+(c?.prompts??0),0),replies:counts.reduce((n,c)=>n+(c?.replies??0),0),requests:thread.runs.reduce((n,r)=>n+r.requests,0),directMessages:direct?.count??0,
      status:(shown?.status??(current?'ready':'cleared')) as string,reason:shown?.reason??null,live:!!live,current,participants:last?.participants??slots,empty:!first,
      // A judged debate's result, for the thread list (C): who won, and each side's total out of 15.
      verdict:(()=>{
        const last=[...thread.runs].reverse().find(r=>r.judgment||r.result);if(!last)return null;
        if(last.result)return {status:'done' as const,kind:last.result.kind,...(last.result.winner?{winner:last.result.winner}:{}),correct:Object.fromEntries(SEATS.map(s=>[s,last.result!.seats[s].correct]))};
        const j=last.judgment!;return j.status!=='done'?{status:j.status,kind:'debate' as const}:{status:j.status,kind:'debate' as const,winner:j.winner,totals:Object.fromEntries(SEATS.map(s=>[s,total(j.scores![s])]))};
      })()};
  }
  // Thread names, read once per list or view.
  private titles?:Map<string,string>;
  private threadList(pairIds:string[]=[]){
    this.titles=this.store.threadTitles();
    const activity=this.store.runActivity(),pairs=new Map<string,Pair|undefined>(),pairOf=(id:string)=>{if(!pairs.has(id))pairs.set(id,this.pairOrUndefined(id));return pairs.get(id);};
    const direct=new Map(this.store.directThreads().map(d=>[d.threadId,d]));
    const groups=this.store.threads();
    // Threads that so far only hold direct messages, plus this room's fresh sessions.
    for(const d of direct.values())if(!groups.some(g=>g.id===d.threadId))groups.push({id:d.threadId,pairId:d.pairId,runs:[]});
    // This room's fresh sessions (one per pair it has: one per mode) are listed too.
    const openIds=new Set<string>();
    for(const pairId of new Set(pairIds)){const open=pairOf(pairId),openId=open&&this.openThreadId(open);if(!open||!openId)continue;openIds.add(openId);if(!groups.some(g=>g.id===openId))groups.push({id:openId,pairId:open.id,runs:[]});}
    // Another chat's untouched fresh sessions are not a conversation; leave them out.
    return groups.filter(g=>g.runs.length||direct.has(g.id)||openIds.has(g.id)).map(g=>this.summarize(g,activity,pairOf(g.pairId),direct.get(g.id))).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
  }
  // Delete one thread from history (D): its prompts and replies, 1:1 messages, name and ballot, the attachments only it
  // used, and its agents' folders. A thread whose agents are still active (or whose judge is still scoring) is refused.
  private async deleteThread(threadId:string){
    const thread=this.findThread(threadId),pair=this.pairOrUndefined(thread.pairId);
    const current=!!pair&&this.openThreadId(pair)===threadId;
    if(current&&pair&&(pair.activeRunId||SEATS.some(s=>this.activation.get(pair.id,s)||this.direct.has(`${pair.id}:${s}`))||this.preparing.has(pair.id)))
      throw new AvAError('THREAD_ACTIVE','This thread’s agents are still active. Close the thread first, then delete it.');
    if(thread.runs.some(r=>this.judging.has(r.id)||r.status==='running'||r.status==='paused'||r.status==='needs_attention'))throw new AvAError('THREAD_BUSY','Something in this thread is still running or needs attention. Let it finish, then delete it.');
    const counts=this.store.deleteThread(threadId,thread.runs.map(r=>r.id));this.titles=undefined;
    // Its sessions' folders (workspaces and saved session state), unless a pair is using them now.
    const inUse=new Set(this.store.db.prepare('SELECT data FROM pairs').all().flatMap(r=>{const p=JSON.parse(String(r.data)) as Pair;return SEATS.map(s=>`${p.id}/${s}/${p.slots[s].generation}`);}));
    for(const run of thread.runs)for(const seat of SEATS){
      if(inUse.has(`${run.pairId}/${seat}/${run.generations[seat]}`))continue;
      for(const base of ['workspaces','acpx'])rmSync(join(this.dataRoot,base,run.pairId,seat,String(run.generations[seat])),{recursive:true,force:true,maxRetries:3,retryDelay:200});
    }
    return {deleted:true,...counts};
  }
  private findThread(threadId:string):{id:string;pairId:string;runs:Run[]}{
    const found=this.store.threads().find(t=>t.id===threadId);if(found)return found;
    const direct=this.store.directThreads().find(d=>d.threadId===threadId);if(direct)return {id:threadId,pairId:direct.pairId,runs:[]};
    for(const row of this.store.db.prepare('SELECT data FROM pairs').all()){const pair=JSON.parse(String(row.data)) as Pair;if(this.openThreadId(pair)===threadId)return {id:threadId,pairId:pair.id,runs:[]};}
    throw new AvAError('NOT_FOUND','Thread not found.');
  }
  // Everything the room shows for one thread: its runs (prompts), their messages with the time each appeared, and the
  // direct messages with each agent (plus any reply still being written).
  private threadView(threadId:string){
    const thread=this.findThread(threadId),pair=this.pairOrUndefined(thread.pairId);
    this.titles=this.store.threadTitles();
    const summary=this.summarize(thread,this.store.runActivity(),pair,this.store.directThreads().find(d=>d.threadId===thread.id));
    const runs=thread.runs.map(r=>{const run=this.engine.snapshot(r.id);return {id:run.id,status:run.status,reason:run.reason,createdAt:run.createdAt??null,elapsedMs:run.elapsedMs,requests:run.requests,
      config:{topic:run.config.topic,completion:run.config.completion,...(run.config.rounds?{rounds:run.config.rounds}:{}),...(run.config.stances?{stances:run.config.stances}:{}),...(run.config.judge?{judge:run.config.judge}:{}),...(run.config.check?{check:run.config.check}:{}),durationMs:run.config.durationMs,maxRequests:run.config.maxRequests,mode:run.config.mode??'conversation',build:run.config.build??null},participants:run.participants??null,judgment:run.judgment??null,result:run.result??null};});
    const messages=thread.runs.flatMap(r=>{const times=this.store.messageTimes(r.id);return this.store.messages(r.id).map((m,i)=>({...m,time:times.get(m.id)??(i===0?r.createdAt??null:null)}));});
    const pending:Partial<Record<Seat,{partial:string;steps:string[]}>>={};
    for(const seat of SEATS){const entry=this.direct.get(`${thread.pairId}:${seat}`);if(entry&&entry.threadId===thread.id)pending[seat]={partial:entry.partial.slice(-4000),steps:entry.steps.slice(-4)};}
    return {thread:summary,runs,messages,direct:{messages:this.store.directMessages(thread.id),pending}};
  }
  // Direct (1:1) messages: one agent, inside its own session, in plain text. Nothing reaches the shared room or the
  // other agent. The agent can't be asked two things at once, so a direct message needs the shared conversation to be
  // stopped or paused between replies, and the conversation waits while a direct reply is being written.
  private direct=new Map<string,{threadId:string;abort:AbortController;partial:string;steps:string[];done:Promise<void>}>();
  // 1:1 requests (pairId:seat) that may use tools in the agent's workspace while they run.
  private directTools=new Set<string>();
  // Clear history in progress; agents (pairId:seat) restarting to change their internet access.
  private clearing=false;
  private restarting=new Set<string>();
  private assertNotRestarting(pairId:string){
    const seat=SEATS.find(s=>this.restarting.has(`${pairId}:${s}`));
    if(seat)throw new AvAError('AGENT_BUSY',`Agent ${seat==='cli1'?1:2} is restarting to change its internet access. Try again in a moment.`);
  }
  private assertNoDirect(pairId:string){
    const busy=SEATS.filter(s=>this.direct.has(`${pairId}:${s}`));
    if(busy.length)throw new AvAError('DIRECT_BUSY',`${busy.map(s=>`Agent ${s==='cli1'?1:2}`).join(' and ')} ${busy.length>1?'are':'is'} still answering your direct message. Wait for the reply, then continue.`);
  }
  private async settleDirect(pairId:string){
    const entries=SEATS.map(s=>this.direct.get(`${pairId}:${s}`)).filter((e):e is NonNullable<typeof e>=>!!e);
    for(const entry of entries)entry.abort.abort(new AvAError('CANCELLED','Session cleared.'));
    let timer:ReturnType<typeof setTimeout>|undefined;
    await Promise.race([Promise.all(entries.map(e=>e.done)),new Promise(resolve=>{timer=setTimeout(resolve,10_000);})]).finally(()=>clearTimeout(timer));
  }
  private async setInternet(pairId:string,seat:Seat,enabled:boolean){
    const pair=this.store.pair(pairId),live=this.activation.get(pairId,seat),n=seat==='cli1'?1:2;
    // One restart at a time per agent: a second switch while it restarts would be lost (the new process reads the setting
    // as it starts).
    this.assertNotRestarting(pairId);
    const restart=!!live&&live.launchedWithInternet!==undefined&&live.launchedWithInternet!==enabled;
    if(restart){
      // A restart can't interrupt a reply: the agent must be between requests.
      if(this.direct.has(`${pairId}:${seat}`))throw new AvAError('DIRECT_BUSY',`Agent ${n} is still answering your direct message.`);
      const run=pair.activeRunId?this.store.run(pair.activeRunId):undefined;
      if(run&&(run.status!=='paused'||(this.engine.ownership(run.id)?.active??0)>0))throw new AvAError('AGENT_BUSY',`Agent ${n} restarts to change its internet access (it keeps its memory). Pause or stop the shared conversation first.`);
    }
    this.store.setSlotInternet(pairId,seat,enabled);this.rememberQuick(pairId,seat);
    if(restart){
      const key=`${pairId}:${seat}`;this.restarting.add(key);
      try{this.engine.replaceParticipant(pairId,seat,await this.activation.relaunch(pairId,seat));}finally{this.restarting.delete(key);}
    }
    return {seat,internet:enabled,restarted:restart,pair:this.pairView(pairId)};
  }
  // Permissions take effect at the agent's next tool request (the gate reads them live). Codex's own mode follows at
  // once when the agent is idle, else before its next request.
  private async setPermissions(pairId:string,seat:Seat,level:'ask'|'bypass'){
    this.store.setSlotPermissions(pairId,seat,level);this.rememberQuick(pairId,seat);
    const participant=this.activation.get(pairId,seat),pair=this.store.pair(pairId);
    const busy=this.direct.has(`${pairId}:${seat}`)||(pair.activeRunId?(this.engine.ownership(pair.activeRunId)?.active??0)>0:false);
    if(participant&&!busy)await participant.setBuildAccess?.(!!this.activation.workspaceAccess?.(pairId,seat)).catch(()=>{});
    return this.pairView(pairId);
  }
  private sendDirect(pairId:string,seat:Seat,text:string,tools=false){
    const pair=this.store.pair(pairId),slot=pair.slots[seat],participant=this.activation.get(pairId,seat),n=seat==='cli1'?1:2,key=`${pairId}:${seat}`;
    if(slot.state!=='ready'||!participant||!slot.sessionId)throw new AvAError('NOT_READY',`Agent ${n} isn't active. Activate it first.`);
    if(this.direct.has(key))throw new AvAError('DIRECT_BUSY',`Agent ${n} is still answering your last direct message.`);
    this.assertNotRestarting(pairId);
    if(pair.activeRunId){
      const run=this.store.run(pair.activeRunId);
      if(run.status!=='paused'||(this.engine.ownership(run.id)?.active??0)>0)throw new AvAError('CONVERSATION_RUNNING','Pause or stop the shared conversation first: an agent can’t answer you directly while it is writing a shared reply.');
    }
    // A 1:1 line belongs to the thread both agents share, which exists once both are active.
    const threadId=this.openThreadId(pair);
    if(!threadId)throw new AvAError('NOT_READY','Activate both agents first: a 1:1 line belongs to the thread they share.');
    const questionId=randomUUID(),abort=new AbortController();
    // Tools only in a Build session: one with no prompt yet, or whose prompt was a build.
    const runs=this.store.threads().find(t=>t.id===threadId)?.runs??[];
    if(tools&&runs.length&&runs[0]!.config.mode!=='build')throw new AvAError('NOT_BUILD','Only a Build session’s 1:1 lines can use workspace file tools.');
    this.store.addDirect({id:questionId,pairId,threadId,seat,sender:'user',text,state:'pending'});
    const entry={threadId,abort,partial:'',steps:[] as string[],done:Promise.resolve()};this.direct.set(key,entry);
    const prompt=[
      `Private message from the operator to you (${seat}) only. Your partner in the shared conversation can't see this message or your reply, and neither appears in the shared room.`,
      'Use it in the shared conversation as the operator intends, but don’t quote or mention this private exchange there unless the operator asks you to.',
      slot.permissions==='bypass'?'You may use your tools, run commands and edit files to do what the operator asks. Reply to the operator directly, in plain text (no JSON).'
        :tools?'You may use scoped file tools to read, create, or edit files in your working folder. Ask mode refuses command execution: do not run shells, scripts, tests, package managers, or process-control tools. Reply directly in plain text (no JSON), and report any execution you could not perform.'
        :'Reply to the operator directly, in plain text (no JSON). Do not edit files or run commands.',
      internetNote(slot.internet===true),
      `Message:\n${text}`,
    ].join('\n\n');
    entry.done=(async()=>{
      const timeout=setTimeout(()=>abort.abort(new AvAError('TIMEOUT',`No reply within ${tools?15:5} minutes.`)),tools?900_000:300_000);
      try{
        // Build access only for a Build session's 1:1 line (Codex back to read-only otherwise).
        if(tools)this.directTools.add(key);
        await participant.setBuildAccess?.(tools);
        const result=await participant.request({id:questionId,text:prompt,signal:abort.signal,onStarted:()=>{},onEvent:e=>{if(e.type==='output')entry.partial+=e.text;else if(e.type==='tool'&&tools)entry.steps.push(e.text.replace(/\s+/g,' ').slice(0,160));}});
        if(result.status!=='completed'){this.store.setDirectState(questionId,'cancelled',abort.signal.aborted?String((abort.signal.reason as Error)?.message??'Cancelled.'):'The agent cancelled the reply.');return;}
        this.store.addDirect({id:randomUUID(),pairId,threadId,seat,sender:'agent',text:plainReply(result.text),state:'sent'});this.store.setDirectState(questionId,'answered');
      }catch(error){this.store.setDirectState(questionId,'failed',error instanceof Error?error.message:String(error));}
      finally{clearTimeout(timeout);this.directTools.delete(key);if(this.direct.get(key)===entry)this.direct.delete(key);}
    })();
    return {id:questionId,threadId};
  }
  // A message's attachments, refused up front if an image would go to an agent that can't read images.
  private attachable(pairId:string,ids:string[]=[]){
    const files=ids.map(a=>this.store.attachment(a));
    if(files.some(f=>f.kind==='image'))for(const seat of SEATS){
      if(this.activation.get(pairId,seat)?.imageInput===false){const provider=this.store.pair(pairId).slots[seat].config?.provider??'';throw new AvAError('IMAGES_UNSUPPORTED',`${LABELS[provider as Provider]??`Agent ${seat==='cli1'?1:2}`} (Agent ${seat==='cli1'?1:2}) can't read images. Remove the image, or attach the content as a text file.`);}
    }
    return files;
  }
  // One agent's folder for a Build run, in the workspace of the session generation that ran it.
  private buildCopy(runId:string,seat:Seat){
    const run=this.store.run(runId);
    if(run.config.mode!=='build'||!run.config.build)throw new AvAError('NOT_BUILD','That prompt wasn’t a Build run.');
    const workspace=participantWorkspace(this.dataRoot,{pairId:run.pairId,seat,generation:run.generations[seat]}),copy=join(workspace,run.config.build.folder);
    if(!existsSync(copy))throw new AvAError('NO_COPY','This agent’s folder is no longer there.');
    return {workspace,copy};
  }
  // The app an agent named in its build report.
  private appOf(runId:string,seat:Seat){
    const run=this.store.run(runId),text=this.store.messages(runId).filter(m=>m.sender===seat).at(-1)?.text;
    return text?appTarget(text,participantWorkspace(this.dataRoot,{pairId:run.pairId,seat,generation:run.generations[seat]})):undefined;
  }
  // Ends a room's current thread: its conversation stops (one that needs attention must be released first), its 1:1 lines
  // settle, its kept app servers stop, and its agents close, keeping their settings. reactivate: start both again with
  // fresh sessions (Clear Session); otherwise they wait for activation (Close thread).
  private async endThread(pairId:string,reactivate:boolean){
    const pair=this.store.pair(pairId);
    if(pair.activeRunId){
      const runId=pair.activeRunId;
      if(this.store.run(runId).status!=='needs_attention')this.engine.stop(runId);
      for(const deadline=Date.now()+30_000;;await new Promise(r=>setTimeout(r,100))){
        const status=this.store.run(runId).status;
        if(status==='stopped'||status==='completed')break;
        if(status==='needs_attention')throw new AvAError('NEEDS_ATTENTION','This conversation needs attention. Release the pair first, then try again.');
        if(Date.now()>deadline)throw new AvAError('STOP_TIMEOUT','The conversation did not stop in time. Try again.');
      }
    }
    await this.settleDirect(pairId);
    await this.stopKeptServers(pairId);
    const slots=this.store.pair(pairId).slots;
    for(const s of SEATS)if(slots[s].config)await this.activation.configure(pairId,s,slots[s].config!);
    if(reactivate)for(const s of SEATS)await this.activation.activate(pairId,s,slots[s].config!);
  }
  // The processes of the app servers an agent's Build runs kept, which its close leaves running. A recorded PID only
  // counts while it runs with its recorded start time (as at Clear Session): servers stopped since, and PIDs reused by
  // other processes, aren't kept.
  private async keptServerProcesses(pairId:string,seat:Seat){
    const kept=this.store.db.prepare("SELECT e.data FROM events e JOIN runs r ON r.id=e.run_id WHERE e.type='build_server' AND r.pair_id=?").all(pairId)
      .map(r=>JSON.parse(String(r.data)) as {seat:Seat;processes:Array<{pid:number;started:number}>}).filter(e=>e.seat===seat).flatMap(e=>e.processes);
    if(!kept.length)return [];
    const alive=new Map((await this.processes().catch(()=>[] as SystemProcess[])).map(p=>[p.pid,p]));
    return kept.filter(k=>Math.abs((alive.get(k.pid)?.started??-1e15)-k.started)<2000).map(k=>k.pid);
  }
  // App servers kept running after a build (recorded as build_server events) are stopped with their session: at Clear
  // Session or Clear history. A recorded PID only counts while its start time still matches.
  private async stopKeptServers(pairId?:string){
    const rows=this.store.db.prepare(`SELECT e.data FROM events e JOIN runs r ON r.id=e.run_id WHERE e.type='build_server'${pairId?' AND r.pair_id=?':''}`).all(...(pairId?[pairId]:[]));
    const kept=rows.flatMap(r=>(JSON.parse(String(r.data)) as {processes:Array<{pid:number;started:number}>}).processes);
    if(!kept.length)return;
    const alive=new Map((await this.processes().catch(()=>[] as SystemProcess[])).map(p=>[p.pid,p]));
    const live=kept.filter(k=>Math.abs((alive.get(k.pid)?.started??-1e15)-k.started)<2000),pids=new Set(live.map(k=>k.pid));
    await this.stopProcesses(live.filter(k=>!pids.has(alive.get(k.pid)!.ppid)).map(k=>k.pid)).catch(()=>{});
  }
  // Clear history: stops kept app servers, gives this room's agents fresh sessions (so they forget too), deletes every
  // saved thread, 1:1 message and attachment, and every agent workspace that no current session uses.
  private async clearHistory(pairId?:string){
    const pairs=()=>this.store.db.prepare('SELECT data FROM pairs').all().map(r=>JSON.parse(String(r.data)) as Pair);
    if(pairs().some(p=>p.activeRunId))throw new AvAError('PAIR_BUSY','Stop the running prompt first (or release it if it needs attention), then clear history.');
    if(this.direct.size)throw new AvAError('DIRECT_BUSY','Wait for the 1:1 replies, then clear history.');
    if(this.restarting.size)throw new AvAError('AGENT_BUSY','An agent is restarting. Try again in a moment.');
    this.clearing=true;
    try{return await this.clearEverything(pairs,pairId);}finally{this.clearing=false;}
  }
  private async clearEverything(pairs:()=>Pair[],pairId?:string){
    await this.stopKeptServers();
    this.previews.closeAll();
    const pair=pairId?this.store.pair(pairId):undefined;
    if(pair&&SEATS.every(s=>pair.slots[s].config)){
      for(const s of SEATS)await this.activation.configure(pair.id,s,pair.slots[s].config!);
      for(const s of SEATS)await this.activation.activate(pair.id,s,pair.slots[s].config!);
    }
    const threads=this.threadList().filter(t=>!t.empty).length,counts=this.store.clearHistory();
    // Agent folders: each session's workspace, and its saved session state (acpx/, which holds that session's messages).
    // Every pair's current session folders stay: their agents may be running in them.
    const live=pairs().flatMap(p=>SEATS.map(s=>[p.id,s,String(p.slots[s].generation)]));
    const dirs=(path:string)=>existsSync(path)?readdirSync(path,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>join(path,e.name)):[];
    let removed=0,kept=0;
    for(const base of ['workspaces','acpx']){
      const root=join(this.dataRoot,base),current=new Set(live.map(parts=>join(root,...parts)));
      for(const pairDir of dirs(root))for(const seatDir of dirs(pairDir))for(const dir of dirs(seatDir)){
        if(current.has(dir))continue;
        try{rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:200});if(base==='workspaces')removed++;}catch{if(base==='workspaces')kept++;}
      }
    }
    return {threads,...counts,workspacesRemoved:removed,workspacesInUse:kept,pair:pair?this.pairView(pair.id):null};
  }
  // Build runs: what an agent started and left running (a file watcher, a test runner) is stopped once it is done:
  // the processes in its own process tree, or in its job object, that started during the run and are still alive (the
  // agent itself started earlier). The job also holds processes whose parent has exited, which the tree can't reach.
  // The exception is the app server it named in its report (APP: http://localhost:<port>/), which keeps running, with
  // its parents and children, until Clear Session.
  private async stopLeftovers(run:Run){
    const since=Date.parse(run.createdAt??'');if(!Number.isFinite(since))return;
    const note=(seat:Seat,text:string)=>this.store.event(run.id,'activity',{seat,turnId:'cleanup',type:'status',text,late:false});
    try{
      const ledger=Object.fromEntries(SEATS.map(seat=>[seat,this.store.seatProcesses(run.pairId,seat,run.generations[seat])]));
      const apps=Object.fromEntries(SEATS.map(seat=>[seat,run.config.build?.kind==='build'?this.appOf(run.id,seat):undefined]));
      if(SEATS.every(seat=>!ledger[seat]!.length&&apps[seat]?.kind!=='server'))return;
      const all=await this.processes(),byPid=new Map(all.map(p=>[p.pid,p]));
      const fresh=(pid:number)=>(byPid.get(pid)?.started??0)>=since;
      // A CLI's own helpers, started during a turn (Codex's code-mode host and command runner, say), and their console
      // hosts are part of the agent; what runs under them still counts.
      const helper=(p:{name:string;parentPid:number})=>AGENT_HELPER.test(p.name)||/^conhost\.exe$/i.test(p.name)&&AGENT_HELPER.test(byPid.get(p.parentPid)?.name??'');
      for(const seat of SEATS){
        const recorded=ledger[seat]!,own=new Set(recorded.map(r=>r.pid)),app=apps[seat];
        const tree=survivors(recorded,all),members=new Set(await this.jobs?.scopeMembers(`${run.pairId}/${seat}/${run.generations[seat]}/`).catch(()=>[] as number[])??[]);
        const found=[...tree,...all.filter(p=>members.has(p.pid)&&!tree.some(t=>t.pid===p.pid)).map(p=>({pid:p.pid,parentPid:p.ppid,name:p.name}))];
        const left=found.filter(p=>!own.has(p.pid)&&fresh(p.pid)&&!helper(p)),leftPids=new Set(left.map(p=>p.pid)),keep=new Set<number>();
        if(app?.kind==='server'){
          const listening=(await this.listeners(app.port).catch(()=>[] as number[])).filter(fresh);
          for(const pid of listening){
            keep.add(pid);
            for(let up=byPid.get(pid)?.ppid;up!==undefined&&leftPids.has(up)&&!keep.has(up);up=byPid.get(up)?.ppid)keep.add(up);
          }
          for(let grew=keep.size>0;grew;){grew=false;for(const p of all)if(!keep.has(p.pid)&&keep.has(p.ppid)&&fresh(p.pid)){keep.add(p.pid);grew=true;}}
          if(listening.length){
            this.store.event(run.id,'build_server',{seat,url:app.url,processes:[...keep].map(pid=>({pid,started:byPid.get(pid)!.started,name:byPid.get(pid)!.name}))});
            note(seat,`Its app server keeps running at ${app.url} until Clear Session`);
          }else note(seat,`Nothing is listening at ${app.url}, the address it named`);
        }
        const stop=left.filter(p=>!keep.has(p.pid));
        if(!stop.length)continue;
        // Only the topmost leftovers are stopped by PID; stopping a tree takes its descendants with it.
        const pids=new Set(stop.map(p=>p.pid));
        await this.stopProcesses(stop.filter(p=>!pids.has(p.parentPid)).map(p=>p.pid)).catch(()=>{});
        this.store.event(run.id,'build_cleanup',{seat,stopped:stop.map(p=>({pid:p.pid,name:p.name}))});
        note(seat,`Stopped ${stop.length===1?'a process':`${stop.length} processes`} it left running: ${[...new Set(stop.map(p=>p.name))].slice(0,6).join(', ')}`);
      }
    }catch{/* best effort: the run's result doesn't depend on it */}
  }
  pairView(pairId:string){
    const pair=this.store.pair(pairId),active=pair.activeRunId?this.store.run(pair.activeRunId):undefined;
    // An agent reading a debate's topic while its partner opens (E7) isn't speaking.
    const speaking=active?[...new Set(this.store.db.prepare("SELECT t.seat FROM turns t LEFT JOIN phases p ON p.id=t.phase_id WHERE t.run_id=? AND t.status IN ('queued','submitted') AND IFNULL(p.kind,'')!='briefing'").all(active.id).map(r=>String(r.seat) as Seat))]:[];
    return {...pair,activeRun:active?{id:active.id,status:active.status,reason:active.reason,mode:active.config.mode??'conversation',nextSeat:active.nextSeat,speaking,queued:this.store.queued(active.id).length}:null,connected:Object.fromEntries(SEATS.map(s=>[s,!!this.activation.get(pairId,s)&&this.activation.get(pairId,s)?.isConnected?.()!==false])),
      images:Object.fromEntries(SEATS.map(s=>[s,this.activation.get(pairId,s)?.imageInput!==false])),usage:Object.fromEntries(SEATS.map(s=>[s,this.usageOf(pair,s)])),mode:this.mode,version:packageVersion,
      quick:Object.fromEntries(SEATS.map(s=>[s,this.quick.plan(s,pair.slots[s].config?.provider)]))};
  }
  // A Prompt run's answers against its answer key, with each agent's time from its request to its answer.
  private scorePrompt(runId:string){
    const run=this.store.run(runId),times=this.store.messageTimes(runId),started=new Map<string,number>();
    for(const row of this.store.db.prepare("SELECT data,time FROM events WHERE run_id=? AND type='prompt_started' ORDER BY seq").all(runId)){const seat=(JSON.parse(String(row.data)) as {seat:Seat}).seat;if(!started.has(seat))started.set(seat,Date.parse(String(row.time)));}
    const replies:Partial<Record<Seat,{text:string;ms:number|null}>>={};
    for(const m of this.store.messages(runId))if(m.sender!=='user'&&!replies[m.sender]){const at=Date.parse(times.get(m.id)??''),from=started.get(m.sender);replies[m.sender]={text:m.text,ms:Number.isFinite(at)&&from!==undefined?Math.max(0,at-from):null};}
    this.store.updateRun(runId,r=>{r.result=promptResult(run.config.check!,replies);});
  }
  // A new thread with the same agents: each gets a fresh session (ActivationManager.renew) without being closed first,
  // once any 1:1 reply has settled; app servers a Build left running stop, as at Clear Session.
  private async freshThread(pairId:string){
    await this.settleDirect(pairId);
    await this.stopKeptServers(pairId);
    await Promise.all(SEATS.map(seat=>this.activation.renew(pairId,seat)));
  }
  // A formal debate's briefs (G6), through each debater's 1:1 line: the motion, its side, its private brief, the format and
  // how it will be judged. Both are briefed at once; the debate starts once both have answered.
  private async briefDebaters(pairId:string,config:RunConfig){
    const pair=this.store.pair(pairId);
    await Promise.all(SEATS.map(async seat=>{
      const {id:questionId}=this.sendDirect(pairId,seat,debateBrief(config,seat,config.instructions[seat],internetNote(pair.slots[seat].internet===true)));
      await this.direct.get(`${pairId}:${seat}`)?.done;
      const row=this.store.db.prepare('SELECT state,error FROM direct_messages WHERE id=?').get(questionId);
      if(row?.state!=='answered')throw new AvAError('BRIEF_FAILED',`Agent ${seat==='cli1'?1:2} didn’t take its debate brief${row?.error?`: ${String(row.error)}`:'.'}`);
    }));
  }
  // The judge (G7): a fresh session of the CLI's strongest model at its highest effort, with web search to check facts.
  // It sees the motion and the speeches, never the debaters' briefs or who they are. It runs in the background and saves
  // its ballot with the run; one judging per debate at a time.
  private judging=new Set<string>();
  private startJudging(runId:string,provider?:JudgeProvider){
    const run=this.store.run(runId);
    if(!run.config.stances)throw new AvAError('NOT_DEBATE','Only a formal debate has a judge.');
    if(['running','pausing','paused','stopping'].includes(run.status))throw new AvAError('DEBATE_RUNNING','Judge the debate once it has ended.');
    if(this.judging.has(runId))return run.judgment;
    if(!SEATS.every(s=>this.store.messages(runId).some(m=>m.sender===s)))throw new AvAError('NOTHING_TO_JUDGE','Each debater needs at least one speech to judge.');
    const chosen=provider??run.config.judge?.provider??'claude',startedAt=new Date().toISOString();
    this.judging.add(runId);
    this.store.updateRun(runId,r=>{r.judgment={status:'judging',judge:{provider:chosen,model:'',auth:'provider-login'},startedAt};});
    void this.judgeDebate(runId,chosen,startedAt).finally(()=>this.judging.delete(runId));
    return this.store.run(runId).judgment;
  }
  private async judgeDebate(runId:string,provider:JudgeProvider,startedAt:string){
    const save=(judgment:Judgment)=>{try{this.store.updateRun(runId,r=>{r.judgment=judgment;});}catch{/* the run was deleted meanwhile */}};
    let judge:ProviderConfig={provider,model:'',auth:'provider-login'},pairId:string|undefined;
    try{
      const listed=await this.catalog(provider),model=strongestModel(provider,listed.models);
      if(!model)throw new AvAError('NO_MODEL',`${LABELS[provider]} listed no models.`);
      const controls=model.id===listed.currentModel?listed.controls:(await this.catalog(provider,model.id)).controls,effort=maxEffort(controls);
      judge={provider,model:model.id,...(model.name!==model.id?{modelName:model.name}:{}),...(effort?{effort}:{}),auth:'provider-login'};
      save({status:'judging',judge,startedAt});
      const pair=this.store.createPair(`${JUDGE_PAIR}${runId}-${randomUUID().slice(0,8)}`);pairId=pair.id;
      await this.activation.configure(pair.id,'cli1',judge);this.store.setSlotInternet(pair.id,'cli1',true);
      await this.activation.activate(pair.id,'cli1',judge);
      const participant=this.activation.get(pair.id,'cli1');if(!participant)throw new AvAError('NOT_READY','The judge did not start.');
      const run=this.store.run(runId);
      const result=await participant.request({id:randomUUID(),text:judgePrompt(run.config,this.store.messages(runId),internetNote(true)),signal:AbortSignal.timeout(20*60_000),onStarted(){},onEvent(){}});
      if(result.status!=='completed')throw new AvAError('JUDGE_CANCELLED','The judge did not finish.');
      save({status:'done',judge,startedAt,finishedAt:new Date().toISOString(),...parseBallot(result.text,run.config.stances!)});
    }catch(error){save({status:'failed',judge,startedAt,finishedAt:new Date().toISOString(),error:(error instanceof Error?error.message:String(error)).slice(0,500)});}
    finally{if(pairId)await this.activation.closePair(pairId).catch(()=>{});}
  }
  // An active agent's settings, remembered for Quick activate: on activation, and when its internet or permissions change.
  private rememberQuick(pairId:string,seat:Seat){
    const pair=this.pairOrUndefined(pairId),slot=pair?.slots[seat];
    if(!pair||pair.thread.startsWith('benchmark-')||pair.thread.startsWith(JUDGE_PAIR)||slot?.state!=='ready'||!slot.config)return;
    this.quick.remember(seat,{config:slot.config,permissions:slot.permissions??'ask',internet:slot.internet===true});
  }
  // Quick activate. The CLI: the one chosen for this agent, else the one it last used, else its default (Claude Code for
  // Agent 1, Codex for Agent 2). Its last settings with that CLI, or the defaults: the strongest model the CLI lists, high
  // effort where it has one, Ask permissions and internet off.
  private async quickActivate(pairId:string,seat:Seat){
    const slot=this.store.pair(pairId).slots[seat];
    if(slot.state==='verifying')throw new AvAError('ACTIVATING',`Agent ${seat==='cli1'?1:2} is already activating.`);
    const provider=this.quick.provider(seat,slot.config?.provider);
    let settings=this.quick.settings(provider);
    if(!settings){
      if(provider==='vercel')throw new AvAError('QUICK_NEEDS_MODEL','Choose a Gateway model once with Activate. Quick activate then reuses it.');
      const listed=await this.catalog(provider),model=strongestModel(provider,listed.models);
      if(!model)throw new AvAError('NO_MODEL',`${LABELS[provider]} listed no models. Choose one with Activate.`);
      // Effort choices can differ by model: read them for the chosen model when it isn't the CLI's current one.
      const controls=model.id===listed.currentModel?listed.controls:(await this.catalog(provider,model.id)).controls,effort=highEffort(controls);
      settings={config:{provider,model:model.id,...(model.name!==model.id?{modelName:model.name}:{}),...(effort?{effort}:{}),auth:'provider-login'},permissions:'ask',internet:false};
    }
    await this.activation.configure(pairId,seat,settings.config);
    this.store.setSlotPermissions(pairId,seat,settings.permissions);this.store.setSlotInternet(pairId,seat,settings.internet);
    return this.activation.activate(pairId,seat,settings.config);
  }
  private async stopAllAgents(){
    this.stoppingAgents=true;
    this.benchmarks.cancelAll();
    const errors:string[]=[],before=this.resources.active().length;
    try{
      for(const pair of this.resources.pairs())if(pair.activeRunId)this.engine.stop(pair.activeRunId);
      for(const entry of this.direct.values())entry.abort.abort(new AvAError('CANCELLED','All AvA agents were stopped.'));
      await Promise.allSettled(this.preparationDone);
      this.previews.closeAll();
      let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([this.activation.closeAll(),new Promise<never>((_,reject)=>{cleanupTimer=setTimeout(()=>reject(new Error('A provider did not confirm cleanup within 15 seconds.')),15000);})]);}
      catch(e){errors.push(e instanceof Error?e.message:'A provider did not confirm cleanup.');}
      finally{clearTimeout(cleanupTimer);}
      const recorded=this.store.recordedProcesses();
      let remaining:number[]=[];
      try{
        const owned=survivors(recorded,await this.processes());
        if(owned.length)await this.stopProcesses(owned.map(p=>p.pid));
        remaining=(await this.census(recorded)).map(p=>p.pid);
      }catch{errors.push('Could not verify that all owned processes stopped.');}
      const unfinished=()=>this.resources.pairs().some(p=>p.activeRunId&&['running','pausing','stopping'].includes(this.store.run(p.activeRunId).status));
      for(const end=Date.now()+5000;unfinished()&&Date.now()<end;)await new Promise(r=>setTimeout(r,25));
      for(const original of this.resources.pairs()){
        let pair=this.store.pair(original.id);
        if(pair.activeRunId&&this.store.run(pair.activeRunId).status==='needs_attention'&&!remaining.length&&!errors.length){
          const run=this.store.run(pair.activeRunId);this.engine.detach(run.id);
          this.store.reconcile(run.id,{note:'Stopped all AvA agents; no owned process survived.',checked:this.store.runProcesses(pair.id,run.generations)});
          pair=this.store.pair(pair.id);
        }
        if(pair.activeRunId){errors.push('A conversation still needs attention. Open its room to inspect or release it.');continue;}
        for(const seat of SEATS){
          if(this.activation.get(pair.id,seat))continue;
          const slot=pair.slots[seat];slot.generation++;slot.state=slot.config?'configuring':'empty';slot.sessionId=null;slot.verifiedAt=null;slot.error=slot.config?'Stopped from Resources. Activate this agent again.':null;
        }
        this.store.savePair(pair);
      }
      return {status:remaining.length||errors.length?'needs_attention':'stopped',agentsBefore:before,remainingProcesses:remaining.length,errors};
    }finally{this.stoppingAgents=false;}
  }
  // Benchmarks own fresh pairs. Retire just those agents before exposing hidden checks.
  async retireBenchmarkPair(pairId:string){
    let pair=this.store.pair(pairId);if(!pair.thread.startsWith('benchmark-'))throw new AvAError('BENCH_PAIR','Only a benchmark-owned pair may be retired this way.');
    if(pair.activeRunId)this.engine.stop(pair.activeRunId);
    await this.activation.closePair(pairId);
    const recorded=this.store.runProcesses(pairId,{cli1:pair.slots.cli1.generation,cli2:pair.slots.cli2.generation});
    if(recorded.length){const own=survivors(recorded,await this.processes());if(own.length)await this.stopProcesses(own.map(p=>p.pid));if((await this.census(recorded)).length)throw new AvAError('BENCH_CLEANUP','A benchmark process survived cleanup. Hidden checks were not exposed.');}
    for(const deadline=Date.now()+5000;pair.activeRunId&&['running','pausing','stopping'].includes(this.store.run(pair.activeRunId).status)&&Date.now()<deadline;){await new Promise(r=>setTimeout(r,25));pair=this.store.pair(pairId);}
    pair=this.store.pair(pairId);
    if(pair.activeRunId){const run=this.store.run(pair.activeRunId);if(run.status!=='needs_attention')throw new AvAError('BENCH_CLEANUP','Benchmark work has not settled.');this.engine.detach(run.id);this.store.reconcile(run.id,{note:'Benchmark sessions closed and no owned process survived; no request was resent.',checked:recorded});pair=this.store.pair(pairId);}
    for(const seat of SEATS){const slot=pair.slots[seat];slot.generation++;slot.state='configuring';slot.sessionId=null;slot.verifiedAt=null;slot.error='Benchmark attempt finished.';}this.store.savePair(pair);
  }
  // An active agent's latest usage report (null before it reports any), with the Gateway key's credit for a Gateway agent.
  private usageOf(pair:Pair,seat:Seat):AgentUsage|null{
    const slot=pair.slots[seat],live=this.activation.get(pair.id,seat);
    if(slot.state!=='ready'||!live||live.sessionId!==slot.sessionId)return null;
    const report=live.usage?.(),credit=slot.config?.provider==='vercel'?gatewayCredit(this.dataRoot):undefined;
    return report||credit?{...report,...(credit?{credit}:{}),at:report?.at??Date.now()}:null;
  }
  async shutdown(){
    this.shuttingDown=true;await this.benchmarks.shutdown();
    // A debate's briefs are 1:1 replies its start waits for: cancel them first, so that start ends.
    for(const entry of this.direct.values())entry.abort.abort(new AvAError('CANCELLED','The service is shutting down.'));
    await Promise.allSettled(this.preparationDone);
    for(const row of this.store.db.prepare('SELECT data FROM runs').all()){
      const run=JSON.parse(String(row.data)) as {id:string;status:string};
      if(['running','pausing','paused'].includes(run.status))this.engine.stop(run.id);
    }
    for(const entry of this.direct.values())entry.abort.abort(new AvAError('CANCELLED','The service is shutting down.'));
    this.previews.closeAll();
    await this.activation.closeAll();
    // Let stopped runs record their terminal state before the caller closes the store; anything still unsettled is quarantined on restart.
    const unsettled=()=>this.store.db.prepare('SELECT data FROM runs').all().some(row=>['running','pausing','stopping'].includes((JSON.parse(String(row.data)) as {status:string}).status));
    for(const deadline=Date.now()+5000;unsettled()&&Date.now()<deadline;)await new Promise(resolve=>setTimeout(resolve,25));
    // The agents have closed (their jobs retired); the job helper ends with the service.
    this.jobs?.dispose();
  }
}
