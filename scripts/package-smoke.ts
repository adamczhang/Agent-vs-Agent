// Smoke-tests a built plugin folder in isolation: throwaway data folder, no provider work, no reference to this checkout.
// The real shared data folder (package.json config.dataDir) is never touched: with --copy the copy is pointed at a temporary
// folder through its own config (an end-to-end check of that setting), otherwise AVA_DATA_DIR overrides it.
// Usage: node --import tsx scripts/package-smoke.ts [pluginDir] [--copy] [--out <evidence.json>]
import {cpSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const args=process.argv.slice(2),flag=(n:string)=>args.includes(n),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const source=resolve(args.find(a=>!a.startsWith('--')&&a!==option('--out'))??'release/marketplace/plugins/agent-vs-agent');
const checkout=resolve('.');
const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[],check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
let plugin=source;
if(flag('--copy')){plugin=join(mkdtempSync(join(tmpdir(),'ava-pkg-copy-')),'agent-vs-agent');cpSync(source,plugin,{recursive:true});}
const sharedDataDir=(JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')) as {config?:{dataDir?:string}}).config?.dataDir;
const local=mkdtempSync(join(tmpdir(),'ava-pkg-localappdata-')),dataRoot=join(local,'AgentVsAgent');
if(flag('--copy')){const file=join(plugin,'package.json'),runtime=JSON.parse(readFileSync(file,'utf8'));runtime.config={...runtime.config,dataDir:dataRoot};writeFileSync(file,JSON.stringify(runtime,null,2));}
const env=Object.fromEntries(Object.entries({...process.env,LOCALAPPDATA:local,AVA_IDLE_TIMEOUT_MS:'1500',PLUGIN_ROOT:plugin,AVA_DATA_DIR:flag('--copy')?undefined:dataRoot}).filter((e):e is [string,string]=>e[1]!==undefined));
// Diagnostic smoke checks must never consult the user's real Gateway key.
env.AI_GATEWAY_API_KEY='';env.AVA_GATEWAY_KEY_DIR='';

// 1. No file outside node_modules may point back into the development checkout.
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'?[]:e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const needles=[checkout,checkout.replaceAll('\\','/'),checkout.replaceAll('\\','\\\\')];
const leaks=walk(plugin).filter(f=>{const text=readFileSync(f,'latin1');return needles.some(n=>text.includes(n));}).map(f=>f.slice(plugin.length+1));
check('no plugin file references the development checkout',leaks.length===0,leaks);
check('packaged marker present',existsSync(join(plugin,'packaged.json')));
// The installed Codex and Claude Code CLIs are used, so the adapters' bundled copies (about 660 MB) must not ship.
const bundledClis=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(e=>/^(codex|claude-agent-sdk)-(win32|darwin|linux)-/.test(e.name)&&/@(openai|anthropic-ai)$/.test(dir)?[join(dir,e.name)]:bundledClis(join(dir,e.name)));
const shipped=existsSync(join(plugin,'node_modules'))?bundledClis(join(plugin,'node_modules')).map(f=>f.slice(plugin.length+1)):[];
check('no bundled Codex or Claude Code binaries (the installed CLIs are used)',shipped.length===0,shipped);
const expectedDataDir=(JSON.parse(readFileSync(join(checkout,'package.json'),'utf8')) as {config?:{dataDir?:string}}).config?.dataDir;
// A build with config.dataDir carries it into the plugin; a build without one (the public default) uses the home folder.
check(expectedDataDir?`plugin uses the shared data folder (${expectedDataDir})`:'plugin uses the default data folder (%USERPROFILE%\\AgentVsAgent)',expectedDataDir?sharedDataDir===expectedDataDir:sharedDataDir===undefined,{sharedDataDir});

// 2. The host wrapper routes a typed command to the MCP tool: the Codex prompt hook, or the Claude Code /ava skill. Both hosts
//    take the same /ava commands, and each passes its own chat identity (Codex's thread ID, Claude Code's session ID).
const claude=existsSync(join(plugin,'.claude-plugin','plugin.json'));
let commandName='/ava';
if(claude){
  const command=readFileSync(join(plugin,'skills','ava','SKILL.md'),'utf8'),mcp=readFileSync(join(plugin,'.mcp.json'),'utf8');
  check('Claude Code /ava is a skill named ava (bare /ava works, like Codex) that passes this conversation’s session ID as the thread',/^name: ava\s*$/m.test(command)&&command.includes('thread `claude-${CLAUDE_SESSION_ID}`')&&!existsSync(join(plugin,'commands','ava.md')));
  check('Claude Code /ava command calls ava_command and pre-approves only that tool, only while it runs',/ava_command/.test(command)&&/\$ARGUMENTS/.test(command)&&/allowed-tools: mcp__plugin_agent-vs-agent_ava__ava_command\s*$/m.test(command));
  // Otherwise Claude could run the command itself (Skill tool) and inherit that pre-approval without the user typing it.
  check('only the user can run the /ava command (disable-model-invocation)',/^disable-model-invocation: true\s*$/m.test(command));
  check('Claude Code MCP config uses ${CLAUDE_PLUGIN_ROOT} and the wrapper has no hooks',mcp.includes('${CLAUDE_PLUGIN_ROOT}/dist/src/server.js')&&!existsSync(join(plugin,'hooks')));
}else{
  const hook=spawnSync(process.execPath,[join(plugin,'hooks','route.mjs')],{env,input:JSON.stringify({thread_id:'pkg-smoke',prompt:'/ava cli1'}),encoding:'utf8',windowsHide:true});
  check('packaged hook routes /ava CLI1 to ava_command',hook.status===0&&/ava_command/.test(hook.stdout)&&/command \\"\/ava CLI1\\"/.test(hook.stdout));
}

// How this plugin's host starts its MCP server, as the plugin's own .mcp.json declares it: Codex runs the command in the
// declared folder with only the env_vars allow-list; Claude Code expands ${CLAUDE_PLUGIN_ROOT} and passes its whole
// environment plus the server's env block. dataDir undefined leaves the plugin's own setting (--copy) in charge.
type Declared={command:string;args:string[];cwd?:string;env?:Record<string,string>;env_vars?:string[]};
const declared=(JSON.parse(readFileSync(join(plugin,'.mcp.json'),'utf8')) as {mcpServers:{ava:Declared}}).mcpServers.ava;
const hostName=claude?'Claude Code':'Codex';
// Without AVA_DATA_DIR in Codex's allow-list, a test would reach the plugin's configured (real) data folder. Refuse that.
if(!claude&&!(declared.env_vars??[]).includes('AVA_DATA_DIR'))throw new Error('This plugin\'s env_vars omit AVA_DATA_DIR, so a test could reach the real data folder. Not started.');
function hostLaunch(dataDir:string|undefined){
  const base:Record<string,string>={...env,...(dataDir?{AVA_DATA_DIR:dataDir}:{})};
  const environment=claude?{...base,...declared.env}:Object.fromEntries((declared.env_vars??[])
    .map(name=>[name,Object.entries(base).find(([key])=>key.toUpperCase()===name.toUpperCase())?.[1]])
    .filter((e):e is [string,string]=>typeof e[1]==='string'));
  return {command:declared.command,args:declared.args.map(a=>a.replaceAll('${CLAUDE_PLUGIN_ROOT}',plugin)),env:environment,cwd:claude?tmpdir():resolve(plugin,declared.cwd??'.'),stderr:'pipe' as const};
}
// A data folder like one on a second drive: the account owns it but holds Modify, not the right to take ownership, so
// securing secrets there must not need it (the 0.2.0 failure). It already has a secrets folder, which the service
// secures as it starts.
function modifyOnly(dir:string){
  mkdirSync(join(dir,'secrets'),{recursive:true});
  if(process.platform!=='win32')return;
  const script=`$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($path in @($env:AVA_SMOKE_DIR,(Join-Path $env:AVA_SMOKE_DIR 'secrets'))){
  $acl=New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
  (Get-Item -LiteralPath $path).SetAccessControl($acl)
}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,AVA_SMOKE_DIR:dir},encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error('Could not prepare the Modify-only data folder: '+result.stderr.trim().split(/\r?\n/)[0]);
}
const finish=():never=>{
  const status=checks.every(c=>c.pass)?'passed':'failed',result={status,recordedAt:new Date().toISOString(),plugin,copied:flag('--copy'),checks};
  const out=option('--out');if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
  console.log(JSON.stringify({status,checks:checks.length}));process.exit(status==='passed'?0:1);
};

// 3. The MCP server starts as its host starts it, in a Modify-only data folder (here a temporary one), keeps its data
//    there, and serves a typed menu.
modifyOnly(dataRoot);
const client=new Client({name:'ava-package-smoke',version:'1'});
let launchedAt=Date.now();
try{await client.connect(new StdioClientTransport(hostLaunch(flag('--copy')?undefined:dataRoot)));}
catch(error){check(`the MCP server starts as ${hostName} launches it`,false,error instanceof Error?error.message:String(error));finish();}
check(`the MCP server starts as ${hostName} launches it (${declared.command} ${declared.args.join(' ')}; handshake ${Date.now()-launchedAt} ms, hosts allow 30 s)`,Date.now()-launchedAt<10000);
// The first call that needs the service (bare /ava help doesn't).
const opening=await client.callTool({name:'ava_providers',arguments:{}});
check('the service starts in a data folder where the account holds only Modify rights',opening.isError!==true,opening.isError?opening.content:undefined);
if(opening.isError)finish();
const tools=(await client.listTools()).tools.map(t=>t.name);
check('MCP tools include ava_command and ava_reconcile',tools.includes('ava_command')&&tools.includes('ava_reconcile'),tools);
const help=await client.callTool({name:'ava_command',arguments:{thread:'pkg-smoke',command:'/ava'}});
check('bare /ava returns concise help including doctor',(help.content as Array<{text?:string}>).some(c=>(c.text??'').includes('/ava doctor')));
const diagnostics=await client.callTool({name:'ava_command',arguments:{thread:'pkg-smoke',command:'/ava doctor'}});
check('/ava doctor works through this host wrapper without model work',!diagnostics.isError&&(diagnostics.content as Array<{text?:string}>).some(c=>/0 model requests/.test(c.text??'')&&/Vercel AI Gateway/.test(c.text??'')));
const menu=await client.callTool({name:'ava_command',arguments:{thread:'pkg-smoke',command:'/ava CLI1'}});
check('ava_command serves the CLI1 menu without model work',(menu.content as Array<{text?:string}>).some(c=>/Choose a CLI/.test(c.text??'')));
check(`menus tell the user to reply with ${commandName}`,(menu.content as Array<{text?:string}>).some(c=>(c.text??'').includes(`Reply: ${commandName} CLI1 <number>`)));
const sessionMenu=await client.callTool({name:'ava_command',arguments:{command:'/ava CLI2'}});
check('ava_command refuses a missing chat identity',sessionMenu.isError===true);
for(const [name,args] of [['ava_start',{}],['ava_activation_menu',{seat:'cli1'}]] as const){
  const missing=await client.callTool({name,arguments:args});check(`${name} refuses a missing chat identity`,missing.isError===true);
}
const server=existsSync(join(dataRoot,'server.json'))?JSON.parse(readFileSync(join(dataRoot,'server.json'),'utf8')):null;
check(flag('--copy')?'data lives in the folder set by the plugin\'s config.dataDir':'data lives in the AVA_DATA_DIR override',!!server&&existsSync(join(dataRoot,'ava.sqlite')),{dataRoot});
const health=server?await (await fetch(`http://127.0.0.1:${server.port}/api`,{method:'POST',headers:{Authorization:`Bearer ${server.token}`},body:JSON.stringify({method:'health',params:{}})})).json() as {result:{version:string;databaseVersion:number;capabilities?:{benchmarks?:boolean;benchmarkResults?:boolean}}}:null;
check('service reports the packaged version and current schema',health?.result.version===JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).version,health?.result);
const benchCall=async(method:string)=>server?await (await fetch(`http://127.0.0.1:${server.port}/api`,{method:'POST',headers:{Authorization:`Bearer ${server.token}`},body:JSON.stringify({method,params:{}})})).json():null;
const catalog=await benchCall('bench.catalog') as {result?:{tasks:Array<{id:string}>}}|null;
const starterTasks=existsSync(join(plugin,'benchmarks','starter'))?readdirSync(join(plugin,'benchmarks','starter'),{withFileTypes:true}).filter(e=>e.isDirectory()).length:0;
check(`packaged benchmark catalog lists every starter task (${starterTasks})`,health?.result.capabilities?.benchmarks===true&&starterTasks>=20&&catalog?.result?.tasks.length===starterTasks);
const results=await benchCall('bench.results') as {result?:{total:number;scoreboard:{rows:unknown[]}}}|null;
check('packaged Results API reads the isolated empty pool without model work',health?.result.capabilities?.benchmarkResults===true&&results?.result?.total===0&&results.result.scoreboard.rows.length===0);
await client.close();
for(const deadline=Date.now()+8000;existsSync(join(dataRoot,'server.json'))&&Date.now()<deadline;)await new Promise(r=>setTimeout(r,100));
check('background service exits when idle',!existsSync(join(dataRoot,'server.json')));

// 4. A service that can't start is reported in seconds, with its reason, launched the way this plugin's host launches it:
//    Codex passes only the .mcp.json env_vars allow-list and starts in the plugin folder; Claude Code passes its whole
//    environment. The broken folder holds a hard-linked secret, which the service refuses.
const broken=mkdtempSync(join(tmpdir(),'ava-pkg-broken-'));mkdirSync(join(broken,'secrets'));
writeFileSync(join(broken,'elsewhere.json'),'{"key":"not_a_real_key"}');linkSync(join(broken,'elsewhere.json'),join(broken,'secrets','ai-gateway.json'));
const failing=new Client({name:'ava-package-smoke-broken',version:'1'});
let startedAt=Date.now();
try{await failing.connect(new StdioClientTransport(hostLaunch(broken)));}
catch(error){check('the host handshake completes with an unusable data folder',false,error instanceof Error?error.message:String(error));finish();}
const handshakeMs=Date.now()-startedAt;
check(`the host handshake completes with an unusable data folder (${handshakeMs} ms, hosts allow 30 s)`,handshakeMs<5000);
startedAt=Date.now();
const refusedStart=await failing.callTool({name:'ava_command',arguments:{thread:'pkg-smoke-broken',command:'/ava CLI1'}});
const failedDiagnostics=await failing.callTool({name:'ava_command',arguments:{thread:'pkg-smoke-broken',command:'/ava doctor'}});
const reportMs=Date.now()-startedAt,said=(r:unknown)=>((r as {content?:Array<{text?:string}>}).content??[]).map(c=>c.text??'').join('');
check(`a failed service start reaches the host with its reason within seconds (${reportMs} ms)`,reportMs<10000&&refusedStart.isError===true&&/could not start: Refused a linked or special private path/.test(said(refusedStart)));
check('/ava doctor explains a service that cannot start and checks the data folder',failedDiagnostics.isError!==true&&/AvA service: not running/.test(said(failedDiagnostics))&&/Data folder .*Writable/.test(said(failedDiagnostics)));
await failing.close();
finish();
