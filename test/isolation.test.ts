import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {participantEnvironment} from '../src/providers.js';
import {tempDir} from './temp.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {codexMcpNames} from '../src/isolation.js';
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
  const config=JSON.parse(env.CODEX_CONFIG!),wrapper=readFileSync(env.CODEX_PATH!,'utf8');
  assert.equal(config.model,'keep-model');
  assert.equal(config.mcp_servers,undefined);
  assert.equal(config['mcp_servers.flat.enabled'],undefined);
  for(const name of ['disk-server']){
    assert.equal(config[`mcp_servers.${name}.enabled`],false);
    assert.ok(wrapper.includes(`-c mcp_servers.${name}.enabled=false`));
  }
  assert.ok(!env.CODEX_CONFIG!.includes('private-value'));
  writeFileSync(fake,`console.error('private-value');process.exit(1);`);
  await assert.rejects(codexMcpNames(cli,root,process.env),error=>error instanceof Error&&/startup was refused/.test(error.message)&&!error.message.includes('private-value'));
  assert.throws(()=>participantEnvironment('codex',{},root,false,undefined,cli,['bad&name']),/startup was refused/);
});

test('Claude launcher preserves argument boundaries and exit status while enforcing strict MCP config',()=>{
  const root=tempDir('ava-claude-mcp-'),fake=join(root,'fake cli.mjs');
  writeFileSync(fake,`console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=7;`);
  const env=participantEnvironment('claude',{},root,false,undefined,{command:process.execPath,args:[fake],path:fake});
  const child=spawnSync(process.execPath,[env.CLAUDE_CODE_EXECUTABLE!,'--probe','one argument'],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,7,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),['--strict-mcp-config','--probe','one argument']);
});
