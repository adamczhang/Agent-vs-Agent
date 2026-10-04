import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { AvAError, systemClock, type AgentUsage, type Clock, type Pair, type Participant, type ProviderConfig, type Seat } from './types.js';

// launchedWithInternet is set for providers whose web access is fixed when the process starts (Codex); the internet
// switch then needs a restart of that agent, resuming the same session.
// imageInput: whether the agent accepts images (as it declared at startup); absent counts as yes for test doubles.
// setBuildAccess: let the agent edit and run commands in its workspace during Build runs (Codex switches its own mode).
// usage: what the agent last reported about its context window and session usage (absent if it reports nothing).
export interface ConfiguredParticipant extends Participant { accepted: ProviderConfig; evidence: string; isConnected?(): boolean; launchedWithInternet?: boolean; imageInput?: boolean; setBuildAccess?(on: boolean): Promise<void>; usage?(): AgentUsage | undefined }
export interface ParticipantFactory {
  open(config: ProviderConfig, scope: { pairId: string; seat: Seat; generation: number }, signal: AbortSignal, options?: { internet?: () => boolean; resumeSessionId?: string; workspace?: () => string | undefined; bypass?: () => boolean; keep?: () => number[] | Promise<number[]> }): Promise<ConfiguredParticipant>;
}
export class ActivationManager {
  private pending = new Map<string, AbortController>();
  private live = new Map<string, ConfiguredParticipant>();
  constructor(readonly store: Store, private factory: ParticipantFactory, private clock: Clock = systemClock, private deadlineMs = 120_000) {}
  private key(pairId: string, seat: Seat) { return `${pairId}:${seat}`; }
  get(pairId: string, seat: Seat) { return this.live.get(this.key(pairId,seat)); }
  isStarting(pairId:string,seat:Seat){return this.pending.has(this.key(pairId,seat));}
  // Set by the service: whether the agent is still answering a 1:1 message (a change of agent would cut it off).
  directBusy?:(pairId:string,seat:Seat)=>boolean;
  // A synchronous service-wide admission guard. Called before a slot reserves activation work.
  beforeActivate?:(pairId:string,seat:Seat)=>void;
  private assertNoDirect(pairId:string,seat:Seat){
    if(this.directBusy?.(pairId,seat))throw new AvAError('DIRECT_BUSY',`Agent ${seat==='cli1'?1:2} is still answering your 1:1 message. Wait for the reply, then change it.`);
  }
  async configure(pairId:string,seat:Seat,config:ProviderConfig){
    this.assertNoDirect(pairId,seat);
    const slot=this.store.mutateSlot(pairId,seat,s=>{s.generation++;s.state='configuring';s.config=config;s.sessionId=null;s.verifiedAt=null;s.error=null;});
    const key=this.key(pairId,seat);this.pending.get(key)?.abort(new AvAError('SUPERSEDED','Selection changed.'));
    const current=this.live.get(key);if(current){await current.close();if(this.live.get(key)===current)this.live.delete(key);}return slot;
  }
  async activate(pairId: string, seat: Seat, config: ProviderConfig) {
    this.assertNoDirect(pairId,seat);
    this.beforeActivate?.(pairId,seat);
    const key = this.key(pairId,seat);
    const slot = this.store.mutateSlot(pairId,seat,s=>{s.generation++;s.state='verifying';s.config=config;s.sessionId=null;s.verifiedAt=null;s.error=null;});
    this.pending.get(key)?.abort(new AvAError('SUPERSEDED','Activation replaced by a newer selection.'));
    const abort = new AbortController();this.pending.set(key,abort);
    const cancelDeadline=this.clock.timer(()=>abort.abort(new AvAError('ACTIVATION_TIMEOUT','Activation exceeded its complete setup deadline.')),this.deadlineMs);
    const assertCurrent=()=>{
      abort.signal.throwIfAborted();
      if(this.store.pair(pairId).slots[seat].generation!==slot.generation)throw new AvAError('SUPERSEDED','Selection changed.');
    };
    let participant:ConfiguredParticipant|undefined, adopted=false;
    const cancelled=new Promise<never>((_,reject)=>abort.signal.addEventListener('abort',()=>reject(abort.signal.reason),{once:true}));
    const work=(async()=>{
      const old=this.live.get(key);if(old){await old.close();if(this.live.get(key)===old)this.live.delete(key);}
      assertCurrent();participant=await this.factory.open(config,{pairId,seat,generation:slot.generation},abort.signal,this.options(pairId,seat));assertCurrent();
      const nonce=`AVA_READY_${randomUUID()}`;
      const result=await participant.request({id:randomUUID(),text:`Reply exactly ${nonce}. Do not use tools or perform other work.`,signal:abort.signal,onStarted(){},onEvent(){}});
      assertCurrent();
      // Some Gateway models answer only in their reasoning through the Codex agent (seen: Kimi K2.6, K2.7 Code).
      if(result.status!=='completed'||result.text.trim()!==nonce)throw new AvAError('ACCESS_NOT_VERIFIED',config.provider==='vercel'
        ?`${config.model} didn’t give a usable reply through the Gateway agent (some models answer only in their reasoning there). Try another model.`
        :'The selected model did not return the readiness marker.');
      this.store.mutateSlot(pairId,seat,s=>{
        assertCurrent();s.state='ready';s.config=participant!.accepted;s.sessionId=participant!.sessionId;s.verifiedAt=Date.now();s.error=null;
      });
      this.live.set(key,participant);adopted=true;
      return {slot:this.store.pair(pairId).slots[seat],evidence:participant.evidence};
    })();
    try { return await Promise.race([work,cancelled]); }
    catch(error){
      if(this.store.pair(pairId).slots[seat].generation===slot.generation)this.store.mutateSlot(pairId,seat,s=>{s.state='failed';s.error=error instanceof Error?error.message:'Activation failed';});
      abort.abort(error);throw error;
    }finally{
      cancelDeadline();if(this.pending.get(key)===abort)this.pending.delete(key);
      void work.catch(()=>{}).finally(async()=>{if(participant&&!adopted)await participant.close();}).catch(()=>{});
    }
  }
  // The agent's internet switch, read live (the permission gate asks on every web tool request).
  internet(pairId:string,seat:Seat){try{return this.store.pair(pairId).slots[seat].internet===true;}catch{return false;}}
  // The agent's permissions setting, read live the same way: bypass approves every tool request.
  bypass(pairId:string,seat:Seat){try{return this.store.pair(pairId).slots[seat].permissions==='bypass';}catch{return false;}}
  // Set by the service: the folder an agent may work in while a Build run is active for it (undefined otherwise).
  workspaceAccess?:(pairId:string,seat:Seat)=>string|undefined;
  // The processes an agent's close leaves running: the app servers its Build runs kept (set by the service).
  keptProcesses?:(pairId:string,seat:Seat)=>Promise<number[]>;
  private options(pairId:string,seat:Seat){return {internet:()=>this.internet(pairId,seat),workspace:()=>this.workspaceAccess?.(pairId,seat),bypass:()=>this.bypass(pairId,seat),keep:()=>this.keptProcesses?.(pairId,seat)??[]};}
  // Apply a launch-time setting to a live agent without losing its conversation: retire its process, then start a new
  // one that resumes the same native session (Codex allows only one process per session), and check it really is the
  // same session. If the resume fails, the agent is marked as needing setup again; nothing is resent.
  async relaunch(pairId:string,seat:Seat){
    this.beforeActivate?.(pairId,seat);
    const key=this.key(pairId,seat),old=this.live.get(key),slot=this.store.pair(pairId).slots[seat];
    if(!old||slot.state!=='ready'||!slot.config||!slot.sessionId)throw new AvAError('NOT_READY',`${seat} is not connected and verified.`);
    const abort=new AbortController(),timeout=this.clock.timer(()=>abort.abort(new AvAError('RELAUNCH_TIMEOUT','The agent did not restart in time.')),this.deadlineMs);
    let next:ConfiguredParticipant|undefined;
    this.pending.set(key,abort);
    try{
      await old.close();
      if(this.live.get(key)===old)this.live.delete(key);
      next=await this.factory.open(slot.config,{pairId,seat,generation:slot.generation},abort.signal,{...this.options(pairId,seat),resumeSessionId:slot.sessionId});
      if(next.sessionId!==slot.sessionId)throw new AvAError('RESUME_FAILED','The agent started a new session instead of resuming its conversation.');
      if(this.store.pair(pairId).slots[seat].generation!==slot.generation)throw new AvAError('SUPERSEDED','The agent changed while it restarted.');
      this.live.set(key,next);
      return next;
    }catch(error){
      if(next)await next.close().catch(()=>{});
      const message=`Couldn't restart this agent with the new internet setting (${error instanceof Error?error.message:String(error)}). Set it up again.`;
      this.store.failSlot(pairId,seat,slot.generation,message);
      throw new AvAError('RELAUNCH_FAILED',message);
    }
    finally{timeout();if(this.pending.get(key)===abort)this.pending.delete(key);}
  }
  cancel(pairId:string,seat:Seat){
    if(!this.pending.has(this.key(pairId,seat)))return;
    this.store.mutateSlot(pairId,seat,s=>{s.generation++;s.state='configuring';s.sessionId=null;s.verifiedAt=null;});
    this.pending.get(this.key(pairId,seat))?.abort(new AvAError('CANCELLED','Activation cancelled.'));
  }
  ready(pairId:string):Pair{
    const pair=this.store.pair(pairId);
    for(const seat of ['cli1','cli2'] as const){
      const slot=pair.slots[seat],live=this.get(pairId,seat);
      if(slot.state!=='ready'||!live||live.isConnected?.()===false||slot.sessionId!==live.sessionId)throw new AvAError('NOT_READY',`${seat} is not connected and verified.`);
    }
    return pair;
  }
  participants(pairId:string){this.ready(pairId);return {cli1:this.get(pairId,'cli1')!,cli2:this.get(pairId,'cli2')!};}
  // Close this service's own sessions for one pair (recovery). A session is forgotten only after it confirms closing.
  async closePair(pairId:string){
    for(const seat of ['cli1','cli2'] as const)this.pending.get(this.key(pairId,seat))?.abort(new AvAError('CANCELLED','Pair released.'));
    const results=await Promise.allSettled((['cli1','cli2'] as const).map(async seat=>{const key=this.key(pairId,seat),live=this.live.get(key);if(live){await live.close();if(this.live.get(key)===live)this.live.delete(key);}}));
    if(results.some(r=>r.status==='rejected'))throw new AvAError('CLEANUP_FAILED','An owned provider did not confirm cleanup. Recovery is required.');
  }
  async closeAll(){
    for(const pending of this.pending.values())pending.abort(new AvAError('SHUTDOWN','Service shutting down.'));
    const results=await Promise.allSettled([...this.live.entries()].map(async([key,p])=>{await p.close();if(this.live.get(key)===p)this.live.delete(key);}));
    if(results.some(r=>r.status==='rejected'))throw new AvAError('CLEANUP_FAILED','An owned provider did not confirm cleanup. Recovery is required.');
  }
}
