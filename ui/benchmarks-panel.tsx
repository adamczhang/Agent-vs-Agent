import { useEffect,useRef,useState } from 'react';
import type { BenchJob } from '../src/bench-runner.js';
import type { PairView } from './model.js';
import { names } from './model.js';
import { rpc,roomId } from './api.js';
import { CommandClient } from './commands.js';
import { Icon } from './icons.js';
import { BenchmarkResultsView } from './benchmark-results.js';
interface Task {id:string;title:string;mode:string;version:number;prompt:string;checks:number;minutes:number;validated:boolean;digest:string;blockedReason:string}
export function BenchmarksPanel({pair,onClose}:{pair:PairView|undefined;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),commands=useRef(new CommandClient(sessionStorage,'ava-benchmark-start:'+roomId));
  const pending=commands.current.pendingInput?.params;
  const [tasks,setTasks]=useState<Task[]>([]),[selected,setSelected]=useState<string[]>(()=>pending?.taskIds as string[]??[]),[repeats,setRepeats]=useState(Number(pending?.repeats??1));
  const [jobs,setJobs]=useState<BenchJob[]>([]),[job,setJob]=useState<BenchJob>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [tab,setTab]=useState<'tasks'|'results'>('tasks');
  const chosen=useRef('');
  const initialized=useRef(!!pending);
  async function refresh(){const catalog=await rpc<{tasks:Task[]}>('bench.catalog',{});setTasks(catalog.tasks);if(!initialized.current){setSelected(catalog.tasks.map(t=>t.id));initialized.current=true;}const list=await rpc<{jobs:BenchJob[]}>('bench.jobs',{});setJobs(list.jobs);const current=list.jobs.find(j=>j.id===chosen.current)??list.jobs[0];if(current){chosen.current=current.id;setJob(current);}}
  useEffect(()=>{dialog.current?.showModal();let active=true,reading=false;const read=async()=>{if(reading)return;reading=true;try{if(active)await refresh();}catch(e){if(active)setError(e instanceof Error?e.message:String(e));}finally{reading=false;}};void read();const timer=setInterval(()=>void read(),2000);return()=>{active=false;clearInterval(timer);};},[]);
  async function work(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const locked=busy||commands.current.hasPending,ready=!!pair?.slots.cli1.config&&!!pair?.slots.cli2.config;
  const canRun=selected.length>0&&selected.every(id=>tasks.some(t=>t.id===id&&t.validated&&!t.blockedReason))&&ready&&!jobs.some(j=>j.status==='running'||j.status==='queued');
  async function start(){await work(async()=>{const params=commands.current.pendingInput?.params??{pairId:pair!.id,taskIds:selected,repeats,stopOnFailure:false};const started=await commands.current.execute(JSON.stringify(params),'bench.start',params,rpc) as BenchJob;chosen.current=started.id;setJob(started);});}
  return <dialog ref={dialog} className="resources-panel benchmarks-panel" aria-labelledby="benchmarks-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header><div><h2 id="benchmarks-title">Benchmarks</h2><p>Validated tasks, fresh agent sessions, and saved pass/fail results.</p></div><button className="icon-btn" aria-label="Close Benchmarks" disabled={busy} onClick={onClose}><Icon.close/></button></header>
    <nav className="benchmark-tabs" role="tablist" aria-label="Benchmark views"><button role="tab" aria-selected={tab==='tasks'} aria-controls="benchmark-tasks-panel" onClick={()=>setTab('tasks')}>Tasks</button><button role="tab" aria-selected={tab==='results'} aria-controls="benchmark-results-panel" onClick={()=>setTab('results')}>Results</button></nav>
    {tab==='results'?<div role="tabpanel" id="benchmark-results-panel"><BenchmarkResultsView simulation={pair?.mode==='simulation'} refreshKey={`${job?.id??''}:${job?.updatedAt??''}`} jobId={job?.id}/></div>:<div role="tabpanel" id="benchmark-tasks-panel">
    {error&&<p role="alert" className="resource-error">{error}</p>}
    <div className="benchmark-tasks">{tasks.map(task=><article key={task.id}><label><input type="checkbox" aria-label={`Select ${task.title}`} checked={selected.includes(task.id)} disabled={locked} onChange={e=>setSelected(ids=>e.target.checked?[...ids,task.id]:ids.filter(id=>id!==task.id))}/><strong>{task.title}</strong><span>{task.mode} · v{task.version} · {task.checks} checks</span></label><small className={task.validated?'validated':''}>{task.validated?'Validated':'Needs validation'}</small>{task.blockedReason&&<p className="resource-note">{task.blockedReason}</p>}<details><summary>Task prompt</summary><pre>{task.prompt}</pre></details></article>)}</div>
    <div className="benchmark-controls"><button className="button" disabled={locked||!selected.length} onClick={()=>void work(async()=>{const result=await rpc<{validations:Array<{validated:boolean}>}>('bench.validate',{taskIds:selected});setNotice(result.validations.every(v=>v.validated)?'All selected tasks validated: reference passes, empty attempt fails.':'A task did not validate. Inspect its reference solution and checks.');})}>Validate selected</button><label>Repetitions <input aria-label="Benchmark repetitions" type="number" min={1} max={10} value={repeats} disabled={locked} onChange={e=>setRepeats(Number(e.target.value))}/></label><button className="button primary" disabled={busy||!commands.current.hasPending&&(!canRun||!Number.isInteger(repeats)||repeats<1||repeats>10)} onClick={()=>void start()}>{commands.current.hasPending?'Retry benchmark start':'Run selected'}</button></div>
    <p className="resource-note">Up to <strong>{selected.length*repeats*4} model requests</strong>: two access checks and two task answers per task and repetition. Validation runs trusted local verifier scripts without model requests. Each attempt uses fresh sessions for {pair?.slots.cli1.config?names[pair.slots.cli1.config.provider]:'Agent 1'} and {pair?.slots.cli2.config?names[pair.slots.cli2.config.provider]:'Agent 2'}.</p>
    {notice&&<p role="status">{notice}</p>}
    {job&&<section className="benchmark-job" aria-label="Benchmark progress"><div className="benchmark-job-head"><h3>{job.status} · {job.results.length}/{job.totalAttempts} attempts</h3>{['queued','running'].includes(job.status)&&<button className="button" disabled={busy} onClick={()=>void work(async()=>{await rpc('bench.cancel',{jobId:job.id,requestId:crypto.randomUUID()});})}>Cancel benchmark</button>}</div>{job.current&&<p>{job.current.taskId} · repetition {job.current.repeat}</p>}{job.error&&<p role="alert">{job.error}</p>}<ul>{job.results.map(result=><li key={result.id}>{result.taskId} · #{result.repeat} · Agent {result.seat==='cli1'?1:2}: <strong>{result.status}</strong></li>)}</ul></section>}
    {jobs.length>1&&<label className="benchmark-history">Past job <select aria-label="Past benchmark job" value={job?.id??''} onChange={e=>{chosen.current=e.target.value;setJob(jobs.find(j=>j.id===e.target.value));}}>{jobs.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString()} · {j.status} · {j.results.length} attempts</option>)}</select></label>}
    </div>}
  </dialog>;
}
