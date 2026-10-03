// Real Claude Code slash-command routing through the installed plugin. No participant model requests.
// Four host prompts, at most four Claude inference turns each; no session persistence or permission-rule changes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {installedCli} from '../src/clis.js';
import {normalizeCommand} from '../src/text-client.js';

const out=process.argv[2]??'pilot-evidence/stage-d/p8-claude-host.json';
if(existsSync(out))throw new Error('Evidence already exists; choose a new output path');
const root=mkdtempSync(join(tmpdir(),'ava-p8-claude-host-')),data=join(root,'data');mkdirSync(data);
const cli=await installedCli('claude'),results:unknown[]=[];
let status='passed',turns=0;
console.log('Claude host-routing ceiling: 4 host prompts, 4 inference turns each (16 total); 0 participant requests.');
try{
  for(const command of ['/ava','/ava doctor','/ava CLI1','/ava start']){
    const session=randomUUID();
    const {stdout}=await promisify(execFile)(cli.command,[...cli.args,'-p',command,'--session-id',session,'--no-session-persistence','--output-format','stream-json','--verbose','--max-turns','4','--effort','low','--disallowedTools','Bash,Write,Edit'],{
      cwd:root,env:{...process.env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'1500'},windowsHide:true,timeout:180000,maxBuffer:16*1024*1024,
    });
    const events=stdout.split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    const result=events.findLast(e=>e.type==='result');turns+=Number(result?.num_turns??0);
    const calls=events.filter(e=>e.type==='assistant').flatMap(e=>e.message?.content??[]).filter(c=>c.type==='tool_use'&&/ava_command$/.test(c.name));
    const routed=calls.some(c=>typeof c.input?.command==='string'&&normalizeCommand(c.input.command)===normalizeCommand(command)&&c.input?.thread===`claude-${session}`);
    const passed=routed&&!result?.is_error&&result?.subtype==='success';
    results.push({command,passed,hostTurns:result?.num_turns??null,toolCalls:calls.map(c=>({name:c.name,command:c.input?.command,threadMatches:c.input?.thread===`claude-${session}`})),subtype:result?.subtype??null});
    console.log(`${passed?'PASS':'FAIL'} Claude Code ${command}: installed ava_command route and conversation identity`);
    if(!passed)throw new Error('Claude host command did not complete through its installed skill: '+command);
  }
}catch(error){status='failed';console.error((error instanceof Error?error.message:'Claude host check failed').replace(/\b[a-f0-9]{64}\b|vck_[\w-]+/g,'REDACTED').slice(0,500));}
mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify({status,recordedAt:new Date().toISOString(),ceiling:{hostPrompts:4,inferenceTurns:16,participantRequests:0},hostTurns:turns,results},null,2));
if(status!=='passed')process.exitCode=1;
