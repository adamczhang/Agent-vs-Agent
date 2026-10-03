// C5: plugin lifecycle in a throwaway Codex profile (temporary CODEX_HOME and LOCALAPPDATA). The user's real
// Codex profile, data, and hook trust are never touched. No model requests: only install, inspect, and local RPC.
// Usage: node --import tsx scripts/lifecycle.ts [--out <results.json>]
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {listProcesses} from '../src/census.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const codex=join(process.env.APPDATA!,'npm','node_modules','@openai','codex','bin','codex.js');
const marketplace=resolve('release','marketplace'),plugin=join(marketplace,'plugins','agent-vs-agent');
if(!existsSync(join(plugin,'packaged.json')))throw new Error('Build the package first: npm run package');
const profile=mkdtempSync(join(tmpdir(),'ava-codex-profile-')),local=mkdtempSync(join(tmpdir(),'ava-localappdata-')),project=mkdtempSync(join(tmpdir(),'ava-project-'));
const dataRoot=join(local,'AgentVsAgent'),pluginId='agent-vs-agent@ava';
// A short idle timeout made the service exit between test steps; 60 s keeps it up while a session is open.
// AVA_DATA_DIR (forwarded by the plugin's env_vars) keeps the throwaway run out of the user's shared data folder.
const env=Object.fromEntries(Object.entries({...process.env,CODEX_HOME:profile,LOCALAPPDATA:local,AVA_DATA_DIR:dataRoot,AVA_IDLE_TIMEOUT_MS:'60000'}).filter((e):e is [string,string]=>e[1]!==undefined));
const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[],check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);return pass;};
const cli=(...a:string[])=>{const r=spawnSync(process.execPath,[codex,...a],{env,encoding:'utf8',windowsHide:true,timeout:600_000});return {status:r.status,out:(r.stdout+r.stderr).trim()};};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// One app-server session in the throwaway profile; returns what this step needs to inspect. `during` runs while the
// session is open: Codex ends the MCP server's whole process tree (including the AvA service) when the session closes.
async function inspect(label:string,during?:()=>Promise<void>){
  const child=spawn(process.execPath,[codex,'app-server'],{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let serial=0;const pending=new Map<number,(m:any)=>void>();
  createInterface({input:child.stdout}).on('line',line=>{let m:any;try{m=JSON.parse(line);}catch{return;}if(m.id!==undefined&&!m.method){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.id!==undefined&&m.method)child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'lifecycle check'}})+'\n');});
  const call=(method:string,params:unknown)=>new Promise<any>((res,rej)=>{const id=++serial,t=setTimeout(()=>rej(new Error('timeout '+method)),60_000);pending.set(id,m=>{clearTimeout(t);res(m);});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  try{
    await call('initialize',{clientInfo:{name:'ava-lifecycle',version:'1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    const hooks=(await call('hooks/list',{cwds:[project]})).result?.data?.[0]?.hooks??[];
    const ours=hooks.filter((h:any)=>/agent-vs-agent/.test(h.pluginId??''));
    const installed=(await call('plugin/installed',{})).result;
    await call('thread/start',{cwd:project,ephemeral:true});
    let ava:any;for(const deadline=Date.now()+30_000;Date.now()<deadline;await sleep(500)){const s=(await call('mcpServerStatus/list',{})).result;ava=(s?.data??[]).find((x:any)=>x.name==='ava');if(ava?.tools&&Object.keys(ava.tools).length||ava?.toolsError)break;}
    if(during)await during();
    return {label,hooks:ours.map((h:any)=>({pluginId:h.pluginId,eventName:h.eventName,enabled:h.enabled,trustStatus:h.trustStatus,sourcePath:h.sourcePath})),installed:JSON.stringify(installed??null).slice(0,2000),ava:ava?{runtimeStatus:ava.runtimeStatus,tools:Object.keys(ava.tools??{}),toolsError:ava.toolsError??null,pluginId:ava.pluginId}:null};
  }finally{child.stdin.end();setTimeout(()=>child.kill(),2000).unref();await sleep(2500);}
}
// The product restarts a dead service on its next tool call (rpc -> ensureService). These direct checks skip that path,
// so when the service is unreachable they use the installed plugin's own ensureService, and the evidence counts it.
let serviceRestarts=0;
async function restartThroughPlugin(){
  const cache=join(profile,'plugins','cache','ava','agent-vs-agent'),version=readdirSync(cache).sort().at(-1)!;
  const {ensureService}=await import(pathToFileURL(join(cache,version,'dist','src','connection.js')).href) as {ensureService(root:string,data:string):Promise<unknown>};
  process.env.AVA_IDLE_TIMEOUT_MS='5000';serviceRestarts++;await ensureService(join(cache,version),dataRoot);
}
async function service(method:string,params:unknown){
  for(let attempt=0;attempt<2;attempt++){try{return await callService(method,params,attempt?20_000:5_000);}catch(error){if(attempt)throw error;await restartThroughPlugin();}}
}
async function callService(method:string,params:unknown,waitMs:number){
  for(const deadline=Date.now()+waitMs;;await sleep(250)){
    let s:{pid?:number;port?:number;token?:string}={};
    try{s=JSON.parse(readFileSync(join(dataRoot,'server.json'),'utf8'));const r=await fetch(`http://127.0.0.1:${s.port}/api`,{method:'POST',headers:{Authorization:`Bearer ${s.token}`},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(3000)});const body=await r.json() as {result:any;error?:string};if(body.error)throw new Error(`${method}: ${body.error}`);return body.result;}
    catch(error){
      if(Date.now()<=deadline)continue;
      let alive=false;try{if(s.pid){process.kill(s.pid,0);alive=true;}}catch{/* dead */}
      const cause=(error as {cause?:{code?:string;message?:string}}).cause;
      throw new Error(`${method} failed: ${(error as Error).message}${cause?` (${cause.code??cause.message})`:''}; service pid ${s.pid} alive=${alive}, port ${s.port}`);
    }
  }
}
const setEnabled=(enabled:boolean)=>{const file=join(profile,'config.toml'),text=existsSync(file)?readFileSync(file,'utf8'):'';const header=`[plugins."${pluginId}"]`;
  writeFileSync(file,text.includes(header)?text.replace(new RegExp(`(\\[plugins\\."${pluginId.replace(/[.@-]/g,'\\$&')}"\\]\\s*\\n\\s*enabled\\s*=\\s*)(true|false)`),`$1${enabled}`):text+`\n${header}\nenabled = ${enabled}\n`);};
const versionOf=(dir:string)=>JSON.parse(readFileSync(join(dir,'package.json'),'utf8')).version as string;
const bump=(to:string)=>{for(const f of [join(plugin,'package.json'),join(plugin,'.codex-plugin','plugin.json')]){const j=JSON.parse(readFileSync(f,'utf8'));j.version=to;writeFileSync(f,JSON.stringify(j,null,2));}};
const original=versionOf(plugin),next=original.replace(/\d+$/,n=>String(Number(n)+1));
// Never leave the release artifact at the bumped test version, even on Ctrl+C.
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{bump(original);process.exit(130);});
const evidence:Record<string,unknown>={step:'C5 lifecycle (throwaway profile)',recordedAt:new Date().toISOString(),profile,localAppData:local,project,pluginId,original};
try{
  // Install.
  const added=cli('plugin','marketplace','add',marketplace,'--json');check('marketplace added to the throwaway profile',added.status===0,added.out.slice(0,400));
  const install=cli('plugin','add',pluginId,'--json');check('plugin installs',install.status===0,install.out.slice(0,400));
  // Seed user data through the service while this session (and so the service) is alive.
  const first=await inspect('installed',async()=>{
    await service('preset.save',{requestId:'seed',name:'kept across upgrades',data:{instructions:{cli1:'',cli2:''},stopWhen:{cli1:'',cli2:''},completion:'auto',minutes:'',requests:'',pace:'5'}});
    await service('pair.create',{thread:'lifecycle-chat'});
  });evidence.installed=first;
  check('exactly one AvA prompt hook is registered',first.hooks.filter((h:any)=>/userPromptSubmit/i.test(h.eventName)).length===1,first.hooks);
  check('a fresh install leaves the new hook for the user to review (not trusted automatically)',first.hooks.every((h:any)=>h.trustStatus!=='trusted'),first.hooks.map((h:any)=>h.trustStatus));
  check('the packaged MCP server starts from the installed plugin (.mcp.json resolves)',!!first.ava&&first.ava.tools.includes('ava_command'),first.ava);
  const installedHook=first.hooks[0]?.sourcePath?resolve(first.hooks[0].sourcePath,'..','route.mjs'):undefined;
  if(installedHook){const r=spawnSync(process.execPath,[installedHook],{env:{...env,PLUGIN_ROOT:resolve(installedHook,'..','..')},input:JSON.stringify({thread_id:'lifecycle',prompt:'/ava CLI2'}),encoding:'utf8',windowsHide:true});check('the installed hook routes /ava CLI2 to ava_command',/ava_command/.test(r.stdout)&&/\/ava CLI2/.test(r.stdout));}
  check('data lives in the throwaway data folder',existsSync(join(dataRoot,'ava.sqlite')));
  // Upgrade to a bumped version built from the same artifact; read the seeded data back through the new version's service.
  bump(next);const upgraded=cli('plugin','add',pluginId,'--json');
  let presets:string[]=[],version='';
  const second=await inspect('upgraded',async()=>{presets=(await service('preset.list',{})).presets.map((p:any)=>p.name);version=(await service('health',{})).version;});evidence.upgraded={...second,serviceVersion:version};
  check('upgrade installs the new version',upgraded.status===0&&second.installed.includes(next)&&version===next,{out:upgraded.out.slice(0,300),serviceVersion:version});
  check('upgrade keeps saved data',presets.includes('kept across upgrades'),presets);
  check('still exactly one AvA prompt hook after upgrade',second.hooks.filter((h:any)=>/userPromptSubmit/i.test(h.eventName)).length===1,second.hooks);
  // Disable, then enable.
  setEnabled(false);const disabled=await inspect('disabled');evidence.disabled=disabled;
  check('disabling removes the hook and the MCP server',disabled.hooks.length===0&&!disabled.ava,disabled);
  setEnabled(true);const enabled=await inspect('enabled');evidence.enabled=enabled;
  check('enabling restores them',enabled.hooks.length===1&&!!enabled.ava?.tools.includes('ava_command'),enabled);
  // Remove.
  const removed=cli('plugin','remove',pluginId,'--json');const after=await inspect('removed');evidence.removed=after;
  check('removal unregisters the hook and MCP server',removed.status===0&&after.hooks.length===0&&!after.ava,{out:removed.out.slice(0,300),after});
  check('removal keeps user data',existsSync(join(dataRoot,'ava.sqlite')));
  await sleep(8000); // a service restarted by these checks idles out after 5 s
  const leftovers=(await listProcesses()).filter(p=>p.pid!==process.pid);
  const cmd=spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile.replaceAll("'","''")}*' -or $_.CommandLine -like '*${local.replaceAll("'","''")}*' } | Select-Object -ExpandProperty ProcessId`],{encoding:'utf8',windowsHide:true});
  const stray=cmd.stdout.split(/\s+/).filter(Boolean).map(Number).filter(pid=>leftovers.some(p=>p.pid===pid));
  check('no AvA or provider process is left running from the throwaway profile',stray.length===0,stray);
}catch(error){check('lifecycle completed without an unexpected error',false,error instanceof Error?error.message:String(error));}
finally{
  bump(original);
  // The throwaway profile holds a full copy of the plugin (hundreds of MB); keep it only with --keep for debugging.
  if(!args.includes('--keep'))for(const dir of [profile,local,project])try{rmSync(dir,{recursive:true,force:true,maxRetries:3});}catch{/* reported paths stay in the evidence */}
}
evidence.serviceRestartsByChecks=serviceRestarts;
evidence.checks=checks;evidence.status=checks.length&&checks.every(c=>c.pass)?'passed':'failed';
const out=option('--out');if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(evidence,null,2));}
console.log(JSON.stringify({status:evidence.status,checks:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.name)}));
if(evidence.status!=='passed')process.exitCode=1;
