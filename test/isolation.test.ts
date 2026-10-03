import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {participantEnvironment} from '../src/providers.js';
import {tempDir} from './temp.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CODEX_ISOLATION_FLAGS,codexIsolationArgs,codexMcpNames} from '../src/isolation.js';
test('participant processes cannot recursively start AvA or inherit its prompt hook',()=>{
  const env=participantEnvironment('codex',{CODEX_CONFIG:JSON.stringify({features:{plugins:true},'features.plugins':true})});
  const config=JSON.parse(env.CODEX_CONFIG!);assert.equal(config.features.plugins,false);assert.equal(config['features.plugins'],false);assert.equal(env.INITIAL_AGENT_MODE,'read-only');
  // A throwaway data folder, so a regression here could never touch the real one.
  const childEnv={...process.env,...env,AVA_DATA_DIR:tempDir('ava-isolation-')};
  const hook=spawnSync(process.execPath,['hooks/route.mjs'],{env:childEnv,input:JSON.stringify({thread_id:'nested',prompt:'/ava CLI1'}),encoding:'utf8',windowsHide:true});assert.equal(hook.stdout,'');
  const nested=spawnSync(process.execPath,['dist/src/server.js','--mcp'],{env:childEnv,encoding:'utf8',windowsHide:true,timeout:3000});assert.notEqual(nested.status,0);assert.match(nested.stderr,/participants cannot start/);
});

test('Codex disables disk and session MCP entries, keeps other settings, and fails closed on inspection errors',async()=>{
  const root=tempDir('ava-mcp-'),fake=join(root,'cli.mjs');
  writeFileSync(fake,`if(!process.argv.includes('plugins')||!process.argv.includes('hooks'))process.exit(2);console.log(JSON.stringify([{name:'disk-server',transport:{env:{SECRET:'private-value'}}}]));`);
  const cli={command:process.execPath,args:[fake],path:fake};
  const names=await codexMcpNames(cli,root,process.env);
  assert.deepEqual(names,['disk-server']);
  const inherited={model:'keep-model',mcp_servers:{session:{command:'never-start',enabled:true}},'mcp_servers.flat.enabled':true};
  const env=participantEnvironment('codex',{CODEX_CONFIG:JSON.stringify(inherited)},root,false,undefined,cli,names);
  const config=JSON.parse(env.CODEX_CONFIG!);
  assert.equal(config.model,'keep-model');
  assert.deepEqual(config.mcp_servers,{'disk-server':{enabled:false}});
  assert.equal(config['mcp_servers.flat.enabled'],undefined);
  assert.ok(!env.CODEX_CONFIG!.includes('private-value'));
  writeFileSync(fake,`console.error('private-value');process.exit(1);`);
  await assert.rejects(codexMcpNames(cli,root,process.env),error=>error instanceof Error&&/startup was refused/.test(error.message)&&!error.message.includes('private-value'));
});

test('Codex launches keep literal MCP names and argument boundaries out of shell interpretation',()=>{
  const root=tempDir('ava-codex-quoted-mcp-'),fake=join(root,'fake cli.mjs');
  writeFileSync(fake,`console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;`);
  const names=['has.dot','has space','company/server','a"quote','back\\slash','percent%AVA_REVIEW_MARKER%','bang!AVA_REVIEW_MARKER!','amp&echo','pipe|echo','tick`$(echo)','__proto__','日本語','line\nbreak'];
  const env=participantEnvironment('codex',{},root,false,undefined,{command:process.execPath,args:[fake],path:fake},names);
  const wrapper=readFileSync(env.CODEX_PATH!,'utf8'),config=JSON.parse(env.CODEX_CONFIG!);
  for(const name of names)assert.deepEqual(config.mcp_servers[name],{enabled:false});
  assert.ok(!wrapper.includes('mcp_servers'));
  const args=['app-server','--probe','one argument'];
  const child=process.platform==='win32'
    ?spawnSync('cmd.exe',['/d','/s','/c',`""${env.CODEX_PATH!}" app-server --probe "one argument""`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,env:{...process.env,AVA_REVIEW_MARKER:'EXPANDED'}})
    :spawnSync(env.CODEX_PATH!,args,{encoding:'utf8',env:{...process.env,AVA_REVIEW_MARKER:'EXPANDED'}});
  assert.equal(child.status,7,child.stderr);
  const received=JSON.parse(child.stdout) as string[];
  assert.deepEqual(received.slice(0,CODEX_ISOLATION_FLAGS.length),CODEX_ISOLATION_FLAGS);
  assert.equal(received[CODEX_ISOLATION_FLAGS.length],'-c');
  assert.equal(received.length,CODEX_ISOLATION_FLAGS.length+2+args.length);
  const table=received[CODEX_ISOLATION_FLAGS.length+1]!;
  assert.ok(table.startsWith('mcp_servers={'));
  for(const name of names)assert.ok(table.includes(`${JSON.stringify(name)}={enabled=false}`),name);
  assert.deepEqual(received.slice(-args.length),args);
  assert.deepEqual(codexIsolationArgs([]),CODEX_ISOLATION_FLAGS,'no phantom transport is added to empty configurations');
});

test('Claude launcher preserves argument boundaries and exit status while enforcing strict MCP config',()=>{
  const root=tempDir('ava-claude-mcp-'),fake=join(root,'fake cli.mjs');
  writeFileSync(fake,`console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;`);
  const env=participantEnvironment('claude',{},root,false,undefined,{command:process.execPath,args:[fake],path:fake});
  const child=spawnSync(process.execPath,[env.CLAUDE_CODE_EXECUTABLE!,'--probe','one argument'],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,7,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),['--strict-mcp-config','--probe','one argument']);
});
