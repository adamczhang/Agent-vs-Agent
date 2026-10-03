import { useEffect, useRef, useState } from 'react';
import type { PromptFile, PromptFileInput, PromptMode, PromptSave, PromptSummary, SavedPrompt } from '../src/prompt-types.js';
import { rpc } from './api.js';
import { CommandClient } from './commands.js';
import { Icon } from './icons.js';
import { bytes, type AttachmentRef, type Mode } from './model.js';

const labels: Record<PromptMode, string> = { all: 'Any mode', benchmark: 'Prompt', conversation: 'Debate', build: 'Build' };
interface EditorFile extends PromptFileInput { mediaType: string; kind: 'text' | 'image'; size: number }
interface Editor extends Omit<PromptSave, 'files'> { files: EditorFile[] }
export interface PreparedPrompt { prompt: SavedPrompt; attachments: AttachmentRef[] }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
});
function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const blank = (mode: Mode, buildKind: 'build' | 'review'): Editor => ({ id: crypto.randomUUID(), revision: null, name: '', text: '', mode, buildKind, files: [] });
const edit = (prompt: SavedPrompt): Editor => ({ id: prompt.id, revision: prompt.revision, name: prompt.name, text: prompt.text, mode: prompt.mode, buildKind: prompt.buildKind, files: prompt.files });
const payload = ({ files, ...data }: Editor): PromptSave => ({ ...data, files: files.map(({ id, name, attachmentId }) => ({ id, name, ...(attachmentId ? { attachmentId } : {}) })) });

export function PromptManager({ mode, buildKind, draft, draftFiles, draftBlocked, startWithDraft, runBlocked, onUse, onClose }: {
  mode: Mode; buildKind: 'build' | 'review'; draft: string; draftFiles: AttachmentRef[]; draftBlocked: boolean; startWithDraft: boolean;
  runBlocked: (mode: PromptMode, kind: 'build' | 'review') => string;
  onUse: (prepared: PreparedPrompt, run: boolean) => Promise<void>; onClose: () => void;
}) {
  const [items, setItems] = useState<PromptSummary[]>([]), [directory, setDirectory] = useState(''), [warnings, setWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<PromptMode | '*'>(mode);
  const [editor, setEditor] = useState<Editor>(() => blank(mode, buildKind)), [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ name: string; kind: 'text' | 'image'; mediaType: string; data: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ text: string; label: string; action: () => void } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), imports = useRef<HTMLInputElement>(null), attachments = useRef<HTMLInputElement>(null), lock = useRef(false);
  const commands = useRef(new CommandClient(sessionStorage, 'ava-prompt-manager'));
  const dirty = baseline ? JSON.stringify(payload(editor)) !== baseline : !!(editor.name || editor.text || editor.files.length);
  const visible = items.filter(p => (filter === '*' || p.mode === 'all' || p.mode === filter) && `${p.name}\n${p.text}\n${p.files.map(f => f.name).join('\n')}`.toLowerCase().includes(query.toLowerCase()));
  const change = (next: Editor) => { setEditor(next); setBaseline(JSON.stringify(payload(next))); setPreview(null); setNotice(''); setError(''); };
  async function refresh() {
    const result = await rpc<{ prompts: PromptSummary[]; directory: string; warnings: string[] }>('prompt.list', {});
    setItems(result.prompts); setDirectory(result.directory); setWarnings(result.warnings); return result.prompts;
  }
  async function work(label: string, action: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(message(e)); } finally { lock.current = false; setBusy(''); }
  }
  function leave(action: () => void) {
    if (lock.current) return;
    if (dirty) setConfirmation({ text: 'Discard the unsaved changes to this prompt?', label: 'Discard changes', action }); else action();
  }
  function fromDraft() {
    setEditor({ ...blank(mode, buildKind), name: draft.trim().split('\n')[0]!.replace(/^#+\s*/, '').slice(0, 120), text: draft,
      files: draftFiles.map(f => ({ ...f, attachmentId: f.id })) }); setBaseline(''); setPreview(null); setNotice('');
  }
  useEffect(() => {
    dialog.current?.showModal();
    void work('Loading prompts…', async () => {
      const list = await refresh();
      if (startWithDraft) fromDraft(); else {
        const first = list.find(p => p.mode === mode || p.mode === 'all');
        if (first) change(edit(await rpc<SavedPrompt>('prompt.get', { id: first.id })));
      }
    });
  }, []);
  function choose(id: string) { leave(() => { void work('Opening prompt…', async () => change(edit(await rpc<SavedPrompt>('prompt.get', { id })))); }); }
  async function save() {
    const saved = await commands.current.execute(JSON.stringify(payload(editor)), 'prompt.save', payload(editor) as unknown as Record<string, unknown>, rpc) as SavedPrompt;
    change(edit(saved)); await refresh(); setNotice('Saved with its files.'); return saved;
  }
  function usePrompt(run: boolean, replace = false) {
    if (!replace && (draft.trim() || draftFiles.length) && (draft !== editor.text || draftFiles.length !== editor.files.length || editor.files.some((f, i) => f.attachmentId !== draftFiles[i]?.id))) {
      setConfirmation({ text: 'Replace the current composer text and attachments with this saved prompt?', label: 'Replace draft', action: () => usePrompt(run, true) }); return;
    }
    void work(run ? 'Starting prompt…' : 'Loading prompt…', async () => {
      const prompt = dirty || !editor.revision ? await save() : editor;
      const prepared = await commands.current.execute(`prepare:${prompt.id}:${prompt.revision}`, 'prompt.prepare', { id: prompt.id, revision: prompt.revision }, rpc) as PreparedPrompt;
      await onUse(prepared, run); onClose();
    });
  }
  function remove() {
    setConfirmation({ text: `Delete “${editor.name}” and its saved files? Earlier runs keep their own copies.`, label: 'Delete prompt', action: () => {
      void work('Deleting prompt…', async () => {
        await commands.current.execute(`delete:${editor.id}:${editor.revision}`, 'prompt.delete', { id: editor.id, revision: editor.revision }, rpc);
        change(blank(mode, buildKind)); await refresh(); setNotice('Prompt deleted.');
      });
    } });
  }
  function importPrompt(file: File) {
    leave(() => { void work('Importing prompt…', async () => {
      if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 64000) throw new Error('Import a Markdown or text file of at most 16,000 characters.');
      const text = await file.text(); if (!text.trim() || text.length > 16000 || text.includes('\0')) throw new Error('The prompt must contain 1–16,000 text characters.');
      setEditor({ ...blank(mode, buildKind), name: file.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 120), text }); setBaseline(''); setPreview(null); setNotice('Imported. Save to add it to your library.');
    }); });
  }
  function addFiles(files: File[]) {
    void work('Adding files…', async () => {
      if (editor.files.length + files.length > 8) throw new Error('Each prompt can hold up to 8 files.');
      const names = new Set(editor.files.map(f => f.name.toLowerCase()));
      for (const file of files) { if (names.has(file.name.toLowerCase())) throw new Error(`A file named ${file.name} is already attached. Rename or remove it first.`); names.add(file.name.toLowerCase()); }
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
        const added = await rpc<AttachmentRef>('attachment.add', { name: file.name, mediaType: file.type, data: await readBase64(file) });
        setEditor(e => ({ ...e, files: [...e.files, { ...added, attachmentId: added.id }] }));
      }
    });
  }
  async function fileData(file: EditorFile) {
    return file.attachmentId ? rpc<PromptFile & { data: string }>('attachment.get', { id: file.attachmentId }) : rpc<PromptFile & { data: string }>('prompt.file', { id: editor.id, fileId: file.id });
  }
  const blocked = runBlocked(editor.mode, editor.buildKind), valid = !!editor.name.trim() && !!editor.text.trim();
  return <dialog ref={dialog} className="prompt-manager" aria-labelledby="prompt-manager-title" onCancel={e => { e.preventDefault(); leave(onClose); }}>
    <header className="library-heading"><div><h2 id="prompt-manager-title"><Icon.folder/>Prompt library</h2><p>Save a prompt once. Keep its files together. Use it in Prompt, Debate, or Build.</p></div><button className="icon-btn" aria-label="Close prompt library" disabled={!!busy} onClick={() => leave(onClose)}><Icon.close/></button></header>
    <div className="library-layout" inert={!!confirmation}>
      <aside className="library-browser">
        <div className="library-tools"><button className="button" disabled={!!busy} onClick={() => leave(() => { change(blank(mode, buildKind)); })}>New prompt</button><button className="button" disabled={!!busy} onClick={() => imports.current?.click()}>Import .md / .txt</button></div>
        <input ref={imports} type="file" hidden accept=".md,.markdown,.txt" onChange={e => { const file = e.target.files?.[0]; if (file) importPrompt(file); e.target.value = ''; }}/>
        <label className="library-search"><Icon.search/><input type="search" aria-label="Search saved prompts" placeholder="Search prompts and files" value={query} onChange={e => setQuery(e.target.value)}/></label>
        <label className="library-filter"><span>Show</span><select aria-label="Filter prompts by mode" value={filter} onChange={e => setFilter(e.target.value as PromptMode | '*')}><option value="*">All modes</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="icon-btn" aria-label="Refresh prompt library" disabled={!!busy} onClick={() => { void work('Refreshing…', async () => { await refresh(); }); }}><Icon.refresh/></button></label>
        <nav className="library-list" aria-label="Saved prompts">{visible.map(p => <button key={p.id} aria-current={p.id === editor.id ? 'true' : undefined} disabled={!!busy} onClick={() => choose(p.id)}><strong>{p.name}</strong><span>{labels[p.mode]}{p.mode === 'build' && p.buildKind === 'review' ? ' · Review' : ''} · {p.files.length} files</span><p>{p.excerpt}</p></button>)}{!visible.length && <p className="library-empty">{busy ? 'Loading…' : 'No prompts here yet. Create one or import a Markdown file.'}</p>}</nav>
        <div className="library-location"><span>Saved on this computer</span><code>{directory || 'Loading folder…'}</code><button className="link" disabled={!directory} onClick={() => { void work('Copying folder…', async () => { await navigator.clipboard.writeText(directory); setNotice('Folder path copied.'); }); }}>Copy folder path</button></div>
      </aside>
      <section className="library-editor" aria-label="Prompt editor">
        <div className="library-editor-tools"><span>{editor.revision ? 'Saved prompt' : 'New prompt'}{dirty ? ' · Unsaved changes' : ''}</span><button className="link" disabled={!!busy || !draft.trim() || draftBlocked} title={draftBlocked ? 'Wait for attachments to finish uploading and remove any failed files.' : 'Copy the current composer and attachments into a new saved prompt'} onClick={() => leave(fromDraft)}>Use current draft</button></div>
        <label className="library-field"><span>Name</span><input aria-label="Prompt name" placeholder="Give this prompt a name" maxLength={120} value={editor.name} disabled={!!busy} onChange={e => setEditor(p => ({ ...p, name: e.target.value }))}/></label>
        <div className="library-mode"><label className="library-field"><span>Mode</span><select aria-label="Saved prompt mode" value={editor.mode} disabled={!!busy} onChange={e => setEditor(p => ({ ...p, mode: e.target.value as PromptMode }))}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{editor.mode === 'build' && <label className="library-field"><span>Task</span><select aria-label="Saved build task" value={editor.buildKind} disabled={!!busy} onChange={e => setEditor(p => ({ ...p, buildKind: e.target.value as 'build' | 'review' }))}><option value="build">Build</option><option value="review">Review</option></select></label>}</div>
        <label className="library-field library-text"><span>Prompt <small>Markdown · {editor.text.length.toLocaleString()} / 16,000</small></span><textarea aria-label="Saved prompt text" placeholder="Write the instructions for both agents…" value={editor.text} disabled={!!busy} maxLength={16000} spellCheck={false} onChange={e => setEditor(p => ({ ...p, text: e.target.value }))}/></label>
        <section className="library-files" aria-label="Prompt files" onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!busy) addFiles([...e.dataTransfer.files]); }}>
          <header><h3>Files <small>{editor.files.length} / 8</small></h3><button className="button" disabled={!!busy || editor.files.length >= 8} onClick={() => attachments.current?.click()}><Icon.attach/> Add files</button></header>
          <input ref={attachments} type="file" hidden multiple onChange={e => { if (e.target.files) addFiles([...e.target.files]); e.target.value = ''; }}/>
          {!editor.files.length && <p>Drop reference images or text files here. They will be included when you load or run this prompt.</p>}
          {editor.files.map(file => <div className="library-file" key={file.id}><Icon.file/><input aria-label={`Filename for ${file.name}`} value={file.name} maxLength={160} disabled={!!busy} onChange={e => setEditor(p => ({ ...p, files: p.files.map(f => f.id === file.id ? { ...f, name: e.target.value } : f) }))}/><small>{bytes(file.size)}</small>
            <button className="icon-btn" aria-label={`Preview ${file.name}`} disabled={!!busy} onClick={() => { void work('Opening file…', async () => { const data = await fileData(file); setPreview({ ...data, name: file.name }); }); }}><Icon.file/></button>
            <button className="icon-btn" aria-label={`Download ${file.name}`} disabled={!!busy} onClick={() => { void work('Downloading file…', async () => { const data = await fileData(file); download(file.name, new Blob([Uint8Array.from(atob(data.data), c => c.charCodeAt(0))], { type: data.mediaType })); }); }}><Icon.download/></button>
            <button className="icon-btn" aria-label={`Remove saved file ${file.name}`} disabled={!!busy} onClick={() => { setEditor(p => ({ ...p, files: p.files.filter(f => f.id !== file.id) })); setPreview(null); }}><Icon.close/></button>
          </div>)}
          {preview && <div className="library-preview"><header><strong>{preview.name}</strong><button className="icon-btn" aria-label="Close file preview" onClick={() => setPreview(null)}><Icon.close/></button></header>{preview.kind === 'image' ? <img src={`data:${preview.mediaType};base64,${preview.data}`} alt={preview.name}/> : <pre>{new TextDecoder().decode(Uint8Array.from(atob(preview.data), c => c.charCodeAt(0)))}</pre>}</div>}
        </section>
        <div className="library-secondary"><button className="link" disabled={!!busy || !editor.text} onClick={() => download(`${editor.name.replace(/[<>:"/\\|?*]/g, '-') || 'prompt'}.md`, new Blob([editor.text], { type: 'text/markdown;charset=utf-8' }))}>Export Markdown</button>{editor.revision && <button className="link" disabled={!!busy} onClick={() => leave(() => { void work('Reloading…', async () => change(edit(await rpc<SavedPrompt>('prompt.get', { id: editor.id })))); })}>Reload saved version</button>}{editor.revision && <button className="link destructive" disabled={!!busy} onClick={remove}>Delete prompt</button>}</div>
      </section>
    </div>
    <footer className="library-footer">
      {warnings.length > 0 && <details className="library-warnings"><summary>{warnings.length} saved prompt(s) need attention</summary>{warnings.map(w => <p key={w}>{w}</p>)}</details>}
      {error && <p role="alert" className="library-error">{error}</p>}
      {confirmation ? <div className="library-confirm" role="alert"><span>{confirmation.text}</span><button className="button" autoFocus onClick={() => setConfirmation(null)}>Cancel</button><button className="button destructive" onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>{confirmation.label}</button></div>
        : <><p role="status">{busy || notice || blocked || 'Loading fills the composer. Running sends to both agents with the room’s current options.'}</p><div className="library-actions"><button className="button" disabled={!!busy || !valid} onClick={() => { void work('Saving prompt…', async () => { await save(); }); }}>Save prompt</button><button className="button" disabled={!!busy || !valid} onClick={() => usePrompt(false)}>Load into composer</button><button className="button primary" disabled={!!busy || !valid || !!blocked} title={blocked || 'Save and run this prompt with both agents'} onClick={() => usePrompt(true)}><Icon.play/> Run now</button></div></>}
    </footer>
  </dialog>;
}
