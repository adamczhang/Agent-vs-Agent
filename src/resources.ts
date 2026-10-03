import { threadKey,type Store } from './store.js';
import type { ActivationManager } from './activation.js';
import { AvAError, SEATS, type Pair, type Seat } from './types.js';
import { survivors,type SystemProcess } from './census.js';

export interface ResourceAgent {pairId:string;room:string;seat:Seat;provider:string;model:string;state:string;processes:number;memoryBytes:number|null}
export interface ResourceSnapshot {maxActiveAgents:number;activeAgents:number;processCount:number;memoryBytes:number|null;sampledAt:string|null;stopping:boolean;agents:ResourceAgent[]}
export class Resources {
  private sample?:{at:number;processes:SystemProcess[]|null};
  private sampling?:Promise<void>;
  constructor(private store:Store,private activation:ActivationManager,private list:()=>Promise<SystemProcess[]>){ }
  pairs():Pair[]{return this.store.db.prepare('SELECT data FROM pairs').all().map(r=>JSON.parse(String(r.data)) as Pair);}
  active(){return this.pairs().flatMap(pair=>SEATS.filter(seat=>!!this.activation.get(pair.id,seat)||this.activation.isStarting(pair.id,seat)||pair.slots[seat].state==='verifying'||!!pair.activeRunId&&!!pair.slots[seat].sessionId).map(seat=>({pair,seat})));}
  get limit(){const saved=this.store.db.prepare("SELECT value FROM app_settings WHERE key='maxActiveAgents'").get();return saved?Number(saved.value):4;}
  configure(limit:number){this.store.db.prepare("INSERT INTO app_settings VALUES('maxActiveAgents',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(limit));return {maxActiveAgents:limit};}
  admit(pairId:string,seat:Seat){
    const limit=this.limit,active=this.active();
    if(active.some(a=>a.pair.id===pairId&&a.seat===seat))return;
    if(limit&&active.length>=limit)throw new AvAError('AGENT_LIMIT',`The limit of ${limit} active agents has been reached. Stop an agent or raise the limit in Resources.`);
  }
  async snapshot(stopping=false):Promise<ResourceSnapshot>{
    const active=this.active();
    if(active.length&&(!this.sample||Date.now()-this.sample.at>=5000)){
      this.sampling??=this.list().then(processes=>{this.sample={at:Date.now(),processes};},()=>{this.sample={at:Date.now(),processes:null};}).finally(()=>{this.sampling=undefined;});
      await this.sampling;
    }
    const rows=this.sample?.processes??[],byPid=new Map(rows.map(p=>[p.pid,p])),all=new Set<number>();
    const threads=this.store.threads(),titles=this.store.threadTitles();
    const agents=active.map(({pair,seat}):ResourceAgent=>{
      const own=survivors(this.store.seatProcesses(pair.id,seat,pair.slots[seat].generation),rows);own.forEach(p=>all.add(p.pid));
      const sizes=own.map(p=>byPid.get(p.pid)?.memoryBytes);
      const current=threadKey(pair.id,{cli1:pair.slots.cli1.sessionId,cli2:pair.slots.cli2.sessionId});
      return {pairId:pair.id,room:titles.get(current)||threads.find(t=>t.id===current)?.runs[0]?.config.topic.slice(0,100)||'New session',seat,provider:pair.slots[seat].config?.provider??'',model:pair.slots[seat].config?.model??'',state:pair.slots[seat].state,processes:own.length,
        memoryBytes:!own.length||!this.sample?.processes||sizes.some(n=>n===undefined)?null:sizes.reduce<number>((sum,n)=>sum+(n??0),0)};
    });
    const sizes=[...all].map(pid=>byPid.get(pid)?.memoryBytes);
    return {maxActiveAgents:this.limit,activeAgents:active.length,processCount:all.size,stopping,agents,sampledAt:this.sample?new Date(this.sample.at).toISOString():null,
      memoryBytes:!active.length?0:agents.some(a=>a.memoryBytes===null)||!all.size||!this.sample?.processes||sizes.some(n=>n===undefined)?null:sizes.reduce<number>((sum,n)=>sum+(n??0),0)};
  }
}
