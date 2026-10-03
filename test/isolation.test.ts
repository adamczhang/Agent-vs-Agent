import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {participantEnvironment} from '../src/providers.js';
import {tempDir} from './temp.js';
test('participant processes cannot recursively start AvA or inherit its prompt hook',()=>{
  const env=participantEnvironment('codex',{CODEX_CONFIG:JSON.stringify({features:{plugins:true},'features.plugins':true})});
  const config=JSON.parse(env.CODEX_CONFIG!);assert.equal(config.features.plugins,false);assert.equal(config['features.plugins'],false);assert.equal(env.INITIAL_AGENT_MODE,'read-only');
  // A throwaway data folder, so a regression here could never touch the real one.
  const childEnv={...process.env,...env,AVA_DATA_DIR:tempDir('ava-isolation-')};
  const hook=spawnSync(process.execPath,['hooks/route.mjs'],{env:childEnv,input:JSON.stringify({thread_id:'nested',prompt:'/ava CLI1'}),encoding:'utf8',windowsHide:true});assert.equal(hook.stdout,'');
  const nested=spawnSync(process.execPath,['dist/src/server.js','--mcp'],{env:childEnv,encoding:'utf8',windowsHide:true,timeout:3000});assert.notEqual(nested.status,0);assert.match(nested.stderr,/participants cannot start/);
});
