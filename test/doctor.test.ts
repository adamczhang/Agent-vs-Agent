import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {doctor,diagnoseCli,diagnoseGateway,formatDoctor,type DiagnosticRun,type DoctorReport} from '../src/doctor.js';
import {runCommand} from '../src/text-client.js';
import {AvAService} from '../src/service.js';
import {TestFactory} from './fakes.js';
import type {Pair} from '../src/types.js';
import type {Menu} from '../src/menus.js';
import {tempDir} from './temp.js';
import {listen} from '../src/http.js';

const inspect=()=>undefined;
test('a slow diagnostic HTTP request keeps the service busy until its response settles',async()=>{
  let complete!:(r:DoctorReport)=>void,started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const result=new Promise<DoctorReport>(resolve=>{complete=resolve;});
  const factory=Object.assign(new TestFactory(),{doctor:()=>{started();return result;}});
  const root=tempDir('ava-doctor-idle-'),service=new AvAService(root,factory,'simulation'),http=await listen(service,root);
  try{
    const response=fetch(`http://127.0.0.1:${http.port}/api`,{method:'POST',headers:{Authorization:`Bearer ${http.token}`},body:JSON.stringify({method:'doctor',params:{}})});
    await entered;await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(Date.now()-http.lastRequestAt()<25,'an in-flight request must prevent idle shutdown');
    complete({modelRequests:0,clis:[],gateway:{key:'none',status:'missing'}});
    assert.equal((await response).status,200);
  }finally{complete({modelRequests:0,clis:[],gateway:{key:'none',status:'missing'}});await http.close();service.store.close();}
});
test('doctor checks versions and documented login status, without model or login commands',async()=>{
  const calls:string[]=[],root=tempDir('ava-doctor-');
  const execute:DiagnosticRun=async(launch,args)=>{
    calls.push(launch.command+' '+args.join(' '));
    const stdout=args[0]==='--version'?(launch.command==='codex'?'0.100.0':launch.command==='claude'?'2.1.300':'1.0.46'):
      launch.command==='codex'?'Logged in using ChatGPT':JSON.stringify({loggedIn:false});
    return {ok:true,stdout,stderr:''};
  };
  const report=await doctor(root,inspect,{env:{},resolve:p=>p==='antigravity'?undefined:{command:p,args:[]},run:execute,fetcher:async()=>{throw new Error('No key should make no HTTP request');}});
  assert.equal(report.modelRequests,0);
  assert.equal(report.clis[0]!.compatible,false);assert.equal(report.clis[0]!.auth,'signed_in');
  assert.equal(report.clis[1]!.compatible,true);assert.equal(report.clis[1]!.auth,'signed_out');
  assert.equal(report.clis[2]!.minimum,null);assert.equal(report.clis[2]!.auth,'unknown');
  assert.equal(report.clis[3]!.installed,false);assert.equal(report.gateway.status,'missing');
  assert.deepEqual(calls.sort(),['codex --version','codex login status','claude --version','claude auth status --json','grok-build --version'].sort());
  assert.match(formatDoctor(report),/Update required: npm install -g/);
});

test('doctor reports failed probes and API-route conflicts without leaking command output',async()=>{
  const failed=await diagnoseCli('claude',inspect,{env:{},resolve:()=>({command:'mock',args:[]}),run:async()=>{throw new Error('not_a_real_secret');}});
  assert.equal(failed.auth,'unknown');assert.ok(!JSON.stringify(failed).includes('not_a_real_secret'));
  const conflict=await diagnoseCli('codex',inspect,{env:{OPENAI_API_KEY:'not_a_real_secret'},resolve:()=>({command:'mock',args:[]}),run:async(_l,args)=>{
    assert.deepEqual(args,['--version']);return {ok:true,stdout:'0.160.0',stderr:''};
  }});
  assert.equal(conflict.auth,'api_key');assert.ok(!JSON.stringify(conflict).includes('not_a_real_secret'));
});

test('Gateway diagnostics use only the credit endpoint and distinguish rejected, empty and unavailable credit',async()=>{
  const root=tempDir('ava-doctor-key-');mkdirSync(join(root,'secrets'));writeFileSync(join(root,'secrets','ai-gateway.json'),JSON.stringify({key:'not_a_real_gateway_key'}));
  for(const [status,body,expected] of [[200,{balance:'12.5'},'ready'],[200,{balance:0},'no_credit'],[401,{error:'not_a_real_secret'},'invalid_key'],[500,{},'unavailable'],[200,{},'unavailable']] as const){
    const report=await diagnoseGateway(root,async(url,options)=>{
      assert.equal(url,'https://ai-gateway.vercel.sh/v1/credits');assert.equal(options?.method,undefined);assert.ok(options?.signal);
      return new Response(JSON.stringify(body),{status});
    });
    assert.equal(report.status,expected);assert.ok(!JSON.stringify(report).includes('not_a_real'));
  }
  assert.equal((await diagnoseGateway(root,async()=>{throw new Error('network down');})).status,'unavailable');
});

test('help and doctor do not create pairs, activate agents, or require a room in either host',async()=>{
  const report:DoctorReport={modelRequests:0,clis:[],gateway:{key:'none',status:'missing'}};
  for(const thread of ['codex-chat','claude-session']){
    const calls:string[]=[];
    const rpc=async(method:string)=>{calls.push(method);assert.equal(method,'doctor');return report;};
    const context={thread,rpc,roomUrl:()=>{throw new Error('No room');}};
    assert.match(await runCommand({...context,command:'/ava'}),/\/ava doctor/);assert.deepEqual(calls,[]);
    assert.match(await runCommand({...context,command:'/ava doctor'}),/0 model requests/);assert.deepEqual(calls,['doctor']);
  }
});

test('the provider menu flags old CLIs before model discovery, including the Gateway Codex dependency',async()=>{
  const factory=Object.assign(new TestFactory(),{cliWarnings:async()=>({codex:'Update required: npm install -g @openai/codex@latest'})});
  const service=new AvAService(tempDir('ava-menu-doctor-'),factory,'simulation');
  try{
    const pair=await service.call('pair.create',{thread:'diagnostic-menu'}) as Pair;
    const menu=await service.call('menu.show',{pairId:pair.id,seat:'cli1'}) as Menu;
    for(const name of ['codex','vercel'])assert.match(menu.choices.find(c=>c.value===name)!.label,/Update required/);
    assert.equal(factory.agents.length,0);
  }finally{await service.shutdown();service.store.close();}
});
