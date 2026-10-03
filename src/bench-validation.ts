import { existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,renameSync,lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename,dirname,join,resolve } from 'node:path';
import { checkTask,CHECKER_VERSION,type CheckResult } from './bench-checks.js';
import { putFiles,type BenchTask } from './bench-tasks.js';
import { AvAError } from './types.js';

export interface Validation {taskId:string;version:number;digest:string;checkerVersion:number;validated:boolean;oracle:CheckResult[];empty:CheckResult[];at:string}
export function validationPath(dataRoot:string,task:BenchTask){return join(dataRoot,'benchmarks','validation',task.digest+'.json');}
export function validated(dataRoot:string,task:BenchTask):Validation|null{
  try{const value=JSON.parse(readFileSync(validationPath(dataRoot,task),'utf8')) as Validation;return value.validated&&value.digest===task.digest&&value.taskId===task.spec.id&&value.version===task.spec.version&&value.checkerVersion===CHECKER_VERSION&&value.oracle.length===task.spec.checks.length&&value.oracle.every(c=>c.passed)&&value.empty.length===task.spec.checks.length&&value.empty.some(c=>!c.passed)?value:null;}catch{return null;}
}
export async function validateTask(task:BenchTask,dataRoot:string):Promise<Validation>{
  const scratch=mkdtempSync(join(tmpdir(),'ava-bench-validation-'));
  try{
    const oracle=join(scratch,'oracle'),empty=join(scratch,'empty');
    for(const dir of [oracle,empty]){mkdirSync(dir);putFiles(dir,task.files,'fixture/');}
    putFiles(oracle,task.files.filter(f=>f.path!=='solution/answer.txt'),'solution/');
    // Hidden verifiers are installed after the candidate has finished, in a fresh checking workspace.
    for(const dir of [oracle,empty])putFiles(dir,task.files.filter(f=>f.path.startsWith('tests/')));
    const answer=task.files.find(f=>f.path==='solution/answer.txt')?.bytes.toString('utf8')??'';
    const [yes,no]=await Promise.all([checkTask(task,answer,oracle),checkTask(task,'',empty)]);
    const result:Validation={taskId:task.spec.id,version:task.spec.version,digest:task.digest,checkerVersion:CHECKER_VERSION,validated:yes.every(c=>c.passed)&&no.some(c=>!c.passed),oracle:yes,empty:no,at:new Date().toISOString()};
    const file=validationPath(dataRoot,task);
    for(const dir of [resolve(dataRoot),join(dataRoot,'benchmarks'),dirname(file)]){if(existsSync(dir)&&lstatSync(dir).isSymbolicLink())throw new AvAError('BENCH_LINK','Benchmark data folders must not be links.');mkdirSync(dir,{recursive:true});}
    const pending=file+'.'+randomUUID()+'.tmp';try{writeFileSync(pending,JSON.stringify(result,null,2)+'\n',{flag:'wx'});renameSync(pending,file);}finally{rmSync(pending,{force:true});}return result;
  }finally{
    if(dirname(resolve(scratch))!==resolve(tmpdir())||!basename(scratch).startsWith('ava-bench-validation-'))throw new AvAError('BENCH_CLEANUP','Refused an unsafe scratch cleanup path.');
    rmSync(scratch,{recursive:true,force:true});
  }
}
