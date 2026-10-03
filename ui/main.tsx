import { useEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent as ReactPointerEvent,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { RunConfig,Seat } from '../src/types';
import type { ThreadStats } from '../src/stats';
import { activityProjection,readableOutput,type ActivityLine,type Event } from './projection';
import { RpcError,initialMode,roomId,roomLink,rpc } from './api';
import { CommandClient } from './commands';
import { replayTimeline } from './replay';
import { StatsView } from './stats-view';
import { ResultsTabs,ResultsView,openApp,type AppLink,type ResultsTab } from './results-view';
import { AgentSetup } from './agent-setup';
import { UsageRing } from './usage-ring';
import { Icon } from './icons';
import { IMAGE_TYPES,TERMINAL,TEXT_NAME,bytes,clock,dayLabel,delivery,directStates,duration,fullDate,initials,internetEnforcement,names,plural,reasonText,seats,shortTime,statusNames,
  type AttachmentRef,type DirectMessage,type Mode,type PairView,type Preset,type PresetData,type SearchHit,type ThreadMessage,type ThreadSummary,type ThreadView } from './model';
import './style.css';

const commands=new CommandClient(sessionStorage,'ava-command:'+roomId);
// One retry slot per agent for direct messages: an unacknowledged send is retried with its original request ID.
const directCommands:Record<Seat,CommandClient>={cli1:new CommandClient(sessionStorage,'ava-direct-cli1:'+roomId),cli2:new CommandClient(sessionStorage,'ava-direct-cli2:'+roomId)};
const DEFAULT_SETTINGS:PresetData={instructions:{cli1:'',cli2:''},stopWhen:{cli1:'',cli2:''},completion:'auto',minutes:'',requests:'',pace:'5'};
const LINE_LABEL:Record<string,string>={thought:'Thinking',tool:'Tool',output:'Writing',status:'Status'};
// Providers whose web access is set at launch, so the internet switch restarts them (see src/providers.ts LAUNCH_TIME_WEB).
const RESTARTS_FOR_WEB=new Set(['codex','grok-build','vercel']);
// Bookkeeping the CLIs report as status (context size, command lists) isn't activity worth showing.
const QUIET_STATUS=/^(usage updated|available commands updated|current mode updated|config options? updated|session (info )?updated)/i;
const SEAT_NUMBER:Record<Seat,number>={cli1:1,cli2:2};
// run.get returns at most this many events per call (Store.events).
const EVENT_PAGE=300;
const message=(e:unknown)=>e instanceof Error?e.message:String(e);

// Prompt, Debate or Build: which kind of thread the room shows and starts. Remembered in this browser only.
const MODE_KEY='ava-mode';
function loadMode():Mode{let m=initialMode;try{m??=localStorage.getItem(MODE_KEY);}catch{/* storage unavailable */}return m==='benchmark'||m==='build'?m:'conversation';}
// Build mode: the last project folder and whether to build or review (this browser only).
const PROJECT_KEY='ava-project',BUILD_KIND_KEY='ava-build-kind';
function loadProject(){try{return localStorage.getItem(PROJECT_KEY)??'';}catch{return '';}}
function loadBuildKind():'build'|'review'{try{return localStorage.getItem(BUILD_KIND_KEY)==='review'?'review':'build';}catch{return 'build';}}
// "benchmark" is the Prompt mode's internal name.
const MODE_NAMES:Record<Mode,string>={conversation:'Debate',benchmark:'Prompt',build:'Build'};
// The app line an agent ends a build report with; the room shows it as a link instead.
const APP_LINE=/^[\s>*_-]*APP[*_\s]*:.*$/gim;
// A file chosen for the next message: uploaded at once, sent by ID.
interface Pending {key:string;name:string;size:number;status:'uploading'|'ready'|'error';ref?:AttachmentRef;preview?:string;error?:string}
const readBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
// Images of saved messages, fetched once per page load.
const imageCache=new Map<string,Promise<string>>();
function AttachmentImage({file,onOpen}:{file:AttachmentRef;onOpen:(src:string)=>void}){
  const [src,setSrc]=useState('');
  useEffect(()=>{
    let cached=imageCache.get(file.id);
    if(!cached){cached=rpc<{data:string;mediaType:string}>('attachment.get',{id:file.id}).then(a=>`data:${a.mediaType};base64,${a.data}`);imageCache.set(file.id,cached);cached.catch(()=>imageCache.delete(file.id));}
    let live=true;void cached.then(s=>{if(live)setSrc(s);}).catch(()=>{});return()=>{live=false;};
  },[file.id]);
  return <button className="attachment-image" title={file.name} aria-label={`Open ${file.name}`} onClick={()=>src&&onOpen(src)}>{src?<img src={src} alt={file.name}/>:<span>{file.name}</span>}</button>;
}

// The split between the two agent panes is a per-viewer convenience: remembered in this browser only. The agent panes
// always take the top half of the window and the shared chat the bottom half.
const LAYOUT_KEY='ava-layout-v2',DEFAULT_LAYOUT={split:.5};
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
function loadLayout(){
  try{const v=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');if(v&&typeof v.split==='number')return {split:clamp(v.split,.2,.8)};}catch{/* storage unavailable */}
  return DEFAULT_LAYOUT;
}
function drag(onMove:(ev:PointerEvent)=>void){
  const up=()=>{window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',up);document.body.classList.remove('resizing');};
  window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',up);document.body.classList.add('resizing');
}
function Highlight({text,query}:{text:string;query:string}){
  const at=query?text.toLowerCase().indexOf(query.toLowerCase()):-1;
  return at<0?<>{text}</>:<>{text.slice(0,at)}<mark>{text.slice(at,at+query.length)}</mark>{text.slice(at+query.length)}</>;
}
// Keeps following new content only while the reader is already at the bottom.
function Scroller({children,className,label,role,follow=true}:{children:ReactNode;className:string;label:string;role?:string;follow?:boolean}){
  const ref=useRef<HTMLDivElement>(null),atBottom=useRef(true);
  useEffect(()=>{if(ref.current&&atBottom.current&&follow)ref.current.scrollTop=ref.current.scrollHeight;},[children,follow]);
  return <div ref={ref} className={className} aria-label={label} role={role} tabIndex={0} onScroll={()=>{const el=ref.current!;atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>{children}</div>;
}
interface DialogSpec {title:string;body:string;confirm:string;destructive?:boolean;run:()=>void;cancel?:()=>void}
function Dialog({spec,onClose}:{spec:DialogSpec;onClose:()=>void}){
  const confirm=useRef<HTMLButtonElement>(null),cancel=useRef<HTMLButtonElement>(null);
  // A destructive choice starts on Cancel, so a stray Enter can't delete anything.
  useEffect(()=>{(spec.destructive?cancel:confirm).current?.focus();},[]);
  const dismiss=()=>{onClose();spec.cancel?.();};
  return <div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)dismiss();}} onKeyDown={e=>{if(e.key==='Escape')dismiss();}}>
    <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
      <h2 id="dialog-title">{spec.title}</h2><p id="dialog-body">{spec.body}</p>
      <div className="dialog-actions"><button ref={cancel} className="button" onClick={dismiss}>Cancel</button><button ref={confirm} className={`button ${spec.destructive?'destructive':'primary'}`} onClick={()=>{onClose();spec.run();}}>{spec.confirm}</button></div>
    </div>
  </div>;
}
type MenuItem={label:string;icon:ReactNode;onSelect:()=>void;disabled?:boolean;destructive?:boolean}|'divider';
function Menu({label,icon,items}:{label:string;icon:ReactNode;items:MenuItem[]}){
  const [open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const away=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);},key=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',away);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="menu-wrap" ref={ref}>
    <button className="icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{icon}</button>
    {open&&<div className="menu" role="menu">{items.map((item,i)=>item==='divider'?<div key={i} className="menu-divider" role="separator"/>:
      <button key={item.label} role="menuitem" className={item.destructive?'destructive':undefined} disabled={item.disabled} onClick={()=>{setOpen(false);item.onSelect();}}>{item.icon}<span>{item.label}</span></button>)}</div>}
  </div>;
}

// The direct line to one agent: a small chat window of its own. Only that agent sees it, in the same session it uses
// in the shared chat, so what you tell it here shapes how it takes part there.
function DirectWindow({seat,name,partner,messages,pending,blocked,readOnly,tools,onSend,onClose}:{seat:Seat;name:string;partner:string;messages:DirectMessage[];pending?:{partial:string;steps?:string[]};blocked:string;readOnly:boolean;tools:boolean;onSend:(text:string)=>Promise<boolean>;onClose:()=>void}){
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{input.current?.focus();},[]);
  useEffect(()=>{const el=input.current;if(!el)return;el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,120)}px`;},[draft]);
  async function submit(){const text=draft.trim();if(!text||blocked||sending)return;setSending(true);try{if(await onSend(text))setDraft('');}finally{setSending(false);}}
  return <section className={`direct-window ${seat}`} role="dialog" aria-label={`Direct messages with ${name}`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
    <header><span className="seat-dot"/><div className="direct-title"><strong>{name}</strong><span>Agent {SEAT_NUMBER[seat]} · 1:1</span></div><button className="icon-btn" aria-label={`Close direct messages with ${name}`} onClick={onClose}><Icon.close/></button></header>
    <Scroller className="direct-feed" label={`Direct messages with ${name}`}>
      <p className="direct-note">Private. Only {name} sees this, in the same session it uses in the shared chat. Nothing here reaches the room or {partner}.{tools?` In a Build session ${name} can also run commands and edit files in its own working folder, to clone a repository before the build, say.`:''}</p>
      {messages.map(m=><div key={m.id} className={`bubble ${m.sender}`}>{m.text}{m.sender==='user'&&m.state!=='pending'&&directStates[m.state]&&<span className="bubble-state">{directStates[m.state]}{m.error?`. ${m.error}`:''}</span>}</div>)}
      {pending&&<div className="bubble agent">
        {pending.steps?.length?<ul className="bubble-steps" aria-label="What it is doing">{pending.steps.map((step,i)=><li key={i}>{step}</li>)}</ul>:null}
        {pending.partial||<span className="typing" role="status" aria-label={`${name} is replying`}><i/><i/><i/></span>}</div>}
    </Scroller>
    {readOnly?<p className="direct-readonly">Read-only. This session was cleared, so {name} no longer remembers it.</p>
    :<form className="direct-composer" onSubmit={e=>{e.preventDefault();void submit();}}>
      <textarea ref={input} rows={1} aria-label={`Message ${name} privately`} placeholder={blocked||`Message ${name} privately`} value={draft} maxLength={16000} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
      <button className="send" type="submit" aria-label={`Send privately to ${name}`} title={blocked||'Send privately · Enter'} disabled={!!blocked||!draft.trim()||sending}><Icon.send/></button>
    </form>}
  </section>;
}

function App(){
  const [pair,setPair]=useState<PairView>();
  const [threads,setThreads]=useState<ThreadSummary[]>([]);
  // '' follows this room's current thread (it moves to the new one after Clear Session); otherwise a chosen thread.
  const [selected,setSelected]=useState('');
  const [view,setView]=useState<(ThreadView&{id:string})|null>(null);
  const [activity,setActivity]=useState<ActivityLine[]>([]),[working,setWorking]=useState<Record<Seat,boolean>>({cli1:false,cli2:false});
  const [attention,setAttention]=useState<{uncertainTurns:number;ownedHere:boolean}>();
  const [error,setError]=useState(''),[connected,setConnected]=useState(true),[busy,setBusy]=useState(''),[draft,setDraft]=useState(commands.draft);
  const [panel,setPanel]=useState<'chat'|'stats'|'results'>('chat'),[stats,setStats]=useState<ThreadStats|null>(null);
  // Build results: which run and view the Results panel shows, and each agent's app link per run (runId:seat).
  const [results,setResults]=useState<{runId:string;tab:ResultsTab}|null>(null),[apps,setApps]=useState<Record<string,AppLink>>({}),appRequested=useRef(new Set<string>());
  const [optionsOpen,setOptionsOpen]=useState(false),[dialog,setDialog]=useState<DialogSpec|null>(null);
  const [settings,setSettings]=useState<PresetData>(DEFAULT_SETTINGS),[presets,setPresets]=useState<Preset[]>([]),[presetId,setPresetId]=useState(''),[presetName,setPresetName]=useState<string|null>(null);
  const [query,setQuery]=useState(''),[hits,setHits]=useState<{query:string;results:SearchHit[]}|null>(null),[focusedId,setFocusedId]=useState('');
  const [replay,setReplay]=useState<{threadId:string;offsets:Record<string,number>;total:number;speed:number;clock:number;tickAt:number}|null>(null);
  const [layout,setLayout]=useState(loadLayout);
  const [directOpen,setDirectOpen]=useState<Record<Seat,boolean>>({cli1:false,cli2:false}),[seen,setSeen]=useState<Record<string,number>>({});
  const [mode,setMode]=useState<Mode>(loadMode),[opening,setOpening]=useState<'both'|Seat>('both'),[files,setFiles]=useState<Pending[]>([]),[renaming,setRenaming]=useState<string|null>(null),[lightbox,setLightbox]=useState('');
  const fileInput=useRef<HTMLInputElement>(null),knownRuns=useRef(new Set<string>()),[dropping,setDropping]=useState(false);
  useEffect(()=>{try{localStorage.setItem(MODE_KEY,mode);}catch{/* storage unavailable */}},[mode]);
  const [project,setProject]=useState(loadProject),[buildKind,setBuildKind]=useState(loadBuildKind);
  useEffect(()=>{try{localStorage.setItem(PROJECT_KEY,project);localStorage.setItem(BUILD_KIND_KEY,buildKind);}catch{/* storage unavailable */}},[project,buildKind]);
  // What the page last showed, and whether the last poll lost the connection.
  const pairShown=useRef(''),threadsShown=useRef(''),lost=useRef(false);
  const polling=useRef(false),selectedRef=useRef(''),shownRef=useRef(''),threadsRef=useRef<ThreadSummary[]>([]),threadsAt=useRef(0),viewAt=useRef(0),liveRef=useRef(false);
  const cursors=useRef(new Map<string,number>()),finished=useRef(new Set<string>()),rawEvents=useRef(new Map<string,Event[]>()),openTurns=useRef(new Map<string,{seat:Seat;runId:string}>());
  const commandBusy=useRef(false),pendingFocus=useRef(''),agentsRef=useRef<HTMLElement>(null),composerRef=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout));}catch{/* storage unavailable */}},[layout]);
  // A file dropped anywhere else on the page would otherwise open in its place and leave the room.
  useEffect(()=>{
    const stop=(e:DragEvent)=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();};
    window.addEventListener('dragover',stop);window.addEventListener('drop',stop);
    return()=>{window.removeEventListener('dragover',stop);window.removeEventListener('drop',stop);};
  },[]);
  function dragSplit(e:ReactPointerEvent){e.preventDefault();const box=agentsRef.current!.getBoundingClientRect();drag(ev=>setLayout(l=>({...l,split:clamp((ev.clientX-box.left)/box.width,.2,.8)})));}
  function nudge(e:KeyboardEvent){
    if(e.key==='Enter'){e.preventDefault();setLayout(DEFAULT_LAYOUT);return;}
    const dir=({ArrowLeft:-1,ArrowRight:1} as Record<string,number>)[e.key];if(!dir)return;e.preventDefault();
    setLayout(l=>({...l,split:clamp(l.split+dir*(e.shiftKey?.1:.05),.2,.8)}));
  }
  const roomThreadOf=(list:ThreadSummary[],pairId?:string)=>list.find(t=>t.pairId===pairId&&t.current)?.id??'';
  function resetThreadState(){
    cursors.current.clear();finished.current.clear();rawEvents.current.clear();openTurns.current.clear();
    setView(null);setActivity([]);setWorking({cli1:false,cli2:false});setAttention(undefined);setStats(null);setReplay(null);viewAt.current=0;
  }
  // One polling loop: the room's pair, the thread list (every few seconds), the shown thread, and its runs' events.
  async function refresh(){
    if(polling.current)return;polling.current=true;
    const target=selectedRef.current;
    try{
      if(!roomId)throw new Error('Open this room with /ava start in Codex or /agent-vs-agent:ava start in Claude Code.');
      const room=await rpc<{pair:PairView}>('room.get',{roomId});
      // Only a change re-renders the page (this runs a few times a second).
      const pairJson=JSON.stringify(room.pair);if(pairJson!==pairShown.current){pairShown.current=pairJson;setPair(room.pair);}
      if(Date.now()-threadsAt.current>2500){
        const list=(await rpc<{threads:ThreadSummary[]}>('threads.list',{pairId:room.pair.id})).threads,listJson=JSON.stringify(list);threadsAt.current=Date.now();
        if(listJson!==threadsShown.current){threadsShown.current=listJson;threadsRef.current=list;setThreads(list);}
      }
      if(selectedRef.current!==target)return;
      const id=target||roomThreadOf(threadsRef.current,room.pair.id);
      if(id!==shownRef.current){shownRef.current=id;resetThreadState();}
      setConnected(true);if(lost.current){lost.current=false;setError('');}
      if(!id)return;
      // A finished thread changes rarely; a live one is re-read on every tick (as is one where a run just started elsewhere).
      const startedElsewhere=!!room.pair.activeRunId&&!knownRuns.current.has(room.pair.activeRunId);
      if(!liveRef.current&&!startedElsewhere&&Date.now()-viewAt.current<2500)return;
      const data=await rpc<ThreadView>('thread.get',{threadId:id});
      if(shownRef.current!==id||selectedRef.current!==target)return;
      viewAt.current=Date.now();setView({...data,id});knownRuns.current=new Set([...data.runs.map(r=>r.id),...(room.pair.activeRunId?[room.pair.activeRunId]:[])]);
      // Poll quickly while the thread has a running conversation or a direct reply being written.
      const activeId=room.pair.activeRunId;liveRef.current=!!activeId&&data.runs.some(r=>r.id===activeId)||Object.keys(data.direct.pending).length>0;
      const fresh:Event[]=[];
      for(const run of data.runs){
        if(finished.current.has(run.id))continue;
        // Every page of a run before the next run, so a long run's activity stays in order.
        let page:{events:Event[];attention?:{uncertainTurns:number;ownedHere:boolean}};
        do{
          page=await rpc<typeof page>('run.get',{runId:run.id,after:cursors.current.get(run.id)??0});
          if(shownRef.current!==id)return;
          if(run.id===activeId)setAttention(page.attention);
          if(!page.events.length)break;
          cursors.current.set(run.id,page.events.at(-1)!.seq);rawEvents.current.set(run.id,[...(rawEvents.current.get(run.id)??[]),...page.events]);fresh.push(...page.events);
          for(const e of page.events){
            const turnId=typeof e.data.turnId==='string'?e.data.turnId:'';
            if(e.type==='prompt_started'&&turnId)openTurns.current.set(turnId,{seat:e.data.seat as Seat,runId:run.id});
            else if((e.type==='turn_ended'||e.type==='room_committed')&&turnId)openTurns.current.delete(turnId);
            else if(e.type==='run_ended')for(const [key,open] of openTurns.current)if(open.runId===run.id)openTurns.current.delete(key);
          }
        }while(page.events.length>=EVENT_PAGE);
        if(TERMINAL.has(run.status))finished.current.add(run.id);
      }
      if(fresh.length)setActivity(old=>activityProjection(old,fresh));
      const busySeats=[...openTurns.current.values()].filter(o=>o.runId===activeId);
      setWorking({cli1:busySeats.some(o=>o.seat==='cli1'),cli2:busySeats.some(o=>o.seat==='cli2')});
    }catch(e){
      // Only an unreachable service means reconnecting; a refusal is shown as it is. A thread that is gone (say after
      // Clear history) gives way to the room's current one.
      if(!(e instanceof RpcError)){lost.current=true;setConnected(false);setError(message(e));}
      else{setConnected(true);if(e.code==='NOT_FOUND'&&target)queueMicrotask(()=>select(''));else setError(message(e));}
    }
    finally{polling.current=false;}
  }
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),400);return()=>clearInterval(timer);},[]);
  function select(id:string){
    const next=id&&id===roomThreadOf(threadsRef.current,pair?.id)?'':id;
    selectedRef.current=next;setSelected(next);setOptionsOpen(false);setRenaming(null);
    // Opening a thread (say from search) shows it in its own mode.
    const target=threadsRef.current.find(t=>t.id===id);if(target?.mode)setMode(target.mode);
    const resolved=next||roomThreadOf(threadsRef.current,pair?.id);
    if(resolved!==shownRef.current){shownRef.current=resolved;resetThreadState();}
    void refresh();
  }
  async function action(label:string,fn:()=>Promise<void>){
    if(commandBusy.current)return;commandBusy.current=true;setBusy(label);setError('');
    try{await fn();threadsAt.current=0;viewAt.current=0;await refresh();}catch(e){setError(message(e));}
    finally{commandBusy.current=false;setBusy('');}
  }

  // What is on screen.
  const roomThreadId=roomThreadOf(threads,pair?.id),threadId=selected||roomThreadId;
  const shown=view&&view.id===threadId?view:null,thread=shown?.thread??threads.find(t=>t.id===threadId)??null;
  const isRoomThread=!!thread&&!!pair&&thread.pairId===pair.id&&thread.current;
  const live=isRoomThread&&!!pair?.activeRunId,status=live?pair?.activeRun?.status:undefined,paused=status==='paused';
  const activeRun=live?shown?.runs.find(r=>r.id===pair?.activeRunId):undefined;
  const ready=!!pair&&seats.every(s=>pair.slots[s].state==='ready'&&pair.connected[s]);
  const direct=shown?.direct??{messages:[] as DirectMessage[],pending:{} as ThreadView['direct']['pending']},directPending=Object.keys(direct.pending).length>0;
  // This chat's session already holds a thread of the other mode: the user starts a fresh session to switch.
  const mismatch=!!thread&&!!thread.mode&&thread.mode!==mode,benchmark=mode==='benchmark',building=mode==='build';
  const uploading=files.some(f=>f.status==='uploading');
  // A running prompt or build takes no further messages: each agent answers the one prompt, then it ends.
  const benchmarkLive=live&&['benchmark','build'].includes(activeRun?.config.mode??thread?.mode??'');
  // A Build session holds one prompt; the next build starts in a fresh session.
  const buildDone=isRoomThread&&thread?.mode==='build'&&!!thread.runIds.length&&!live;
  // In a Build session (no prompt yet, or a build), 1:1 lines may run commands in the agent's working folder.
  const directTools=building&&(!thread?.mode||thread.mode==='build');
  const canSend=isRoomThread&&ready&&!!shown&&!mismatch&&!benchmarkLive&&!buildDone&&status!=='stopping'&&status!=='needs_attention'&&!directPending&&(!building||buildKind==='build'||!!project.trim());
  function switchMode(next:Mode){
    if(next===mode)return;setMode(next);setOptionsOpen(false);
    // A thread chosen from the other list goes back to this chat's current session.
    if(selectedRef.current&&threadsRef.current.find(t=>t.id===selectedRef.current)?.mode!==next)select('');
  }
  // Files for the next message: checked here, uploaded at once, and sent by ID with the message.
  async function addFiles(list:FileList|File[]){
    const chosen=[...list].slice(0,Math.max(0,8-files.length));
    for(const file of chosen){
      const key=crypto.randomUUID(),image=IMAGE_TYPES.includes(file.type),text=!image&&(file.type.startsWith('text/')||TEXT_NAME.test(file.name)||file.type==='application/json');
      const blind=image?seats.find(s=>pair?.images?.[s]===false):undefined;
      const problem=!image&&!text?'Only images (PNG, JPEG, GIF, WebP) and text files can be sent':blind?`${agentName(blind)} can’t read images`:image&&file.size>8*1024*1024?'Larger than 8 MB':text&&file.size>512*1024?'Larger than 512 KB':'';
      setFiles(f=>[...f,{key,name:file.name,size:file.size,status:problem?'error':'uploading',...(problem?{error:problem}:{})}]);
      if(problem)continue;
      try{
        const data=await readBase64(file);
        const ref=await rpc<AttachmentRef>('attachment.add',{name:file.name,mediaType:file.type,data});
        setFiles(f=>f.map(p=>p.key===key?{...p,status:'ready',ref,...(image?{preview:`data:${file.type};base64,${data}`}:{})}:p));
      }catch(e){setFiles(f=>f.map(p=>p.key===key?{...p,status:'error',error:message(e)}:p));}
    }
  }
  async function rename(title:string){
    if(!thread)return;const value=title.trim();setRenaming(null);
    if(value===(thread.named?thread.title:''))return;
    await action('Renaming',async()=>{await rpc('thread.rename',{threadId:thread.id,title:value});});
  }
  const canClear=!!pair&&seats.every(s=>!!pair.slots[s].config)&&pair.activeRun?.status!=='needs_attention';
  const runById=new Map((shown?.runs??[]).map(r=>[r.id,r]));

  async function send(){
    const text=draft.trim();if(!pair||!text||!canSend||busy||uploading)return;
    const attachments=files.filter(f=>f.status==='ready'&&f.ref).map(f=>f.ref!.id);
    await action(live?'Sending':'Starting',async()=>{
      if(live&&pair.activeRunId){
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments]),'run.broadcast',{runId:pair.activeRunId,text,attachments},rpc);
      }else if(building){
        // Build: each agent gets its own copy of the project (or an empty folder); the time limit is the only option.
        const path=project.trim(),options:Partial<RunConfig>={mode:'build',...(settings.minutes?{durationMs:Number(settings.minutes)*60000}:{})},build={kind:buildKind,...(path?{path}:{})};
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments,'build',buildKind,path]),'run.start',{pairId:pair.id,text,options,attachments,build},rpc);
      }else if(benchmark){
        // Prompt: it goes to both agents at once, as written; only a time limit applies.
        const options:Partial<RunConfig>={mode:'benchmark',...(settings.minutes?{durationMs:Number(settings.minutes)*60000}:{})};
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments,'benchmark']),'run.start',{pairId:pair.id,text,options,attachments},rpc);
      }else{
        const options:Partial<RunConfig>={mode:'conversation',opening,instructions:settings.instructions,stopWhen:settings.stopWhen,paceMs:Number(settings.pace||0)*1000};
        if(settings.completion!=='auto')options.completion=settings.completion;
        if(settings.minutes){options.durationMs=Number(settings.minutes)*60000;if(settings.completion==='auto')options.completion='duration';}
        if(settings.requests)options.maxRequests=Number(settings.requests);
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments]),'run.start',{pairId:pair.id,text,options,attachments},rpc);
      }
      setDraft('');setFiles([]);setOptionsOpen(false);liveRef.current=true;
    });
  }
  // Direct (1:1) lines. A send waits while the agent is busy in the shared conversation (the service enforces it too).
  const replyCount=(seat:Seat)=>direct.messages.filter(m=>m.seat===seat&&m.sender==='agent').length;
  const seenKey=(seat:Seat)=>`${threadId}:${seat}`;
  const unread=(seat:Seat)=>!directOpen[seat]&&seen[seenKey(seat)]!==undefined&&replyCount(seat)>seen[seenKey(seat)]!;
  useEffect(()=>{
    if(!shown)return;
    setSeen(old=>{const next={...old};for(const seat of seats){const key=`${shown.id}:${seat}`;if(next[key]===undefined||directOpen[seat])next[key]=shown.direct.messages.filter(m=>m.seat===seat&&m.sender==='agent').length;}return JSON.stringify(next)===JSON.stringify(old)?old:next;});
  },[shown,directOpen]);
  function directBlocked(seat:Seat){
    const slot=pair?.slots[seat],n=SEAT_NUMBER[seat];
    if(!slot||slot.state!=='ready'||!pair?.connected[seat])return `Agent ${n} isn't set up`;
    if(direct.pending[seat])return `${agentName(seat)} is replying…`;
    if(live&&!paused)return 'Pause the shared chat first';
    return '';
  }
  async function sendDirect(seat:Seat,text:string){
    if(!pair)return false;
    try{await directCommands[seat].execute(JSON.stringify(['direct',pair.id,seat,text,directTools]),'direct.send',{pairId:pair.id,seat,text,...(directTools?{tools:true}:{})},rpc);viewAt.current=0;liveRef.current=true;void refresh();return true;}
    catch(e){setError(message(e));return false;}
  }
  function toggleDirect(seat:Seat){
    // Side by side on a wide screen; one at a time on a narrow one.
    setDirectOpen(o=>{const next={...o,[seat]:!o[seat]};if(next[seat]&&window.innerWidth<880)next[seat==='cli1'?'cli2':'cli1']=false;return next;});
  }
  // Internet switch per agent. Codex restarts (same session) to apply it, so it waits until the agent is between requests.
  const internetOn=(seat:Seat)=>pair?.slots[seat].internet===true;
  function internetBlocked(seat:Seat){
    const slot=pair?.slots[seat];if(!slot?.config)return 'Set up this agent first';
    if(RESTARTS_FOR_WEB.has(slot.config.provider)&&slot.state==='ready'){
      if(direct.pending[seat])return `${agentName(seat)} is answering your 1:1 message`;
      if(live&&!paused)return `Pause the shared chat to switch ${agentName(seat)}’s internet (it restarts, keeping its memory)`;
    }
    return '';
  }
  const [switchingNet,setSwitchingNet]=useState<Record<Seat,boolean>>({cli1:false,cli2:false});
  // Each agent's setup menu (the /ava CLI1 menu, in the room).
  const [setup,setSetup]=useState<Partial<Record<Seat,boolean>>>({});
  const toggleSetup=(seat:Seat)=>setSetup(s=>({...s,[seat]:!s[seat]}));
  // Each thread with live agents runs two CLI processes on this computer. From the third such thread on, opening one
  // or activating its agents asks first (the user may go ahead anyway).
  const MANY_THREADS=2;
  const liveThreads=async()=>(await rpc<{pairs:Array<{pairId:string;agents:number;running:boolean}>}>('pairs.active',{})).pairs;
  const ask=(spec:Omit<DialogSpec,'run'|'cancel'>)=>new Promise<boolean>(resolve=>setDialog({...spec,run:()=>resolve(true),cancel:()=>resolve(false)}));
  const loadWarning=(count:number,running:number)=>`${count} threads already have live agents${running?` (${running} running a prompt now)`:''}. Each runs two CLI agents on this computer, so more at once can slow it down and use up provider rate limits faster.`;
  async function confirmActivate(){
    if(!pair)return true;
    const others=(await liveThreads().catch(()=>[])).filter(p=>p.pairId!==pair.id);
    if(others.length<MANY_THREADS)return true;
    return ask({title:'Activate another thread’s agents?',confirm:'Activate anyway',body:`${loadWarning(others.length,others.filter(p=>p.running).length)} You can activate anyway.`});
  }
  // New thread: a clean page of its own, in this mode, with its own two agents to activate.
  async function newThread(){
    try{
      const active=await liveThreads().catch(()=>[]);
      if(active.length>=MANY_THREADS&&!(await ask({title:'Open another thread?',confirm:'Open anyway',body:`${loadWarning(active.length,active.filter(p=>p.running).length)} You’ll be asked again before its agents start.`})))return;
      const room=await rpc<{roomId:string}>('room.new',{});
      window.open(roomLink(room.roomId,mode),'_blank','noopener');
    }catch(e){setError(message(e));}
  }
  async function toggleInternet(seat:Seat){
    if(!pair||internetBlocked(seat)||switchingNet[seat])return;setSwitchingNet(n=>({...n,[seat]:true}));
    try{await rpc('slot.internet',{pairId:pair.id,seat,enabled:!internetOn(seat),requestId:crypto.randomUUID()});threadsAt.current=0;void refresh();}
    catch(e){setError(message(e));}finally{setSwitchingNet(n=>({...n,[seat]:false}));}
  }
  function control(which:'pause'|'resume'|'step'|'stop'){const runId=pair?.activeRunId;if(runId)void action(which,async()=>{await commands.execute(JSON.stringify(['control',runId,which]),'run.control',{runId,action:which},rpc);});}
  // Clear Session: both agents get fresh sessions and forget everything; the old thread stays in the list.
  function clearSession(){
    if(!pair)return;
    const current=threadsRef.current.find(t=>t.pairId===pair.id&&t.current);
    if(current?.empty){select(current.id);composerRef.current?.focus();return;}
    setOptionsOpen(false);
    setDialog({title:'Clear Session?',confirm:'Clear Session',
      body:`${pair.activeRunId?'The running conversation stops first. ':''}Both agents start fresh sessions and forget this thread, and any app server they left running stops. The thread stays in the list. Each agent makes one short access check.`,
      run:()=>void action('Clearing session',async()=>{
        await commands.execute(`clear:${pair.id}:${pair.activeRunId??pair.lastRunId??'none'}`,'pair.clear',{pairId:pair.id},rpc);
        selectedRef.current='';setSelected('');setPanel('chat');
      })});
  }
  // Clear history: every saved thread in this data folder goes, with its 1:1 messages, attachments and the agents'
  // working folders; this room's agents start fresh sessions.
  function clearHistory(){
    if(!pair)return;setOptionsOpen(false);
    setDialog({title:'Clear all history?',confirm:'Delete everything',destructive:true,
      body:'This permanently deletes every saved thread, from every chat that shares this data folder: prompts, replies, 1:1 messages, attachments, and the agents’ working folders with everything they built. App servers they left running stop, and both agents here start fresh sessions. This can’t be undone.',
      run:()=>void action('Clearing history',async()=>{
        await rpc('history.clear',{pairId:pair.id,requestId:crypto.randomUUID()});
        selectedRef.current='';setSelected('');setPanel('chat');setResults(null);setApps({});appRequested.current.clear();threadsAt.current=0;
      })});
  }
  function openResults(runId:string,tab:ResultsTab){setResults({runId,tab});setPanel('results');}
  function release(){
    const runId=pair?.activeRunId;if(!runId)return;
    setDialog({title:'Release this pair?',confirm:'Release',destructive:true,
      body:'AvA first closes its own sessions for this conversation and checks that no provider process from it is still running. Requests with an unknown outcome are abandoned, never resent. Both agents then need to be set up again.',
      // A fresh request ID per click: a refused release (a process still running) can be retried after fixing the cause.
      run:()=>void action('Releasing',async()=>{await rpc('run.reconcile',{runId,requestId:crypto.randomUUID()});})});
  }
  async function exportThread(kind:'md'|'json'){
    if(!shown?.runs.length||!thread)return;
    await action('Exporting',async()=>{
      const parts:Array<{markdown:string;json:unknown}>=[];
      for(const run of shown.runs)parts.push(await rpc('run.export',{runId:run.id}));
      const privateLines=seats.filter(seat=>shown.direct.messages.some(m=>m.seat===seat)).map(seat=>`# Direct with Agent ${SEAT_NUMBER[seat]} (${agentName(seat)})\n\n${shown.direct.messages.filter(m=>m.seat===seat).map(m=>`**${m.sender==='user'?'You':agentName(seat)}:** ${m.text}`).join('\n\n')}`);
      const blob=kind==='md'?new Blob([[...parts.map((p,i)=>`# Prompt ${i+1}\n\n${p.markdown}`),...privateLines].join('\n\n---\n\n')],{type:'text/markdown'})
        :new Blob([JSON.stringify({format:'ava-thread',version:1,exportedAt:new Date().toISOString(),thread:{id:thread.id,title:thread.title,prompts:shown.runs.length},runs:parts.map(p=>p.json),direct:shown.direct.messages},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ava-thread-${thread.id}.${kind}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  // Replay is presentation only: saved messages reappear on their recorded timing, prompt after prompt.
  function startReplay(){
    if(!shown)return;let base=0;const offsets:Record<string,number>={};
    for(const run of shown.runs){
      const timeline=replayTimeline(shown.messages.filter(m=>m.runId===run.id),rawEvents.current.get(run.id)??[]);
      for(const [key,at] of Object.entries(timeline.offsets))offsets[key]=base+at;
      base+=timeline.total+1200;
    }
    setPanel('chat');setReplay({threadId:shown.id,offsets,total:Math.max(0,base-1200),speed:4,clock:0,tickAt:performance.now()});
  }
  const advance=<T extends {clock:number;total:number;speed:number;tickAt:number}>(r:T,now=performance.now()):T=>({...r,clock:Math.min(r.total,r.clock+(now-r.tickAt)*r.speed),tickAt:now});
  const activeReplay=replay&&replay.threadId===threadId?replay:null,replayDone=!activeReplay||activeReplay.clock>=activeReplay.total;
  useEffect(()=>{if(replayDone)return;const timer=setInterval(()=>setReplay(r=>r&&advance(r)),100);return()=>clearInterval(timer);},[replayDone]);

  // Stats for the whole thread, refreshed while it is live.
  const promptCount=shown?.runs.length??0;
  useEffect(()=>{
    setStats(s=>s&&s.threadId===threadId?s:null);
    if(panel!=='stats'||!threadId||!promptCount)return;
    const load=()=>void rpc<ThreadStats>('thread.stats',{threadId}).then(s=>{if(shownRef.current===s.threadId)setStats(s);}).catch(()=>{});
    load();if(!live)return;const timer=setInterval(load,1500);return()=>clearInterval(timer);
  },[panel,threadId,live,promptCount]);
  // Each agent's app link as soon as its report is in: the page it named (served by AvA) or the server it left running.
  useEffect(()=>{
    for(const run of shown?.runs??[]){
      if(run.config.mode!=='build'||run.config.build?.kind!=='build')continue;
      for(const seat of seats){
        const key=`${run.id}:${seat}`;if(appRequested.current.has(key)||!shown!.messages.some(m=>m.runId===run.id&&m.sender===seat))continue;
        appRequested.current.add(key);
        void rpc<AppLink>('build.preview',{runId:run.id,seat}).then(link=>setApps(a=>({...a,[key]:link}))).catch(e=>setApps(a=>({...a,[key]:{error:message(e)}})));
      }
    }
  },[shown]);
  // The Results panel belongs to a thread with builds; leaving it (another thread, say) goes back to the chat.
  const buildRuns=(shown?.runs??[]).filter(r=>r.config.mode==='build');
  useEffect(()=>{if(panel==='results'&&shown&&!buildRuns.length)setPanel('chat');},[panel,shown,buildRuns.length]);
  // Likewise Stats, for a thread with no prompts (its Stats button is off, so there'd be no way back).
  useEffect(()=>{if(panel==='stats'&&shown&&!promptCount)setPanel('chat');},[panel,shown,promptCount]);
  const resultsRun=panel==='results'?buildRuns.find(r=>r.id===results?.runId)??buildRuns.at(-1):undefined,resultsTab=results?.tab??'preview';
  // Search every saved message in the pool, as you type.
  useEffect(()=>{
    const q=query.trim();if(!q){setHits(null);return;}
    let current=true;
    const timer=setTimeout(()=>{void rpc<{results:SearchHit[]}>('runs.search',{query:q,limit:50}).then(r=>{if(current)setHits({query:q,results:r.results});}).catch(e=>{if(current)setError(message(e));});},220);
    return()=>{current=false;clearTimeout(timer);};
  },[query]);
  function openHit(hit:SearchHit){pendingFocus.current=hit.messageId;select(hit.threadId);setPanel('chat');}
  useEffect(()=>{
    const id=pendingFocus.current,el=id?document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`):null;
    if(el){pendingFocus.current='';setFocusedId(id);el.scrollIntoView({block:'center'});el.focus({preventScroll:true});}
  },[shown?.messages]);
  useEffect(()=>{if(!focusedId)return;const timer=setTimeout(()=>setFocusedId(''),2600);return()=>clearTimeout(timer);},[focusedId]);
  // Presets hold room settings only; provider, model, effort and speed stay with activation.
  async function loadPresets(){try{setPresets((await rpc<{presets:Preset[]}>('preset.list',{})).presets);}catch{/* connection errors surface through polling */}}
  useEffect(()=>{void loadPresets();},[]);
  function applyPreset(id:string){setPresetId(id);const preset=presets.find(p=>p.id===id);if(preset)setSettings({...DEFAULT_SETTINGS,...preset.data});}
  async function savePreset(){
    const name=presetName?.trim();if(!name)return;
    await action('Saving preset',async()=>{const saved=await rpc<{id:string}>('preset.save',{requestId:crypto.randomUUID(),name,data:settings});await loadPresets();setPresetId(saved.id);setPresetName(null);});
  }
  async function deletePreset(){
    const preset=presets.find(p=>p.id===presetId);if(!preset)return;
    await action('Deleting preset',async()=>{await rpc('preset.delete',{requestId:crypto.randomUUID(),id:preset.id});setPresetId('');await loadPresets();});
  }
  // Only what this mode's sheet shows counts (Prompt and Build have just a time limit).
  const customized=benchmark||building?settings.minutes!=='':JSON.stringify(settings)!==JSON.stringify(DEFAULT_SETTINGS);
  // The options sheet closes on Escape or a click anywhere outside it (its own toggle button handles itself).
  const sheetRef=useRef<HTMLDivElement>(null),optionsButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!optionsOpen)return;
    const away=(e:MouseEvent)=>{const target=e.target as Node;if(!sheetRef.current?.contains(target)&&!optionsButton.current?.contains(target)&&!(target instanceof Element&&target.closest('.backdrop')))setOptionsOpen(false);};
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape'&&!dialog){setOptionsOpen(false);optionsButton.current?.focus();}};
    document.addEventListener('mousedown',away);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',key);};
  },[optionsOpen,dialog]);
  useEffect(()=>{const el=composerRef.current;if(!el)return;el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,220)}px`;},[draft]);

  // Identities: the live slots for this room's current thread, the recorded ones for anything else.
  // The room's own agents are on screen: its current thread, or no thread yet (agents not both active).
  const roomView=!!pair&&(isRoomThread||!threadId);
  const identity=(seat:Seat)=>roomView?pair?.slots[seat].config??null:shown?.runs.at(-1)?.participants?.[seat]??thread?.participants?.[seat]??null;
  const agentName=(seat:Seat)=>names[identity(seat)?.provider??'']??`Agent ${SEAT_NUMBER[seat]}`;
  const senderOf=(m:ThreadMessage)=>m.sender==='user'?null:runById.get(m.runId)?.participants?.[m.sender]??identity(m.sender);
  function paneStatus(seat:Seat){
    if(!roomView)return {text:'Recorded',tone:''};
    const slot=pair?.slots[seat];
    if(slot?.state==='verifying')return {text:'Checking access',tone:'busy'};
    if(slot?.state!=='ready')return {text:slot?.state==='failed'?'Activation failed':'Not active',tone:'off'};
    if(!pair?.connected[seat])return {text:'Offline',tone:'off'};
    if(direct.pending[seat])return {text:'Replying to you privately',tone:'busy'};
    if(working[seat])return {text:'Thinking',tone:'busy'};
    return {text:live?'Waiting':'Ready',tone:''};
  }

  // The channel: messages grouped Slack-style, with day separators and a quiet note where each prompt ended.
  const messages=shown?(activeReplay?shown.messages.filter(m=>(activeReplay.offsets[m.id]??0)<=activeReplay.clock):shown.messages):[];
  const feed:ReactNode[]=[];
  {
    let prev:ThreadMessage|undefined,lastDay='';
    const endNote=(runId:string)=>{const run=runById.get(runId);if(run&&TERMINAL.has(run.status)&&replayDone)feed.push(<div className="run-end" key={'end'+run.id}><span>{reasonText(run.reason)||statusNames[run.status]}</span><span>{duration(run.elapsedMs)}</span></div>);};
    for(const m of messages){
      const day=m.time?new Date(m.time).toDateString():lastDay;
      if(prev&&prev.runId!==m.runId){endNote(prev.runId);prev=undefined;}
      if(day&&day!==lastDay){feed.push(<div className="day" key={'day'+m.id}><span>{dayLabel(m.time)==='Today'?'Today':fullDate(m.time)}</span></div>);lastDay=day;prev=undefined;}
      const continued=!!prev&&prev.sender===m.sender&&(!m.time||!prev.time||Date.parse(m.time)-Date.parse(prev.time)<300_000);
      const who=senderOf(m),note=delivery(m),run=runById.get(m.runId);
      // In a prompt or build, each answer shows how long it took from the moment both agents got the prompt.
      const took=(run?.config.mode==='benchmark'||run?.config.mode==='build')&&m.sender!=='user'&&m.time&&run.createdAt?Date.parse(m.time)-Date.parse(run.createdAt):null;
      // A build run's prompt says where each agent works.
      const b=run?.config.build,copyNote=m.sender==='user'&&b&&shown?.messages.find(x=>x.runId===run.id)?.id===m.id?(b.source?`Each agent ${b.kind==='review'?'reviews':'works on'} its own copy of ${b.source}`:'Each agent builds in its own folder'):'';
      // A build report ends with the agent's app link; the room shows it as a button rather than the raw line.
      const report=m.sender!=='user'&&b?.kind==='build'?m.sender:null,link=report?apps[`${m.runId}:${report}`]:undefined;
      const text=report?m.text.replace(APP_LINE,'').trim():m.text;
      feed.push(<article key={m.id} tabIndex={-1} data-message-id={m.id} className={`msg ${m.sender}${continued?' continued':''}${m.id===focusedId?' focused':''}`}>
        <div className="avatar" aria-hidden="true">{continued?null:m.sender==='user'?'You':initials(who?.provider)}</div>
        <div className="msg-body">
          {!continued&&<header><strong>{m.sender==='user'?'You':names[who?.provider??'']??`Agent ${SEAT_NUMBER[m.sender]}`}</strong>{m.sender!=='user'&&<span className="msg-seat">Agent {SEAT_NUMBER[m.sender]}</span>}{m.time&&<time dateTime={m.time}>{clock(m.time)}</time>}{took!==null&&<span className="msg-took">answered in {took<60_000?`${(took/1000).toFixed(1)} s`:duration(took)}</span>}</header>}
          <p className="msg-text">{text}</p>
          {report&&<div className="msg-actions">
            {link?.url?<a className="app-link" href={link.url} target="_blank" rel="noopener noreferrer" onClick={e=>{e.preventDefault();openApp(m.runId,report,setError);}}>
              <Icon.window/><span>{link.named===false?'Open what it built':'Open app'}</span><small>{link.kind==='server'?new URL(link.url).host:link.entry||'its folder'}</small><Icon.external/></a>
              :link?.error?<span className="app-missing">{link.error}</span>:<span className="app-missing">Finding its app…</span>}
            <button className="link" onClick={()=>openResults(m.runId,'preview')}>Side by side</button>
            <button className="link" onClick={()=>openResults(m.runId,'changes')}>Changes</button>
          </div>}
          {m.attachments?.length?<div className="attachments">{m.attachments.map(a=>a.kind==='image'?<AttachmentImage key={a.id} file={a} onOpen={setLightbox}/>
            :<span key={a.id} className="attachment-file"><Icon.file/>{a.name}<small>{bytes(a.size)}</small></span>)}</div>:null}
          {copyNote&&<p className="msg-note copy-note"><Icon.folder/>{copyNote}</p>}
          {note&&<p className="msg-note">{note}</p>}
        </div>
      </article>);
      prev=m;
    }
    if(prev)endNote(prev.runId);
  }
  const answered=activeRun?shown?.messages.filter(m=>m.runId===activeRun.id&&m.sender!=='user').length??0:0;
  const subtitle=!thread?'':thread.empty?(ready?`Fresh session · both agents are ready${benchmark?' for a prompt':building?(buildKind==='review'?' to review a project':' to build'):''}`:'Waiting for both agents')
    :live&&activeRun?(activeRun.config.mode==='build'?[status==='running'?(activeRun.config.build?.kind==='review'?'Reviewing':'Building'):statusNames[status??'']??status,`${duration(activeRun.elapsedMs)} of ${duration(activeRun.config.durationMs)}`,`${answered} of 2 reports`]
      :activeRun.config.mode==='benchmark'?[status==='running'?'Answering':statusNames[status??'']??status,duration(activeRun.elapsedMs),`${answered} of 2 answers`]
      :[statusNames[status??'']??status,`${duration(activeRun.elapsedMs)}${activeRun.config.completion==='duration'?` of ${duration(activeRun.config.durationMs)}`:''}`,`${activeRun.requests} of ${activeRun.config.maxRequests} requests`]).join(' · ')
    :buildDone?'Build finished · one prompt per Build session'
    :isRoomThread?`${plural(thread.prompts,'prompt')} · ready for the next one`
    :`${plural(thread.prompts,'prompt')} · ${shortTime(thread.updatedAt)} · read-only`;
  const placeholder=!ready?'Activate both agents to start':directPending?'Waiting for a private reply…':benchmarkLive?'Both agents are answering…':live?(paused?'Message both agents. Each replies once, then they pause again':'Message both agents')
    :building?(buildKind==='review'?(project.trim()?'What should both agents look for? For example: find bugs and risky code':'Enter the project folder first'):'What should both agents build? For example: a Snake game playable with the arrow keys')
    :benchmark?'Prompt for both agents. They get it at the same moment':thread?.empty?'Give both agents a topic':'Send the next prompt. Both agents remember this thread';
  // Each mode lists its own threads; a fresh, unused session shows in both.
  const listed=threads.filter(t=>!t.mode||t.mode===mode);
  const grouped=new Map<string,ThreadSummary[]>();for(const t of listed){const key=t.empty?'Today':dayLabel(t.updatedAt);grouped.set(key,[...(grouped.get(key)??[]),t]);}
  const lines=(seat:Seat)=>activity.filter(l=>l.seat===seat&&!(l.type==='status'&&QUIET_STATUS.test(l.text)));

  return <div className="app">
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand"><span>Agent vs Agent</span>{pair?.mode==='simulation'&&<span className="pill">Simulation</span>}</div>
        <button className="icon-btn" aria-label={`New ${MODE_NAMES[mode]} thread`} title={`New ${MODE_NAMES[mode]} thread: a clean page with its own two agents`} onClick={()=>void newThread()}><Icon.compose/></button>
      </div>
      <label className="search"><Icon.search/><input type="search" placeholder="Search" aria-label="Search every thread" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('');}}/></label>
      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        {([['benchmark','Prompt',<Icon.prompt key="i"/>,'Both agents get the same prompt at the same moment; compare answers and speed'],['conversation','Debate',<Icon.chat key="i"/>,'The agents debate each other: prime each with its 1:1 line, then give them a topic'],
          ['build','Build',<Icon.build key="i"/>,'Both agents build the same app, each in its own folder, then compare them side by side. Or have both review a project']] as const).map(([value,label,icon,tip])=>
          <button key={value} role="radio" aria-checked={mode===value} title={tip} onClick={()=>switchMode(value)}>{icon}<span>{label}</span></button>)}
      </div>
      <nav className="threads" aria-label={hits?'Search results':`${MODE_NAMES[mode]} threads`}>
        {hits?(hits.results.length?hits.results.map(hit=><button key={hit.messageId} className="hit" onClick={()=>openHit(hit)}>
          <span className="hit-who">{hit.sender==='user'?'You':names[hit.participants?.[hit.sender as Seat]?.provider??'']??hit.sender}</span>
          <span className="hit-text"><Highlight text={hit.snippet} query={hits.query}/></span>
          <span className="hit-thread">{hit.runTopic} · {shortTime(hit.runCreatedAt)}</span>
        </button>):<p className="threads-empty">No messages match “{hits.query}”.</p>)
        :listed.length?[...grouped].map(([day,list])=><section key={day}><h2>{day}</h2>{list.map(t=><button key={t.id} className="thread" aria-current={t.id===threadId?'true':undefined} onClick={()=>{select(t.id);}} onDoubleClick={()=>{select(t.id);setRenaming(t.named?t.title:'');}}>
          <span className="thread-top"><span className="thread-title">{t.named||!t.empty?t.title||'Untitled':t.current?'New session':'Private messages only'}</span><time>{shortTime(t.updatedAt)}</time></span>
          <span className="thread-meta">{t.live&&<span className="live-dot" title="Live"/>}{t.participants?`${names[t.participants.cli1.provider]} · ${names[t.participants.cli2.provider]}`:'Agents not recorded'}{t.empty?'':` · ${plural(t.prompts,'prompt')}`}{t.directMessages?' · 1:1':''}</span>
        </button>)}</section>)
        :<p className="threads-empty">{MODE_NAMES[mode]} threads appear here.</p>}
      </nav>
    </aside>

    {/* Results: the apps take the bottom half, each under its agent's screen and as tall; the prompt row goes below them. */}
    <main className={`workspace${resultsRun?' results-mode':''}`} style={{'--split-a':`${layout.split}fr`,'--split-b':`${1-layout.split}fr`} as CSSProperties}>
      <section ref={agentsRef} className="agents" aria-label="Agent activity">
        {seats.flatMap((seat,i)=>{const who=identity(seat),state=paneStatus(seat),own=lines(seat),slot=pair?.slots[seat];const pane=<article key={seat} className={`agent ${seat}`} aria-label={`Agent ${i+1} activity`}>
          <header><span className="seat-dot"/>
            {/* Before activation the name's place holds Activate; afterwards the name opens the same setup menu. */}
            {roomView&&slot?(slot.state==='ready'?<button className="agent-name" aria-expanded={!!setup[seat]} title="Change the model, effort or permissions" onClick={()=>toggleSetup(seat)}><strong>{agentName(seat)}</strong><Icon.chevron/></button>
              :slot.state==='verifying'?<strong>{agentName(seat)}</strong>
              :<button className="activate-btn" aria-expanded={!!setup[seat]} onClick={()=>toggleSetup(seat)}>{slot.state==='failed'?'Activate again':'Activate'}</button>)
            :<strong>{agentName(seat)}</strong>}
            <span className="agent-model">{[who?.model,who?.effort?.value].filter(Boolean).join(' · ')||(roomView?`Agent ${i+1}`:'Not set up')}</span>
            {roomView&&slot?.permissions==='bypass'&&<span className="bypass-tag" title="Permissions: bypass. AvA approves every tool request this agent makes.">Bypass</span>}
            {roomView&&internetOn(seat)&&<span className="net-tag" title="Internet on"><Icon.globe/></span>}<span className={`agent-status ${state.tone}`}>{state.text}</span>
            {roomView&&slot?.state==='ready'&&<UsageRing name={agentName(seat)} provider={slot.config?.provider} usage={pair?.usage?.[seat]}/>}</header>
          {roomView&&pair&&setup[seat]&&<AgentSetup pairId={pair.id} seat={seat} onClose={()=>setSetup(s=>({...s,[seat]:false}))} onError={setError} confirmActivate={confirmActivate}/>}
          <Scroller className="activity" label={`Agent ${i+1} activity`}>{own.length?own.map(line=><div key={line.key} className={`line ${line.type}`}><span className="line-type">{LINE_LABEL[line.type]??line.type}{line.late?' · late':''}</span><pre>{line.type==='output'?readableOutput(line.text):line.text}</pre></div>)
            :<p className="pane-empty">{isRoomThread?'Thinking and tool use appear here as they happen.':'No recorded activity.'}</p>}</Scroller>
        </article>;return i?[pane]:[pane,<div key="split" className="split-handle" role="separator" aria-orientation="vertical" aria-label="Resize the agent panes" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.split*100)} tabIndex={0} title="Drag to resize · double-click to reset" onPointerDown={dragSplit} onKeyDown={nudge} onDoubleClick={()=>setLayout(DEFAULT_LAYOUT)}/>];})}
      </section>

      <section className={`channel${dropping?' dropping':''}`} aria-label="Conversation"
        onDragOver={e=>{if(canSend&&e.dataTransfer.types.includes('Files')){e.preventDefault();setDropping(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropping(false);}}
        onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();setDropping(false);if(canSend)void addFiles(e.dataTransfer.files);}}>
        <header className="channel-head">
          <div className="channel-title">{renaming!==null&&thread?<form onSubmit={e=>{e.preventDefault();void rename(renaming);}}><input className="rename" autoFocus aria-label="Thread name" maxLength={120} placeholder={thread.runIds.length?'Name (empty uses the first prompt)':'Name this session'} value={renaming} onChange={e=>setRenaming(e.target.value)} onBlur={()=>void rename(renaming)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRenaming(null);}}}/></form>
            :<h1 title={thread?'Double-click to rename':undefined} onDoubleClick={()=>thread&&setRenaming(thread.named?thread.title:'')}>{thread?(thread.named||!thread.empty?thread.title||'Untitled':thread.current?'New session':'Private messages only'):'Agent vs Agent'}</h1>}{subtitle&&<p className={live?'live':undefined}>{live&&<span className="live-dot"/>}{subtitle}</p>}</div>
          <div className="toolbar">
            {resultsRun&&<><ResultsTabs runs={buildRuns} runId={resultsRun.id} tab={resultsTab} onChange={setResults}/><span className="toolbar-divider"/></>}
            {live&&<>{!benchmarkLive&&<><button className="icon-btn" aria-label={paused?'Resume':'Pause'} title={paused?(directPending?'Waiting for a private reply':'Resume'):'Pause after the current replies'} disabled={!!busy||status!=='running'&&status!=='paused'||paused&&directPending} onClick={()=>control(paused?'resume':'pause')}>{paused?<Icon.play/>:<Icon.pause/>}</button>
              <button className="icon-btn" aria-label="Next reply" title="Next reply (while paused)" disabled={!!busy||!paused||directPending} onClick={()=>control('step')}><Icon.next/></button></>}
              <button className="icon-btn" aria-label="Stop" title="Stop" disabled={!!busy||status==='stopping'||status==='needs_attention'} onClick={()=>control('stop')}><Icon.stop/></button>
              <span className="toolbar-divider"/></>}
            {buildRuns.length>0&&<button className={`icon-btn${panel==='results'?' pressed':''}`} aria-pressed={panel==='results'} aria-label="Results" title={panel==='results'?'Back to the conversation':'Results: both apps side by side, and what each changed'}
              onClick={()=>{if(panel==='results'){setPanel('chat');return;}const last=buildRuns.at(-1)!;openResults(results&&buildRuns.some(r=>r.id===results.runId)?results.runId:last.id,results?.tab??(last.config.build?.kind==='review'?'changes':'preview'));}}>{panel==='results'?<Icon.chat/>:<Icon.window/>}</button>}
            <button className={`icon-btn${panel==='stats'?' pressed':''}`} aria-pressed={panel==='stats'} aria-label="Stats" title={panel==='stats'?'Back to the conversation':'Stats'} disabled={!promptCount} onClick={()=>setPanel(p=>p==='stats'?'chat':'stats')}>{panel==='stats'?<Icon.chat/>:<Icon.chart/>}</button>
            <Menu label="More" icon={<Icon.more/>} items={[
              {label:'Rename',icon:<Icon.pencil/>,disabled:!thread,onSelect:()=>thread&&setRenaming(thread.named?thread.title:'')},
              {label:'Replay',icon:<Icon.replay/>,disabled:live||!shown?.messages.length,onSelect:startReplay},
              {label:'Export JSON',icon:<Icon.download/>,disabled:!promptCount,onSelect:()=>void exportThread('json')},
              {label:'Export Markdown',icon:<Icon.download/>,disabled:!promptCount,onSelect:()=>void exportThread('md')},
              'divider',
              {label:'Clear Session',icon:<Icon.compose/>,disabled:!!busy||!canClear,onSelect:clearSession},
              {label:'Clear history…',icon:<Icon.trash/>,destructive:true,disabled:!!busy||!!pair?.activeRunId||!threads.some(t=>!t.empty),onSelect:clearHistory},
            ]}/>
          </div>
        </header>
        {!connected&&<div className="notice"><Icon.refresh/><span>Reconnecting to AvA…</span></div>}

        {panel==='stats'?<div className="feed"><StatsView stats={stats} names={names} loading={!!promptCount}/></div>
        :resultsRun?<ResultsView run={resultsRun} tab={resultsTab} live={live&&resultsRun.id===pair?.activeRunId} agentName={agentName} reported={{cli1:!!shown?.messages.some(m=>m.runId===resultsRun.id&&m.sender==='cli1'),cli2:!!shown?.messages.some(m=>m.runId===resultsRun.id&&m.sender==='cli2')}}/>
        :<Scroller className="feed" label="Messages" role="log" follow={!focusedId}>
          {mismatch&&thread?<div className="empty">
            <h2>{MODE_NAMES[mode]} starts in a fresh session</h2>
            <p>This chat’s agents are in a {MODE_NAMES[thread.mode!].toLowerCase()} thread, “{thread.title||'Untitled'}”. Clear Session gives both agents fresh sessions for {MODE_NAMES[mode].toLowerCase()}; the {MODE_NAMES[thread.mode!].toLowerCase()} thread stays in its own list.</p>
            <div className="empty-actions"><button className="button primary" disabled={!!busy||!canClear} onClick={clearSession}>Clear Session</button><button className="button" onClick={()=>switchMode(thread.mode!)}>Back to {MODE_NAMES[thread.mode!]}</button></div>
          </div>
          :feed.length?feed:(shown||!threadId)&&<div className="empty">
            {!pair?<><h2>Agent vs Agent</h2><p>Open this room with <kbd>/ava start</kbd> in Codex or <kbd>/agent-vs-agent:ava start</kbd> in Claude Code.</p></>
            :!ready&&roomView||!thread?<><h2>Activate both agents</h2><p>Use <strong>Activate</strong> above each agent’s screen to choose its CLI, model, effort and permissions. Each activation sends one short request to check access.</p></>
            :building&&buildKind==='review'?<><h2>Review a project with {agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Each agent gets its own copy of the folder below and may read, edit and run commands there; your original is never touched. Both start at the same moment and report what they find. Watch them work above.':'No reports in this thread.'}</p>
              {isRoomThread&&<button className="suggestion" onClick={()=>{setDraft('Find bugs and risky code. Run the tests if there are any, and rank what you find by severity.');composerRef.current?.focus();}}>Find bugs, run the tests, rank by severity</button>}</>
            :building?<><h2>Build with {agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Both build the same thing at the same moment, each in its own folder, then post a link to their app here. Open the two side by side with Results. To set an agent up first (clone a repository, say), use its 1:1 line: in a Build session it can run commands in its own folder. One prompt per session.':'No builds in this thread.'}</p>
              {isRoomThread&&<button className="suggestion" onClick={()=>{setDraft('Build a polished Snake game that runs in the browser: arrow keys to steer, a score, increasing speed, and a restart button.');composerRef.current?.focus();}}>A Snake game for the browser</button>}</>
            :benchmark?<><h2>Prompt {agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Both get your prompt at the same moment. Watch them work above, compare their final answers here, then open Stats for speed and timing. Attach files or images with the paperclip.':'No answers in this thread.'}</p>
              {isRoomThread&&<button className="suggestion" onClick={()=>{setDraft('Write a function that merges overlapping intervals, explain its complexity, and include three test cases.');composerRef.current?.focus();}}>Merge overlapping intervals, with tests</button>}</>
            :<><h2>{agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Both agents are ready. Give each a role with its 1:1 line below if you like, then give them a topic.':'No messages in this thread.'}</p>
              {isRoomThread&&<button className="suggestion" onClick={()=>{setDraft('Talk about the Minnesota Vikings for 15 minutes');composerRef.current?.focus();}}>Talk about the Minnesota Vikings for 15 minutes</button>}</>}
          </div>}
        </Scroller>}

        {isRoomThread&&status==='needs_attention'&&<div className="notice warn" role="status"><Icon.warning/><div><strong>Needs attention.</strong> {reasonText(pair?.activeRun?.reason??null)}.{attention?.uncertainTurns?` ${plural(attention.uncertainTurns,'request')} ${attention.uncertainTurns===1?'has':'have'} an unknown outcome and will not be resent.`:''} {attention?.uncertainTurns?'Release the pair once no provider process is running.':attention?.ownedHere?'Nothing is outstanding: Stop ends it and frees the pair.':'Release the pair to start again. Nothing will be resent.'}</div><button className="button" disabled={!!busy} onClick={release}>Release</button></div>}

        {/* Results gives the two apps the whole bottom half; the chat button brings the text box back. */}
        <div className="foot" hidden={panel==='results'}>
        {thread&&(isRoomThread||direct.messages.length>0)&&<div className="direct-chips" role="group" aria-label="Each agent's 1:1 line and internet switch">
          {seats.map(seat=>{const on=internetOn(seat),blocked=internetBlocked(seat);return <div key={seat} className="chip-group">
            <button className={`chip ${seat}`} aria-pressed={directOpen[seat]} title={`Private 1:1 with ${agentName(seat)}. Not shared with the room or the other agent.`} onClick={()=>toggleDirect(seat)}>
              <span className="seat-dot"/>{agentName(seat)}<span className="chip-sub">1:1</span>{(unread(seat)||direct.pending[seat])&&<span className={`chip-flag${direct.pending[seat]?' busy':''}`} aria-label={direct.pending[seat]?'Replying':'New reply'}/>}
            </button>
            {isRoomThread&&<button className={`chip net${on?' on':''}`} aria-pressed={on} aria-label={`Internet for ${agentName(seat)}: ${on?'on':'off'}`} disabled={!!blocked||switchingNet[seat]}
              title={blocked||`Internet ${on?'on':'off'} for ${agentName(seat)}. ${internetEnforcement[pair?.slots[seat].config?.provider??'']??''} Every prompt also tells the agent its setting.`}
              onClick={()=>void toggleInternet(seat)}><Icon.globe/>{switchingNet[seat]?(RESTARTS_FOR_WEB.has(pair?.slots[seat].config?.provider??'')?'Restarting…':'…'):on?'On':'Off'}</button>}
          </div>;})}
        </div>}
        {activeReplay?<div className="replay-bar">
          <span>{replayDone?'Replay finished':`Replaying · ${duration(activeReplay.clock)} of ${duration(activeReplay.total)}`}</span>
          <div className="segmented" role="group" aria-label="Replay speed">{[1,4,16].map(speed=><button key={speed} aria-pressed={activeReplay.speed===speed} onClick={()=>setReplay(r=>r&&{...advance(r),speed})}>{speed}×</button>)}</div>
          <button className="button" onClick={()=>setReplay(null)}>Done</button>
        </div>
        :buildDone&&!mismatch?<div className="readonly-bar"><span>This build is done. Each Build session takes one prompt; 1:1 lines still work.</span><button className="button primary" disabled={!!busy||!canClear} onClick={clearSession}>New build session</button></div>
        :isRoomThread||!thread?<form className={`composer${canSend?'':' disabled'}`} onSubmit={e=>{e.preventDefault();void send();}}>
          {files.length>0&&<div className="composer-files" aria-label="Attached files">{files.map(f=><span key={f.key} className={`file-chip ${f.status}`} title={f.error??f.name}>
            {f.preview?<img src={f.preview} alt=""/>:<Icon.file/>}<span className="file-name">{f.name}</span><small>{f.status==='uploading'?'Uploading…':f.error??bytes(f.size)}</small>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(list=>list.filter(p=>p.key!==f.key))}><Icon.close/></button></span>)}</div>}
          {building&&isRoomThread&&<div className="project-row">
            <div className="segmented" role="radiogroup" aria-label="Build or review">{([['build','Build'],['review','Review']] as const).map(([value,label])=><button key={value} type="button" role="radio" aria-checked={buildKind===value} aria-pressed={buildKind===value} disabled={mismatch||benchmarkLive} onClick={()=>setBuildKind(value)}>{label}</button>)}</div>
            <label><Icon.folder/><input aria-label="Project folder" placeholder={buildKind==='review'?'Project folder to review, for example D:\\Projects\\my-app':'Optional: a project folder to start from (empty starts from scratch)'} value={project} maxLength={1000} spellCheck={false} disabled={mismatch||benchmarkLive} onChange={e=>setProject(e.target.value)}/></label>
          </div>}
          <div className="composer-row">
            <button ref={optionsButton} type="button" className={`icon-btn${optionsOpen?' pressed':''}`} aria-label="Options for the next prompt" title="Options for the next prompt" aria-expanded={optionsOpen} disabled={mismatch} onClick={()=>{setOptionsOpen(o=>!o);void loadPresets();}}><Icon.sliders/>{customized||opening!=='both'&&!benchmark?<span className="badge"/>:null}</button>
            <button type="button" className="icon-btn" aria-label="Attach files or images" title={seats.some(s=>pair?.images?.[s]===false)?`Attach text files (${seats.filter(s=>pair?.images?.[s]===false).map(agentName).join(' and ')} can’t read images)`:'Attach images or text files (or paste or drop them here)'} disabled={!canSend||files.length>=8} onClick={()=>fileInput.current?.click()}><Icon.attach/></button>
            <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.json,.jsonl,.csv,.yaml,.yml,.toml,.xml,.html,.css,.js,.mjs,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.cs,.php,.sh,.ps1,.sql,.log,.diff,.patch" onChange={e=>{if(e.target.files)void addFiles(e.target.files);e.target.value='';}}/>
            <textarea ref={composerRef} rows={1} aria-label={benchmark?'Prompt for both agents':'Message both agents'} placeholder={busy?`${busy}…`:mismatch?`Clear Session to start ${MODE_NAMES[mode].toLowerCase()}`:placeholder} value={draft} maxLength={16000} disabled={!isRoomThread||!ready||mismatch}
              onChange={e=>setDraft(e.target.value)} onPaste={e=>{const pasted=[...e.clipboardData.files];if(pasted.length&&canSend){e.preventDefault();void addFiles(pasted);}}}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
            <button className="send" type="submit" aria-label={live?'Send to both agents':benchmark?'Send to both agents at once':'Start'} title={uploading?'Waiting for uploads':'Send · Enter (Shift+Enter for a new line)'} disabled={!!busy||!draft.trim()||!canSend||uploading}><Icon.send/></button>
          </div>
        </form>
        :<div className="readonly-bar"><span>{thread.pairId===pair?.id?'This session was cleared. Its agents no longer remember it.':'From another chat. Read-only here.'}</span>{roomThreadId&&<button className="link" onClick={()=>select('')}>Go to the current session</button>}</div>}

        {optionsOpen&&isRoomThread&&<div ref={sheetRef} className="sheet" role="dialog" aria-label="Options for the next prompt">
          <header><div><h2>{benchmark?'Prompt options':building?'Build options':'Options'}</h2><p>{benchmark?'The prompt goes to both agents exactly as you write it. To give one agent extra context, use its 1:1 line first.':building?'Each agent may read, edit and run commands in its own working folder only. Anything outside it is refused.':live?'Used when the next prompt starts. The running conversation keeps its settings.':'Used when the next prompt starts.'}</p></div><button className="icon-btn" aria-label="Close options" onClick={()=>setOptionsOpen(false)}><Icon.close/></button></header>
          {benchmark||building?<div className="sheet-body">
            <div className="group limits single">
              <label><span>Time limit (minutes)</span><input type="number" min="0.5" max="60" step="any" placeholder={building?'30':'60'} value={settings.minutes} onChange={e=>setSettings(s=>({...s,minutes:e.target.value}))}/></label>
            </div>
            {customized&&<button className="link" onClick={()=>setSettings(s=>({...s,minutes:''}))}>Reset to default</button>}
            <p className="sheet-note">{building?'Each agent reports once. Work that isn’t finished when the time limit ends is cancelled; what it built stays in its folder until Clear history.':'Each agent answers once. Answers that aren’t finished when the time limit ends are cancelled.'}</p>
          </div>
          :<div className="sheet-body">
            <div className="group">
              <h3>First to speak</h3>
              <div className="segmented wide" role="radiogroup" aria-label="First to speak">
                {([['both','Both at once'],['cli1',agentName('cli1')],['cli2',agentName('cli2')]] as const).map(([value,label])=><button key={value} type="button" role="radio" aria-checked={opening===value} aria-pressed={opening===value} onClick={()=>setOpening(value)}>{label}</button>)}
              </div>
            </div>
            <div className="group">
              <label className="row"><span>Preset</span><select value={presetId} onChange={e=>applyPreset(e.target.value)}><option value="">{presets.length?'None':'No saved presets'}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {presetName===null?<div className="row actions"><button className="link" onClick={()=>setPresetName(presets.find(p=>p.id===presetId)?.name??'')}>Save as preset…</button>{presetId&&<button className="link destructive" onClick={()=>void deletePreset()}>Delete preset</button>}</div>
              :<form className="row" onSubmit={e=>{e.preventDefault();void savePreset();}}><input autoFocus aria-label="Preset name" placeholder="Preset name" maxLength={80} value={presetName} onChange={e=>setPresetName(e.target.value)}/><button className="button" type="button" onClick={()=>setPresetName(null)}>Cancel</button><button className="button primary" type="submit" disabled={!presetName.trim()}>Save</button></form>}
            </div>
            <div className="seat-grid">{seats.map(seat=><div className="group" key={seat}>
              <h3><span className={`seat-dot ${seat}`}/>{agentName(seat)} <span>Agent {SEAT_NUMBER[seat]}</span></h3>
              <textarea aria-label={`Private instruction for Agent ${SEAT_NUMBER[seat]}`} placeholder="Private instruction (only this agent sees it)" maxLength={8000} value={settings.instructions[seat]} onChange={e=>setSettings(s=>({...s,instructions:{...s.instructions,[seat]:e.target.value}}))}/>
              <input aria-label={`Stop condition for Agent ${SEAT_NUMBER[seat]}`} placeholder="Stop when… (optional)" maxLength={4000} value={settings.stopWhen[seat]} onChange={e=>setSettings(s=>({...s,stopWhen:{...s.stopWhen,[seat]:e.target.value}}))}/>
            </div>)}</div>
            <div className="group limits">
              <label><span>Ends</span><select value={settings.completion} onChange={e=>setSettings(s=>({...s,completion:e.target.value as PresetData['completion']}))}><option value="auto">From the prompt</option><option value="duration">At the time limit</option><option value="either">When either agent is done</option><option value="both">When both agents are done</option></select></label>
              <label><span>Minutes</span><input type="number" min="0.01" max="1440" step="any" placeholder="From prompt" value={settings.minutes} onChange={e=>setSettings(s=>({...s,minutes:e.target.value}))}/></label>
              <label><span>Requests</span><input type="number" min="2" max="10000" placeholder="Automatic" value={settings.requests} onChange={e=>setSettings(s=>({...s,requests:e.target.value}))}/></label>
              <label><span>Pace (s)</span><input type="number" min="0" max="60" value={settings.pace} onChange={e=>setSettings(s=>({...s,pace:e.target.value}))}/></label>
            </div>
            {(customized||opening!=='both')&&<button className="link" onClick={()=>{setSettings(DEFAULT_SETTINGS);setPresetId('');setOpening('both');}}>Reset to defaults</button>}
          </div>}
        </div>}
        {thread&&<div className="direct-dock">{seats.filter(seat=>directOpen[seat]).map(seat=><DirectWindow key={`${threadId}:${seat}`} seat={seat} name={agentName(seat)} partner={agentName(seat==='cli1'?'cli2':'cli1')}
          messages={direct.messages.filter(m=>m.seat===seat)} pending={direct.pending[seat]} blocked={directBlocked(seat)} readOnly={!isRoomThread} tools={directTools&&isRoomThread}
          onSend={text=>sendDirect(seat,text)} onClose={()=>setDirectOpen(o=>({...o,[seat]:false}))}/>)}</div>}
        </div>
      </section>
    </main>
    {lightbox&&<div className="backdrop lightbox" role="dialog" aria-label="Image" onMouseDown={()=>setLightbox('')} onKeyDown={e=>{if(e.key==='Escape')setLightbox('');}}><img src={lightbox} alt=""/><button className="icon-btn" autoFocus aria-label="Close image" onClick={()=>setLightbox('')}><Icon.close/></button></div>}
    {dialog&&<Dialog spec={dialog} onClose={()=>setDialog(null)}/>}
    {error&&<div className="toast" role="alert"><span>{error}</span><button className="icon-btn" aria-label="Dismiss" onClick={()=>setError('')}><Icon.close/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
