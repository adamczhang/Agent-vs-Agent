// Four real Codex host turns through the installed hook/MCP tools, no participant requests.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {installedCli} from '../src/clis.js';

const out=process.argv[2]??'pilot-evidence/stage-d/p8-codex-host.json';
if(existsSync(out))throw new Error('Evidence already exists; choose a new output path');
const root=mkdtempSync(join(tmpdir(),'ava-p8-codex-host-')),data=join(root,'data');mkdirSync(data);
console.log('Codex host-routing ceiling: 4 host turns; 0 participant requests. Stop at the first failed command.');
const cli=await installedCli('codex'),child=spawn(cli.command,[...cli.args,'app-server'],{cwd:root,env:{...process.env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'60000'},windowsHide:true,stdio:['pipe','pipe','pipe']});
let serial=0,threadId='',status='passed',errorText='';const results:unknown[]=[];
const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),listeners=new Set<(v:any)=>void>();
const send=(v:unknown)=>child.stdin.write(JSON.stringify(v)+'\n');
child.stderr.on('data',()=>{});
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{let m:any;try{m=JSON.parse(line);}catch{return;}
  if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
  if(m.id!==undefined&&m.method){
    // Only finite approvals of AvA's requested test calls. Hook trust and persistent tool rules are never changed.
    if(m.method==='mcpServer/elicitation/request')send({id:m.id,result:{action:m.params?.serverName==='ava'?'accept':'decline',content:m.params?.serverName==='ava'?{}:null,_meta:null}});
    else if(m.method==='item/commandExecution/requestApproval')send({id:m.id,result:{decision:'decline'}});
    else send({id:m.id,error:{code:-32601,message:'Not part of the AvA host check'}});
  }
  for(const listener of listeners)listener(m);
});
const call=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timeout: '+method));},60000);pending.set(id,{resolve,reject,timer});send({id,method,params});});
async function turn(command:string){
  const items:any[]=[],hooks:any[]=[];
  let listener:(m:any)=>void;
  const done=new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>{listeners.delete(listener);reject(new Error('Host turn timed out'));},180000);
    listener=m=>{if(m.params?.threadId!==threadId)return;
      if(m.method==='item/completed')items.push(m.params.item);
      if(m.method==='hook/completed'&&m.params.run?.eventName==='userPromptSubmit'&&/agent-vs-agent/.test(m.params.run.sourcePath??''))hooks.push(m.params.run);
      if(m.method==='turn/completed'){clearTimeout(timer);listeners.delete(listener);resolve(m.params.turn);}
    };listeners.add(listener);
  });
  await call('turn/start',{threadId,input:[{type:'text',text:command,text_elements:[]}],effort:'low'});
  const ended=await done,calls=items.filter(i=>i.type==='mcpToolCall'&&/ava_command$/.test(i.tool));
  const passed=ended.status==='completed'&&hooks.length>0&&calls.some(c=>c.status==='completed'&&c.arguments?.thread===threadId&&c.arguments?.command?.toLowerCase()===command.toLowerCase())&&!items.some(i=>i.type==='commandExecution');
  results.push({command,passed,hookFired:hooks.length>0,toolCalls:calls.map(c=>({tool:c.tool,status:c.status,threadMatches:c.arguments?.thread===threadId})),status:ended.status});
  console.log(`${passed?'PASS':'FAIL'} Codex ${command}: installed hook and ava_command route`);
  if(!passed)throw new Error('Codex host command did not route correctly: '+command);
}
try{
  await call('initialize',{clientInfo:{name:'ava-p8-host',version:'0.1.2'},capabilities:{experimentalApi:true}});send({method:'initialized'});
  const listed=await call('hooks/list',{cwds:[root]});
  const hooks=listed.data.flatMap((r:any)=>r.hooks).filter((h:any)=>h.pluginId==='agent-vs-agent@ava'&&h.eventName==='userPromptSubmit');
  if(!hooks.some((h:any)=>h.enabled&&h.trustStatus==='trusted'&&/[\\/]0\.1\.2[\\/]/.test(h.sourcePath)))throw new Error('The installed 0.1.2 hook must be trusted by the user.');
  const opened=await call('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'on-request',sandbox:'read-only',baseInstructions:'You are checking typed AvA commands. Use only the AvA MCP tools requested by the hook. Show their returned text. Do not run shell commands, edit files, open browser pages, or call other apps.'});threadId=opened.thread.id;
  for(const deadline=Date.now()+30000;;await new Promise(resolve=>setTimeout(resolve,250))){
    const servers=await call('mcpServerStatus/list',{}),ava=servers.data?.find((s:any)=>s.name==='ava');
    if(ava?.tools&&Object.keys(ava.tools).some(name=>/ava_command$/.test(name)))break;
    if(ava?.toolsError||Date.now()>deadline)throw new Error('The installed AvA MCP tools did not become ready');
  }
  for(const command of ['/ava','/ava doctor','/ava CLI1','/ava start'])await turn(command);
}catch(error){status='failed';errorText=(error instanceof Error?error.message:'Host check failed').replace(/\b[a-f0-9]{64}\b|vck_[\w-]+/g,'REDACTED');console.error('P8 host stopped: '+errorText);}
finally{
  child.stdin.end();lines.close();setTimeout(()=>child.kill(),2500).unref();
  for(const p of pending.values())clearTimeout(p.timer);
  mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify({status,recordedAt:new Date().toISOString(),ceiling:{hostTurns:4,participantRequests:0},results,...(errorText?{error:errorText}:{})},null,2));
}
if(status!=='passed')process.exitCode=1;
