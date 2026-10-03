import test from 'node:test';
import assert from 'node:assert/strict';
import { linkSync,mkdirSync,unlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensureService,startFailure } from '../src/connection.js';
import { checkDataFolder } from '../src/doctor.js';
import { tempDir } from './temp.js';

const TOKEN='0123456789abcdef'.repeat(4);
const text=(result:unknown)=>((result as {content?:Array<{text?:string}>}).content??[]).map(c=>c.text??'').join('');
// A stand-in service: ensureService starts <root>/dist/src/server.js, which here runs `body` and exits.
function fakeService(body:string){
  const root=tempDir('ava-fake-service-');mkdirSync(join(root,'dist','src'),{recursive:true});
  writeFileSync(join(root,'dist','src','server.js'),body);return root;
}

test('a start failure is read from the log written since the start, for that process, without tokens',()=>{
  const log=join(tempDir('ava-start-log-'),'service.log'),old='{"status":"failed","pid":7,"code":"OLD","error":"an earlier start"}\n';
  writeFileSync(log,old+'{"status":"listening","pid":8}\n{"status":"failed","pid":9,"code":"PRIVATE_FILE","error":"token '+TOKEN+' refused"}\n');
  assert.deepEqual(startFailure(log,old.length,9),{code:'PRIVATE_FILE',error:'token <redacted> refused'});
  assert.equal(startFailure(log,old.length,8),undefined,'another process\'s line is not this start\'s reason');
  writeFileSync(log,'file:///x/server.js:3\n  throw new Error(\'x\');\n\nTypeError [ERR_X]: Cannot read the thing\n    at file:///x/server.js:3:9\n\nNode.js v26\n');
  assert.deepEqual(startFailure(log,0,123),{code:'SERVICE_CRASHED',error:'Cannot read the thing'},'a crash before the service could report');
});

test('a service that fails to start is reported at once with its reason, not after the wait',async()=>{
  const failing=fakeService('console.log(JSON.stringify({status:"failed",pid:process.pid,code:"PRIVATE_FILE",error:"Could not restrict secrets to your Windows account."}));process.exit(1);');
  let started=Date.now();
  await assert.rejects(ensureService(failing,tempDir('ava-start-data-')),(error:Error&{code?:string})=>error.code==='SERVICE_START_FAILED'&&/could not start: Could not restrict secrets/.test(error.message)&&/service\.log/.test(error.message));
  assert.ok(Date.now()-started<5000,`reported after ${Date.now()-started} ms`);
  const crashing=fakeService('throw new RangeError("Broken install");');started=Date.now();
  await assert.rejects(ensureService(crashing,tempDir('ava-start-data-')),/could not start: Broken install/);
  assert.ok(Date.now()-started<5000);
  // Losing the race to another starting service isn't a failure: the caller waits for that service instead.
  const lost=fakeService('console.log(JSON.stringify({status:"failed",pid:process.pid,code:"OWNER_EXISTS",error:"already owned"}));process.exit(1);');
  await assert.rejects(ensureService(lost,tempDir('ava-start-data-'),1500),/did not become ready/);
  const blocked=join(tempDir('ava-start-file-'),'not-a-folder');writeFileSync(blocked,'');
  await assert.rejects(ensureService(failing,join(blocked,'data')),/data folder .* can't be created/);
});

test('the host handshake succeeds with a broken data folder; commands and /ava doctor say why, and recover once fixed',async(t)=>{
  const data=tempDir('ava-broken-data-');mkdirSync(join(data,'secrets'));
  // A hard-linked secret is refused (the same file could be read through its other name), so the service can't start.
  writeFileSync(join(data,'elsewhere.json'),'{"key":"not_a_real_key"}');linkSync(join(data,'elsewhere.json'),join(data,'secrets','ai-gateway.json'));
  const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>v[1]!==undefined));
  const client=new Client({name:'ava-broken-start',version:'1'});t.after(async()=>{await client.close().catch(()=>{});});
  let started=Date.now();
  await client.connect(new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),'dist','src','server.js'),'--mcp'],env:{...env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'1500'},stderr:'pipe'}));
  assert.ok(Date.now()-started<5000,`handshake took ${Date.now()-started} ms`);
  started=Date.now();
  const menu=await client.callTool({name:'ava_command',arguments:{thread:'broken-start',command:'/ava CLI1'}});
  assert.equal(menu.isError,true);assert.match(text(menu),/could not start: Refused a linked or special private path/);
  const doctor=await client.callTool({name:'ava_command',arguments:{thread:'broken-start',command:'/ava doctor'}});
  assert.notEqual(doctor.isError,true);
  assert.match(text(doctor),/AvA service: not running\. .*Refused a linked or special private path/);
  assert.match(text(doctor),/Data folder .*: Writable; secrets are restricted to your account\./);
  assert.ok(Date.now()-started<10000,`both answers took ${Date.now()-started} ms`);
  assert.ok(!text(doctor).includes('#token='),'no room link or token in the diagnostics');
  // Fixing the folder needs no host restart: the next command starts the service.
  unlinkSync(join(data,'secrets','ai-gateway.json'));
  const fixed=await client.callTool({name:'ava_command',arguments:{thread:'broken-start',command:'/ava CLI1'}});
  assert.notEqual(fixed.isError,true);assert.match(text(fixed),/Choose a CLI/);
});

test('the data folder check reports a folder that takes writes and secures secrets, and one that cannot',()=>{
  const ok=checkDataFolder(tempDir('ava-folder-ok-'));
  assert.deepEqual([ok.writable,ok.secured],[true,true]);assert.match(ok.message,/secrets are restricted to your account/);
  const blocked=join(tempDir('ava-folder-file-'),'file');writeFileSync(blocked,'');
  const bad=checkDataFolder(join(blocked,'data'));
  assert.deepEqual([bad.writable,bad.secured],[false,null]);assert.match(bad.message,/^Not writable: /);
});
