import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { dirname,join,resolve,relative,isAbsolute } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { AvAError } from './types.js';

export const benchPath=z.string().min(1).max(240).refine(p=>!/[\\<>:"|?*\x00-\x1f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s!=='.'&&s!=='..'&&s!=='.git'&&!!s&&!/[ .]$/.test(s)&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s)),'Use a relative path without links, traversal, reserved names or alternate streams.');
const checkSchema=z.union([
  z.object({equals:z.string().max(32000)}).strict(),z.object({contains:z.string().min(1).max(32000)}).strict(),
  z.object({regex:z.string().min(1).max(2000),flags:z.string().regex(/^[imsu]*$/).optional(),timeout_ms:z.number().int().min(50).max(5000).optional()}).strict().refine(c=>{try{new RegExp(c.regex,c.flags);return true;}catch{return false;}},'Invalid regular expression or flags.'),
  z.object({number:z.object({value:z.number().finite(),tolerance:z.number().finite().nonnegative().default(0)}).strict()}).strict(),
  z.object({json_path:z.object({path:z.string().max(500).regex(/^\$(?:\.[A-Za-z_$][\w$]*|\[(?:0|[1-9]\d*)\])*$/),equals:z.json()}).strict()}).strict(),
  z.object({file_exists:benchPath}).strict(),
  z.object({run:z.string().regex(/^node tests\/[A-Za-z0-9_./-]+\.m?js$/),timeout_ms:z.number().int().min(100).max(60000).optional()}).strict(),
]);
const schema=z.object({id:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),version:z.number().int().positive(),mode:z.enum(['prompt','build','review']),
  title:z.string().min(1).max(160).optional(),prompt:z.string().min(1).max(16000),time_limit_minutes:z.number().positive().max(60).default(5),checks:z.array(checkSchema).min(1).max(30),rubric:z.string().max(4000).optional(),
  // container: run this task's verifiers in Docker (src/containers.ts), for bundles that aren't trusted on the host.
  isolation:z.enum(['container']).optional()}).strict();
export type BenchCheck=z.infer<typeof checkSchema>;
export type TaskSpec=z.infer<typeof schema>;
export interface TaskFile {path:string;bytes:Buffer}
export interface BenchTask {spec:TaskSpec;directory:string;digest:string;files:TaskFile[]}
export const TASK_LIMITS={files:1000,bytes:16*1024*1024};
export function safeBenchFile(root:string,name:string){
  benchPath.parse(name);const base=resolve(root),target=resolve(base,name),rel=relative(base,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new AvAError('BENCH_PATH','File escaped its benchmark workspace.');
  for(let at=target;;at=dirname(at)){
    if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw new AvAError('BENCH_LINK','A benchmark file or parent is a link.');
    if(at===base)break;
  }
  return target;
}
export function treeFiles(root:string):TaskFile[]{
  const files:TaskFile[]=[];let size=0;
  function walk(dir:string){
    const full=join(root,dir),info=lstatSync(full);if(info.isSymbolicLink())throw new AvAError('BENCH_LINK','Benchmark files and folders must not be links.');
    for(const entry of readdirSync(full,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=dir?`${dir}/${entry.name}`:entry.name;if(entry.name==='.git')continue;benchPath.parse(path);
      const stat=lstatSync(join(root,path));if(stat.isSymbolicLink())throw new AvAError('BENCH_LINK','Benchmark files and folders must not be links.');
      if(stat.isDirectory())walk(path);else if(stat.isFile()){
        if(files.length>=TASK_LIMITS.files||(size+=stat.size)>TASK_LIMITS.bytes)throw new AvAError('BENCH_SIZE','Benchmark files exceed the 1,000-file or 16 MiB limit.');
        files.push({path,bytes:readFileSync(join(root,path))});
      }else throw new AvAError('BENCH_FILE','Only regular benchmark files are supported.');
    }
  }
  walk('');return files;
}
export function putFiles(root:string,files:TaskFile[],prefix=''){
  if(existsSync(root)&&lstatSync(root).isSymbolicLink())throw new AvAError('BENCH_LINK','Benchmark workspaces must not be links.');
  for(const file of files){if(prefix&&!file.path.startsWith(prefix))continue;const name=prefix?file.path.slice(prefix.length):file.path;benchPath.parse(name);
    const target=safeBenchFile(root,name);
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.bytes);
  }
}
export function loadTask(directory:string):BenchTask{
  const root=resolve(directory),files=treeFiles(root),manifest=files.find(f=>f.path==='task.yaml');
  if(!manifest||manifest.bytes.length>64000)throw new AvAError('BENCH_TASK','A task needs task.yaml of at most 64 KiB.');
  const doc=parseDocument(manifest.bytes.toString('utf8'),{uniqueKeys:true});if(doc.errors.length)throw new AvAError('BENCH_TASK',doc.errors[0]!.message);
  const spec=schema.parse(doc.toJS({maxAliasCount:20}));
  if(!files.some(f=>f.path.startsWith('solution/')))throw new AvAError('BENCH_SOLUTION','A reference solution is required.');
  if(spec.mode!=='build'&&!files.some(f=>f.path==='solution/answer.txt'))throw new AvAError('BENCH_SOLUTION','Prompt and Review tasks need solution/answer.txt.');
  for(const check of spec.checks){
    if('run'in check){const path=check.run.slice(5);benchPath.parse(path);if(!files.some(f=>f.path===path))throw new AvAError('BENCH_VERIFIER',`Missing verifier ${path}.`);}
    if(spec.mode==='prompt'&&('run'in check||'file_exists'in check))throw new AvAError('BENCH_CHECK','Prompt tasks use answer checks.');
  }
  const hash=createHash('sha256');for(const file of files){hash.update(file.path+'\0'+file.bytes.length+'\0');hash.update(file.bytes);}
  return {spec,directory:root,digest:hash.digest('base64url'),files};
}
export function loadSuite(directory:string):BenchTask[]{
  const root=resolve(directory);if(lstatSync(root).isSymbolicLink())throw new AvAError('BENCH_LINK','A benchmark suite must not be a link.');
  const tasks=existsSync(join(root,'task.yaml'))?[loadTask(root)]:readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()||d.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>loadTask(join(root,d.name)));
  if(!tasks.length)throw new AvAError('BENCH_SUITE','The suite contains no tasks.');
  if(new Set(tasks.map(t=>t.spec.id)).size!==tasks.length)throw new AvAError('BENCH_ID','Task IDs must be unique inside a suite.');
  return tasks;
}
