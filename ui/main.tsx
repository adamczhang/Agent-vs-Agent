import { useEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent as ReactPointerEvent,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_ROUNDS,DEFAULT_SPEECH_MINUTES,type AnswerCheck,type GameSetup,type HuntSetup,type JudgeProvider,type RunConfig,type Seat,type Stance } from '../src/types';
import type { ThreadStats } from '../src/stats';
import { describeQuick } from '../src/quick';
import { GameView, gameTitle } from './game-view';
import { PuzzlesPanel } from './puzzles-panel';
import { SeriesPanel } from './series-panel';
import { ProfileSelector } from './profile-selector';
import type { RunProfile } from '../src/run-profiles';
import { activityProjection,type ActivityLine,type Event } from './projection';
import { RpcError,initialMode,roomId,roomLink,rpc } from './api';
import { CommandClient } from './commands';
import { ResourcesPanel } from './resources-panel';
import { BenchmarksPanel } from './benchmarks-panel';
import { replayTimeline } from './replay';
import { StatsView } from './stats-view';
import { ResultsTabs,ResultsView,openApp,type AppLink,type ResultsTab } from './results-view';
import { AgentSetup } from './agent-setup';
import { UsageRing } from './usage-ring';
import { PromptManager,type PreparedPrompt } from './prompt-manager';
import type { DebateSetup,PromptMode } from '../src/prompt-types';
import { Ballot } from './ballot';
import { PromptResult } from './prompt-result';
import { HuntResult } from './hunt-result';
import { PromptBuilder } from './prompt-builder';
import { Icon } from './icons';
import { IMAGE_TYPES,TERMINAL,TEXT_NAME,bytes,clock,dayLabel,delivery,directStates,duration,fullDate,initials,internetEnforcement,names,plural,reasonText,seats,shortTime,statusNames,
  type AttachmentRef,type DirectMessage,type Mode,type PairView,type Preset,type PresetData,type SearchHit,type ThreadMessage,type ThreadSummary,type ThreadView } from './model';
import './style.css';

const commands=new CommandClient(sessionStorage,'ava-command:'+roomId);
// Run controls and the thread's own commands (Close thread, Clear Session) keep their own retry records, so a Pause after an
// uncertain send can't replace that send's (Q5).
const controlCommands=new CommandClient(sessionStorage,'ava-control:'+roomId),threadCommands=new CommandClient(sessionStorage,'ava-thread:'+roomId);
// One retry slot per agent for direct messages: an unacknowledged send is retried with its original request ID.
const directCommands:Record<Seat,CommandClient>={cli1:new CommandClient(sessionStorage,'ava-direct-cli1:'+roomId),cli2:new CommandClient(sessionStorage,'ava-direct-cli2:'+roomId)};
const DEFAULT_SETTINGS:PresetData={instructions:{cli1:'',cli2:''},stopWhen:{cli1:'',cli2:''},completion:'auto',rounds:'',minutes:'',requests:'',pace:'5'};
// A debate prompt's template (G2) sets up the next debate: each agent's private context and internet, and the rounds.
// Stop conditions, a time and a request limit left from an earlier debate would cut it short, so they're cleared.
// Every debate is formal (G6): Agent 1 argues for the motion and Agent 2 against unless swapped, and Claude Code judges
// unless changed (G7).
const DEFAULT_STANCES:Record<Seat,Stance>={cli1:'for',cli2:'against'};
const SIDE_LABEL:Record<Stance,string>={for:'For the motion',against:'Against the motion'};
const SPEECH_TIMES:Array<[string,string]>=[['1','1 minute'],['2','2 minutes'],['3','3 minutes'],['5','5 minutes'],['10','10 minutes'],['0','No limit']];
const JUDGES:Array<[JudgeProvider|'off',string]>=[['claude','Claude Code (strongest model, max effort)'],['codex','Codex (strongest model, max effort)'],['off','No judge']];
function debateSettings(setup:DebateSetup,base:PresetData):PresetData{
  const {cli1,cli2}=setup.agents;
  return {...base,profile:undefined,instructions:{cli1:cli1.context,cli2:cli2.context},internet:{cli1:cli1.internet,cli2:cli2.internet},stances:{cli1:cli1.stance,cli2:cli2.stance},speech:String(setup.speechMinutes??DEFAULT_SPEECH_MINUTES),stopWhen:{cli1:'',cli2:''},completion:'rounds',rounds:String(setup.rounds),minutes:'',requests:''};
}
const LINE_LABEL:Record<string,string>={thought:'Thinking',tool:'Tool',output:'Writing',status:'Status'};
// Providers whose web access is set at launch, so the internet switch restarts them (see src/providers.ts LAUNCH_TIME_WEB).
const RESTARTS_FOR_WEB=new Set(['codex','grok-build','vercel']);
// Bookkeeping the CLIs report as status (context size, command lists) isn't activity worth showing.
const QUIET_STATUS=/^(usage updated|available commands updated|current mode updated|config options? updated|session (info )?updated)/i;
const SEAT_NUMBER:Record<Seat,number>={cli1:1,cli2:2};
// run.get returns at most this many events per call (Store.events).
const EVENT_PAGE=300,EVENT_PAGES_PER_TICK=5;
// Events that change the thread itself (its messages, its run's status): the view is re-read when one arrives.
const VIEW_EVENTS=new Set(['room_committed','room_queued','run_started','run_ended','paused','duration_changed','reconciled','build_copied','build_server','build_cleanup']);
const message=(e:unknown)=>e instanceof Error?e.message:String(e);

// Prompt, Debate, Build or Gamer: which kind of thread the room shows and starts. Remembered in this browser only.
const MODE_KEY='ava-mode';
function loadMode():Mode{let m=initialMode;try{m??=localStorage.getItem(MODE_KEY);}catch{/* storage unavailable */}return m==='benchmark'||m==='build'||m==='game'?m:'conversation';}
const OPENING_KEY='ava-opening';
function loadOpening():'both'|Seat{try{const v=localStorage.getItem(OPENING_KEY);if(v==='both'||v==='cli2')return v;}catch{/* storage unavailable */}return 'cli1';}
// Build mode: the last project folder and whether to build or review (this browser only).
const PROJECT_KEY='ava-project',BUILD_KIND_KEY='ava-build-kind';
function loadProject(){try{return localStorage.getItem(PROJECT_KEY)??'';}catch{return '';}}
function loadBuildKind():'build'|'review'{try{return localStorage.getItem(BUILD_KIND_KEY)==='review'?'review':'build';}catch{return 'build';}}
// "benchmark" is the Prompt mode's internal name.
const MODE_NAMES:Record<Mode,string>={conversation:'Debate',benchmark:'Prompt',build:'Build',game:'Gamer'};
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

// Pane proportions are a per-viewer convenience, remembered in this browser only.
const LAYOUT_KEY='ava-layout-v2',DEFAULT_LAYOUT={split:.5,height:.5};
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
function loadLayout(){
  const ratio=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?clamp(v,.2,.8):.5;
  try{const v=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');if(v)return {split:ratio(v.split),height:ratio(v.height)};}catch{/* storage unavailable */}
  return DEFAULT_LAYOUT;
}
function drag(e:ReactPointerEvent,onMove:(ev:PointerEvent)=>void,rows=false){
  if(e.button!==0||!e.isPrimary)return;
  e.preventDefault();const handle=e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const move=(ev:PointerEvent)=>{if(ev.pointerId===e.pointerId)onMove(ev);};
  const up=(ev:globalThis.Event)=>{
    if('pointerId' in ev&&ev.pointerId!==e.pointerId)return;
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',up);handle.removeEventListener('lostpointercapture',up);
    if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing','resizing-rows');
  };
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',up);handle.addEventListener('lostpointercapture',up);
  document.body.classList.add('resizing');document.body.classList.toggle('resizing-rows',rows);
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
      <p className="direct-note">Private. Only {name} sees this, in the same session it uses in the shared chat. Nothing here reaches the room or {partner}.{tools?` In a Build session ${name} can use file tools in its own folder. Ask mode refuses command execution.`:''}</p>
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
  // The rounds chip beside the message box (Debate): its small menu, closed by a click elsewhere.
  const [roundsOpen,setRoundsOpen]=useState(false),roundsRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!roundsOpen)return;
    const close=(e:MouseEvent)=>{if(!roundsRef.current?.contains(e.target as Node))setRoundsOpen(false);};
    document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);
  },[roundsOpen]);
  const [library,setLibrary]=useState<'browse'|'draft'|null>(null),[builderOpen,setBuilderOpen]=useState(false);
  // A loaded Prompt-mode prompt's answer key: sent with that prompt (while the composer still holds its text) and never
  // shown to the agents.
  const [answerKey,setAnswerKey]=useState<{text:string;check:AnswerCheck}|null>(null);
  // A loaded scored Bug hunt's setup (H3): its planted bugs go with that prompt only, and never to the agents.
  const [hunt,setHunt]=useState<{text:string;setup:HuntSetup}|null>(null);
  const [resourcesOpen,setResourcesOpen]=useState(false);
  const [benchmarksOpen,setBenchmarksOpen]=useState(false);
  const [puzzlesOpen,setPuzzlesOpen]=useState(false);
  const [seriesOpen,setSeriesOpen]=useState(false);
  const [settings,setSettings]=useState<PresetData>(DEFAULT_SETTINGS),[presets,setPresets]=useState<Preset[]>([]),[presetId,setPresetId]=useState(''),[presetName,setPresetName]=useState<string|null>(null);
  const [query,setQuery]=useState(''),[hits,setHits]=useState<{query:string;results:SearchHit[]}|null>(null),[focusedId,setFocusedId]=useState('');
  const [replay,setReplay]=useState<{threadId:string;offsets:Record<string,number>;total:number;speed:number;clock:number;tickAt:number}|null>(null);
  const [layout,setLayout]=useState(loadLayout);
  const [directOpen,setDirectOpen]=useState<Record<Seat,boolean>>({cli1:false,cli2:false}),[seen,setSeen]=useState<Record<string,number>>({});
  const [mode,setMode]=useState<Mode>(loadMode),[opening,setOpening]=useState<'both'|Seat>(loadOpening),[files,setFiles]=useState<Pending[]>([]),[renaming,setRenaming]=useState<string|null>(null),[lightbox,setLightbox]=useState('');
  const fileInput=useRef<HTMLInputElement>(null),knownRuns=useRef(new Set<string>()),[dropping,setDropping]=useState(false);
  useEffect(()=>{try{localStorage.setItem(MODE_KEY,mode);}catch{/* storage unavailable */}},[mode]);
  // The polling loop reads the mode on screen from here (it picks the room's pair for that mode).
  const modeRef=useRef<Mode>(mode);modeRef.current=mode;
  useEffect(()=>{try{localStorage.setItem(OPENING_KEY,opening);}catch{/* storage unavailable */}},[opening]);
  const [project,setProject]=useState(loadProject),[buildKind,setBuildKind]=useState(loadBuildKind);
  useEffect(()=>{try{localStorage.setItem(PROJECT_KEY,project);localStorage.setItem(BUILD_KIND_KEY,buildKind);}catch{/* storage unavailable */}},[project,buildKind]);
  // What the page last showed, and whether the last poll lost the connection.
  const pairShown=useRef(''),threadsShown=useRef(''),lost=useRef(false);
  const polling=useRef<Promise<void>|null>(null),again=useRef(false),stopped=useRef(false),pollFailed=useRef(false),threadGeneration=useRef(0),viewDirty=useRef(false),viewShown=useRef(''),viewRef=useRef<(ThreadView&{id:string})|null>(null),selectedRef=useRef(''),shownRef=useRef(''),threadsRef=useRef<ThreadSummary[]>([]),threadsAt=useRef(0),viewAt=useRef(0),liveRef=useRef(false);
  const cursors=useRef(new Map<string,number>()),finished=useRef(new Set<string>()),rawEvents=useRef(new Map<string,Event[]>()),openTurns=useRef(new Map<string,{seat:Seat;runId:string}>());
  const commandBusy=useRef(false),pendingFocus=useRef(''),agentsRef=useRef<HTMLElement>(null),workspaceRef=useRef<HTMLElement>(null),channelRef=useRef<HTMLElement>(null),composerRef=useRef<HTMLTextAreaElement>(null);

  useEffect(()=>{try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout));}catch{/* storage unavailable */}},[layout]);
  // A file dropped anywhere else on the page would otherwise open in its place and leave the room.
  useEffect(()=>{
    const stop=(e:DragEvent)=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();};
    window.addEventListener('dragover',stop);window.addEventListener('drop',stop);
    return()=>{window.removeEventListener('dragover',stop);window.removeEventListener('drop',stop);};
  },[]);
  function dragSplit(e:ReactPointerEvent){const box=agentsRef.current!.getBoundingClientRect();drag(e,ev=>setLayout(l=>({...l,split:clamp((ev.clientX-box.left)/box.width,.2,.8)})));}
  function dragHeight(e:ReactPointerEvent){
    const top=agentsRef.current!.getBoundingClientRect(),bottom=(workspaceRef.current!.querySelector<HTMLElement>('.results-grid')??channelRef.current!).getBoundingClientRect();
    const height=top.height+bottom.height;
    if(height>0)drag(e,ev=>setLayout(l=>({...l,height:clamp((ev.clientY-top.top)/height,.2,.8)})),true);
  }
  function nudge(e:KeyboardEvent,axis:'split'|'height'){
    if(e.key==='Enter'){e.preventDefault();setLayout(l=>({...l,[axis]:DEFAULT_LAYOUT[axis]}));return;}
    const dir=(axis==='split'?{ArrowLeft:-1,ArrowRight:1}:{ArrowUp:-1,ArrowDown:1})[e.key as 'ArrowLeft'|'ArrowRight'|'ArrowUp'|'ArrowDown'];if(!dir)return;e.preventDefault();
    setLayout(l=>({...l,[axis]:clamp(l[axis]+dir*(e.shiftKey?.1:.05),.2,.8)}));
  }
  const roomThreadOf=(list:ThreadSummary[],pairId?:string)=>list.find(t=>t.pairId===pairId&&t.current)?.id??'';
  function resetThreadState(){
    // A poll still reading the thread left behind (A → B → A included) sees the generation change and stops (Q5).
    threadGeneration.current++;viewRef.current=null;viewShown.current='';viewDirty.current=false;
    cursors.current.clear();finished.current.clear();rawEvents.current.clear();openTurns.current.clear();
    setView(null);setActivity([]);setWorking({cli1:false,cli2:false});setAttention(undefined);setStats(null);setReplay(null);viewAt.current=0;
  }
  // One polling loop: the room's pair, the thread list (every few seconds), the shown thread, and its runs' events. A call
  // made while a poll is under way runs it once more when that one ends, and resolves after it (Q5): a command's own
  // refresh used to be dropped, leaving the list and the header stale for a few seconds.
  function refresh():Promise<void>{
    if(polling.current){again.current=true;return polling.current;}
    const run=(async()=>{try{do{again.current=false;await poll();}while(again.current&&!stopped.current);}finally{polling.current=null;}})();
    return polling.current=run;
  }
  async function poll(){
    const target=selectedRef.current,shownMode=modeRef.current;let generation=threadGeneration.current;
    const current=(id:string)=>shownRef.current===id&&selectedRef.current===target&&threadGeneration.current===generation;
    try{
      if(!roomId)throw new Error('Open this room with /ava start in Codex or /agent-vs-agent:ava start in Claude Code.');
      // The room's pair for the mode on screen (E9): each mode keeps its own thread and agents. An answer for a mode
      // switched away from meanwhile is the other mode's pair, so it's dropped (Q5).
      const room=await rpc<{pair:PairView;pairIds?:string[]}>('room.get',{roomId,mode:shownMode});
      if(modeRef.current!==shownMode)return;
      // Only a change re-renders the page (this runs a few times a second).
      const pairJson=JSON.stringify(room.pair);if(pairJson!==pairShown.current){pairShown.current=pairJson;setPair(room.pair);}
      if(Date.now()-threadsAt.current>2500){
        // A command that asked for a fresh list while this one was on its way (threadsAt back to 0) still gets one.
        const asked=threadsAt.current;
        const list=(await rpc<{threads:ThreadSummary[]}>('threads.list',{pairId:room.pair.id,pairIds:room.pairIds??[]})).threads,listJson=JSON.stringify(list);
        if(modeRef.current!==shownMode)return;
        if(threadsAt.current===asked)threadsAt.current=Date.now();
        if(listJson!==threadsShown.current){threadsShown.current=listJson;threadsRef.current=list;setThreads(list);}
      }
      if(selectedRef.current!==target)return;
      const id=target||roomThreadOf(threadsRef.current,room.pair.id);
      if(id!==shownRef.current){shownRef.current=id;resetThreadState();generation=threadGeneration.current;}
      setConnected(true);if(lost.current||pollFailed.current){lost.current=false;pollFailed.current=false;setError('');}
      if(!id)return;
      // A finished thread changes rarely; a live one is read on every tick (as is one where a run just started elsewhere).
      const activeId=room.pair.activeRunId,startedElsewhere=!!activeId&&!knownRuns.current.has(activeId),due=Date.now()-viewAt.current>=2500;
      if(!liveRef.current&&!startedElsewhere&&!due)return;
      // While it's live, the thread itself (messages and 1:1 lines) is re-read only when something in it changed, while a
      // 1:1 reply is pending, when its run has just ended, or every few seconds; its events are read on every tick (Q5).
      let data=viewRef.current?.id===id?viewRef.current:null;
      const directLive=!!data&&Object.keys(data.direct.pending).length>0;
      if(!data||startedElsewhere||directLive||due||viewDirty.current||(liveRef.current&&!activeId)){
        viewDirty.current=false;const asked=viewAt.current;
        const next=await rpc<ThreadView>('thread.get',{threadId:id});
        if(!current(id))return;
        if(viewAt.current===asked)viewAt.current=Date.now();
        const json=JSON.stringify(next);if(json!==viewShown.current||!viewRef.current){viewShown.current=json;viewRef.current={...next,id};setView(viewRef.current);}
        data=viewRef.current!;
        knownRuns.current=new Set([...data.runs.map(r=>r.id),...(activeId?[activeId]:[])]);
        // Poll quickly while the thread has a running conversation or a direct reply being written.
        liveRef.current=!!activeId&&data.runs.some(r=>r.id===activeId)||Object.keys(data.direct.pending).length>0;
      }
      const fresh:Event[]=[];let pages=0;
      for(const run of data.runs){
        if(finished.current.has(run.id))continue;
        // Every page of a run before the next run, so a long run's activity stays in order; a few pages a tick, so
        // opening a long finished thread doesn't hold up the room's own state (Q5).
        let page:{events:Event[];attention?:{uncertainTurns:number;ownedHere:boolean}}|undefined;
        do{
          if(++pages>EVENT_PAGES_PER_TICK){again.current=true;break;}
          page=await rpc<NonNullable<typeof page>>('run.get',{runId:run.id,after:cursors.current.get(run.id)??0,eventsOnly:true});
          if(!current(id))return;
          if(run.id===activeId)setAttention(page.attention);
          if(!page.events.length)break;
          cursors.current.set(run.id,page.events.at(-1)!.seq);fresh.push(...page.events);
          let raw=rawEvents.current.get(run.id);if(!raw)rawEvents.current.set(run.id,raw=[]);raw.push(...page.events);
          for(const e of page.events){
            const turnId=typeof e.data.turnId==='string'?e.data.turnId:'';
            if(e.type==='prompt_started'&&turnId)openTurns.current.set(turnId,{seat:e.data.seat as Seat,runId:run.id});
            else if((e.type==='turn_ended'||e.type==='room_committed')&&turnId)openTurns.current.delete(turnId);
            else if(e.type==='run_ended')for(const [key,open] of openTurns.current)if(open.runId===run.id)openTurns.current.delete(key);
          }
        }while(page.events.length>=EVENT_PAGE);
        if(pages>EVENT_PAGES_PER_TICK)break;
        if(TERMINAL.has(run.status))finished.current.add(run.id);
      }
      if(fresh.length)setActivity(old=>activityProjection(old,fresh));
      // Something that changes the thread itself (a message, a status) has it re-read at once.
      if(fresh.some(e=>VIEW_EVENTS.has(e.type))){viewDirty.current=true;again.current=true;}
      const busySeats=[...openTurns.current.values()].filter(o=>o.runId===activeId),now={cli1:busySeats.some(o=>o.seat==='cli1'),cli2:busySeats.some(o=>o.seat==='cli2')};
      setWorking(old=>old.cli1===now.cli1&&old.cli2===now.cli2?old:now);
    }catch(e){
      // Only an unreachable service means reconnecting; a refusal is shown as it is, and cleared by the next good poll. A
      // thread that is gone (say after Clear history) gives way to the room's current one. An expired room link stops the
      // polling: every later call would fail the same way, and its message would come back after each dismissal (Q5).
      if(!(e instanceof RpcError)){lost.current=true;setConnected(false);setError(message(e));}
      else{setConnected(true);if(e.code==='AUTH')stopped.current=true;if(e.code==='NOT_FOUND'&&target)queueMicrotask(()=>select(''));else{pollFailed.current=true;setError(message(e));}}
    }
  }
  useEffect(()=>{
    void refresh();
    // No polling in a hidden tab (each New thread opens one); a tab shown again catches up at once (Q5).
    const tick=()=>{if(!document.hidden&&!stopped.current)void refresh();};
    const timer=setInterval(tick,400);document.addEventListener('visibilitychange',tick);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
  },[]);
  function select(id:string){
    const next=id&&id===roomThreadOf(threadsRef.current,pair?.id)?'':id;
    selectedRef.current=next;setSelected(next);setOptionsOpen(false);setRenaming(null);
    // Opening a thread (say from search) shows it in its own mode.
    const target=threadsRef.current.find(t=>t.id===id);if(target?.mode){modeRef.current=target.mode;setMode(target.mode);}
    const resolved=next||roomThreadOf(threadsRef.current,pair?.id);
    if(resolved!==shownRef.current){shownRef.current=resolved;resetThreadState();}
    void refresh();
  }
  async function action(label:string,fn:()=>Promise<void>){
    if(commandBusy.current)return;commandBusy.current=true;setBusy(label);setError('');
    try{await fn();threadsAt.current=0;viewAt.current=0;await refresh();}catch(e){pollFailed.current=false;setError(message(e));}
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
  const mismatch=!!thread&&!!thread.mode&&thread.mode!==mode,benchmark=mode==='benchmark',building=mode==='build',gaming=mode==='game';
  const uploading=files.some(f=>f.status==='uploading');
  // A running prompt or build takes no further messages: each agent answers the one prompt, then it ends.
  const benchmarkLive=live&&['benchmark','build'].includes(activeRun?.config.mode??thread?.mode??'');
  // In a Build session (no prompt yet, or a build), 1:1 lines may use scoped workspace file tools.
  const directTools=building&&(!thread?.mode||thread.mode==='build');
  // sendable: everything but the folder, which a prompt run from the library may bring itself.
  const sendable=isRoomThread&&ready&&!!shown&&!mismatch&&!benchmarkLive&&status!=='stopping'&&status!=='needs_attention'&&!directPending;
  const canSend=sendable&&(!building||buildKind==='build'||!!project.trim());
  // Each mode has its own thread and agents in this room (E9): switching shows that mode's current thread, and the
  // one left keeps running (or waiting) until it is closed.
  function switchMode(next:Mode){
    if(next===mode)return;modeRef.current=next;setMode(next);setOptionsOpen(false);
    if(selectedRef.current&&threadsRef.current.find(t=>t.id===selectedRef.current)?.mode!==next)select('');
    threadsAt.current=0;void refresh();
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

  async function send(saved?:{text:string;attachments:string[];buildKind:'build'|'review';debate?:DebateSetup;check?:AnswerCheck;project?:string;hunt?:HuntSetup}){
    const text=(saved?.text??draft).trim();if(!pair||!text||!sendable||busy||uploading)return;
    if(building&&(saved?.buildKind??buildKind)==='review'&&!(saved?.project??project).trim())return;
    const attachments=saved?.attachments??files.filter(f=>f.status==='ready'&&f.ref).map(f=>f.ref!.id);
    const kind=saved?.buildKind??buildKind;
    await action(live?'Sending':'Starting',async()=>{
      if(live&&pair.activeRunId){
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments]),'run.broadcast',{runId:pair.activeRunId,text,attachments},rpc);
      }else if(building){
        // Build: each agent gets its own copy of the project (or an empty folder); the time limit is the only option.
        // A Bug hunt loaded from the library brings its planted bugs, while the message box still holds its text.
        const huntSetup=kind==='review'?saved?.hunt??(hunt&&hunt.text.trim()===text?hunt.setup:undefined):undefined;
        const path=(saved?.project??project).trim(),options:Partial<RunConfig>={mode:'build',...(settings.profile?{profile:settings.profile}:{}),...(settings.minutes?{durationMs:Number(settings.minutes)*60000}:{})},build={kind,...(path?{path}:{}),...(huntSetup?{hunt:huntSetup}:{})};
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments,'build',options,build]),'run.start',{pairId:pair.id,text,options,attachments,build},rpc);
      }else if(benchmark){
        // Prompt: it goes to both agents at once, as written; only a time limit applies. A loaded challenge or race brings
        // its answer key, which AvA checks the answers against.
        const check=saved?.check??(answerKey&&answerKey.text.trim()===text?answerKey.check:undefined);
        const options:Partial<RunConfig>={mode:'benchmark',...(settings.profile?{profile:settings.profile}:{}),...(settings.minutes?{durationMs:Number(settings.minutes)*60000}:{}),...(check?{check}:{})};
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments,'benchmark',options]),'run.start',{pairId:pair.id,text,options,attachments},rpc);
      }else{
        // A debate prompt run from the library brings its own setup; otherwise the Options apply.
        const s=saved?.debate?debateSettings(saved.debate,settings):settings;
        // Each agent's internet, when a debate prompt or Options set it: its switch changes first (Codex and Grok Build
        // restart in the same session, keeping their memory).
        for(const seat of seats){const want=s.internet?.[seat];if(want!==undefined&&want!==internetOn(seat))await rpc('slot.internet',{pairId:pair.id,seat,enabled:want,requestId:crypto.randomUUID()});}
        const judge=s.judge??'claude';
        const options:Partial<RunConfig>={mode:'conversation',...(s.profile?{profile:s.profile}:{}),opening,instructions:s.instructions,stopWhen:s.stopWhen,paceMs:Number(s.pace||0)*1000,stances:s.stances??DEFAULT_STANCES,...(judge!=='off'?{judge:{provider:judge}}:{})};
        const speech=Number(s.speech??DEFAULT_SPEECH_MINUTES);if(speech>0)options.speechMs=speech*60_000;
        if(s.completion!=='auto')options.completion=s.completion;
        if(s.minutes){options.durationMs=Number(s.minutes)*60000;if(s.completion==='auto')options.completion='duration';}
        // The rounds apply when the debate ends by rounds: the default, unless a time is set here or in the prompt.
        if(s.rounds&&(s.completion==='rounds'||s.completion==='auto'&&!s.minutes))options.rounds=Number(s.rounds);
        if(s.requests)options.maxRequests=Number(s.requests);
        // The signature holds the options, so a retry with other settings (sides, rounds, judge) is a new start (Q5).
        await commands.execute(JSON.stringify(['send',pair.id,text,attachments,'conversation',options]),'run.start',{pairId:pair.id,text,options,attachments},rpc);
      }
      setDraft('');setFiles([]);setOptionsOpen(false);setAnswerKey(null);setHunt(null);liveRef.current=true;
    });
  }
  // Gamer mode (J3): a game starts as its own run (and thread), titled with its game and players.
  async function startGame(setup:GameSetup,profile?:RunProfile){
    if(!pair||!ready||busy)return;
    const text=gameTitle(setup,{cli1:agentName('cli1'),cli2:agentName('cli2')}),options:Partial<RunConfig>={mode:'game',game:setup,paceMs:1000,...(profile?{profile}:{})};
    await action('Starting',async()=>{await commands.execute(JSON.stringify(['send',pair.id,text,[],'game',options]),'run.start',{pairId:pair.id,text,options,attachments:[]},rpc);liveRef.current=true;});
  }
  function promptRunBlocked(savedMode:PromptMode,kind:'build'|'review',folder?:string){
    if(commands.hasPending)return 'Resolve the pending send from the composer before running another prompt.';
    if(busy||uploading)return 'Wait for the current operation to finish.';
    if(!ready)return 'Activate both agents to run a prompt. You can still save or load one.';
    if(live)return 'Wait for the current run to finish, or load this prompt for later.';
    if(savedMode!=='all'&&savedMode!==mode)return `Load this prompt to switch to ${MODE_NAMES[savedMode]} mode first.`;
    if(building&&kind==='review'&&!(folder??project).trim())return 'Enter the repository to hunt in before running a bug hunt.';
    if(!sendable)return 'Open a ready session in this mode, or load the prompt for later.';
    return '';
  }
  async function useSavedPrompt({prompt,attachments}:PreparedPrompt,run:boolean){
    if(commands.hasPending)throw new Error('A send has an unknown outcome. Resolve it from the composer before loading another prompt.');
    if(run){const blocked=promptRunBlocked(prompt.mode,prompt.buildKind,prompt.build?.project);if(blocked)throw new Error(blocked);}
    // A debate prompt sets up the next debate. With one running, its topic would only join that conversation.
    if(prompt.debate&&mode==='conversation'&&live)throw new Error('A debate is running. Stop it or close the thread, then load this debate prompt.');
    setDraft(prompt.text);setFiles(attachments.map(ref=>({key:ref.id,name:ref.name,size:ref.size,status:'ready',ref})));setBuildKind(prompt.buildKind);
    if(prompt.debate){const setup=prompt.debate;setSettings(s=>debateSettings(setup,s));setPresetId('');}
    setAnswerKey(prompt.check?{text:prompt.text,check:prompt.check}:null);
    // A Build prompt fills in its folder (an app's starting point, or the repository to hunt in), and a scored hunt its bugs.
    if(prompt.mode==='build'&&prompt.build?.project)setProject(prompt.build.project);
    setHunt(prompt.build?.hunt&&prompt.buildKind==='review'?{text:prompt.text,setup:prompt.build.hunt}:null);
    if(run)await send({text:prompt.text,attachments:attachments.map(f=>f.id),buildKind:prompt.buildKind,...(prompt.debate?{debate:prompt.debate}:{}),...(prompt.check?{check:prompt.check}:{}),...(prompt.build?.project?{project:prompt.build.project}:{}),...(prompt.build?.hunt?{hunt:prompt.build.hunt}:{})});
    else{if(prompt.mode!=='all')switchMode(prompt.mode);select('');setPanel('chat');setOptionsOpen(false);setTimeout(()=>composerRef.current?.focus(),0);}
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
  // Which setup menu is open for each agent, at which screen ('home', or 'provider' to change the CLI).
  const [setup,setSetup]=useState<Partial<Record<Seat,string|false>>>({});
  const toggleSetup=(seat:Seat,phase='home')=>setSetup(s=>({...s,[seat]:s[seat]===phase?false:phase}));
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
    try{
      await rpc('slot.internet',{pairId:pair.id,seat,enabled:!internetOn(seat),requestId:crypto.randomUUID()});threadsAt.current=0;void refresh();
      // The switch is the latest word: a debate prompt's or the Options' choice for this agent no longer applies.
      setSettings(s=>{if(s.internet?.[seat]===undefined)return s;const {[seat]:_,...rest}=s.internet;return {...s,internet:rest};});
    }
    catch(e){setError(message(e));}finally{setSwitchingNet(n=>({...n,[seat]:false}));}
  }
  function control(which:'pause'|'resume'|'step'|'stop'){const runId=pair?.activeRunId;if(runId)void action(which,async()=>{await controlCommands.execute(JSON.stringify(['control',runId,which]),'run.control',{runId,action:which},rpc);});}
  // A judged debate's result in the thread list (C).
  const verdictText=(v?:ThreadSummary['verdict'])=>!v?'':v.kind==='game'?(v.winner?` · Agent ${v.winner==='cli1'?1:2} won`:' · draw'):v.kind==='hunt'?(v.winner?` · Agent ${v.winner==='cli1'?1:2} found ${v.found![v.winner]} of ${v.planted}`:` · no planted bug found`):v.kind==='challenge'||v.kind==='race'?(v.winner?` · Agent ${v.winner==='cli1'?1:2} won the ${v.kind}`:` · no right answer`)
    :v.status==='judging'?' · judging':v.status==='failed'?' · not judged':v.ballots?` · Agent ${v.winner==='cli1'?1:2} won, ${v.ballots.won} of ${v.ballots.of} ballots`:` · Agent ${v.winner==='cli1'?1:2} won ${v.totals![v.winner!]}–${v.totals![v.winner==='cli1'?'cli2':'cli1']}`;
  // Delete one thread from history (D): its prompts, replies, 1:1 messages and ballot. A thread whose agents are still
  // active must be closed first.
  function deleteThread(t:ThreadSummary){
    setDialog({title:'Delete this thread?',confirm:'Delete thread',body:`“${t.title||'Untitled'}” and everything in it (prompts, replies, 1:1 messages and the judge’s ballot) are deleted from history. This can’t be undone.`,
      run:()=>void action('Deleting thread',async()=>{await rpc('thread.delete',{threadId:t.id,requestId:crypto.randomUUID()});if(selectedRef.current===t.id){selectedRef.current='';setSelected('');}threadsAt.current=0;})});
  }
  // Close thread (E8): the conversation stops, both agents close (and any app server they left running), and the thread
  // stays in history. The next thread keeps both agents' settings: Activate both starts them again.
  function closeThread(){
    if(!pair)return;
    setOptionsOpen(false);
    setDialog({title:'Close this thread?',confirm:'Close thread',
      body:`Both agents close, and any app server they left running stops. The thread stays in your history. The next thread keeps both agents' settings, ready to activate.`,
      run:()=>void action('Closing thread',async()=>{
        await threadCommands.execute(`close:${pair.id}:${pair.slots.cli1.generation}:${pair.slots.cli2.generation}:${pair.activeRunId??pair.lastRunId??'none'}`,'pair.close',{pairId:pair.id},rpc);
        selectedRef.current='';setSelected('');setPanel('chat');
      })});
  }
  // Quick activate: each agent's last settings, or the strongest model at high effort with Ask permissions and internet off
  // (one short access check each; asked first when many threads are live).
  const quickText=(seat:Seat)=>{const plan=pair?.quick?.[seat];return plan?describeQuick(plan,names[plan.provider]??plan.provider):'';};
  async function quickActivate(which:Seat[]){
    if(!pair||!which.length||!(await confirmActivate()))return;
    void action(which.length>1?'Quick-activating both agents':'Quick-activating',async()=>{
      const results=await Promise.allSettled(which.map(seat=>rpc('slot.quick',{pairId:pair.id,seat})));
      const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult|undefined;if(failed)throw failed.reason;
    });
  }
  // Activate both: both agents' saved settings, one short access check each (asked first when many threads are live).
  async function activateBoth(){
    if(!pair||!(await confirmActivate()))return;
    void action('Activating both agents',async()=>{await Promise.all(seats.filter(s=>pair.slots[s].state!=='ready'&&pair.slots[s].state!=='verifying').map(seat=>rpc('slot.activate',{pairId:pair.id,seat})));});
  }
  // Clear Session: both agents get fresh sessions and forget everything; the old thread stays in the list.
  function clearSession(){
    if(!pair)return;
    const current=threadsRef.current.find(t=>t.pairId===pair.id&&t.current);
    if(current?.empty){select(current.id);composerRef.current?.focus();return;}
    setOptionsOpen(false);
    setDialog({title:'Clear Session?',confirm:'Clear Session',
      body:`${pair.activeRunId?'The running conversation stops first. ':''}Both agents start fresh sessions and forget this thread, and any app server they left running stops. The thread stays in the list. Each agent makes one short access check.`,
      run:()=>void action('Clearing session',async()=>{
        await threadCommands.execute(`clear:${pair.id}:${pair.slots.cli1.generation}:${pair.slots.cli2.generation}:${pair.activeRunId??pair.lastRunId??'none'}`,'pair.clear',{pairId:pair.id},rpc);
        selectedRef.current='';setSelected('');setPanel('chat');
      })});
  }
  // Clear history: every saved thread in this data folder goes, with its 1:1 messages, attachments and the agents'
  // working folders; this room's agents start fresh sessions.
  function clearHistory(){
    if(!pair)return;setOptionsOpen(false);
    setDialog({title:'Clear all history?',confirm:'Delete history',destructive:true,
      body:'This permanently deletes every saved thread, from every chat that shares this data folder: conversation prompts, replies, 1:1 messages, attachments, and the agents’ working folders with everything they built. App servers they left running stop, and both agents here start fresh sessions. The saved prompt library stays. Deleting history can’t be undone.',
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
  function applyPreset(id:string){setPresetId(id);const preset=presets.find(p=>p.id===id);if(preset){const {opening:first,...data}=preset.data;setSettings({...DEFAULT_SETTINGS,...data});if(first)setOpening(first);}}
  async function savePreset(){
    const name=presetName?.trim();if(!name)return;
    await action('Saving preset',async()=>{const saved=await rpc<{id:string}>('preset.save',{requestId:crypto.randomUUID(),name,data:{...settings,opening}});await loadPresets();setPresetId(saved.id);setPresetName(null);});
  }
  async function deletePreset(){
    const preset=presets.find(p=>p.id===presetId);if(!preset)return;
    await action('Deleting preset',async()=>{await rpc('preset.delete',{requestId:crypto.randomUUID(),id:preset.id});setPresetId('');await loadPresets();});
  }
  // Only what this mode's sheet shows counts (Prompt and Build have just a time limit).
  const customized=benchmark||building?settings.minutes!=='':JSON.stringify(settings)!==JSON.stringify(DEFAULT_SETTINGS);
  // How the next debate ends, for the rounds chip: its rounds unless a time (in Options or the prompt, "…for 5 minutes")
  // or the agents' own choice ends it instead (the same rule as send and conversationConfig).
  const promptTime=draft.trim().match(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|seconds?|secs?|s)\s*[.!]?$/i);
  const roundsValue=Number(settings.rounds)||DEFAULT_ROUNDS;
  const byRounds=settings.completion==='rounds'||settings.completion==='auto'&&!settings.minutes&&!promptTime;
  const endsLabel=byRounds?`${roundsValue} rounds`:settings.completion==='either'||settings.completion==='both'?'Until done'
    :settings.minutes?`${settings.minutes} min`:promptTime?`${promptTime[1]} ${/^s/i.test(promptTime[2]!)?'s':'min'}`:'20 min';
  // Picking rounds makes the debate end by them, even if a time was set (the time then only bounds it).
  function chooseRounds(n:number){
    setSettings(s=>({...s,rounds:String(n),...(s.completion==='auto'&&!s.minutes&&!promptTime?{}:{completion:'rounds' as const,minutes:''})}));setPresetId('');
  }
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
  const gameRun=shown?.runs.filter(r=>r.config.mode==='game').at(-1)??null,gameMoves=gameRun?(shown?.messages??[]).filter(m=>m.runId===gameRun.id&&m.sender!=='user'&&m.state==='committed').map(m=>m.text):[];
  // Close thread: while the thread has an agent active (or starting) or a conversation running. Activate both: once both
  // agents have settings (a model chosen) and neither is active.
  const canClose=roomView&&!!pair&&(seats.some(s=>['ready','verifying'].includes(pair.slots[s].state))||!!pair.activeRunId)&&pair.activeRun?.status!=='needs_attention';
  const canActivateBoth=roomView&&!!pair&&seats.every(s=>!!pair.slots[s].config?.model&&!['ready','verifying'].includes(pair.slots[s].state));
  const canQuickBoth=roomView&&!!pair?.quick&&seats.every(s=>!['ready','verifying'].includes(pair.slots[s].state));
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
    if(live&&pair.activeRun?.mode==='conversation'){
      if(pair.activeRun.status==='paused')return {text:'Paused',tone:''};
      if(pair.activeRun.status==='stopping')return {text:'Stopping',tone:''};
      if(pair.activeRun.status==='needs_attention')return {text:'Needs attention',tone:'off'};
      if(pair.activeRun.speaking?.includes(seat))return {text:'Speaking',tone:'busy'};
      return {text:!pair.activeRun.speaking?.length&&pair.activeRun.nextSeat===seat?'Up next':'Waiting',tone:''};
    }
    if(working[seat])return {text:'Thinking',tone:'busy'};
    return {text:live?'Waiting':'Ready',tone:''};
  }
  const turnRun=roomView&&pair?.activeRun?.mode==='conversation'?pair.activeRun:null;
  const turnLabel=(s:Seat)=>`Agent ${SEAT_NUMBER[s]} (${agentName(s)})`;
  const turnNote=roomView&&mode==='conversation'?(turnRun
    ?`${turnRun.speaking?.length?`Speaking: ${turnRun.speaking.map(turnLabel).join(' and ')}`:`Next: ${turnLabel(turnRun.nextSeat??'cli1')}`}${turnRun.queued?` · ${turnRun.queued} prompt${turnRun.queued===1?'':'s'} queued for the next turn`:''}`
    :opening==='both'?'Both agents open independently, then alternate':`${turnLabel(opening)} opens, then agents alternate`):'';

  // The channel: messages grouped Slack-style, with day separators and a quiet note where each prompt ended.
  const messages=shown?(activeReplay?shown.messages.filter(m=>(activeReplay.offsets[m.id]??0)<=activeReplay.clock):shown.messages):[];
  const feed:ReactNode[]=[];
  {
    let prev:ThreadMessage|undefined,lastDay='';
    const endNote=(runId:string)=>{const run=runById.get(runId);if(run&&TERMINAL.has(run.status)&&replayDone){feed.push(<div className="run-end" key={'end'+run.id}><span>{reasonText(run.reason)||statusNames[run.status]}</span><span>{duration(run.elapsedMs)}</span></div>);
      if(run.config.check)feed.push(<PromptResult key={'result'+run.id} run={run}/>);
      if(run.config.build?.planted)feed.push(<HuntResult key={'hunt'+run.id} run={run}/>);
      if(run.config.stances)feed.push(<Ballot key={'ballot'+run.id} run={run} canJudge={isRoomThread} busy={!!busy} onJudge={()=>void action('Asking the judge',async()=>{await rpc('debate.judge',{runId:run.id});})} onCheckOrder={()=>void action('Checking presentation order',async()=>{const client=new CommandClient(sessionStorage,'ava-judge-order:'+roomId+':'+run.id);await client.execute(JSON.stringify({runId:run.id}),'debate.checkOrder',{runId:run.id},rpc);})} onCancelOrder={()=>void action('Cancelling order check',async()=>{await rpc('debate.cancelOrderCheck',{runId:run.id,requestId:crypto.randomUUID()});})}/>);}};
    for(const m of messages){
      const day=m.time?new Date(m.time).toDateString():lastDay;
      if(prev&&prev.runId!==m.runId){endNote(prev.runId);prev=undefined;}
      if(day&&day!==lastDay){feed.push(<div className="day" key={'day'+m.id}><span>{dayLabel(m.time)==='Today'?'Today':fullDate(m.time)}</span></div>);lastDay=day;prev=undefined;}
      const continued=!!prev&&prev.sender===m.sender&&(!m.time||!prev.time||Date.parse(m.time)-Date.parse(prev.time)<300_000);
      const who=senderOf(m),note=delivery(m),run=runById.get(m.runId);
      // In a prompt or build, each answer shows how long it took from the moment both agents got the prompt.
      const took=(run?.config.mode==='benchmark'||run?.config.mode==='build')&&m.sender!=='user'&&m.time&&run.createdAt?Date.parse(m.time)-Date.parse(run.createdAt):null;
      // A build run's prompt says where each agent works.
      const b=run?.config.build,copyNote=m.sender==='user'&&b&&shown?.messages.find(x=>x.runId===run.id)?.id===m.id?(b.source?`Each agent ${b.kind==='review'?'hunts in':'works on'} its own copy of ${b.source}`:'Each agent builds in its own folder'):'';
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
  // A debate's current round (G1): the round the agent who has spoken least is on.
  const round=(runId:string,rounds:number)=>Math.min(rounds,Math.min(...seats.map(s=>shown?.messages.filter(m=>m.runId===runId&&m.sender===s).length??0))+1);
  const subtitle=!thread?'':thread.empty?(ready?`Fresh session · both agents are ready${benchmark?' for a prompt':building?(buildKind==='review'?' for a bug hunt':' to build'):''}`:'Waiting for both agents')
    :live&&activeRun?(activeRun.config.mode==='build'?[status==='running'?(activeRun.config.build?.kind==='review'?'Hunting':'Building'):statusNames[status??'']??status,`${duration(activeRun.elapsedMs)} of ${duration(activeRun.config.durationMs)}`,`${answered} of 2 reports`]
      :activeRun.config.mode==='benchmark'?[status==='running'?'Answering':statusNames[status??'']??status,duration(activeRun.elapsedMs),`${answered} of 2 answers`]
      :activeRun.config.mode==='game'?[status==='running'?'Playing':statusNames[status??'']??status,duration(activeRun.elapsedMs),`Move ${Math.floor(gameMoves.length/2)+1}`]
      :[statusNames[status??'']??status,`${duration(activeRun.elapsedMs)}${activeRun.config.completion==='duration'?` of ${duration(activeRun.config.durationMs)}`:''}`,activeRun.config.completion==='rounds'&&activeRun.config.rounds?`Round ${round(activeRun.id,activeRun.config.rounds)} of ${activeRun.config.rounds}`:`${activeRun.requests} of ${activeRun.config.maxRequests} requests`]).join(' · ')
    :isRoomThread?`${plural(thread.prompts,thread.mode==='game'?'game':'prompt')} · ready for the next one`
    :`${plural(thread.prompts,thread.mode==='game'?'game':'prompt')} · ${shortTime(thread.updatedAt)} · read-only`;
  const placeholder=!ready?'Activate both agents to start':directPending?'Waiting for a private reply…':benchmarkLive?'Both agents are answering…':live?(paused?'Message both agents. Each replies once, then they pause again':'Message both agents')
    :building?(buildKind==='review'?(project.trim()?'What should both agents hunt for? For example: bugs in the command parser':'Enter the repository to hunt in first'):'What should both agents build? For example: a Snake game playable with the arrow keys')
    :benchmark?'Prompt for both agents. They get it at the same moment':thread?.empty?'Give both agents a topic':'Send the next prompt. Both agents remember this thread';
  // Each mode lists its own threads; a fresh, unused session shows in both.
  // One history for every mode (E9), each thread labeled with its mode. Another mode's fresh session isn't a thread yet.
  const listed=threads.filter(t=>!t.empty||t.pairId===pair?.id);
  const grouped=new Map<string,ThreadSummary[]>();for(const t of listed){const key=t.empty?'Today':dayLabel(t.updatedAt),list=grouped.get(key);if(list)list.push(t);else grouped.set(key,[t]);}
  const lines=(seat:Seat)=>activity.filter(l=>l.seat===seat&&!(l.type==='status'&&QUIET_STATUS.test(l.text)));

  return <div className="app">
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand"><span>Agent vs Agent</span>{pair?.version&&<span className="version" title={`Agent vs Agent ${pair.version}: the version of the service running this room`}>v{pair.version}</span>}{pair?.mode==='simulation'&&<span className="pill">Simulation</span>}</div>
        <button className="icon-btn" aria-label={`New ${MODE_NAMES[mode]} thread`} title={`New ${MODE_NAMES[mode]} thread: a clean page with its own two agents`} onClick={()=>void newThread()}><Icon.compose/></button>
      </div>
      <div className="mode-switch" role="radiogroup" aria-label="Mode">
        {([['benchmark','Prompt',<Icon.prompt key="i"/>,'Both agents get the same prompt at the same moment; compare answers and speed'],['conversation','Debate',<Icon.chat key="i"/>,'The agents debate each other: prime each with its 1:1 line, then give them a topic'],
          ['build','Build',<Icon.build key="i"/>,'Both agents build the same app, each in its own folder, then compare them side by side. Or have both review a project'],
          ['game','Gamer',<Icon.game key="i"/>,'The agents play a board game against each other: chess, checkers, Go or Crosscurrent, with AvA as the referee']] as const).map(([value,label,icon,tip])=>
          <button key={value} role="radio" aria-checked={mode===value} title={tip} onClick={()=>switchMode(value)}>{icon}<span>{label}</span></button>)}
      </div>
      <div className={`sidebar-tools${mode==='game'?' two':''}`} role="group" aria-label="Room tools">
        <button className="library-open" onClick={()=>setLibrary('browse')}><Icon.folder/><span>Prompt library</span></button>
        {/* The builder for this mode's prompts: Debate's and Prompt's guided setups, a simple form for Build. A game is set
            up beside its board, so Gamer has none. */}
        {mode!=='game'&&<button className="library-open" onClick={()=>setBuilderOpen(true)}><Icon.pencil/><span>{mode==='conversation'?'Debate builder':mode==='build'?'Build builder':'Prompt builder'}</span></button>}
        {/* Settings (owner, 2026-10-04): the agent limit and Stop all, for every room. */}
        <button className="library-open" onClick={()=>setResourcesOpen(true)}><Icon.gear/><span>Settings</span></button>
      </div>
      <div className="sidebar-search">
        <label className="search"><Icon.search/><input type="search" placeholder="Search" aria-label="Search every thread" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQuery('');}}/></label>
      </div>
      <nav className="threads" aria-label={hits?'Search results':`${MODE_NAMES[mode]} threads`}>
        {hits?(hits.results.length?hits.results.map(hit=><button key={hit.messageId} className="hit" onClick={()=>openHit(hit)}>
          <span className="hit-who">{hit.sender==='user'?'You':names[hit.participants?.[hit.sender as Seat]?.provider??'']??hit.sender}</span>
          <span className="hit-text"><Highlight text={hit.snippet} query={hits.query}/></span>
          <span className="hit-thread">{hit.runTopic} · {shortTime(hit.runCreatedAt)}</span>
        </button>):<p className="threads-empty">No messages match “{hits.query}”.</p>)
        :listed.length?[...grouped].map(([day,list])=><section key={day}><h2>{day}</h2>{list.map(t=><div key={t.id} className="thread-row"><button className="thread" aria-current={t.id===threadId?'true':undefined} onClick={()=>{select(t.id);}} onDoubleClick={()=>{select(t.id);setRenaming(t.named?t.title:'');}}>
          <span className="thread-top"><span className="thread-title">{t.named||!t.empty?t.title||'Untitled':t.current?'New session':'Private messages only'}</span><time>{shortTime(t.updatedAt)}</time></span>
          <span className="thread-meta">{t.live&&<span className="live-dot" title="Live"/>}<span className={`thread-mode ${t.mode??mode}`}>{MODE_NAMES[t.mode??mode]}</span>{t.participants?`${names[t.participants.cli1.provider]} · ${names[t.participants.cli2.provider]}`:'Agents not recorded'}{t.empty?'':` · ${plural(t.prompts,t.mode==='game'?'game':'prompt')}`}{t.directMessages?' · 1:1':''}{verdictText(t.verdict)}</span>
        </button>
        {/* Shown on hover (D): deletes this thread from history, after a confirmation. */}
        {!t.empty&&<button className="thread-delete" aria-label={`Delete thread: ${t.title||'Untitled'}`} title="Delete this thread" onClick={()=>deleteThread(t)}><Icon.trash/></button>}</div>)}</section>)
        :<p className="threads-empty">Threads appear here.</p>}
      </nav>
    </aside>

    {/* Results use the same resizable upper/lower split; their prompt row stays below the apps. */}
    {resourcesOpen&&<ResourcesPanel onClose={()=>setResourcesOpen(false)}/>}
    {benchmarksOpen&&<BenchmarksPanel pair={pair} onClose={()=>setBenchmarksOpen(false)}/>}
    {puzzlesOpen&&<PuzzlesPanel pair={pair} onClose={()=>setPuzzlesOpen(false)}/>}
    {seriesOpen&&<SeriesPanel pair={pair} onClose={()=>setSeriesOpen(false)} onOpen={select}/>}
    <main ref={workspaceRef} className={`workspace${resultsRun?' results-mode':''}`} style={{'--split-a':`${layout.split}fr`,'--split-b':`${1-layout.split}fr`,'--split-top':`${layout.height}fr`,'--split-bottom':`${1-layout.height}fr`} as CSSProperties}>
      <section ref={agentsRef} className="agents" aria-label="Agent activity">
        {seats.flatMap((seat,i)=>{const who=identity(seat),state=paneStatus(seat),own=lines(seat),slot=pair?.slots[seat];const pane=<article key={seat} className={`agent ${seat}`} aria-label={`Agent ${i+1} activity`}>
          <header><span className="seat-dot"/>
            {/* Once active, the name opens the setup menu. Before that, a chosen CLI's name opens the list of CLIs (it can
                change at any time), beside Activate. */}
            {roomView&&slot?(slot.state==='ready'?<button className="agent-name" aria-expanded={!!setup[seat]} title="Change the CLI, model, effort or permissions" onClick={()=>toggleSetup(seat)}><strong>{agentName(seat)}</strong><Icon.chevron/></button>
              :slot.state==='verifying'?<strong>{agentName(seat)}</strong>
              :<>{slot.config&&<button className="agent-name" aria-expanded={setup[seat]==='provider'} title="Change the CLI" onClick={()=>toggleSetup(seat,'provider')}><strong>{names[slot.config.provider]??slot.config.provider}</strong><Icon.chevron/></button>}
                <button className="activate-btn" aria-expanded={setup[seat]==='home'} onClick={()=>toggleSetup(seat)}>{slot.state==='failed'?'Activate again':'Activate'}</button>
                {pair?.quick?.[seat]&&<button className="quick-btn" aria-label={`Quick activate Agent ${i+1}: ${quickText(seat)}`} title={`Quick activate: ${quickText(seat)}. One short model request.`} disabled={!!busy} onClick={()=>void quickActivate([seat])}><Icon.bolt/>Quick</button>}</>)
            :<strong>{agentName(seat)}</strong>}
            <span className="agent-model">{[who?.modelName??who?.model,who?.effort?.value].filter(Boolean).join(' · ')||(roomView?`Agent ${i+1}`:'Not set up')}</span>
            {roomView&&slot?.permissions==='bypass'&&<span className="bypass-tag" title="Permissions: bypass. AvA approves every tool request this agent makes.">Bypass</span>}
            {roomView&&internetOn(seat)&&<span className="net-tag" title="Internet on"><Icon.globe/></span>}<span className={`agent-status ${state.tone}`}>{state.text}</span>
            {roomView&&slot?.state==='ready'&&<UsageRing name={agentName(seat)} provider={slot.config?.provider} usage={pair?.usage?.[seat]}/>}</header>
          {roomView&&pair&&setup[seat]&&<AgentSetup key={setup[seat]||'home'} pairId={pair.id} seat={seat} startPhase={setup[seat]||undefined} onClose={()=>setSetup(s=>({...s,[seat]:false}))} onError={setError} confirmActivate={confirmActivate}/>}
          <Scroller className="activity" label={`Agent ${i+1} activity`}>{own.length?own.map(line=><div key={line.key} className={`line ${line.type}`}><span className="line-type">{LINE_LABEL[line.type]??line.type}{line.late?' · late':''}</span><pre>{line.shown??line.text}</pre></div>)
            :<p className="pane-empty">{isRoomThread?'Thinking and tool use appear here as they happen.':'No recorded activity.'}</p>}</Scroller>
        </article>;return i?[pane]:[pane,<div key="split" className="split-handle" role="separator" aria-orientation="vertical" aria-label="Resize the agent panes" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.split*100)} tabIndex={0} title="Drag to resize · double-click to reset" onPointerDown={dragSplit} onKeyDown={e=>nudge(e,'split')} onDoubleClick={()=>setLayout(l=>({...l,split:DEFAULT_LAYOUT.split}))}/>];})}
      </section>
      <div className="row-handle" role="separator" aria-orientation="horizontal" aria-label="Resize the CLI and lower panes" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(layout.height*100)} aria-valuetext={`${Math.round(layout.height*100)}% CLI panes`} tabIndex={0} title="Drag up or down to resize · double-click to reset" onPointerDown={dragHeight} onKeyDown={e=>nudge(e,'height')} onDoubleClick={()=>setLayout(l=>({...l,height:DEFAULT_LAYOUT.height}))}/>

      <section ref={channelRef} className={`channel${dropping?' dropping':''}`} aria-label="Conversation"
        onDragOver={e=>{if(canSend&&e.dataTransfer.types.includes('Files')){e.preventDefault();setDropping(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropping(false);}}
        onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();setDropping(false);if(canSend)void addFiles(e.dataTransfer.files);}}>
        <header className="channel-head">
          <div className="channel-title">{renaming!==null&&thread?<form onSubmit={e=>{e.preventDefault();void rename(renaming);}}><input className="rename" autoFocus aria-label="Thread name" maxLength={120} placeholder={thread.runIds.length?'Name (empty uses the first prompt)':'Name this session'} value={renaming} onChange={e=>setRenaming(e.target.value)} onBlur={()=>void rename(renaming)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRenaming(null);}}}/></form>
            :<h1 title={thread?'Double-click to rename':undefined} onDoubleClick={()=>thread&&setRenaming(thread.named?thread.title:'')}>{thread?(thread.named||!thread.empty?thread.title||'Untitled':thread.current?'New session':'Private messages only'):'Agent vs Agent'}</h1>}{subtitle&&<p className={live?'live':undefined}>{live&&<span className="live-dot"/>}{subtitle}</p>}{turnNote&&<p role="status" aria-label="Debate turn order">{turnNote}</p>}</div>
          <div className="toolbar">
            {gaming&&<button className="button small" onClick={()=>setPuzzlesOpen(true)}>Puzzles</button>}
            {(gaming||mode==='conversation')&&<button className="button small" onClick={()=>setSeriesOpen(true)}>Series</button>}
            {resultsRun&&<><ResultsTabs runs={buildRuns} runId={resultsRun.id} tab={resultsTab} onChange={setResults}/><span className="toolbar-divider"/></>}
            {live&&<>{!benchmarkLive&&<><button className="icon-btn" aria-label={paused?'Resume':'Pause'} title={paused?(directPending?'Waiting for a private reply':'Resume'):'Pause after the current replies'} disabled={!!busy||status!=='running'&&status!=='paused'||paused&&directPending} onClick={()=>control(paused?'resume':'pause')}>{paused?<Icon.play/>:<Icon.pause/>}</button>
              <button className="icon-btn" aria-label="Next reply" title="Next reply (while paused)" disabled={!!busy||!paused||directPending} onClick={()=>control('step')}><Icon.next/></button></>}
              <button className="icon-btn" aria-label="Stop" title="Stop" disabled={!!busy||status==='stopping'||status==='needs_attention'} onClick={()=>control('stop')}><Icon.stop/></button>
              <span className="toolbar-divider"/></>}
            {buildRuns.length>0&&<button className={`icon-btn${panel==='results'?' pressed':''}`} aria-pressed={panel==='results'} aria-label="Results" title={panel==='results'?'Back to the conversation':'Results: both apps side by side, and what each changed'}
              onClick={()=>{if(panel==='results'){setPanel('chat');return;}const last=buildRuns.at(-1)!;openResults(results&&buildRuns.some(r=>r.id===results.runId)?results.runId:last.id,results?.tab??(last.config.build?.kind==='review'?'changes':'preview'));}}>{panel==='results'?<Icon.chat/>:<Icon.window/>}</button>}
            {canClose&&<button className="button small close-thread" aria-label="Close thread" title="Stop the conversation and close both agents; the thread stays in history" disabled={!!busy} onClick={closeThread}>Close thread</button>}
            <button className={`icon-btn${panel==='stats'?' pressed':''}`} aria-pressed={panel==='stats'} aria-label="Stats" title={panel==='stats'?'Back to the conversation':'Stats'} disabled={!promptCount} onClick={()=>setPanel(p=>p==='stats'?'chat':'stats')}>{panel==='stats'?<Icon.chat/>:<Icon.chart/>}</button>
            <Menu label="More" icon={<Icon.more/>} items={[
              {label:'Benchmarks',icon:<Icon.prompt/>,onSelect:()=>setBenchmarksOpen(true)},
              {label:'Rename',icon:<Icon.pencil/>,disabled:!thread,onSelect:()=>thread&&setRenaming(thread.named?thread.title:'')},
              {label:'Replay',icon:<Icon.replay/>,disabled:live||!shown?.messages.length,onSelect:startReplay},
              {label:'Export JSON',icon:<Icon.download/>,disabled:!promptCount,onSelect:()=>void exportThread('json')},
              {label:'Export Markdown',icon:<Icon.download/>,disabled:!promptCount,onSelect:()=>void exportThread('md')},
              'divider',
              {label:'Close thread',icon:<Icon.close/>,disabled:!!busy||!canClose,onSelect:closeThread},
              {label:'Clear Session',icon:<Icon.compose/>,disabled:!!busy||!canClear,onSelect:clearSession},
              {label:'Clear history…',icon:<Icon.trash/>,destructive:true,disabled:!!busy||!!pair?.activeRunId||!threads.some(t=>!t.empty),onSelect:clearHistory},
            ]}/>
          </div>
        </header>
        {!connected&&<div className="notice"><Icon.refresh/><span>Reconnecting to AvA…</span></div>}

        {panel==='stats'?<div className="feed"><StatsView stats={stats} names={names} loading={!!promptCount}/></div>
        :gaming&&!mismatch&&(gameRun||roomView&&ready)?<GameView run={gameRun} moves={gameMoves} live={!!gameRun&&live&&gameRun.id===pair?.activeRunId} speaking={pair?.activeRun?.speaking??[]} names={{cli1:agentName('cli1'),cli2:agentName('cli2')}}
            canStart={roomView&&ready&&!live} blocked={!roomView?'Open the room’s current thread to start a game.':!ready?'Activate both agents first.':live?'A game is running.':''} busy={!!busy} onStart={startGame} pairId={pair?.id} agents={{cli1:pair?.slots.cli1.config,cli2:pair?.slots.cli2.config}}/>
        :resultsRun?<ResultsView run={resultsRun} tab={resultsTab} live={live&&resultsRun.id===pair?.activeRunId} agentName={agentName} reported={{cli1:!!shown?.messages.some(m=>m.runId===resultsRun.id&&m.sender==='cli1'),cli2:!!shown?.messages.some(m=>m.runId===resultsRun.id&&m.sender==='cli2')}}/>
        :<Scroller className="feed" label="Messages" role="log" follow={!focusedId}>
          {mismatch&&thread?<div className="empty">
            <h2>{MODE_NAMES[mode]} starts in a fresh session</h2>
            <p>This chat’s agents are in a {MODE_NAMES[thread.mode!].toLowerCase()} thread, “{thread.title||'Untitled'}”. Clear Session gives both agents fresh sessions for {MODE_NAMES[mode].toLowerCase()}; the {MODE_NAMES[thread.mode!].toLowerCase()} thread stays in its own list.</p>
            <div className="empty-actions"><button className="button primary" disabled={!!busy||!canClear} onClick={clearSession}>Clear Session</button><button className="button" onClick={()=>switchMode(thread.mode!)}>Back to {MODE_NAMES[thread.mode!]}</button></div>
          </div>
          :feed.length?feed:(shown||!threadId)&&<div className="empty">
            {!pair?<><h2>Agent vs Agent</h2><p>Open this room with <kbd>/ava start</kbd> in Codex or <kbd>/agent-vs-agent:ava start</kbd> in Claude Code.</p></>
            :!ready&&roomView||!thread?<><h2>Activate both agents</h2><p>{canActivateBoth?'Both agents keep the settings they had. Activate them together, or change either one with Activate above its screen. Each activation sends one short request to check access.':<><strong>Quick activate</strong> uses each agent’s last settings, or the strongest model at high effort with Ask permissions and internet off. Or use <strong>Activate</strong> above each agent’s screen to choose its CLI, model, effort and permissions. Each activation sends one short request to check access.</>}</p>
              {(canActivateBoth||canQuickBoth)&&<div className="empty-actions">{canQuickBoth&&<button className="button primary" disabled={!!busy} title={seats.map((s,i)=>`Agent ${i+1}: ${quickText(s)}`).join('\n')} onClick={()=>void quickActivate(seats.filter(s=>!['ready','verifying'].includes(pair!.slots[s].state)))}><Icon.bolt/> Quick activate both</button>}{canActivateBoth&&<button className="button" disabled={!!busy} onClick={()=>void activateBoth()}>Activate both</button>}</div>}
              {canQuickBoth&&<p className="quick-note">{seats.map((s,i)=><span key={s}>Agent {i+1}: {quickText(s)}</span>)}</p>}</>
            :building&&buildKind==='review'?<><h2>Bug hunt with {agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Each agent gets its own copy of the repository below (its files, without the git history) and hunts in it; your original is never touched. Both start at the same moment and report each bug they find. Each hunt is its own thread, with the same agents.':'No reports in this thread.'}</p>
              {isRoomThread&&<button className="suggestion" onClick={()=>{setDraft('Find the bugs in this repository: read the code, run the tests if there are any, and rank what you find by severity.');composerRef.current?.focus();}}>Find bugs, run the tests, rank by severity</button>}</>
            :building?<><h2>Build with {agentName('cli1')} and {agentName('cli2')}</h2><p>{isRoomThread?'Both build the same thing at the same moment, each in its own folder, then post a link to their app here. Open the two side by side with Results. Use a 1:1 line to prepare files first. Ask mode permits scoped file tools and refuses command execution. Each build is its own thread, with the same agents.':'No builds in this thread.'}</p>
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
        :(isRoomThread||!thread)&&!gaming?<form className={`composer${canSend?'':' disabled'}`} onSubmit={e=>{e.preventDefault();void send();}}>
          {files.length>0&&<div className="composer-files" aria-label="Attached files">{files.map(f=><span key={f.key} className={`file-chip ${f.status}`} title={f.error??f.name}>
            {f.preview?<img src={f.preview} alt=""/>:<Icon.file/>}<span className="file-name">{f.name}</span><small>{f.status==='uploading'?'Uploading…':f.error??bytes(f.size)}</small>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(list=>list.filter(p=>p.key!==f.key))}><Icon.close/></button></span>)}</div>}
          {building&&isRoomThread&&<div className="project-row">
            <div className="segmented" role="radiogroup" aria-label="App build or bug hunt">{([['build','App build'],['review','Bug hunt']] as const).map(([value,label])=><button key={value} type="button" role="radio" aria-checked={buildKind===value} aria-pressed={buildKind===value} disabled={mismatch||benchmarkLive} onClick={()=>setBuildKind(value)}>{label}</button>)}</div>
            <label><Icon.folder/><input aria-label="Project folder" placeholder={buildKind==='review'?'Repository to hunt in: a folder, or https://github.com/owner/repo':'Optional: a folder or git repository to start from (empty starts from scratch)'} value={project} maxLength={1000} spellCheck={false} disabled={mismatch||benchmarkLive} onChange={e=>setProject(e.target.value)}/></label>
          </div>}
          <div className="composer-row">
            <button ref={optionsButton} type="button" className={`icon-btn${optionsOpen?' pressed':''}`} aria-label="Options for the next prompt" title="Options for the next prompt" aria-expanded={optionsOpen} disabled={mismatch} onClick={()=>{setOptionsOpen(o=>!o);void loadPresets();}}><Icon.sliders/>{customized||opening!=='cli1'&&!benchmark?<span className="badge"/>:null}</button>
            <button type="button" className="icon-btn" aria-label="Attach files or images" title={seats.some(s=>pair?.images?.[s]===false)?`Attach text files (${seats.filter(s=>pair?.images?.[s]===false).map(agentName).join(' and ')} can’t read images)`:'Attach images or text files (or paste or drop them here)'} disabled={!canSend||files.length>=8} onClick={()=>fileInput.current?.click()}><Icon.attach/></button>
            <button type="button" className="icon-btn" aria-label="Save draft to prompt library" title="Save this prompt and its files" disabled={!draft.trim()||!!busy||uploading||files.some(f=>f.status==='error')} onClick={()=>setLibrary('draft')}><Icon.folder/></button>
            {building&&buildKind==='review'&&isRoomThread&&hunt&&hunt.text.trim()===draft.trim()&&<span className="key-chip" title="AvA plants these bugs in both copies before the hunt starts, then checks each agent's BUG lines against them. The agents never see them.">Planted bugs · {hunt.setup.bugs.filter(b=>!b.decoy).length}{hunt.setup.bugs.some(b=>b.decoy)?` + ${hunt.setup.bugs.filter(b=>b.decoy).length} decoy${hunt.setup.bugs.filter(b=>b.decoy).length===1?'':'s'}`:''}</span>}
            {benchmark&&isRoomThread&&answerKey&&answerKey.text.trim()===draft.trim()&&<span className="key-chip" title="AvA checks each agent’s final ANSWER line against this key when both have answered. The agents never see it.">Answer key · {answerKey.check.kind==='race'?'Race':'Challenge'}</span>}
            {/* The debate's length at a glance (rounds, or the time or agents' choice that ends it instead), changed here or in Options. */}
            {!benchmark&&!building&&isRoomThread&&!live&&<div className="rounds-chip" ref={roundsRef}>
              <button type="button" className={`chip${roundsOpen?' pressed':''}`} aria-haspopup="dialog" aria-expanded={roundsOpen} disabled={mismatch} title="How long the debate runs. Each agent speaks once a round." onClick={()=>setRoundsOpen(o=>!o)}>{endsLabel}</button>
              {roundsOpen&&<div className="rounds-pop" role="dialog" aria-label="Debate rounds" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRoundsOpen(false);}}}>
                <p>Rounds: each agent speaks once a round. The agents can’t end the debate early.</p>
                <div className="rounds-presets" role="group" aria-label="Number of rounds">{[3,5,7,9,11,15].map(n=><button key={n} type="button" aria-pressed={byRounds&&roundsValue===n} onClick={()=>{chooseRounds(n);setRoundsOpen(false);}}>{n}</button>)}</div>
                <label className="rounds-custom"><span>Other</span><input type="number" min={1} max={100} step={1} aria-label="Custom number of rounds" placeholder={String(roundsValue)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const n=Number((e.target as HTMLInputElement).value);if(Number.isInteger(n)&&n>=1&&n<=100){chooseRounds(n);setRoundsOpen(false);}}}}/></label>
                {!byRounds&&<p className="rounds-now">Now: {endsLabel}. Picking rounds switches the debate to rounds.</p>}
                <button type="button" className="link" onClick={()=>{setRoundsOpen(false);setOptionsOpen(true);void loadPresets();}}>Other endings in Options</button>
              </div>}
            </div>}
            <input ref={fileInput} type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.json,.jsonl,.csv,.yaml,.yml,.toml,.xml,.html,.css,.js,.mjs,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.cs,.php,.sh,.ps1,.sql,.log,.diff,.patch" onChange={e=>{if(e.target.files)void addFiles(e.target.files);e.target.value='';}}/>
            <textarea ref={composerRef} rows={1} aria-label={benchmark?'Prompt for both agents':'Message both agents'} placeholder={busy?`${busy}…`:mismatch?`Clear Session to start ${MODE_NAMES[mode].toLowerCase()}`:placeholder} value={draft} maxLength={16000} disabled={!isRoomThread||!ready||mismatch}
              onChange={e=>setDraft(e.target.value)} onPaste={e=>{const pasted=[...e.clipboardData.files];if(pasted.length&&canSend){e.preventDefault();void addFiles(pasted);}}}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
            <button className="send" type="submit" aria-label={live?'Send to both agents':benchmark?'Send to both agents at once':'Start'} title={uploading?'Waiting for uploads':'Send · Enter (Shift+Enter for a new line)'} disabled={!!busy||!draft.trim()||!canSend||uploading}><Icon.send/></button>
          </div>
        </form>
        :gaming&&(isRoomThread||!thread)?null
        :<div className="readonly-bar"><span>{thread?.pairId===pair?.id?'This session was cleared. Its agents no longer remember it.':'From another chat. Read-only here.'}</span>{roomThreadId&&<button className="link" onClick={()=>select('')}>Go to the current session</button>}</div>}

        {optionsOpen&&isRoomThread&&<div ref={sheetRef} className="sheet" role="dialog" aria-label="Options for the next prompt">
          <header><div><h2>{benchmark?'Prompt options':building?'Build options':'Options'}</h2><p>{benchmark?'The prompt goes to both agents exactly as you write it. To give one agent extra context, use its 1:1 line first.':building?'Ask mode allows scoped file tools in each agent’s own folder and refuses command execution. Bypass explicitly trusts unrestricted tools.':live?'Used when the next prompt starts. The running conversation keeps its settings.':'Used when the next prompt starts.'}</p></div><button className="icon-btn" aria-label="Close options" onClick={()=>setOptionsOpen(false)}><Icon.close/></button></header>
          <div className="sheet-profile"><ProfileSelector pairId={pair?.id} agents={{cli1:pair?.slots.cli1.config,cli2:pair?.slots.cli2.config}} value={settings.profile??''} unit={benchmark||building?'answer':'speech'} onChange={(profile,ms)=>setSettings(s=>({...s,profile:profile||undefined,...(ms?(benchmark||building?{minutes:String(ms/60000)}:{speech:String(ms/60000)}):{})}))}/></div>
          {benchmark||building?<div className="sheet-body">
            <div className="group limits single">
              <label><span>Time limit (minutes)</span><input type="number" min="0.5" max="60" step="any" placeholder={building?'30':'60'} value={settings.minutes} onChange={e=>setSettings(s=>({...s,profile:undefined,minutes:e.target.value}))}/></label>
            </div>
            {customized&&<button className="link" onClick={()=>setSettings(s=>({...s,profile:undefined,minutes:''}))}>Reset to default</button>}
            <p className="sheet-note">{building?'Each agent reports once. Work that isn’t finished when the time limit ends is cancelled; what it built stays in its folder until Clear history.':'Each agent answers once. Answers that aren’t finished when the time limit ends are cancelled.'}</p>
          </div>
          :<div className="sheet-body">
            <div className="group">
              <h3>First to speak</h3>
              <div className="segmented wide" role="radiogroup" aria-label="First to speak">
                {([['cli1',turnLabel('cli1')],['cli2',turnLabel('cli2')],['both','Both at once']] as const).map(([value,label])=><button key={value} type="button" role="radio" aria-checked={opening===value} aria-pressed={opening===value} onClick={()=>setOpening(value)}>{label}</button>)}
              </div>
            </div>
            <div className="group">
              <label className="row"><span>Preset</span><select value={presetId} onChange={e=>applyPreset(e.target.value)}><option value="">{presets.length?'None':'No saved presets'}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {presetName===null?<div className="row actions"><button className="link" onClick={()=>setPresetName(presets.find(p=>p.id===presetId)?.name??'')}>Save as preset…</button>{presetId&&<button className="link destructive" onClick={()=>void deletePreset()}>Delete preset</button>}</div>
              :<form className="row" onSubmit={e=>{e.preventDefault();void savePreset();}}><input autoFocus aria-label="Preset name" placeholder="Preset name" maxLength={80} value={presetName} onChange={e=>setPresetName(e.target.value)}/><button className="button" type="button" onClick={()=>setPresetName(null)}>Cancel</button><button className="button primary" type="submit" disabled={!presetName.trim()}>Save</button></form>}
            </div>
            <div className="seat-grid">{seats.map(seat=><div className="group" key={seat}>
              <h3><span className={`seat-dot ${seat}`}/>{agentName(seat)} <span>Agent {SEAT_NUMBER[seat]}</span></h3>
              <div className="seat-side"><strong>{SIDE_LABEL[(settings.stances??DEFAULT_STANCES)[seat]]}</strong>{seat==='cli1'&&<button type="button" className="link" onClick={()=>setSettings(s=>{const now=s.stances??DEFAULT_STANCES;return {...s,stances:{cli1:now.cli2,cli2:now.cli1}};})}>Swap sides</button>}</div>
              <textarea aria-label={`Private context for Agent ${SEAT_NUMBER[seat]}`} placeholder="Private brief: lines of argument, evidence to find, what the other side will say. Given through this agent’s 1:1 line before the debate" maxLength={8000} value={settings.instructions[seat]} onChange={e=>setSettings(s=>({...s,instructions:{...s.instructions,[seat]:e.target.value}}))}/>
              {/* G2: internet for the next debate. It switches when the debate starts; the agent's own switch below the chat is its state now. */}
              <label className="seat-net"><input type="checkbox" aria-label={`Internet for Agent ${SEAT_NUMBER[seat]} in the next debate`} checked={settings.internet?.[seat]??internetOn(seat)} onChange={e=>setSettings(s=>({...s,internet:{...s.internet,[seat]:e.target.checked}}))}/>Internet {(settings.internet?.[seat]??internetOn(seat))?'on':'off'}{settings.internet?.[seat]!==undefined&&settings.internet[seat]!==internetOn(seat)&&<small>switches when the debate starts</small>}</label>
              <input aria-label={`Stop condition for Agent ${SEAT_NUMBER[seat]}`} placeholder="Stop when… (optional)" maxLength={4000} value={settings.stopWhen[seat]} onChange={e=>setSettings(s=>({...s,stopWhen:{...s.stopWhen,[seat]:e.target.value}}))}/>
            </div>)}</div>
            <div className="group limits">
              <label className="judge-pick"><span>Speech time <small>per speech, thinking included; running over forfeits it</small></span><select aria-label="Speech time" value={settings.speech??String(DEFAULT_SPEECH_MINUTES)} onChange={e=>setSettings(s=>({...s,profile:undefined,speech:e.target.value}))}>{SPEECH_TIMES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <label className="judge-pick"><span>Judge</span><select aria-label="Judge" value={settings.judge??'claude'} onChange={e=>setSettings(s=>({...s,judge:e.target.value as PresetData['judge']}))}>{JUDGES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Ends</span><select value={settings.completion} onChange={e=>setSettings(s=>({...s,completion:e.target.value as PresetData['completion']}))}><option value="auto">Default</option><option value="rounds">After the rounds</option><option value="duration">At the time limit</option><option value="either">When either agent is done</option><option value="both">When both agents are done</option></select></label>
              <label><span>Rounds</span><input type="number" min="1" max="100" step="1" placeholder={String(DEFAULT_ROUNDS)} disabled={settings.completion!=='rounds'&&settings.completion!=='auto'} value={settings.rounds??''} onChange={e=>setSettings(s=>({...s,rounds:e.target.value}))}/></label>
              <label><span>Minutes</span><input type="number" min="0.01" max="1440" step="any" placeholder="From prompt" value={settings.minutes} onChange={e=>setSettings(s=>({...s,profile:undefined,minutes:e.target.value}))}/></label>
              <label><span>Requests</span><input type="number" min="2" max="10000" placeholder="Automatic" value={settings.requests} onChange={e=>setSettings(s=>({...s,requests:e.target.value}))}/></label>
              <label><span>Pace (s)</span><input type="number" min="0" max="60" value={settings.pace} onChange={e=>setSettings(s=>({...s,pace:e.target.value}))}/></label>
            </div>
            <p className="sheet-note">By default a debate runs for its rounds (each agent speaks once a round; {DEFAULT_ROUNDS} unless you set them), or for the time the prompt gives, as in “…for 5 minutes”. The agents can’t end it early by agreeing.</p>
            {(customized||opening!=='cli1')&&<button className="link" onClick={()=>{setSettings(DEFAULT_SETTINGS);setPresetId('');setOpening('cli1');}}>Reset to defaults</button>}
          </div>}
        </div>}
        {thread&&<div className="direct-dock">{seats.filter(seat=>directOpen[seat]).map(seat=><DirectWindow key={`${threadId}:${seat}`} seat={seat} name={agentName(seat)} partner={agentName(seat==='cli1'?'cli2':'cli1')}
          messages={direct.messages.filter(m=>m.seat===seat)} pending={direct.pending[seat]} blocked={directBlocked(seat)} readOnly={!isRoomThread} tools={directTools&&isRoomThread}
          onSend={text=>sendDirect(seat,text)} onClose={()=>setDirectOpen(o=>({...o,[seat]:false}))}/>)}</div>}
        </div>
      </section>
    </main>
    {builderOpen&&<PromptBuilder key={mode} mode={mode} onUse={useSavedPrompt} onClose={()=>setBuilderOpen(false)}/>}
    {library&&<PromptManager mode={mode} buildKind={buildKind} draft={draft} draftDebate={{rounds:Number(settings.rounds)||DEFAULT_ROUNDS,speechMinutes:Number(settings.speech??DEFAULT_SPEECH_MINUTES),agents:{cli1:{stance:(settings.stances??DEFAULT_STANCES).cli1,context:settings.instructions.cli1,internet:settings.internet?.cli1??internetOn('cli1')},cli2:{stance:(settings.stances??DEFAULT_STANCES).cli2,context:settings.instructions.cli2,internet:settings.internet?.cli2??internetOn('cli2')}}}} draftFiles={files.flatMap(f=>f.status==='ready'&&f.ref?[f.ref]:[])} draftBlocked={files.some(f=>f.status!=='ready')} startWithDraft={library==='draft'} runBlocked={promptRunBlocked} onUse={useSavedPrompt} onClose={()=>setLibrary(null)}/>}
    {lightbox&&<div className="backdrop lightbox" role="dialog" aria-label="Image" onMouseDown={()=>setLightbox('')} onKeyDown={e=>{if(e.key==='Escape')setLightbox('');}}><img src={lightbox} alt=""/><button className="icon-btn" autoFocus aria-label="Close image" onClick={()=>setLightbox('')}><Icon.close/></button></div>}
    {dialog&&<Dialog spec={dialog} onClose={()=>setDialog(null)}/>}
    {error&&<div className="toast" role="alert"><span>{error}</span><button className="icon-btn" aria-label="Dismiss" onClick={()=>setError('')}><Icon.close/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
