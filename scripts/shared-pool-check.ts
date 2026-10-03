// Checks that the packaged Codex and Claude Code plugins share one data folder, one background service, and one
// conversation pool. Uses a temporary data folder (AVA_DATA_DIR) for both, never the user's shared folder; no model work.
// Usage: node --import tsx scripts/shared-pool-check.ts [--out <results.json>]
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const plugins=resolve('release','marketplace','plugins'),codexPlugin=join(plugins,'agent-vs-agent'),claudePlugin=join(plugins,'agent-vs-agent-claude');
for(const p of [codexPlugin,claudePlugin])if(!existsSync(join(p,'packaged.json')))throw new Error('Build the packages first: npm run package');
const data=mkdtempSync(join(tmpdir(),'ava-shared-pool-'));
const checks:Array<{name:string;pass:boolean;detail?:unknown}>=[],check=(name:string,pass:boolean,detail?:unknown)=>{checks.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}`);};
const baseEnv=Object.fromEntries(Object.entries({...process.env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'1500'}).filter((e):e is [string,string]=>e[1]!==undefined));
// Each host launches the plugin's MCP server its own way; the Claude Code wrapper adds its .mcp.json env block.
async function connect(plugin:string){
  const extra=existsSync(join(plugin,'.claude-plugin'))?(JSON.parse(readFileSync(join(plugin,'.mcp.json'),'utf8')).mcpServers.ava.env??{}):{};
  const client=new Client({name:'ava-shared-pool-check',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(plugin,'dist','src','server.js'),'--mcp'],env:{...baseEnv,...extra},stderr:'pipe',cwd:tmpdir()}));
  return client;
}
const text=(r:unknown)=>((r as {content:Array<{text?:string}>}).content).map(c=>c.text??'').join('');
const servicePid=()=>JSON.parse(readFileSync(join(data,'server.json'),'utf8')).pid as number;
const thread='shared-pool-chat';

const codex=await connect(codexPlugin);
const opened=text(await codex.callTool({name:'ava_command',arguments:{thread,command:'/ava CLI1'}}));
check('the Codex plugin opens the CLI1 menu',/Choose a CLI/.test(opened));
const firstPid=servicePid();
const claude=await connect(claudePlugin);
const chosen=text(await claude.callTool({name:'ava_command',arguments:{thread,command:'/ava CLI1 1'}}));
check('the Claude Code plugin answers the menu the Codex plugin showed (same pair, same menu)',/Status: configuring/.test(chosen)&&/Provider: Claude Code/.test(chosen),chosen.split('\n').slice(0,4));
check('both plugins use the same background service',servicePid()===firstPid,{firstPid,now:servicePid()});
const status=JSON.parse(text(await codex.callTool({name:'ava_command',arguments:{thread,command:'/ava status'}}))) as {slots:{cli1:{state:string}}};
check('the Codex plugin sees the change made through the Claude Code plugin',status.slots.cli1.state==='configuring',{cli1:status.slots.cli1.state});
const healthOf=async(client:Client)=>JSON.parse(text(await client.callTool({name:'ava_providers',arguments:{}})));
check('both plugins see the same provider list',JSON.stringify(await healthOf(codex))===JSON.stringify(await healthOf(claude)));
await codex.close();await claude.close();
for(const deadline=Date.now()+8000;existsSync(join(data,'server.json'))&&Date.now()<deadline;)await new Promise(r=>setTimeout(r,100));
check('the shared service exits when both hosts are idle',!existsSync(join(data,'server.json')));

const status_=checks.every(c=>c.pass)?'passed':'failed',result={status:status_,recordedAt:new Date().toISOString(),data:'temporary AVA_DATA_DIR shared by both plugins',providerWork:'none',checks};
const out=option('--out');if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
console.log(JSON.stringify({status:status_,checks:checks.length}));if(status_!=='passed')process.exitCode=1;
