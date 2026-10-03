import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tempDir } from './temp.js';

test('packaged MCP server starts, exposes menus, and opens a room whose agents are activated from it',async(t)=>{
  const data=tempDir('ava-mcp-');
  const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>v[1]!==undefined));
  const options={command:process.execPath,args:[join(process.cwd(),'dist','src','server.js'),'--mcp'],env:{...env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'1500'},stderr:'pipe' as const};
  const transport=new StdioClientTransport(options);
  const client=new Client({name:'ava-pilot',version:'1'});
  const second=new Client({name:'ava-second-viewer',version:'1'});
  t.after(async()=>{await Promise.allSettled([client.close(),second.close()]);});
  await Promise.all([client.connect(transport),second.connect(new StdioClientTransport(options))]);
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='ava_activation_menu'));assert.ok(list.tools.some(t=>t.name==='ava_start'));
  // The handshake doesn't wait for the service; the first tool call does.
  const menu=await client.callTool({name:'ava_activation_menu',arguments:{thread:'mcp-test',seat:'cli1'}});
  const firstPid=JSON.parse(readFileSync(join(data,'server.json'),'utf8')).pid;
  const text=(menu.content as Array<{text?:string}>).map(c=>c.text??'').join('');assert.ok(text.includes('Choose a CLI'));assert.ok(text.includes('Antigravity'));
  const typed=await client.callTool({name:'ava_command',arguments:{thread:'mcp-test',command:'/ava CLI1 1'}});
  assert.match((typed.content as Array<{text?:string}>).map(c=>c.text??'').join(''),/Provider: Claude Code/,'a typed choice runs through the shared menu snapshot');
  const refused=await client.callTool({name:'ava_command',arguments:{thread:'mcp-test',command:'/ava start; rm -rf /'}});
  assert.match((refused.content as Array<{text?:string}>).map(c=>c.text??'').join(''),/Not an Agent vs Agent command/);
  // The room opens before both agents are verified (they activate from the room); the link goes to the host only.
  const opened=await client.callTool({name:'ava_start',arguments:{thread:'mcp-test'}});assert.notEqual(opened.isError,true);
  assert.match((opened.content as Array<{text?:string}>).map(c=>c.text??'').join(''),/#token=[a-f0-9]{64}&room=/);
  await client.close();
  const secondMenu=await second.callTool({name:'ava_activation_menu',arguments:{thread:'second-chat',seat:'cli2'}});
  assert.ok(!secondMenu.isError);assert.equal(JSON.parse(readFileSync(join(data,'server.json'),'utf8')).pid,firstPid);
  await second.close();
  const deadline=Date.now()+5000;
  while(existsSync(join(data,'server.json'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  assert.equal(existsSync(join(data,'server.json')),false,'Idle daemon shuts down after all clients leave.');
});

// A host waits for the handshake (30 s at most), and a freshly installed copy's files are read slowly the first time.
// So the MCP server loads only what it serves; the engine and the room load in the background service.
test('the MCP server answers its handshake without loading the engine or the room',async(t)=>{
  const data=tempDir('ava-mcp-light-'),hook=join(data,'loads.mjs');
  writeFileSync(hook,"import {registerHooks} from 'node:module';registerHooks({load(url,context,next){if(url.startsWith('file:'))process.stderr.write('LOADED '+url+'\\n');return next(url,context);}});\n");
  const child=spawn(process.execPath,['--import',pathToFileURL(hook).href,join(process.cwd(),'dist','src','server.js'),'--mcp'],{env:{...process.env,AVA_DATA_DIR:data,AVA_IDLE_TIMEOUT_MS:'1500'},stdio:['pipe','pipe','pipe']});
  t.after(()=>{child.kill();});
  let loaded='',out='';child.stderr.on('data',d=>{loaded+=d;});
  const answered=new Promise<void>((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('"id":1'))resolve();});child.once('exit',()=>reject(new Error('The MCP server exited before its handshake.')));});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ava-test',version:'1'}}})+'\n');
  await answered;
  const files=loaded.split('\n').filter(l=>l.startsWith('LOADED ')).map(l=>l.slice(7).replaceAll('\\','/'));
  assert.ok(files.some(f=>f.endsWith('/dist/src/server.js')),'the load hook saw the server');
  const heavy=files.filter(f=>/\/dist\/src\/(service|http|controller|providers|activation)\.js$|\/node_modules\/(acpx|@openclaw|yaml)\//.test(f));
  assert.deepEqual(heavy,[],'the MCP process loads no engine, room or provider modules before its handshake');
});