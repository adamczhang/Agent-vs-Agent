import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertNodeVersion,defaultDataRoot } from './paths.js';
import { runCommand } from './text-client.js';

// Terminal client for a running service. Also still serves --request-file calls from hooks installed before 0.2.0.
const dataRoot=defaultDataRoot();
const args=process.argv.slice(2);
function option(name:string){const i=args.indexOf(name);return i>=0?args[i+1]:undefined;}
let thread=option('--thread')??process.env.CODEX_THREAD_ID??'terminal',command=option('--command')??'/ava';
const requestFile=option('--request-file');if(requestFile){const r=JSON.parse(readFileSync(requestFile,'utf8'));thread=r.thread;command=r.command;}
async function main(){
  assertNodeVersion();
  if(process.env.AVA_PARTICIPANT==='1')throw new Error('AvA participants cannot control their parent plugin.');
  const file=join(dataRoot,'server.json');
  if(!existsSync(file))throw new Error('The AvA service is not running. Open AvA from Codex or Claude Code (or run npm run serve for development, with the same AVA_DATA_DIR).');
  const runtime=JSON.parse(readFileSync(file,'utf8')) as {port:number;token:string;pid:number};
  const rpc=async(method:string,params:unknown)=>{
    const response=await fetch(`http://127.0.0.1:${runtime.port}/api`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${runtime.token}`},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(150000)});
    const body=await response.json() as {result:unknown;error?:string};if(!response.ok||body.error)throw new Error(body.error??'Service request failed');return body.result;
  };
  console.log(await runCommand({rpc,thread,command,roomUrl:roomId=>`http://127.0.0.1:${runtime.port}/#token=${runtime.token}&room=${roomId}`}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
