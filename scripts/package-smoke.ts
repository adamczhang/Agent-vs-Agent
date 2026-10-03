// Smoke-tests a built plugin folder in isolation: throwaway data folder, no provider work, no reference to this checkout.
// The real shared data folder (package.json config.dataDir) is never touched: with --copy the copy is pointed at a temporary
// folder through its own config (an end-to-end check of that setting), otherwise AVA_DATA_DIR overrides it.
// Usage: node --import tsx scripts/package-smoke.ts [pluginDir] [--copy] [--out <evidence.json>]
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
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
  // Claude Code passes the server's env block on top of its own environment.
  const serverEnv=(JSON.parse(mcp) as {mcpServers:{ava:{env?:Record<string,string>}}}).mcpServers.ava.env??{};
  Object.assign(env,serverEnv);
}else{
  const hook=spawnSync(process.execPath,[join(plugin,'hooks','route.mjs')],{env,input:JSON.stringify({thread_id:'pkg-smoke',prompt:'/ava cli1'}),encoding:'utf8',windowsHide:true});
  check('packaged hook routes /ava CLI1 to ava_command',hook.status===0&&/ava_command/.test(hook.stdout)&&/command \\"\/ava CLI1\\"/.test(hook.stdout));
}

// 3. The MCP server starts from the plugin, keeps data in the configured folder (here a temporary one), and serves a typed menu.
const client=new Client({name:'ava-package-smoke',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[join(plugin,'dist','src','server.js'),'--mcp'],env,stderr:'pipe',cwd:tmpdir()}));
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
const health=server?await (await fetch(`http://127.0.0.1:${server.port}/api`,{method:'POST',headers:{Authorization:`Bearer ${server.token}`},body:JSON.stringify({method:'health',params:{}})})).json() as {result:{version:string;databaseVersion:number}}:null;
check('service reports the packaged version and current schema',health?.result.version===JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).version,health?.result);
await client.close();
for(const deadline=Date.now()+8000;existsSync(join(dataRoot,'server.json'))&&Date.now()<deadline;)await new Promise(r=>setTimeout(r,100));
check('background service exits when idle',!existsSync(join(dataRoot,'server.json')));

const status=checks.every(c=>c.pass)?'passed':'failed',result={status,recordedAt:new Date().toISOString(),plugin,copied:flag('--copy'),checks};
const out=option('--out');if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
console.log(JSON.stringify({status,checks:checks.length}));if(status!=='passed')process.exitCode=1;
