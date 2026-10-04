import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync,readFileSync,writeFileSync,mkdirSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { callEndpoint,ensureService,type Endpoint } from './connection.js';
import { claimOwner,ownerAlive,processStarted } from './ownership.js';
import { assertNodeVersion,defaultDataRoot,packageVersion,projectRoot } from './paths.js';
import { normalizeCommand,runCommand } from './text-client.js';
import { checkDataFolder,formatServiceDown } from './doctor.js';
import { AvAError,type Pair } from './types.js';

assertNodeVersion();
if(process.env.AVA_PARTICIPANT==='1')throw new Error('AvA participants cannot start or control their parent plugin.');
// A development server (`npm run serve`) never opens the real shared pool by accident: without AVA_DATA_DIR it uses the
// checkout's .ava-serve folder (point a client at it with the same AVA_DATA_DIR).
const dataRoot=process.argv.includes('--standalone')&&!process.env.AVA_DATA_DIR?join(projectRoot,'.ava-serve'):defaultDataRoot();
if(process.argv.includes('--mcp')){
  // MCP clients share one persistent owner. Closing a viewer or one Codex chat
  // cannot kill another chat's providers or create a competing controller.
  // The host's handshake doesn't wait for the service: it starts in the background, and a start that fails is reported,
  // with its reason, by the tool call that needs it, rather than as a host timeout. Concurrent calls share one start.
  let address:Endpoint|undefined,starting:Promise<Endpoint>|undefined;
  const ready=()=>starting??=ensureService(projectRoot,dataRoot).then(found=>address=found).finally(()=>{starting=undefined;});
  void ready().catch(()=>{/* reported by the first tool call */});
  const rpc=async<T=unknown>(method:string,params:unknown)=>callEndpoint<T>(await ready(),method,params);
  const roomUrl=(roomId:string)=>'http://127.0.0.1:'+address!.port+'/#token='+address!.token+'&room='+roomId;
  const server=new McpServer({name:'agent-vs-agent',version:packageVersion});
  const reply=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
  // Each host passes its chat identity: Codex its thread ID (from the prompt hook), Claude Code its session ID (the /ava
  // skill passes claude-<session ID>). Missing identities are refused, never shared by a host process.
  const threadArg=z.string().trim().min(1).max(200);
  // The tool always receives "/ava …", and both hosts take /ava as typed. A host whose users had to type the command
  // under another name could set AVA_COMMAND_NAME, so menus and errors show what to type there; none does now.
  const commandName=process.env.AVA_COMMAND_NAME,forHost=(text:string)=>commandName?text.replace(/(?<![\w.\/\\-])\/ava(?![\w.\/\\-])/g,commandName):text;
  // Typed /ava commands arrive here: from the Codex prompt hook, or from the Claude Code /ava skill.
  server.registerTool('ava_command',{description:'Run a typed Agent vs Agent control command for this chat and return the text to show. Always pass the chat identity: Codex thread ID or claude-<session ID>. Opening menus sends no model prompt; choosing "Activate and verify" sends one short access check.',inputSchema:{thread:threadArg,command:z.string().min(1).max(40)}},async({thread,command})=>{
    const normalized=normalizeCommand(command);
    if(!normalized)return reply({error:forHost('Not an Agent vs Agent command. Use /ava, /ava doctor, /ava CLI1, /ava CLI2, /ava start, /ava status, or /ava reconcile.')});
    try{
      const text=await runCommand({rpc:(method,params)=>rpc(method,params),thread,command:normalized,roomUrl});
      return {content:[{type:'text' as const,text:forHost(text)}]};
    }catch(error){
      // Diagnostics still answer when the service can't start: why it failed, and a check of the data folder.
      if(normalized==='/ava DOCTOR'&&error instanceof AvAError&&error.code==='SERVICE_START_FAILED')return {content:[{type:'text' as const,text:forHost(formatServiceDown(error.message,checkDataFolder(dataRoot)))}]};
      throw new Error(forHost(error instanceof Error?error.message:String(error)));
    }
  });
  server.registerTool('ava_providers',{description:'Inspect installed AvA CLI providers without starting model work.',inputSchema:{}},async()=>reply(await rpc('providers.list',{})));
  server.registerTool('ava_activation_menu',{description:'Open the CLI1 or CLI2 activation menu for this chat. Does not send a model prompt.',inputSchema:{thread:threadArg,seat:z.enum(['cli1','cli2'])}},async({thread,seat})=>{
    const pair=await rpc<Pair>('pair.create',{thread});return reply(await rpc('menu.show',{pairId:pair.id,seat}));
  });
  server.registerTool('ava_choose',{description:'Apply an exact choice from the displayed activation menu. Activate and verify sends one short model-access probe.',inputSchema:{pairId:z.string(),seat:z.enum(['cli1','cli2']),menuId:z.string(),choice:z.string()}},async args=>reply(await rpc('menu.choose',args)));
  server.registerTool('ava_start',{description:'Open the GUI room for this chat; agents that are not yet active can be activated there. Refocusing an existing room sends no model work.',inputSchema:{thread:threadArg}},async({thread})=>{
    const pair=await rpc<Pair>('pair.create',{thread});
    const prepared=await rpc<{ticket?:string;roomId?:string}>('room.prepare',{pairId:pair.id});
    const opened=prepared.roomId?prepared:await rpc<{roomId:string}>('room.open',{ticket:prepared.ticket});
    return reply({roomId:opened.roomId,url:roomUrl(opened.roomId!)});
  });
  server.registerTool('ava_status',{description:'Inspect an AvA pair or conversation without generating replies.',inputSchema:{pairId:z.string()}},async args=>reply(await rpc('pair.get',args)));
  server.registerTool('ava_reconcile',{description:'Release a pair whose conversation needs attention, after AvA confirms no provider process from it is still running. Requests with unknown outcomes are abandoned, never resent; both agents must then be reactivated.',inputSchema:{runId:z.string(),requestId:z.string()}},async args=>reply(await rpc('run.reconcile',args)));
  server.registerTool('ava_control',{description:'Pause, resume, advance one reply, or stop a named AvA conversation. Reuse requestId when retrying the same command.',inputSchema:{runId:z.string(),action:z.enum(['pause','resume','step','stop']),requestId:z.string()}},async args=>reply(await rpc('run.control',args)));
  const heartbeat=setInterval(()=>{if(address)void callEndpoint(address,'health',{},2000).catch(()=>{});},10000);heartbeat.unref();
  server.server.onclose=()=>clearInterval(heartbeat);
  await server.connect(new StdioServerTransport());
}else{
  const lockFile=join(dataRoot,'service.lock'),owner=randomUUID();
  let releaseOwner:(()=>void)|undefined,locked=false;
  try{
    mkdirSync(dataRoot,{recursive:true});
    releaseOwner=claimOwner(dataRoot,owner);
    if(existsSync(lockFile)){
      const lock=JSON.parse(readFileSync(lockFile,'utf8')) as {pid:number;started?:number};
      if(ownerAlive(lock.pid,lock.started))throw new AvAError('OWNER_EXISTS','An AvA service already owns this data directory. Connect to its existing endpoint.');
      unlinkSync(lockFile);
    }
    writeFileSync(lockFile,JSON.stringify({pid:process.pid,owner,started:processStarted()}),{flag:'wx',mode:0o600});locked=true;
    // Only the service loads the engine and the room: an MCP server needs neither, and a host waits for its handshake.
    const [{AvAService},{listen}]=await Promise.all([import('./service.js'),import('./http.js')]);
    const service=new AvAService(dataRoot),http=await listen(service,join(projectRoot,'dist','web'));
    let closing=false,idle:ReturnType<typeof setInterval>|undefined;
    const shutdown=async()=>{
      if(closing)return;closing=true;
      try{await http.close();service.store.close();if(JSON.parse(readFileSync(lockFile,'utf8')).owner===owner)unlinkSync(lockFile);releaseOwner?.();if(idle)clearInterval(idle);}
      catch(error){closing=false;console.error(error instanceof Error?error.message:error);}
    };
    process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
    // A newer install asked this service to step aside (service.retire): its idle agents close, then it exits and the
    // newer plugin starts its own.
    service.retire=()=>{void (async()=>{try{await service.shutdown();}catch{/* close what it can */}await shutdown();process.exit(0);})();};
    if(process.argv.includes('--daemon')){
      const idleMs=Math.max(100,Number(process.env.AVA_IDLE_TIMEOUT_MS)||120000);
      idle=setInterval(()=>{
        if(Date.now()-http.lastRequestAt()<idleMs||closing)return;
        const hasActive=service.store.db.prepare('SELECT data FROM pairs').all().some(row=>(JSON.parse(String(row.data)) as Pair).activeRunId);
        if(!hasActive&&!service.benchmarks.busy)void shutdown();
      },Math.min(10000,idleMs));
    }
    console.log(JSON.stringify({status:'listening',port:http.port,pid:process.pid,dataRoot,version:packageVersion}));
  }catch(error){
    // A start that fails says why on one line of the service log, where the MCP server that started it reads it
    // (connection.ts startFailure). The ownership claims it made are released first.
    try{if(locked&&JSON.parse(readFileSync(lockFile,'utf8')).owner===owner)unlinkSync(lockFile);releaseOwner?.();}catch{/* best effort */}
    console.log(JSON.stringify({status:'failed',pid:process.pid,code:error instanceof AvAError?error.code:'SERVICE_START_FAILED',error:error instanceof Error?error.message:String(error),dataRoot,version:packageVersion}));
    process.exit(1);
  }
}
