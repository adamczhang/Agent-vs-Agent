import { test as base, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RequestListener } from 'node:http';
import type { AvAService as Service } from '../../src/service.js';
import type { Pair, Run, Seat } from '../../src/types.js';

// Exercise the compiled service as shipped, including its worker-thread entry points.
const {AvAService}=await import(pathToFileURL(resolve('dist/src/service.js')).href) as typeof import('../../src/service.js');
const {SimulationFactory}=await import(pathToFileURL(resolve('dist/src/simulation.js')).href) as typeof import('../../src/simulation.js');
const {listen}=await import(pathToFileURL(resolve('dist/src/http.js')).href) as typeof import('../../src/http.js');
export const test=base.extend<{room:{url:string;service:Service;pairId:string}}>({
  room:async({},use)=>{
    const data=mkdtempSync(join(tmpdir(),'ava-browser-'));
    const service=new AvAService(data,new SimulationFactory(400),'simulation');
    let close=()=>service.shutdown();
    try{
    const call=service.call.bind(service);
    async function pair(thread:string){
      const p=await call('pair.create',{thread}) as Pair;
      for(const [seat,provider] of [['cli1','codex'],['cli2','claude']] as const){
        await call('slot.configure',{pairId:p.id,seat,config:{provider,model:'sim-model',auth:'provider-login'}});
        await call('slot.activate',{pairId:p.id,seat});
      }
      return p;
    }
    const p=await pair('browser-room');
    const history=await call('run.start',{pairId:p.id,text:'Browser fixture conversation',requestId:'history',options:{paceMs:0,maxRequests:2}}) as Run;
    await expect.poll(()=>service.store.run(history.id).status).toBe('stopped');
    expect(service.store.run(history.id).reason).toBe('request_limit');
    const buildPair=await pair('browser-build');
    const build=await call('run.start',{pairId:buildPair.id,text:'Browser fixture build',requestId:'fixture-build',options:{mode:'build'},build:{kind:'build'}}) as Run;
    await expect.poll(()=>service.store.run(build.id).status).toBe('completed');
    const prepared=await call('room.prepare',{pairId:p.id}) as {ticket:string};
    const room=await call('room.open',prepared) as {roomId:string};
    const http=await listen(service,resolve('dist/web'));
    close=async()=>{http.server.closeAllConnections();await http.close();};
    const origin=`http://127.0.0.1:${http.port}`;
    // Preview routing/security has server tests. These token-free frames exercise the actual Results UI.
    service.call=async(method,input)=>method==='build.preview'
      ?{kind:'static',url:`${origin}/__fixture_frame?seat=${(input as {seat:Seat}).seat}`,origin,entry:'index.html',named:true}
      :call(method,input);
    const handler=http.server.listeners('request')[0] as RequestListener;
    http.server.removeAllListeners('request');
    http.server.on('request',(req,res)=>{
      if(req.headers.host!==`127.0.0.1:${http.port}`){res.writeHead(403).end();return;}
      if(req.url==='/__test_session'){
        // This route exists only in this simulated, disposable test server. No token-bearing URL or trace.
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
        res.end(`<script>sessionStorage.setItem('ava-token',${JSON.stringify(http.token)});sessionStorage.setItem('ava-room',${JSON.stringify(room.roomId)});location.replace('/');</script>`);return;
      }
      if(req.url?.startsWith('/__fixture_frame?')){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><h1>Working preview</h1><button onclick="this.textContent=\'Preview clicked\'">Try preview</button>');return;}
      handler.call(http.server,req,res);
    });
    await use({url:`${origin}/__test_session`,service,pairId:p.id});
    }finally{await close();service.store.close();}
  },
});
export {expect};
