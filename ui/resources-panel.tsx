import { useEffect,useRef,useState } from 'react';
import type { ResourceSnapshot } from '../src/resources.js';
import { rpc } from './api.js';
import { CommandClient } from './commands.js';
import { Icon } from './icons.js';
import { bytes,names } from './model.js';

export function ResourcesPanel({onClose}:{onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[data,setData]=useState<ResourceSnapshot>(),[limit,setLimit]=useState('');
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const stopCommand=useRef(new CommandClient(sessionStorage,'ava-stop-all')),configureCommand=useRef(new CommandClient(sessionStorage,'ava-resource-limit'));
  const refresh=async()=>{const next=await rpc<ResourceSnapshot>('resources.get',{});setData(next);setLimit(value=>value||String(next.maxActiveAgents));};
  useEffect(()=>{
    dialog.current?.showModal();let disposed=false,reading=false;
    const read=async()=>{if(reading)return;reading=true;try{const next=await rpc<ResourceSnapshot>('resources.get',{});if(!disposed){setData(next);setLimit(v=>v||String(next.maxActiveAgents));}}catch(e){if(!disposed)setError(e instanceof Error?e.message:String(e));}finally{reading=false;}};
    void read();const timer=setInterval(()=>void read(),5000);
    return()=>{disposed=true;clearInterval(timer);};
  },[]);
  async function work(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function stop(){setConfirm(false);await work(async()=>{
    const result=await stopCommand.current.execute('stop-all','resources.stop',{},rpc) as {status:string;remainingProcesses:number;errors:string[]};
    setNotice(result.status==='stopped'?'All AvA agents stopped. Activate agents in a room when you want to continue.':`Some work needs attention. ${result.remainingProcesses} processes remain. ${result.errors.join(' ')}`);
  });}
  return <dialog ref={dialog} className="resources-panel" aria-labelledby="resources-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header><div><h2 id="resources-title">Resources</h2><p>AvA agents across every room in this conversation pool.</p></div><button className="icon-btn" aria-label="Close Resources" disabled={busy} onClick={onClose}><Icon.close/></button></header>
    {error&&<p role="alert" className="resource-error">{error}</p>}
    {data?<>
      <div className="resource-totals"><span><strong>{data.activeAgents}</strong> active or starting agents</span><span><strong>{data.processCount}</strong> recorded processes</span><span><strong>{data.memoryBytes===null?'Unavailable':bytes(data.memoryBytes)}</strong> memory in use</span></div>
      <form className="resource-settings" onSubmit={e=>{e.preventDefault();void work(async()=>{await configureCommand.current.execute(`limit:${limit}`,'resources.configure',{maxActiveAgents:Number(limit)},rpc);setNotice('Activation limit saved. Existing work continues.');});}}>
        <label>Maximum active agents <input aria-label="Maximum active agents" type="number" min={0} max={32} required value={limit} disabled={busy} onChange={e=>setLimit(e.target.value)}/></label>
        <button className="button" disabled={busy||Number(limit)===1||!limit}>Save limit</button>
        <small>0 means unlimited. Lowering the limit blocks new activations until space is available.</small>
      </form>
      <div className="resource-table"><table><thead><tr><th>Agent / room</th><th>State</th><th>Processes</th><th>Memory</th></tr></thead><tbody>{data.agents.map(agent=><tr key={`${agent.pairId}:${agent.seat}`}><td>{names[agent.provider]??agent.provider} · Agent {agent.seat==='cli1'?1:2}<small>{agent.room} · {agent.model}</small></td><td>{agent.state==='verifying'?'Starting':agent.state==='ready'?'Active':'Needs attention'}</td><td>{agent.processes}</td><td>{agent.memoryBytes===null?'Unavailable':bytes(agent.memoryBytes)}</td></tr>)}</tbody></table>{!data.agents.length&&<p>No active agents.</p>}</div>
      <p className="resource-note">Memory is sampled from recorded processes every five seconds while this panel is open. Unavailable readings stay unknown. The activation limit counts agents, not child processes or memory.</p>
      {notice&&<p role="status">{notice}</p>}
      {confirm?<div className="resource-confirm" role="alert"><p>Stop agents in every AvA room, including private replies and app previews? Conversations and saved prompts stay saved.</p><button className="button" onClick={()=>setConfirm(false)}>Cancel</button><button className="button destructive" onClick={()=>void stop()}>Confirm stop all</button></div>
        :<button className="button destructive" disabled={busy||data.stopping} onClick={()=>stopCommand.current.hasPending?void stop():setConfirm(true)}>{stopCommand.current.hasPending?'Retry stop status':'Stop all AvA agents'}</button>}
    </>:<p>Loading resource usage…</p>}
  </dialog>;
}
