import { readFileSync,openSync,closeSync,fstatSync,readSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { AvAError } from './types.js';
import { ownerAlive } from './ownership.js';
export interface Endpoint {pid:number;port:number;token:string}
export function endpoint(dataRoot:string):Endpoint{
  const value=JSON.parse(readFileSync(join(dataRoot,'server.json'),'utf8')) as Endpoint;
  if(!Number.isInteger(value.pid)||!Number.isInteger(value.port)||value.port<1||value.port>65535||!/^[a-f0-9]{64}$/.test(value.token))throw new AvAError('INVALID_ENDPOINT','Invalid local service address.');
  return value;
}
export async function callEndpoint<T=unknown>(address:Endpoint,method:string,params:unknown,timeoutMs=150000):Promise<T>{
  const response=await fetch(`http://127.0.0.1:${address.port}/api`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+address.token},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(timeoutMs)});
  const body=await response.json() as {result:T;error?:string;code?:string};
  if(!response.ok||body.error)throw new AvAError(body.code??'SERVICE_ERROR',body.error??'Local service request failed.');return body.result;
}
// Why a service this caller started has exited: the failure line it writes to its log (see server.ts), or else the
// error line Node printed for a crash before it could. Only the log written since the start is read.
export function startFailure(logFile:string,from:number,pid?:number):{code:string;error:string}|undefined{
  let text='';
  try{
    const fd=openSync(logFile,'r');
    try{const size=fstatSync(fd).size,length=Math.min(Math.max(0,size-from),65536),bytes=Buffer.alloc(length);readSync(fd,bytes,0,length,size-length);text=bytes.toString('utf8');}
    finally{closeSync(fd);}
  }catch{return undefined;}
  const scrub=(value:unknown)=>String(value).replace(/\b[a-f0-9]{64}\b/g,'<redacted>').slice(0,500);
  for(const line of text.split(/\r?\n/).reverse()){
    if(!line.startsWith('{'))continue;
    try{const entry=JSON.parse(line) as {status?:string;pid?:number;code?:string;error?:string};if(entry.status==='failed'&&(pid===undefined||entry.pid===pid))return {code:scrub(entry.code),error:scrub(entry.error)};}catch{/* not a status line */}
  }
  const thrown=[...text.matchAll(/^\w*Error(?: \[\w+\])?: (.+)$/gm)].pop()?.[1];
  return thrown?{code:'SERVICE_CRASHED',error:scrub(thrown.trim())}:undefined;
}
// A service that fails exits and is reported at once, so the wait only bounds a healthy start. The first start after an
// install reads the engine's files cold (antivirus scanning them too), which a slow machine can take well over 15 s to
// do; 45 s stays inside Codex's 60-second limit for a tool call.
export async function ensureService(projectRoot:string,dataRoot:string,waitMs=45_000):Promise<Endpoint>{
  // ownerRunning: whether the recorded owner is still that process. The lock is read on every pass, so an owner that
  // shuts down during the wait (an idle exit removes its lock) is replaced at once; asking the system whether a locked
  // owner still runs (a crash leaves its lock) is slower, so that is repeated only every 5 s.
  const logFile=join(dataRoot,'service.log');
  try{mkdirSync(dataRoot,{recursive:true});}
  catch(error){throw new AvAError('SERVICE_START_FAILED',`AvA's data folder ${dataRoot} can't be created (${error instanceof Error?error.message:String(error)}).`);}
  let spawned=false,ownerRunning:boolean|undefined,ownerCheckedAt=0,child:{pid?:number;exited:boolean}|undefined,logFrom=0;
  const deadline=Date.now()+waitMs;
  while(Date.now()<deadline){
    try{const address=endpoint(dataRoot);const health=await callEndpoint<{pid:number}>(address,'health',{},1000);if(health.pid===address.pid)return address;}catch{/* An existing owner may still be starting. */}
    // A service this call started has exited: say why at once, instead of waiting out the deadline. One that lost the
    // race to another starting service leaves that one to become ready.
    if(child?.exited){
      const failure=startFailure(logFile,logFrom,child.pid);child=undefined;
      if(failure?.code!=='OWNER_EXISTS')throw new AvAError('SERVICE_START_FAILED',`AvA's service could not start: ${failure?.error??'it stopped without saying why.'} Details are in ${logFile}.`);
    }
    if(!spawned){
      let lock:{pid:number;started?:number}|undefined;try{lock=JSON.parse(readFileSync(join(dataRoot,'service.lock'),'utf8'));}catch{/* No owner recorded. */}
      if(!lock)ownerRunning=false;
      else if(ownerRunning===undefined||Date.now()-ownerCheckedAt>=5000){ownerCheckedAt=Date.now();ownerRunning=ownerAlive(lock.pid,lock.started);}
      if(!ownerRunning){
        let log:number;
        try{log=openSync(logFile,'a',0o600);logFrom=fstatSync(log).size;}
        catch(error){throw new AvAError('SERVICE_START_FAILED',`AvA can't write to its data folder ${dataRoot} (${error instanceof Error?error.message:String(error)}).`);}
        try{
          const started=spawn(process.execPath,[join(projectRoot,'dist','src','server.js'),'--daemon'],{cwd:projectRoot,env:{...process.env,AVA_DATA_DIR:dataRoot},detached:true,windowsHide:true,stdio:['ignore',log,log]});
          const watched={pid:started.pid,exited:false};child=watched;
          started.on('error',()=>{watched.exited=true;});started.on('exit',()=>{watched.exited=true;});started.unref();spawned=true;
        }finally{closeSync(log);}
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new AvAError('SERVICE_START_FAILED',`The AvA service did not become ready within ${Math.round(waitMs/1000)} s. Inspect ${logFile}.`);
}
