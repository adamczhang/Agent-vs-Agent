import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCommand } from '../src/text-client.js';
import { tempDir } from './temp.js';

function hook(prompt:string,thread='thread-a'){
  const data=tempDir('ava-hook-');
  const result=spawnSync(process.execPath,['hooks/route.mjs'],{cwd:process.cwd(),env:{...process.env,PLUGIN_ROOT:process.cwd(),PLUGIN_DATA:data},input:JSON.stringify({thread_id:thread,prompt}),encoding:'utf8',windowsHide:true});
  return {result,data,context:result.stdout?JSON.parse(result.stdout).hookSpecificOutput.additionalContext as string:''};
}
test('hook ignores ordinary development and quoted slash examples',()=>{
  for(const text of ['Implement /ava CLI1 in this project','Explain the controller','"/ava start" is an example','/available'])assert.equal(hook(text).result.stdout,'');
});
test('hook routes a valid command to the ava_command MCP tool with only the normalized command and chat ID, writing no files',()=>{
  const {result,data,context}=hook('/ava cli1 2');assert.equal(result.status,0);
  assert.match(context,/ava_command/);assert.match(context,/thread "thread-a"/);assert.match(context,/command "\/ava CLI1 2"/);
  assert.ok(!/client\.js|request-file|PowerShell/i.test(context),'no shell command is suggested');
  assert.deepEqual(readdirSync(data),[],'no request file is written');
});
test('hook refuses anything outside the command grammar without echoing it',()=>{
  for(const prompt of ['/ava CLI1 1; $(Write-Output INJECTED)','/ava start now INJECTED','/ava cli3','/ava start 2','/ava CLI1 "INJECTED"']){
    const {context}=hook(prompt);assert.match(context,/not recognized/,prompt);assert.ok(!context.includes('INJECTED'),prompt);assert.ok(!/ava_command/.test(context),prompt);
  }
  assert.match(hook('/ava status','bad id; rm').context,/cannot identify this Codex chat/);
});
test('hook and MCP tool apply the same command grammar',()=>{
  for(const prompt of ['/ava','/ava doctor','/AVA DOCTOR','/ava doctor 1','/AVA cli2','/ava CLI1 12','/ava cli2 b','/ava cli1 X','/ava start','/ava status','/ava reconcile','/ava start 1','/ava cli1 1234','/ava cli1 a','/ava foo']){
    const expected=normalizeCommand(prompt),context=hook(prompt).context;
    if(expected)assert.ok(context.includes(`command "${expected}"`),prompt);else assert.match(context,/not recognized/,prompt);
  }
});
