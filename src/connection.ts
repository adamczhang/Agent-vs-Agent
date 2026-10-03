import { readFileSync,openSync,closeSync,mkdirSync } from 'node:fs';
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
export async function ensureService(projectRoot:string,dataRoot:string):Promise<Endpoint>{
  // ownerRunning: whether the recorded owner is still that process (checked once per call; it may ask the system).
  mkdirSync(dataRoot,{recursive:true});let spawned=false,ownerRunning:boolean|undefined;
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    try{const address=endpoint(dataRoot);const health=await callEndpoint<{pid:number}>(address,'health',{},1000);if(health.pid===address.pid)return address;}catch{/* An existing owner may still be starting. */}
    if(!spawned){
      if(ownerRunning===undefined){try{const lock=JSON.parse(readFileSync(join(dataRoot,'service.lock'),'utf8')) as {pid:number;started?:number};ownerRunning=ownerAlive(lock.pid,lock.started);}catch{ownerRunning=false;/* No live owner. */}}
      if(!ownerRunning){
        const log=openSync(join(dataRoot,'service.log'),'a',0o600);
        try{const child=spawn(process.execPath,[join(projectRoot,'dist','src','server.js'),'--daemon'],{cwd:projectRoot,env:{...process.env,AVA_DATA_DIR:dataRoot},detached:true,windowsHide:true,stdio:['ignore',log,log]});child.on('error',()=>{});child.unref();spawned=true;}
        finally{closeSync(log);}
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new AvAError('SERVICE_START_FAILED',`The AvA service did not become ready. Inspect ${join(dataRoot,'service.log')}.`);
}
