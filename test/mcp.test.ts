import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
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
  const firstPid=JSON.parse(readFileSync(join(data,'server.json'),'utf8')).pid;
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='ava_activation_menu'));assert.ok(list.tools.some(t=>t.name==='ava_start'));
  const menu=await client.callTool({name:'ava_activation_menu',arguments:{thread:'mcp-test',seat:'cli1'}});
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
