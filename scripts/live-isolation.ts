// P4: at most two model requests, subscription login only, stop at the first failure.
// New temporary data; evidence contains only process names/classifications, never command lines or tokens.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeFactory} from '../src/providers.js';
import {listProcesses,survivors,type LedgerProcess} from '../src/census.js';
import type {Provider} from '../src/types.js';

console.log('Request ceiling: 2 (Codex 1, Claude Code 1), provider-login only. Stop at first failure.');
const root=mkdtempSync(join(tmpdir(),'ava-p4-isolation-')),factory=new NativeFactory(root);
const recorded:LedgerProcess[]=[],results:unknown[]=[];
factory.ledger={spawned:p=>recorded.push({pid:p.pid,ownerPid:process.pid,spawnedAt:new Date().toISOString()}),exited:pid=>{const p=recorded.find(p=>p.pid===pid);if(p)p.exited=true;}};
async function census(){
  const owned=survivors(recorded,await listProcesses());
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],{windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const rows=JSON.parse(stdout) as Array<{ProcessId:number;CommandLine:string|null}>;
  return owned.map(p=>{
    const command=rows.find(r=>r.ProcessId===p.pid)?.CommandLine??'';
    const ownCli=/^(codex|claude)([-_.][\w.-]*)?\.exe$/i.test(p.name);
    const adapter=/[\\/]@agentclientprotocol[\\/](codex|claude)-agent?-?acp[\\/]dist|[\\/]@agentclientprotocol[\\/]codex-acp[\\/]dist/.test(command);
    const launcher=/[\\/]wrappers[\\/](codex|claude)-child-|[\\/]@openai[\\/]codex[\\/]bin[\\/]codex.js/.test(command);
    const helper=/^(conhost|OpenConsole)\.exe$/i.test(p.name);
    return {name:p.name,kind:ownCli?'cli':adapter?'adapter':launcher?'launcher':helper?'console':'unexpected'};
  });
}
let failed=false;
try{
  for(const provider of ['codex','claude'] as Provider[]){
    recorded.length=0;
    const agent=await factory.open({provider,model:'',auth:'provider-login'},{pairId:randomUUID(),seat:'cli1',generation:1},AbortSignal.timeout(120000));
    try{
      const before=await census();
      if(!before.length||before.some(p=>p.kind==='unexpected'))throw new Error(`${provider}: unexpected process before request: ${JSON.stringify(before)}`);
      let during:ReturnType<typeof census>|undefined;
      const answer=await agent.request({id:randomUUID(),text:'Reply exactly P4_OK. Do not use tools.',signal:AbortSignal.timeout(120000),onStarted(){during=census();},onEvent(){}});
      const processes=[...before,...await during!];
      if(answer.status!=='completed'||answer.text.trim()!=='P4_OK'||processes.some(p=>p.kind==='unexpected'))throw new Error(`${provider}: isolation or response check failed: ${JSON.stringify(processes)}`);
      results.push({provider,passed:true,processes});console.log(`PASS ${provider} live reply and process census`);
    }finally{await agent.close();}
  }
}catch(error){failed=true;console.error(error instanceof Error?error.message.replace(/\b[a-f0-9]{64}\b/g,'REDACTED'):'Isolation check failed');}
mkdirSync('pilot-evidence/stage-d',{recursive:true});
writeFileSync('pilot-evidence/stage-d/p4-isolation.json',JSON.stringify({recordedAt:new Date().toISOString(),ceiling:2,status:failed?'failed':'passed',results},null,2));
if(failed)process.exitCode=1;
