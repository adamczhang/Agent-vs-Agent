import { spawn,execFile } from 'node:child_process';
import { existsSync,lstatSync,mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify,isDeepStrictEqual } from 'node:util';
import { Worker } from 'node:worker_threads';
import { safeBenchFile,type BenchTask,type BenchCheck } from './bench-tasks.js';
import { VERIFIER_IMAGE,containerStatus,docker,runInContainer,type ContainerStatus,type Docker } from './containers.js';

// 2: verifiers run under the guard below, so a task validated by version 1 is validated again.
export const CHECKER_VERSION=2;
// backend: where a `run:` check ran: under Node's permission guard, unguarded on the host (validation and mock runs on a
// Node without network control), or in a container (image: its digest).
export interface CheckResult {index:number;kind:string;passed:boolean;detail:string;exitCode?:number|null;durationMs:number;guarded?:boolean;backend?:'node-permission'|'host'|'container';image?:string}
// A task marked `isolation: container`, or every task with AVA_VERIFIER_BACKEND=container, runs its verifiers in Docker.
export const needsContainer=(task:BenchTask)=>task.spec.isolation==='container'||process.env.AVA_VERIFIER_BACKEND==='container';
// Docker access for container checks; tests replace these.
export const containerBackend:{run:Docker;status:()=>Promise<ContainerStatus>}={run:docker,status:()=>containerStatus()};
// A container check never falls back to the host: without Docker's Linux engine and the pinned image it fails, saying why.
async function containerCheck(root:string,check:Extract<BenchCheck,{run:string}>,status:ContainerStatus,signal?:AbortSignal){
  const verifier=check.run.slice(5),file=safeBenchFile(root,verifier);
  if(!existsSync(file)||!lstatSync(file).isFile())return {passed:false,detail:'Required verifier file is missing',exitCode:null,backend:'container' as const};
  if(!status.available)return {passed:false,detail:`Container isolation unavailable: ${status.reason}`,exitCode:null,backend:'container' as const};
  const result=await runInContainer(root,verifier,check.timeout_ms??10000,signal,containerBackend.run);
  const detail=signal?.aborted?'Check cancelled':result.timedOut?'Verifier timed out':result.output.trim()||`Exited ${result.exitCode}`;
  return {passed:result.exitCode===0&&!result.timedOut&&!signal?.aborted,exitCode:result.exitCode,detail:detail.slice(0,8000),backend:'container' as const,image:VERIFIER_IMAGE.digest};
}
const exec=promisify(execFile);
async function kill(pid:number){if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:5000}).catch(()=>{});else{try{process.kill(-pid,'SIGKILL');}catch{}}}
export function verifierEnvironment():NodeJS.ProcessEnv{
  const out:NodeJS.ProcessEnv={};for(const key of ['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC','TEMP','TMP'])if(process.env[key])out[key]=process.env[key];return out;
}
// The verifier guard. Node's permission model confines a verifier, and the candidate code it imports. It may read only
// the attempt folder (the candidate's files and the hidden tests) and write only a throwaway folder, which is also its
// temp folder. It gets no child processes, worker threads, add-ons, WASI or network (connections, listening, DNS).
// Node describes this as a seat belt against accidents, not a sandbox against hostile code, so it is for trusted
// (validated) tasks. It needs a Node that can deny network access (--allow-net); without one, live program verifiers
// stay blocked (bench-runner.ts). AVA_VERIFIER_GUARD=off turns the guard, and with it live program verifiers, off.
export const verifierGuardAvailable=()=>process.env.AVA_VERIFIER_GUARD!=='off'&&process.allowedNodeEnvironmentFlags.has('--permission')&&process.allowedNodeEnvironmentFlags.has('--allow-net');
const GUARD_DENIAL=/ERR_ACCESS_DENIED|Access to this API has been restricted[^\r\n]*/;
async function runCheck(root:string,check:Extract<BenchCheck,{run:string}>,signal?:AbortSignal){
  const file=safeBenchFile(root,check.run.slice(5));
  if(!existsSync(file)||!lstatSync(file).isFile())return {passed:false,detail:'Required verifier file is missing',exitCode:null};
  const guarded=verifierGuardAvailable(),scratch=guarded?mkdtempSync(join(tmpdir(),'ava-verifier-')):'';
  const args=guarded?['--permission',`--allow-fs-read=${root}`,`--allow-fs-write=${scratch}`,'--max-old-space-size=256',file]:['--max-old-space-size=256',file];
  const env=guarded?{...verifierEnvironment(),TEMP:scratch,TMP:scratch,TMPDIR:scratch}:verifierEnvironment();
  return new Promise<{passed:boolean;detail:string;exitCode:number|null;guarded:boolean;backend:'node-permission'|'host'}>(resolve=>{
    let output='',reason='',settled=false;const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const finish=(code:number|null)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      // A refusal by the guard is named as such, ahead of the verifier's own output.
      const denied=code!==0&&!reason?GUARD_DENIAL.exec(output)?.[0]:undefined;
      resolve({passed:code===0&&!reason,exitCode:code,guarded,backend:guarded?'node-permission':'host',detail:((denied?`Blocked by the verifier guard: ${denied}\n`:'')+(reason||output.trim()||`Exited ${code}`)).slice(0,8000)});
    };
    const terminate=(why:string)=>{if(reason)return;reason=why;if(child.pid)void kill(child.pid).finally(()=>{child.kill();finish(null);});else finish(null);};
    const cancel=()=>terminate('Check cancelled');
    const timer=setTimeout(()=>terminate('Verifier timed out'),check.timeout_ms??10000);
    const collect=(chunk:Buffer)=>{if(output.length<8000)output+=chunk.toString('utf8');if(output.length>=8000)terminate('Verifier output limit exceeded');};
    // The scratch folder goes once the verifier has fully exited (a stopped one may still hold its files for a moment,
    // and so may an antivirus scan). A folder that still can't be removed stays in the temp folder; it's never an error.
    const cleanup=()=>{if(scratch)void rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});};
    child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',()=>{reason='Verifier could not start';finish(null);cleanup();});child.on('close',code=>{finish(code);cleanup();});
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  });
}
async function regexCheck(check:Extract<BenchCheck,{regex:string}>,text:string,signal?:AbortSignal){
  return new Promise<{passed:boolean;detail:string}>(resolve=>{
    const ext=import.meta.url.endsWith('.ts')?'ts':'js';
    const worker=new Worker(new URL(`./bench-regex-worker.${ext}`,import.meta.url),{workerData:{pattern:check.regex,flags:check.flags,text},resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16}});
    let settled=false;
    const finish=(passed:boolean,detail:string)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);void worker.terminate().finally(()=>resolve({passed,detail}));};
    const cancel=()=>finish(false,'Check cancelled');
    const timer=setTimeout(()=>finish(false,'Regular expression timed out'),check.timeout_ms??1500);
    worker.once('message',(result:{passed:boolean;error?:string})=>finish(result.passed,result.error??(result.passed?'Pattern matched':'Pattern did not match')));
    worker.once('error',()=>finish(false,'Regular expression worker failed'));worker.once('exit',()=>finish(false,'Regular expression worker exited without a result'));
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  });
}
function atJsonPath(value:unknown,path:string):{found:boolean;value?:unknown}{
  let current=value;
  for(const match of path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/g)){
    const key=match[1]??match[2]!;
    if(current===null||typeof current!=='object'||!Object.prototype.hasOwnProperty.call(current,key))return {found:false};
    current=(current as Record<string,unknown>)[key];
  }
  return {found:true,value:current};
}
export async function checkTask(task:BenchTask,answer:string,root:string,signal?:AbortSignal):Promise<CheckResult[]>{
  const results:CheckResult[]=[];let container:ContainerStatus|undefined;
  for(const [index,check] of task.spec.checks.entries()){
    const at=Date.now(),kind=['equals','contains','regex','number','json_path','file_exists','run'].find(k=>k in check)!;let result:Omit<CheckResult,'index'|'kind'|'durationMs'>;
    try{
    if(signal?.aborted)result={passed:false,detail:'Check cancelled'};
    else if(answer.length>256000)result={passed:false,detail:'Answer exceeds the checker size limit'};
    else if('equals'in check)result={passed:answer.trim()===check.equals.trim(),detail:answer.trim()===check.equals.trim()?'Exact answer matched':'Exact answer did not match'};
    else if('contains'in check)result={passed:answer.includes(check.contains),detail:answer.includes(check.contains)?'Required text found':'Required text missing'};
    else if('regex'in check)result=await regexCheck(check,answer,signal);
    else if('number'in check){const number=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(answer.trim())?Number(answer.trim()):NaN;const passed=Number.isFinite(number)&&Math.abs(number-check.number.value)<=check.number.tolerance;result={passed,detail:passed?'Number is within tolerance':'Number is missing or outside tolerance'};}
    else if('json_path'in check){try{const found=atJsonPath(JSON.parse(answer),check.json_path.path),passed=found.found&&isDeepStrictEqual(found.value,check.json_path.equals);result={passed,detail:passed?'JSON value matched':'JSON path missing or value did not match'};}catch{result={passed:false,detail:'Answer is not valid JSON'};}}
    else if('file_exists'in check){const file=safeBenchFile(root,check.file_exists);const passed=existsSync(file)&&lstatSync(file).isFile();result={passed,detail:passed?'Required file exists':'Required regular file is missing'};}
    else if(needsContainer(task))result=await containerCheck(root,check,container??=await containerBackend.status(),signal);
    else result=await runCheck(root,check,signal);
    }catch(error){result={passed:false,detail:error instanceof Error?error.message:'Check failed'};}
    results.push({index,kind,...result,durationMs:Date.now()-at});
  }
  return results;
}
