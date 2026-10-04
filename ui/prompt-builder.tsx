import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SPEECH_MINUTES, type DebateSetup, type PromptSummary, type SavedPrompt } from '../src/prompt-types.js';
import { DEFAULT_ROUNDS, type AnswerCheck, type Stance } from '../src/types.js';
import { answerInstructions } from '../src/answer-check.js';
import { rpc } from './api.js';
import { Icon } from './icons.js';
import type { Mode } from './model.js';
import type { PreparedPrompt } from './prompt-manager.js';

// The prompt builder (owner, 2026-10-03): a guided form for setting a prompt up properly, one per mode. Debate's is
// complete: the motion and its definitions, which side each agent argues, a private brief for each side, internet,
// rounds and speech time. The grey hints in each box say what a good entry looks like and disappear as you type. Prompt
// and Build have simple forms for now (to be refined with those modes). Every builder saves to the prompt library and
// can open a saved prompt of its mode to edit.
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const TITLES: Record<Mode, string> = { conversation: 'Debate builder', benchmark: 'Prompt builder', build: 'Build builder' };
interface Side { brief: string; internet: boolean }
interface DebateForm { name: string; motion: string; definitions: string; agent1: Stance; sides: Record<Stance, Side>; rounds: number; speech: number }
interface SimpleForm { name: string; main: string; second: string; third: string; buildKind: 'build' | 'review' }
const blankDebate = (): DebateForm => ({ name: '', motion: '', definitions: '', agent1: 'for', sides: { for: { brief: '', internet: true }, against: { brief: '', internet: true } }, rounds: DEFAULT_ROUNDS, speech: DEFAULT_SPEECH_MINUTES });
const blankSimple = (): SimpleForm => ({ name: '', main: '', second: '', third: '', buildKind: 'build' });
// Prompt mode (owner, 2026-10-04): a challenge or race has a hidden answer key that AvA checks; "none" is a plain prompt.
interface PromptForm { name: string; kind: AnswerCheck['kind'] | 'none'; task: string; form: string; answers: string; constraints: string }
const blankPrompt = (): PromptForm => ({ name: '', kind: 'challenge', task: '', form: '', answers: '', constraints: '' });
function promptText(f: PromptForm) {
  const body = [f.task.trim(), f.constraints.trim()].filter(Boolean).join('\n\n');
  // An edited prompt already holds its answer line; a new one gets it (and how it's judged) at the end.
  const ending = /ANSWER:/i.test(body) ? '' : f.kind !== 'none' ? answerInstructions(f.kind, f.form) : f.form.trim() ? `End your reply with one line in exactly this form: ANSWER: ${f.form.trim()}` : '';
  return [`# ${f.name.trim()}`, body, ending].filter(Boolean).join('\n\n');
}
function promptForm(prompt: SavedPrompt): PromptForm {
  return { name: prompt.name, kind: prompt.check?.kind ?? 'none', task: prompt.text.replace(/^#[^\n]*\n+/, ''), form: '', answers: prompt.check?.answers.join('\n') ?? '', constraints: '' };
}
const answersOf = (f: PromptForm) => f.answers.split('\n').map(a => a.trim()).filter(Boolean);
// A saved debate as the form: "# Motion: …" then the definitions; each agent's brief goes with its side.
function debateForm(prompt: SavedPrompt): DebateForm {
  const [first, ...rest] = prompt.text.split('\n'), motion = /^#\s*Motion:\s*/i.test(first ?? '') ? first!.replace(/^#\s*Motion:\s*/i, '') : '';
  const setup = prompt.debate, form = blankDebate();
  form.name = prompt.name; form.motion = motion || prompt.text.trim(); form.definitions = motion ? rest.join('\n').trim() : '';
  if (setup) {
    form.agent1 = setup.agents.cli1.stance; form.rounds = setup.rounds; form.speech = setup.speechMinutes ?? DEFAULT_SPEECH_MINUTES;
    for (const seat of ['cli1', 'cli2'] as const) form.sides[setup.agents[seat].stance] = { brief: setup.agents[seat].context, internet: setup.agents[seat].internet };
  }
  return form;
}
function debateText(form: DebateForm) { return `# Motion: ${form.motion.trim()}${form.definitions.trim() ? `\n\n${form.definitions.trim()}` : ''}`; }
function debateSetup(form: DebateForm): DebateSetup {
  const other: Stance = form.agent1 === 'for' ? 'against' : 'for', side = (stance: Stance) => ({ stance, context: form.sides[stance].brief.trim(), internet: form.sides[stance].internet });
  return { rounds: form.rounds, speechMinutes: form.speech, agents: { cli1: side(form.agent1), cli2: side(other) } };
}
// Prompt and Build (shells): the main text, plus two optional parts appended under their own headings.
const SIMPLE: Record<'benchmark' | 'build', { main: [string, string]; second: [string, string]; third: [string, string] }> = {
  benchmark: { main: ['Task', 'What both agents should do, stated completely: the question or problem, and everything they need to answer it. Both get exactly this text at the same moment.'],
    second: ['Answer format', 'How they should answer, for example: "one JSON object with keys a and b, no other text", or "a short paragraph, then the final number on its own line".'],
    third: ['Constraints', 'Limits that make answers comparable, for example: no tools, no web search, at most 200 words.'] },
  build: { main: ['What to build or review', 'Describe the app or the review: what it must do, who uses it, and how the operator will open it. For a review, name what to look for (bugs, security, performance).'],
    second: ['Requirements', 'The must-haves, one per line: features, technologies to use or avoid, and anything it must not do.'],
    third: ['How it will be judged', 'What a good result looks like, so both agents aim for the same thing, for example: works offline, passes these checks, readable code.'] },
};
function simpleText(mode: 'benchmark' | 'build', form: SimpleForm) {
  const parts = SIMPLE[mode];
  return [`# ${form.name.trim()}`, form.main.trim(), ...(form.second.trim() ? [`## ${parts.second[0]}\n\n${form.second.trim()}`] : []), ...(form.third.trim() ? [`## ${parts.third[0]}\n\n${form.third.trim()}`] : [])].join('\n\n');
}
function simpleForm(prompt: SavedPrompt): SimpleForm {
  // A saved prompt opens as one text (its parts aren't separated again).
  return { name: prompt.name, main: prompt.text.replace(/^#[^\n]*\n+/, ''), second: '', third: '', buildKind: prompt.buildKind };
}

export function PromptBuilder({ mode, onUse, onClose }: { mode: Mode; onUse: (prepared: PreparedPrompt, run: boolean) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<PromptSummary[]>([]), [editing, setEditing] = useState<{ id: string; revision: string } | null>(null);
  const attempt = useRef<{ signature: string; id: string; requestId: string } | null>(null);
  const [debate, setDebate] = useState<DebateForm>(blankDebate), [simple, setSimple] = useState<SimpleForm>(blankSimple), [promptF, setPromptF] = useState<PromptForm>(blankPrompt);
  const isPrompt = mode === 'benchmark';
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const isDebate = mode === 'conversation';
  async function refresh() { const list = (await rpc<{ prompts: PromptSummary[] }>('prompt.list', {})).prompts; setSaved(list.filter(p => p.mode === mode)); }
  useEffect(() => { dialog.current?.showModal(); void refresh().catch(e => setError(message(e))); }, []);
  async function work(label: string, action: () => Promise<void>) { setBusy(label); setError(''); setNotice(''); try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(''); } }
  function open(id: string) {
    if (!id) { setEditing(null); setDebate(blankDebate()); setSimple(blankSimple()); setPromptF(blankPrompt()); return; }
    void work('Opening…', async () => {
      const prompt = await rpc<SavedPrompt>('prompt.get', { id });
      setEditing({ id: prompt.id, revision: prompt.revision });
      if (isDebate) setDebate(debateForm(prompt)); else if (isPrompt) setPromptF(promptForm(prompt)); else setSimple(simpleForm(prompt));
    });
  }
  const missing = isPrompt ? (!promptF.name.trim() ? 'Give the prompt a name.' : !promptF.task.trim() ? 'Write the task.' : promptF.kind !== 'none' && !answersOf(promptF).length ? 'Give the expected answer (the agents never see it).' : '')
    : isDebate ? (!debate.name.trim() ? 'Give the debate a name.' : !debate.motion.trim() ? 'Write the motion.' : !(debate.rounds >= 1 && debate.rounds <= 100) ? 'Rounds must be 1 to 100.' : '')
    : (!simple.name.trim() ? 'Give the prompt a name.' : !simple.main.trim() ? `Fill in “${SIMPLE[mode as 'benchmark' | 'build'].main[0]}”.` : '');
  async function save(use: boolean) {
    await work(use ? 'Saving and loading…' : 'Saving…', async () => {
      const payload = isPrompt ? { name: promptF.name.trim(), text: promptText(promptF), mode: 'benchmark', buildKind: 'build', ...(promptF.kind !== 'none' ? { check: { kind: promptF.kind, answers: answersOf(promptF) } } : {}) }
        : isDebate ? { name: debate.name.trim(), text: debateText(debate), mode: 'conversation', buildKind: 'build', debate: debateSetup(debate) }
        : { name: simple.name.trim(), text: simpleText('build', simple), mode, buildKind: simple.buildKind };
      // An edited prompt keeps its files.
      // The same save, retried after an error, keeps its prompt ID and request ID until it succeeds: a save that went
      // through although its answer was lost isn't made twice (Q5).
      const signature = JSON.stringify([editing, payload]);
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: editing?.id ?? crypto.randomUUID(), requestId: crypto.randomUUID() };
      const { id, requestId } = attempt.current;
      const files = editing ? (await rpc<SavedPrompt>('prompt.get', { id })).files.map(f => ({ id: f.id, name: f.name })) : [];
      const result = await rpc<SavedPrompt>('prompt.save', { ...payload, id, revision: editing?.revision ?? null, files, requestId });
      attempt.current = null;
      setEditing({ id: result.id, revision: result.revision }); await refresh();
      if (use) { await onUse(await rpc<PreparedPrompt>('prompt.prepare', { id: result.id, revision: result.revision }), false); onClose(); }
      else setNotice(`Saved “${result.name}” to the prompt library.`);
    });
  }
  const side = (stance: Stance) => {
    const label = stance === 'for' ? 'Proposition: for the motion' : 'Opposition: against the motion', agent = debate.agent1 === stance ? 1 : 2;
    return <div className="builder-side" key={stance}>
      <h3>{label} <small>Agent {agent}</small></h3>
      <textarea aria-label={`${stance === 'for' ? 'Proposition' : 'Opposition'} brief`} rows={6} maxLength={8000} value={debate.sides[stance].brief} onChange={e => setDebate(d => ({ ...d, sides: { ...d.sides, [stance]: { ...d.sides[stance], brief: e.target.value } } }))}
        placeholder={`Private to the side arguing ${stance === 'for' ? 'for' : 'against'} the motion, given through its 1:1 line before the debate. Include:\n• its two or three strongest lines of argument\n• the evidence to look for: studies, data, real cases, named sources\n• the other side's likely best points, and how to answer them\nDon't write its speeches for it.`}/>
      <label className="library-check"><input type="checkbox" checked={debate.sides[stance].internet} onChange={e => setDebate(d => ({ ...d, sides: { ...d.sides, [stance]: { ...d.sides[stance], internet: e.target.checked } } }))}/>Can search the web for evidence</label>
    </div>;
  };
  const simpleField = (key: 'main' | 'second' | 'third', rows: number) => { const [label, hint] = SIMPLE[mode as 'benchmark' | 'build'][key]; return <label className="library-field" key={key}><span>{label}{key !== 'main' && <small>optional</small>}</span><textarea rows={rows} maxLength={6000} placeholder={hint} value={simple[key]} onChange={e => setSimple(s => ({ ...s, [key]: e.target.value }))}/></label>; };
  return <dialog ref={dialog} className="builder" aria-labelledby="builder-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="library-heading"><div><h2 id="builder-title"><Icon.pencil/>{TITLES[mode]}</h2>
      <p>{isDebate ? 'Set up a formal debate: a clear motion, a side for each agent, and a private brief for each side. It is saved to the prompt library.' : isPrompt ? 'Set up a challenge or a race: a short, hard question with one exact answer, and the answer key AvA checks. It is saved to the prompt library.' : 'A simple form for now; it will be refined when this mode gets its turn. It is saved to the prompt library.'}</p></div>
      <button className="icon-btn" aria-label="Close builder" disabled={!!busy} onClick={onClose}><Icon.close/></button></header>
    <div className="builder-body">
      <label className="library-field builder-open"><span>Start from</span><select aria-label="Open a saved prompt" value={editing?.id ?? ''} disabled={!!busy} onChange={e => open(e.target.value)}>
        <option value="">A new {isDebate ? 'debate' : 'prompt'}</option>{saved.map(p => <option key={p.id} value={p.id}>Edit: {p.name}</option>)}</select></label>
      {isPrompt ? <>
        <label className="library-field"><span>Name</span><input aria-label="Prompt name" maxLength={120} placeholder="A short name for the library, for example: Domino tilings" value={promptF.name} onChange={e => setPromptF(f => ({ ...f, name: e.target.value }))}/></label>
        <div className="builder-sides-head"><span>Kind</span><div className="segmented" role="radiogroup" aria-label="Prompt kind">{([['challenge', 'Challenge'], ['race', 'Race'], ['none', 'Plain prompt']] as const).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={promptF.kind === k} aria-pressed={promptF.kind === k} onClick={() => setPromptF(f => ({ ...f, kind: k }))}>{label}</button>)}</div>
          <small>{promptF.kind === 'challenge' ? 'Hard, with one exact answer: the right answer wins, the faster one if both are right.' : promptF.kind === 'race' ? 'Quicker, with one exact answer: the fastest right answer wins.' : 'No answer key: compare the answers yourself.'}</small></div>
        <label className="library-field"><span>Task <small>both agents get it at the same moment</small></span><textarea aria-label="Task" rows={6} maxLength={12000} value={promptF.task} onChange={e => setPromptF(f => ({ ...f, task: e.target.value }))}
          placeholder={'A short question that is hard to answer but has one exact answer. Good kinds:\n• counting and probability (how many ways…, give a fraction in lowest terms)\n• logic puzzles with exactly one solution\n• tracing a short program by hand\n• shortest paths, dates, number bases\nAvoid questions the agents can look up, or whose answer is a matter of opinion.'}/></label>
        {promptF.kind !== 'none' && <div className="builder-row">
          <label className="library-field"><span>Answer form <small>what goes on the ANSWER line</small></span><input aria-label="Answer form" maxLength={200} placeholder="<a whole number>, <a fraction in lowest terms>, <a name>…" value={promptF.form} onChange={e => setPromptF(f => ({ ...f, form: e.target.value }))}/></label>
          <label className="library-field"><span>Expected answer <small>hidden from the agents · one per line if several are right</small></span><textarea aria-label="Expected answer" rows={2} maxLength={2000} placeholder="The exact answer, for example 2131. Work it out (ideally by program) before you save." value={promptF.answers} onChange={e => setPromptF(f => ({ ...f, answers: e.target.value }))}/></label>
        </div>}
        <label className="library-field"><span>Constraints <small>optional</small></span><textarea aria-label="Constraints" rows={2} maxLength={2000} placeholder="Limits that keep it fair, for example: no tools, no web search. (Challenges and races already ask for that.)" value={promptF.constraints} onChange={e => setPromptF(f => ({ ...f, constraints: e.target.value }))}/></label>
        <p className="builder-note">AvA adds how it’s judged and the closing line “ANSWER: …”, then checks each agent’s answer against your key when both have answered.</p>
      </> : isDebate ? <>
        <label className="library-field"><span>Name</span><input aria-label="Debate name" maxLength={120} placeholder="A short name for the library, for example: Smartphones in schools" value={debate.name} onChange={e => setDebate(d => ({ ...d, name: e.target.value }))}/></label>
        <label className="library-field"><span>Motion <small>both debaters see it</small></span><input aria-label="Motion" maxLength={500} placeholder="This house would ban smartphones in schools: one clear proposal that one side can support and the other oppose" value={debate.motion} onChange={e => setDebate(d => ({ ...d, motion: e.target.value }))}/></label>
        <label className="library-field"><span>Definitions and scope <small>optional · both see it</small></span><textarea aria-label="Definitions" rows={3} maxLength={4000} value={debate.definitions} onChange={e => setDebate(d => ({ ...d, definitions: e.target.value }))}
          placeholder={'Pin down the key terms and limits both sides must accept, so they argue the motion rather than its meaning. For example: "Schools means primary and secondary schools. The ban covers the whole school day, with exceptions for medical needs."'}/></label>
        <div className="builder-sides-head"><span>Agent 1 argues</span><div className="segmented" role="radiogroup" aria-label="Agent 1 argues">{(['for', 'against'] as const).map(s => <button key={s} type="button" role="radio" aria-checked={debate.agent1 === s} aria-pressed={debate.agent1 === s} onClick={() => setDebate(d => ({ ...d, agent1: s }))}>{s === 'for' ? 'For the motion' : 'Against the motion'}</button>)}</div><small>Agent 2 argues the other side.</small></div>
        <div className="builder-sides">{side('for')}{side('against')}</div>
        <div className="builder-row">
          <label className="library-field"><span>Rounds <small>opening, rebuttals, closing</small></span><input aria-label="Rounds" type="number" min={1} max={100} value={debate.rounds || ''} onChange={e => setDebate(d => ({ ...d, rounds: Number(e.target.value) }))}/></label>
          <label className="library-field"><span>Speech time <small>running over forfeits the speech</small></span><select aria-label="Speech time" value={String(debate.speech)} onChange={e => setDebate(d => ({ ...d, speech: Number(e.target.value) }))}>{[1, 2, 3, 5, 10, 0].map(n => <option key={n} value={n}>{n ? `${n} minute${n === 1 ? '' : 's'}` : 'No limit'}</option>)}</select></label>
        </div>
      </> : <>
        <label className="library-field"><span>Name</span><input aria-label="Prompt name" maxLength={120} placeholder="A short name for the library" value={simple.name} onChange={e => setSimple(s => ({ ...s, name: e.target.value }))}/></label>
        {mode === 'build' && <label className="library-field"><span>Task</span><select aria-label="Build or review" value={simple.buildKind} onChange={e => setSimple(s => ({ ...s, buildKind: e.target.value as 'build' | 'review' }))}><option value="build">Build an app</option><option value="review">Review a project</option></select></label>}
        {simpleField('main', 6)}{simpleField('second', 3)}{simpleField('third', 3)}
      </>}
    </div>
    <footer className="library-footer">
      {error && <p role="alert" className="library-error">{error}</p>}
      <p role="status">{busy || notice || missing || (editing ? 'Saving updates the saved prompt.' : 'Saving adds it to the prompt library.')}</p>
      <div className="library-actions"><button className="button" disabled={!!busy || !!missing} onClick={() => void save(false)}>Save</button><button className="button primary" disabled={!!busy || !!missing} onClick={() => void save(true)}>Save and load</button></div>
    </footer>
  </dialog>;
}
