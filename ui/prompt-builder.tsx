import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SPEECH_MINUTES, type DebateSetup, type PromptSummary, type SavedPrompt } from '../src/prompt-types.js';
import { DEFAULT_ROUNDS, FULL_COMMIT, isRepoUrl, type AnswerCheck, type Stance } from '../src/types.js';
import { answerInstructions } from '../src/answer-check.js';
import { rpc } from './api.js';
import { Icon } from './icons.js';
import type { Mode } from './model.js';
import type { PreparedPrompt } from './prompt-manager.js';

// The prompt builder (owner, 2026-10-03): a guided form for setting a prompt up properly, one per mode. Debate's is
// complete: the motion and its definitions, which side each agent argues, a private brief for each side, internet,
// rounds and speech time. Prompt's sets up a challenge or race with its answer key. Build's (H3) has a form for each
// kind: an app build, and a bug hunt with its repository (checked before saving) and, for a scored hunt, the commit to
// copy, what to leave out and the bugs to plant. The grey hints in each box say what a good entry looks like and
// disappear as you type. Every builder saves to the prompt library and can open a saved prompt of its mode to edit.
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const TITLES: Record<Mode, string> = { conversation: 'Debate builder', benchmark: 'Prompt builder', build: 'Build builder' };
interface Side { brief: string; internet: boolean }
interface DebateForm { name: string; motion: string; definitions: string; agent1: Stance; sides: Record<Stance, Side>; rounds: number; speech: number }
// Build (H3): an app build, or a bug hunt in a repository, scored when it plants bugs.
interface PlantedRow { file: string; find: string; replace: string; what: string; decoy?: boolean }
interface BuildForm { name: string; kind: 'build' | 'review'; main: string; requirements: string; judged: string; project: string; scored: boolean; commit: string; exclude: string; include: string; maxReports: string; bugs: PlantedRow[] }
type BugState = 'ok' | 'missing' | 'ambiguous' | 'no-file' | 'excluded';
interface ProjectCheck { folder: string; head: string | null; commitFound: boolean | null; files: number; bytes: number; bugs: BugState[]; problem?: string }
const BUG_STATE: Record<BugState, string> = { ok: '✓ Its original code is there once', missing: '✗ Its original code isn’t in that file', ambiguous: '✗ Its original code appears more than once: add a line of context', 'no-file': '✗ No such file in the repository (or at that commit)', excluded: '✗ That file is left out of the copies' };
const blankDebate = (): DebateForm => ({ name: '', motion: '', definitions: '', agent1: 'for', sides: { for: { brief: '', internet: true }, against: { brief: '', internet: true } }, rounds: DEFAULT_ROUNDS, speech: DEFAULT_SPEECH_MINUTES });
const blankBuild = (kind: BuildForm['kind'] = 'build'): BuildForm => ({ name: '', kind, main: '', requirements: '', judged: '', project: '', scored: false, commit: '', exclude: 'tests\nAGENTS.md\nCLAUDE.md', include: '', maxReports: '', bugs: [] });
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
// A Build prompt's text: the name as its heading, the task, then the optional parts under their own headings. A saved
// prompt opens as one text (its parts aren't separated again).
function buildText(f: BuildForm) {
  const parts: Array<[string, string]> = f.kind === 'build' ? [['Requirements', f.requirements], ['How it will be judged', f.judged]] : [['What counts as a bug', f.judged]];
  return [`# ${f.name.trim()}`, f.main.trim(), ...parts.filter(([, v]) => v.trim()).map(([h, v]) => `## ${h}\n\n${v.trim()}`)].join('\n\n');
}
// The parts of a saved Build prompt's text that its kind's form has fields for, under the headings buildText writes; any
// other text stays with the main part.
function buildParts(prompt: SavedPrompt) {
  const headings = prompt.buildKind === 'build' ? ['Requirements', 'How it will be judged'] : ['What counts as a bug'];
  const [main = '', ...rest] = prompt.text.replace(/^#[^\n]*\n+/, '').split(new RegExp(`\\n+## (${headings.join('|')})\\n+`));
  const part = (heading: string) => { for (let i = 0; i + 1 < rest.length; i += 2) if (rest[i] === heading) return rest[i + 1]!.trim(); return ''; };
  return { main: main.trim(), requirements: prompt.buildKind === 'build' ? part('Requirements') : '', judged: part(headings.at(-1)!) };
}
function buildForm(prompt: SavedPrompt): BuildForm {
  const hunt = prompt.build?.hunt;
  return { ...blankBuild(prompt.buildKind), name: prompt.name, ...buildParts(prompt), project: prompt.build?.project ?? '', scored: !!hunt,
    commit: hunt?.commit ?? '', exclude: hunt ? (hunt.exclude ?? []).join('\n') : blankBuild().exclude, include: (hunt?.include ?? []).join('\n'), maxReports: hunt?.maxReports ? String(hunt.maxReports) : '', bugs: hunt?.bugs.map(({ file, find, replace, what, decoy }) => ({ file, find, replace, what, ...(decoy ? { decoy } : {}) })) ?? [] };
}
const lines = (text: string) => text.split('\n').map(p => p.trim()).filter(Boolean);
const leftOut = (f: BuildForm) => lines(f.exclude), slice = (f: BuildForm) => lines(f.include);
function buildSetup(f: BuildForm) {
  const project = f.project.trim(), exclude = leftOut(f), include = slice(f);
  const hunt = f.kind === 'review' && f.scored && f.bugs.length ? { ...(f.commit.trim() ? { commit: f.commit.trim() } : {}), ...(exclude.length ? { exclude } : {}), ...(include.length ? { include } : {}), ...(Number(f.maxReports) >= 1 ? { maxReports: Math.floor(Number(f.maxReports)) } : {}), bugs: f.bugs.map(b => ({ file: b.file.trim(), find: b.find, replace: b.replace, what: b.what.trim(), ...(b.decoy ? { decoy: true } : {}) })) } : undefined;
  return project || hunt ? { ...(project ? { project } : {}), ...(hunt ? { hunt } : {}) } : undefined;
}
const sizeText = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function PromptBuilder({ mode, onUse, onClose }: { mode: Mode; onUse: (prepared: PreparedPrompt, run: boolean) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<PromptSummary[]>([]), [editing, setEditing] = useState<{ id: string; revision: string } | null>(null);
  const attempt = useRef<{ signature: string; id: string; requestId: string } | null>(null);
  const [debate, setDebate] = useState<DebateForm>(blankDebate), [buildF, setBuildF] = useState<BuildForm>(() => blankBuild()), [promptF, setPromptF] = useState<PromptForm>(blankPrompt);
  // The repository check (Bug hunt): what a copy would hold, and whether each planted bug's original code is there.
  const [checked, setChecked] = useState<ProjectCheck | null>(null);
  const isPrompt = mode === 'benchmark';
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const isDebate = mode === 'conversation';
  async function refresh() { const list = (await rpc<{ prompts: PromptSummary[] }>('prompt.list', {})).prompts; setSaved(list.filter(p => p.mode === mode)); }
  useEffect(() => { dialog.current?.showModal(); void refresh().catch(e => setError(message(e))); }, []);
  async function work(label: string, action: () => Promise<void>) { setBusy(label); setError(''); setNotice(''); try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(''); } }
  function open(id: string) {
    if (!id) { setEditing(null); setDebate(blankDebate()); setBuildF(blankBuild()); setPromptF(blankPrompt()); setChecked(null); return; }
    void work('Opening…', async () => {
      const prompt = await rpc<SavedPrompt>('prompt.get', { id });
      setEditing({ id: prompt.id, revision: prompt.revision });
      if (isDebate) setDebate(debateForm(prompt)); else if (isPrompt) setPromptF(promptForm(prompt)); else { setBuildF(buildForm(prompt)); setChecked(null); }
    });
  }
  const missing = isPrompt ? (!promptF.name.trim() ? 'Give the prompt a name.' : !promptF.task.trim() ? 'Write the task.' : promptF.kind !== 'none' && !answersOf(promptF).length ? 'Give the expected answer (the agents never see it).' : '')
    : isDebate ? (!debate.name.trim() ? 'Give the debate a name.' : !debate.motion.trim() ? 'Write the motion.' : !(debate.rounds >= 1 && debate.rounds <= 100) ? 'Rounds must be 1 to 100.' : '')
    : !buildF.name.trim() ? 'Give the prompt a name.' : !buildF.main.trim() ? (buildF.kind === 'review' ? 'Say what to hunt for.' : 'Say what to build.')
    : buildF.kind === 'review' && !buildF.project.trim() ? 'Give the repository to hunt in.'
    : buildF.kind === 'review' && buildF.scored && !buildF.bugs.length ? 'Add a planted bug, or untick the scored hunt.'
    : buildF.kind === 'review' && buildF.scored && buildF.bugs.some(b => !b.file.trim() || !b.find || !b.replace || !b.what.trim()) ? 'Each planted bug needs its file, its original code, its new code and what’s wrong.'
    : buildF.kind === 'review' && buildF.scored && buildF.bugs.some(b => b.find === b.replace) ? 'A planted bug must change the code.'
    : buildF.kind === 'review' && buildF.scored && buildF.bugs.every(b => b.decoy) ? 'Plant at least one bug that isn’t a decoy.'
    : buildF.kind === 'review' && buildF.scored && buildF.maxReports.trim() && !(Number(buildF.maxReports) >= 1 && Number(buildF.maxReports) <= 100) ? 'BUG lines that count: 1 to 100, or empty for all.'
    : buildF.kind === 'review' && buildF.scored && buildF.commit.trim() && !/^[0-9a-f]{7,64}$/i.test(buildF.commit.trim()) ? 'A commit is its hash, for example 5fc3198.'
    : buildF.kind === 'review' && buildF.scored && isRepoUrl(buildF.project) && !FULL_COMMIT.test(buildF.commit.trim()) ? 'A hunt in a repository on the web needs its commit’s full hash: Check, then Use.' : '';
  // Bug hunt: checks the repository (and the planted bugs) without copying anything.
  function check() {
    void work('Checking the repository…', async () => {
      setChecked(await rpc<ProjectCheck>('project.check', { path: buildF.project.trim(), ...(buildF.scored && buildF.commit.trim() ? { commit: buildF.commit.trim() } : {}), ...(buildF.scored ? { exclude: leftOut(buildF), include: slice(buildF), bugs: buildF.bugs.filter(b => b.file.trim() && b.find).map(b => ({ file: b.file.trim(), find: b.find })) } : {}) }));
    });
  }
  const setBug = (index: number, change: Partial<PlantedRow>) => { setChecked(null); setBuildF(f => ({ ...f, bugs: f.bugs.map((b, i) => i === index ? { ...b, ...change } : b) })); };
  async function save(use: boolean) {
    await work(use ? 'Saving and loading…' : 'Saving…', async () => {
      const payload = isPrompt ? { name: promptF.name.trim(), text: promptText(promptF), mode: 'benchmark', buildKind: 'build', ...(promptF.kind !== 'none' ? { check: { kind: promptF.kind, answers: answersOf(promptF) } } : {}) }
        : isDebate ? { name: debate.name.trim(), text: debateText(debate), mode: 'conversation', buildKind: 'build', debate: debateSetup(debate) }
        : { name: buildF.name.trim(), text: buildText(buildF), mode, buildKind: buildF.kind, ...(buildSetup(buildF) ? { build: buildSetup(buildF) } : {}) };
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
  return <dialog ref={dialog} className="builder" aria-labelledby="builder-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="library-heading"><div><h2 id="builder-title"><Icon.pencil/>{TITLES[mode]}</h2>
      <p>{isDebate ? 'Set up a formal debate: a clear motion, a side for each agent, and a private brief for each side. It is saved to the prompt library.' : isPrompt ? 'Set up a challenge or a race: a short, hard question with one exact answer, and the answer key AvA checks. It is saved to the prompt library.' : 'Set up an app build, or a bug hunt in a repository: scored when it plants bugs that AvA checks each agent’s reports against. It is saved to the prompt library.'}</p></div>
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
        <label className="library-field"><span>Name</span><input aria-label="Prompt name" maxLength={120} placeholder={buildF.kind === 'review' ? 'A short name for the library, for example: Hunt: the settings parser' : 'A short name for the library, for example: Pomodoro timer'} value={buildF.name} onChange={e => setBuildF(f => ({ ...f, name: e.target.value }))}/></label>
        <div className="builder-sides-head"><span>Kind</span><div className="segmented" role="radiogroup" aria-label="Build kind">{([['build', 'App build'], ['review', 'Bug hunt']] as const).map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={buildF.kind === k} aria-pressed={buildF.kind === k} onClick={() => { setChecked(null); setBuildF(f => ({ ...f, kind: k })); }}>{label}</button>)}</div>
          <small>{buildF.kind === 'review' ? 'Both hunt for bugs in their own copies of a repository and report each one on a BUG line.' : 'Both build the same app at the same moment, each in its own folder, and post a link to it.'}</small></div>
        {buildF.kind === 'build' ? <>
          <label className="library-field"><span>What to build <small>both agents get it at the same moment</small></span><textarea aria-label="What to build" rows={6} maxLength={12000} value={buildF.main} onChange={e => setBuildF(f => ({ ...f, main: e.target.value }))}
            placeholder={'The app, stated completely: what it does, who uses it, and the screens or controls it needs. For example:\n“A Pomodoro timer: 25-minute focus and 5-minute break sessions, start, pause and reset, a count of finished sessions, and a sound when a session ends.”\nIt runs in the browser as plain files unless you say otherwise.'}/></label>
          <label className="library-field"><span>Requirements <small>optional</small></span><textarea aria-label="Requirements" rows={3} maxLength={6000} value={buildF.requirements} onChange={e => setBuildF(f => ({ ...f, requirements: e.target.value }))} placeholder={'The must-haves, one per line: features, technologies to use or avoid, and anything it must not do. For example:\n• keyboard shortcuts for start and pause\n• no frameworks, no network requests'}/></label>
          <label className="library-field"><span>How it will be judged <small>optional</small></span><textarea aria-label="How it will be judged" rows={2} maxLength={6000} value={buildF.judged} onChange={e => setBuildF(f => ({ ...f, judged: e.target.value }))} placeholder="What a good result looks like, so both aim for the same thing: works on first open, handles edge cases, looks finished, readable code."/></label>
          <label className="library-field"><span>Project to start from <small>optional · empty starts from scratch</small></span><input aria-label="Project to start from" maxLength={1000} spellCheck={false} placeholder="A folder or a public git repository, for example D:\\Projects\\my-app or https://github.com/owner/repo" value={buildF.project} onChange={e => setBuildF(f => ({ ...f, project: e.target.value }))}/></label>
        </> : <>
          <div className="builder-row builder-repo">
            <label className="library-field"><span>Repository to hunt in <small>a folder, or a public git repository’s address; each agent gets its own copy, without the git history</small></span><input aria-label="Repository to hunt in" maxLength={1000} spellCheck={false} placeholder="D:\\Projects\\my-app, or https://github.com/owner/repo" value={buildF.project} onChange={e => { setChecked(null); setBuildF(f => ({ ...f, project: e.target.value })); }}/></label>
            <button type="button" className="button" disabled={!!busy || !buildF.project.trim()} onClick={check}>Check</button>
          </div>
          {checked && <p className="builder-note" role="status">{checked.folder}: {checked.head ? (isRepoUrl(checked.folder) ? `on the web, its default branch now at ${checked.head.slice(0, 7)}` : `git repository, now at ${checked.head.slice(0, 7)}`) : isRepoUrl(checked.folder) ? 'not reached' : 'not a git repository'}. A copy holds {checked.files} file{checked.files === 1 ? '' : 's'} ({sizeText(checked.bytes)}).{checked.commitFound === false ? ' The commit below isn’t in this repository.' : ''}{checked.problem ? ` ${checked.problem}` : ''}</p>}
          <label className="library-field"><span>What to hunt for <small>both agents get it at the same moment</small></span><textarea aria-label="What to hunt for" rows={5} maxLength={12000} value={buildF.main} onChange={e => setBuildF(f => ({ ...f, main: e.target.value }))}
            placeholder={'Where to look and what to look for. Set the difficulty here:\n• easy: name the file or module, and how many bugs it has\n• harder: name a folder, or only the area (“the request queue”)\n• hardest: the whole repository, with no count\nAvA adds how to report: one BUG line per bug, with its file and line.'}/></label>
          <label className="library-field"><span>What counts as a bug <small>optional</small></span><textarea aria-label="What counts as a bug" rows={2} maxLength={6000} value={buildF.judged} onChange={e => setBuildF(f => ({ ...f, judged: e.target.value }))} placeholder="For example: wrong results, crashes and data loss count; style, naming and missing comments don’t."/></label>
          <label className="library-check"><input type="checkbox" checked={buildF.scored} onChange={e => { setChecked(null); setBuildF(f => ({ ...f, scored: e.target.checked })); }}/>Score this hunt: plant bugs in both copies, and check each agent’s BUG lines against them</label>
          {buildF.scored && <>
            <label className="library-field"><span>Commit to copy <small>the same code every run · optional for a folder, whose copy is otherwise as it is now; a repository on the web needs the full hash</small></span><div className="builder-inline"><input aria-label="Commit to copy" maxLength={64} spellCheck={false} placeholder="e.g. 5fc3198, or the full 40-character hash" value={buildF.commit} onChange={e => { setChecked(null); setBuildF(f => ({ ...f, commit: e.target.value })); }}/>{checked?.head && <button type="button" className="button" onClick={() => setBuildF(f => ({ ...f, commit: isRepoUrl(f.project) ? checked.head! : checked.head!.slice(0, 12) }))}>Use {checked.head.slice(0, 7)}</button>}</div></label>
            <div className="builder-row">
              <label className="library-field"><span>Only these folders <small>optional · a slice of a large repository, one path per line</small></span><textarea aria-label="Only these folders" rows={3} maxLength={4000} value={buildF.include} onChange={e => { setChecked(null); setBuildF(f => ({ ...f, include: e.target.value })); }} placeholder={'Empty takes the whole repository. For example:\nsrc/parser\nREADME.md'}/></label>
              <label className="library-field"><span>Leave out of the copies <small>one path per line</small></span><textarea aria-label="Leave out of the copies" rows={3} maxLength={4000} value={buildF.exclude} onChange={e => { setChecked(null); setBuildF(f => ({ ...f, exclude: e.target.value })); }} placeholder={'Tests that would point at the bugs, and instructions for agents:\ntests\nAGENTS.md'}/></label>
            </div>
            <div className="planted-bugs" aria-label="Planted bugs">
              <label className="library-field"><span>BUG lines that count <small>optional · only each agent’s first ones; for a hunt that doesn’t say how many bugs it has</small></span><input aria-label="BUG lines that count" inputMode="numeric" maxLength={3} placeholder="All of them" value={buildF.maxReports} onChange={e => setBuildF(f => ({ ...f, maxReports: e.target.value.replace(/\D/g, '') }))}/></label>
              {buildF.bugs.map((bug, i) => <fieldset key={i} className="planted-bug"><legend>Planted {bug.decoy ? 'decoy' : 'bug'} {i + 1}</legend>
                <label className="library-field"><span>File <small>inside the repository</small></span><input aria-label={`File of planted bug ${i + 1}`} maxLength={400} spellCheck={false} placeholder="src/parser.py" value={bug.file} onChange={e => setBug(i, { file: e.target.value })}/></label>
                <div className="builder-row">
                  <label className="library-field"><span>Original code <small>exactly as it is, once in the file</small></span><textarea aria-label={`Original code of planted bug ${i + 1}`} rows={3} spellCheck={false} className="code" value={bug.find} onChange={e => setBug(i, { find: e.target.value })} placeholder="    if count > limit:"/></label>
                  <label className="library-field"><span>Bugged code <small>what it becomes</small></span><textarea aria-label={`Bugged code of planted bug ${i + 1}`} rows={3} spellCheck={false} className="code" value={bug.replace} onChange={e => setBug(i, { replace: e.target.value })} placeholder="    if count >= limit:"/></label>
                </div>
                <label className="library-check"><input type="checkbox" checked={!!bug.decoy} onChange={e => setBug(i, { decoy: e.target.checked })}/>A decoy: the new code is still correct but looks wrong, and a BUG line on it counts against the agent</label>
                <label className="library-field"><span>{bug.decoy ? 'Why it’s still correct' : 'What’s wrong'} <small>shown with the result, never to the agents</small></span><input aria-label={`What's wrong with planted bug ${i + 1}`} maxLength={1000} value={bug.what} onChange={e => setBug(i, { what: e.target.value })} placeholder="Off by one: a count equal to the limit is refused."/></label>
                {checked && checked.bugs[i] && <p className={`bug-check ${checked.bugs[i] === 'ok' ? 'ok' : 'bad'}`}>{BUG_STATE[checked.bugs[i]!]}</p>}
                <button type="button" className="button" onClick={() => { setChecked(null); setBuildF(f => ({ ...f, bugs: f.bugs.filter((_, j) => j !== i) })); }}>Remove</button>
              </fieldset>)}
              <button type="button" className="button" disabled={buildF.bugs.length >= 30} onClick={() => setBuildF(f => ({ ...f, bugs: [...f.bugs, { file: '', find: '', replace: '', what: '' }] }))}>Add a planted bug</button>
            </div>
            <p className="builder-note">Each bug (and decoy) is planted in both copies before the agents start, so both begin from the same seeded code. Use <strong>Check</strong> to see that each one applies. A BUG line counts when it names the bug’s file and a line within three lines of it. The winner found more bugs, then fell for fewer decoys, then was faster.</p>
          </>}
        </>}
      </>}
    </div>
    <footer className="library-footer">
      {error && <p role="alert" className="library-error">{error}</p>}
      <p role="status">{busy || notice || missing || (editing ? 'Saving updates the saved prompt.' : 'Saving adds it to the prompt library.')}</p>
      <div className="library-actions"><button className="button" disabled={!!busy || !!missing} onClick={() => void save(false)}>Save</button><button className="button primary" disabled={!!busy || !!missing} onClick={() => void save(true)}>Save and load</button></div>
    </footer>
  </dialog>;
}
