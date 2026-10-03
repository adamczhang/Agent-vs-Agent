import { spawn,execFile } from 'node:child_process';
import { existsSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { promisify,isDeepStrictEqual } from 'node:util';
import { Worker } from 'node:worker_threads';
import { safeBenchFile,type BenchTask,type BenchCheck } from './bench-tasks.js';

export const CHECKER_VERSION=1;
export interface CheckResult {index:number;kind:string;passed:boolean;detail:string;exitCode?:number|null;durationMs:number}
const exec=promisify(execFile);
async function kill(pid:number){if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:5000}).catch(()=>{});else{try{process.kill(-pid,'SIGKILL');}catch{}}}
export function verifierEnvironment():NodeJS.ProcessEnv{
  const out:NodeJS.ProcessEnv={};for(const key of ['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC','TEMP','TMP'])if(process.env[key])out[key]=process.env[key];return out;
}
async function runCheck(root:string,check:Extract<BenchCheck,{run:string}>,signal?:AbortSignal){
  const file=safeBenchFile(root,check.run.slice(5));
  if(!existsSync(file)||!lstatSync(file).isFile())return {passed:false,detail:'Required verifier file is missing',exitCode:null};
  return new Promise<{passed:boolean;detail:string;exitCode:number|null}>(resolve=>{
    let output='',reason='',settled=false;const child=spawn(process.execPath,['--max-old-space-size=256',file],{cwd:root,env:verifierEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const finish=(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve({passed:code===0&&!reason,exitCode:code,detail:(reason||output.trim()||`Exited ${code}`).slice(0,8000)});};
    const terminate=(why:string)=>{if(reason)return;reason=why;if(child.pid)void kill(child.pid).finally(()=>{child.kill();finish(null);});else finish(null);};
    const cancel=()=>terminate('Check cancelled');
    const timer=setTimeout(()=>terminate('Verifier timed out'),check.timeout_ms??10000);
    const collect=(chunk:Buffer)=>{if(output.length<8000)output+=chunk.toString('utf8');if(output.length>=8000)terminate('Verifier output limit exceeded');};
    child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',()=>{reason='Verifier could not start';finish(null);});child.on('close',finish);
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
  const results:CheckResult[]=[];
  for(const [index,check] of task.spec.checks.entries()){
    const at=Date.now(),kind=['equals','contains','regex','number','json_path','file_exists','run'].find(k=>k in check)!;let result:{passed:boolean;detail:string;exitCode?:number|null};
    try{
    if(signal?.aborted)result={passed:false,detail:'Check cancelled'};
    else if(answer.length>256000)result={passed:false,detail:'Answer exceeds the checker size limit'};
    else if('equals'in check)result={passed:answer.trim()===check.equals.trim(),detail:answer.trim()===check.equals.trim()?'Exact answer matched':'Exact answer did not match'};
    else if('contains'in check)result={passed:answer.includes(check.contains),detail:answer.includes(check.contains)?'Required text found':'Required text missing'};
    else if('regex'in check)result=await regexCheck(check,answer,signal);
    else if('number'in check){const number=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(answer.trim())?Number(answer.trim()):NaN;const passed=Number.isFinite(number)&&Math.abs(number-check.number.value)<=check.number.tolerance;result={passed,detail:passed?'Number is within tolerance':'Number is missing or outside tolerance'};}
    else if('json_path'in check){try{const found=atJsonPath(JSON.parse(answer),check.json_path.path),passed=found.found&&isDeepStrictEqual(found.value,check.json_path.equals);result={passed,detail:passed?'JSON value matched':'JSON path missing or value did not match'};}catch{result={passed:false,detail:'Answer is not valid JSON'};}}
    else if('file_exists'in check){const file=safeBenchFile(root,check.file_exists);const passed=existsSync(file)&&lstatSync(file).isFile();result={passed,detail:passed?'Required file exists':'Required regular file is missing'};}
    else result=await runCheck(root,check,signal);
    }catch(error){result={passed:false,detail:error instanceof Error?error.message:'Check failed'};}
    results.push({index,kind,...result,durationMs:Date.now()-at});
  }
  return results;
}
