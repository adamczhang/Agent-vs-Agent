// Read-only check of AvA's prompt hook in the user's Codex (hooks/list on a Codex app-server; nothing is changed).
// Usage: node --import tsx scripts/verify-host-hook.ts [--plugin agent-vs-agent@ava] [--out <evidence.json>] [--expect trusted|any]
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {dirname,join,resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const pluginId=option('--plugin')??'agent-vs-agent@ava',out=option('--out'),expect=option('--expect')??'trusted';
const codex=join(process.env.APPDATA!,'npm','node_modules','@openai','codex','bin','codex.js');
const child=spawn(process.execPath,[codex,'app-server'],{cwd:resolve('.'),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let serial=0;const requests=new Map<number,{resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>();
const lines=createInterface({input:child.stdout});let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-8000);});
lines.on('line',line=>{try{const value=JSON.parse(line);const pending=requests.get(value.id);if(pending){requests.delete(value.id);clearTimeout(pending.timer);if(value.error)pending.reject(new Error(value.error.message));else pending.resolve(value.result);}}catch{}});
function call(method:string,params:unknown):Promise<any>{return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{requests.delete(id);reject(new Error('Host inspection timeout: '+method));},30000);requests.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
try{
  await call('initialize',{clientInfo:{name:'ava-hook-verification',version:'0.2.2'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const response=await call('hooks/list',{cwds:[resolve('.')]});
  const entries=response.data.map((entry:any)=>({cwd:entry.cwd,errors:entry.errors,hooks:entry.hooks.filter((hook:any)=>hook.pluginId===pluginId).map((hook:any)=>({eventName:hook.eventName,enabled:hook.enabled,trustStatus:hook.trustStatus,sourcePath:hook.sourcePath}))}));
  const hooks=entries.flatMap((entry:any)=>entry.hooks),found=hooks.some((hook:any)=>hook.eventName==='userPromptSubmit'&&hook.enabled);
  const passed=found&&(expect==='any'||hooks.every((hook:any)=>hook.trustStatus==='trusted'));
  const result={status:passed?'passed':'failed',pluginId,expect,verifiedAt:new Date().toISOString(),method:'read-only hooks/list on the installed Codex app-server',entries};
  if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
  console.log(JSON.stringify(result));if(!passed)process.exitCode=1;
}catch(error){console.error(error);process.exitCode=1;}
finally{child.stdin.end();lines.close();const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer));}
