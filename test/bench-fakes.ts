import assert from 'node:assert/strict';
import { existsSync,readdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { TestFactory } from './fakes.js';
import { participantWorkspace } from '../src/workspace.js';
import type { Seat } from '../src/types.js';
import type { AvAService } from '../src/service.js';
import type { BenchJob } from '../src/bench-runner.js';

export class BenchmarkFactory extends TestFactory {
  taskRequests=0;judgeRequests=0;hold=false;wrongSeat?:Seat;failActivation=false;judgeReply='{"score":7,"reason":"Clear and correct."}';
  constructor(readonly data:string){super();}
  override async open(...args:Parameters<TestFactory['open']>){
    if(this.failActivation)throw new Error('Synthetic provider startup failure');
    const agent=await super.open(...args),scope=args[1] as {pairId:string;seat:Seat;generation:number},original=agent.request.bind(agent);
    agent.request=request=>{
      const result=original(request);if(/AVA_READY_[\w-]+/.test(request.text))return result;
      if(request.text.startsWith('You are grading one attempt')){this.judgeRequests++;agent.raw(this.judgeReply);return result;}
      this.taskRequests++;if(this.hold)return result;
      let answer='42';
      const workspace=participantWorkspace(this.data,scope);
      const folder=existsSync(workspace)?readdirSync(workspace).find(n=>n.startsWith('fixture-')||n.startsWith('app-')):undefined;
      if(folder){
        const app=join(workspace,folder);assert.equal(existsSync(join(app,'tests')),false,'hidden checks are absent while the agent works');assert.equal(existsSync(join(app,'solution')),false);
        if(existsSync(join(app,'src','cart.js')))answer='src/cart.js:4 adds the discount. src/cart.js:8 reverses the stock check.';
        else{writeFileSync(join(app,'tip.js'),readFileSync(resolve('benchmarks/starter/tip-calculator/solution/tip.js')));writeFileSync(join(app,'index.html'),'<input><input><input>');answer=`Built a tip calculator.\nAPP: ${folder}/index.html`;}
      }
      if(this.wrongSeat===scope.seat)answer='Wrong answer';agent.raw(answer);return result;
    };
    return agent;
  }
}
export const agents={cli1:{provider:'codex',model:'fixture',auth:'provider-login'},cli2:{provider:'claude',model:'fixture',auth:'provider-login'}} as const;
export async function finishJob(service:AvAService,id:string){
  for(const deadline=Date.now()+15000;;await new Promise(r=>setTimeout(r,20))){const job=service.benchmarks.get(id);if(!['queued','running'].includes(job.status)){await Promise.resolve();return job;}if(Date.now()>deadline)throw new Error('Benchmark fixture did not finish');}
}
export async function startJob(service:AvAService,taskIds:string[],requestId='start',repeats=1){return await service.call('bench.start',{taskIds,agents,requestId,repeats}) as BenchJob;}
