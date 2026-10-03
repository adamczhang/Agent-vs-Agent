import type { AgentRequest, AgentResult, Clock, Participant, ProviderConfig } from '../src/types.js';
import type { ServiceFactory } from '../src/service.js';
import type { Catalog } from '../src/providers.js';
import type { ConfiguredParticipant } from '../src/activation.js';

export class FakeClock implements Clock {
  time = 0;
  private next = 0;
  private timers = new Map<number, { time: number; fn: () => void }>();
  now = () => this.time;
  timer = (fn: () => void, delay: number) => {
    const id = ++this.next; this.timers.set(id, { time: this.time + delay, fn });
    return () => { this.timers.delete(id); };
  };
  async advance(ms: number) {
    this.time += ms;
    while (true) {
      const first = [...this.timers].filter(([,t])=>t.time <= this.time).sort((a,b)=>a[1].time-b[1].time || a[0]-b[0])[0];
      if (!first) break;
      this.timers.delete(first[0]); first[1].fn();
    }
    await flush();
  }
}
interface Pending { request: AgentRequest; resolve(value: AgentResult): void; reject(reason: unknown): void; settled: boolean }
export class FakeParticipant implements Participant {
  calls: Pending[] = [];
  closed = false;
  constructor(readonly sessionId: string, private readonly honorAbort = true) {}
  request(request: AgentRequest): Promise<AgentResult> {
    return new Promise((resolve,reject) => {
      const call: Pending = { request, resolve, reject, settled: false }; this.calls.push(call);
      request.onStarted();
      request.signal.addEventListener('abort', () => {
        if (this.honorAbort && !call.settled) { call.settled=true; resolve({status:'cancelled',text:''}); }
      },{once:true});
      if(request.signal.aborted && this.honorAbort) {call.settled=true;resolve({status:'cancelled',text:''});}
    });
  }
  answer(text: string, stop = false, index = this.calls.length-1) {
    this.raw(JSON.stringify({ message:text, stop_requested:stop, stop_reason:stop?'done':null }),index);
  }
  raw(text: string,index=this.calls.length-1) {
    const call=this.calls[index]; if(!call)throw new Error('No pending call');
    call.request.onEvent({type:'output',text});call.settled=true;call.resolve({status:'completed',text});
  }
  emit(type:'thought'|'tool'|'output', text:string,index=this.calls.length-1) {this.calls[index]!.request.onEvent({type,text});}
  async close(){this.closed=true;for(const call of this.calls)if(!call.settled){call.settled=true;call.resolve({status:'cancelled',text:''});}}
}
type OpenOptions={internet?:()=>boolean;resumeSessionId?:string;workspace?:()=>string|undefined;bypass?:()=>boolean;keep?:()=>number[]};
export class TestFactory implements ServiceFactory {
  agents:Array<FakeParticipant&ConfiguredParticipant&{options:OpenOptions;buildAccess?:boolean[]}>=[];
  ledger?:ServiceFactory['ledger'];
  gatewayModels?:ServiceFactory['gatewayModels'];
  runVercel?:ServiceFactory['runVercel'];
  list(){return [{provider:'codex',mode:'simulation'}];}
  async discover():Promise<Catalog>{return {provider:'codex',currentModel:'model',models:[{id:'model',name:'Model'}],controls:[]};}
  // Like the native factory: a resume reopens the same session, and Codex fixes its web access at launch.
  async open(config:ProviderConfig,_scope?:unknown,_signal?:AbortSignal,options:OpenOptions={}){
    const agent=new FakeParticipant(options.resumeSessionId??'native-'+this.agents.length) as FakeParticipant&ConfiguredParticipant&{options:OpenOptions;buildAccess?:boolean[]};
    agent.accepted=config;agent.evidence='simulation';agent.isConnected=()=>!agent.closed;agent.options=options;
    // As verified live: Codex and Grok Build fix web access at launch; Grok Build can't read images.
    if(config.provider==='codex'||config.provider==='grok-build')agent.launchedWithInternet=options.internet?.()??false;    agent.imageInput=config.provider!=='grok-build';
    // Codex switches its own mode for Build runs; record each switch.
    if(config.provider==='codex'){agent.buildAccess=[];agent.setBuildAccess=async(on:boolean)=>{agent.buildAccess!.push(on);};}
    const original=agent.request.bind(agent);
    agent.request=(r:AgentRequest)=>{const result=original(r);const marker=r.text.match(/AVA_READY_[\w-]+/);if(marker)agent.raw(marker[0]);return result;};
    this.agents.push(agent);return agent;
  }
}
export async function flush(){ for(let i=0;i<35;i++)await Promise.resolve(); }
