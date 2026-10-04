import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobHost } from '../src/jobs.js';
import { tempDir } from './temp.js';

const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const until=async(check:()=>boolean|Promise<boolean>,ms=10000)=>{for(const end=Date.now()+ms;Date.now()<end;await new Promise(r=>setTimeout(r,50)))if(await check())return true;return false;};
// A stand-in agent: it starts `count` idle children, prints their PIDs, and exits, so the children lose their parent.
const agent=(count:number)=>[process.execPath,'-e',`const {spawn}=require('node:child_process');const pids=[];for(let i=0;i<${count};i++)pids.push(spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true,windowsHide:true}).pid);console.log(JSON.stringify(pids));setTimeout(()=>process.exit(0),200);`];
// What ACPX does with the launcher: start it, report its PID (here: create the job and release it), read the agent's output.
async function start(host:JobHost,name:string,argv:string[],assignTo=name){
  const launched=await host.launch(argv);
  await host.create(name);
  const child=spawn(launched.argv[0]!,launched.argv.slice(1),{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let output='';child.stdout.on('data',c=>{output+=String(c);});
  const contained=await host.release(assignTo,child.pid!);
  await until(()=>output.includes(']'));
  return {launched,contained,pids:JSON.parse(output.slice(output.indexOf('['),output.indexOf(']')+1)) as number[],launcher:child.pid!};
}

test('an agent and the processes it starts stay in its job, even after their parents exit, and stop with it',{timeout:60000},async(t)=>{
  const host=new JobHost(tempDir('ava-jobs-'));t.after(()=>host.dispose());
  if(process.platform!=='win32'){const launched=await host.launch(['node']);assert.equal(launched.contained,false);assert.deepEqual(launched.argv,['node']);return;}
  const first=await start(host,'pair/cli1/1/a',agent(2));
  assert.equal(first.launched.contained,true,first.launched.note);assert.equal(first.contained,true);
  assert.ok(await until(()=>!alive(first.launcher)),'the launcher ends with its agent');
  const members=await host.members('pair/cli1/1/a');
  for(const pid of first.pids){assert.ok(alive(pid));assert.ok(members.includes(pid),'a child whose parent exited is still a job member');}
  const scoped=await host.scopeMembers('pair/cli1/1/');for(const pid of first.pids)assert.ok(scoped.includes(pid),'the seat\'s scope lists its jobs\' members');
  await host.retire('pair/cli1/1/a');
  assert.ok(await until(()=>first.pids.every(pid=>!alive(pid))),'stopping the job stops every member');
  // With a kept process (an app server the user is previewing), the rest stop and it keeps running.
  const second=await start(host,'pair/cli2/1/b',agent(2));
  await host.retire('pair/cli2/1/b',[second.pids[0]!]);
  assert.ok(await until(()=>!alive(second.pids[1]!)));assert.equal(alive(second.pids[0]!),true,'the kept process keeps running');
  process.kill(second.pids[0]!);
});

// PowerShell 7 from the Microsoft Store runs in its package's own job, so what it starts is outside the agent's job and
// Windows won't add it. The helper's lineage still finds it. Runs where the Store's pwsh is what PATH finds.
test('a process started outside the job by a Store app (PowerShell 7) is still found through its lineage, and stopped',{timeout:60000},async(t)=>{
  if(process.platform!=='win32')return;
  const where=spawnSync('where.exe',['pwsh'],{encoding:'utf8',windowsHide:true}).stdout.split(/\r?\n/)[0]??'';
  if(!/WindowsApps/i.test(where))return;
  const host=new JobHost(tempDir('ava-jobs-lineage-'));t.after(()=>host.dispose());
  const marker=`AVA_LINEAGE_${process.pid}`;
  const launched=await host.launch(['pwsh.exe','-NoProfile','-Command',`Start-Process -WindowStyle Hidden '${process.execPath}' -ArgumentList '-e','setInterval(()=>{},1000)//${marker}'`]);
  await host.create('pair/cli1/1/d');
  const child=spawn(launched.argv[0]!,launched.argv.slice(1),{stdio:'ignore',windowsHide:true});await host.release('pair/cli1/1/d',child.pid!);
  const find=()=>spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${marker}' } | ForEach-Object { $_.ProcessId }`],{encoding:'utf8',windowsHide:true}).stdout.split(/\s+/).filter(Boolean).map(Number);
  let started:number[]=[];assert.ok(await until(()=>(started=find()).length===1,20000),'the background process started');
  try{
    assert.ok(await until(async()=>(await host.members('pair/cli1/1/d')).includes(started[0]!),5000),'it is a member through the lineage, though outside the job');
    await host.retire('pair/cli1/1/d');
    assert.ok(await until(()=>!alive(started[0]!)),'retiring the job stops it');
  }finally{if(alive(started[0]!))process.kill(started[0]!);}
});

test('when assignment fails, the launcher still starts the agent, uncontained, and says so',{timeout:60000},async(t)=>{
  const host=new JobHost(tempDir('ava-jobs-fail-'));t.after(()=>host.dispose());
  if(process.platform!=='win32')return;
  const started=await start(host,'pair/cli1/1/c',agent(1),'no-such-job');
  assert.equal(started.contained,false);assert.equal(started.pids.length,1);
  process.kill(started.pids[0]!);await host.retire('pair/cli1/1/c');
  const off=process.env.AVA_JOB_OBJECTS;process.env.AVA_JOB_OBJECTS='off';
  try{const launched=await host.launch(['node']);assert.equal(launched.contained,false);assert.match(launched.note,/AVA_JOB_OBJECTS=off/);}
  finally{if(off===undefined)delete process.env.AVA_JOB_OBJECTS;else process.env.AVA_JOB_OBJECTS=off;}
});

test('a launcher that has gone gets no start signal, old signals are swept, and kept PIDs outside the job don\'t stop it ending whole',{timeout:60000},async(t)=>{
  if(process.platform!=='win32')return;
  const data=tempDir('ava-jobs-stale-'),host=new JobHost(data);t.after(()=>host.dispose());
  const ops:string[]=[],internals=host as unknown as {must(op:string,fields:object):Promise<unknown>},must=internals.must.bind(host);
  internals.must=(op,fields)=>{ops.push(op);return must(op,fields);};
  await host.launch(['node']);await host.create('pair/cli1/1/e');
  const gone=spawn(process.execPath,['-e','0'],{stdio:'ignore',windowsHide:true});await new Promise(r=>gone.once('exit',r));
  assert.equal(await host.release('pair/cli1/1/e',gone.pid!),false);
  assert.equal(existsSync(join(data,'jobs',`${gone.pid}.ready`)),false,'no signal is left for the next process with that PID');
  // A signal older than any launcher waits is removed when the next agent launches.
  const old=join(data,'jobs','99999.ready');writeFileSync(old,'contained');utimesSync(old,new Date(Date.now()-120_000),new Date(Date.now()-120_000));
  await host.launch(['node']);assert.equal(existsSync(old),false);
  // A kept PID that isn't this job's member (another agent's server, or one that has exited) leaves it to end as a whole.
  const started=await start(host,'pair/cli1/1/f',agent(2));ops.length=0;
  await host.retire('pair/cli1/1/f',[gone.pid!]);
  assert.ok(ops.includes('terminate'),`the job was ended whole (${ops.join(', ')})`);
  assert.ok(await until(()=>started.pids.every(pid=>!alive(pid))));
});