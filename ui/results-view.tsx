import { useEffect, useState } from 'react';
import type { Seat } from '../src/types';
import { rpc } from './api';
import { Icon } from './icons';
import { seats, type ThreadRun } from './model';

// What build.preview returns: the agent's app (a page AvA serves on its own origin, or a server the agent left running).
export interface AppLink { kind?: 'static' | 'server'; url?: string; entry?: string; named?: boolean; error?: string }
interface FileChange { path: string; status: 'added' | 'modified' | 'deleted' | 'changed'; added: number | null; removed: number | null }
interface Changes { files: FileChange[]; totalFiles: number; added: number; removed: number; patch: string; truncated: boolean }
export type ResultsTab = 'preview' | 'changes';
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const STATUS_MARK: Record<FileChange['status'], string> = { added: 'A', modified: 'M', deleted: 'D', changed: 'C' };
// Sandboxed, but with its own origin kept (allow-same-origin) so the app can use its storage; it is a different
// origin from the room, so it can't reach the room or its token.
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock allow-popups allow-downloads';

// Opens an agent's app in a new tab, asking for a fresh link first (a preview server may have been recycled).
export function openApp(runId: string, seat: Seat, onError: (text: string) => void) {
  void rpc<AppLink>('build.preview', { runId, seat }).then(link => { if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer'); }).catch(e => onError(message(e)));
}

// The Results switch (apps or changes, and which prompt), shown in the row under the two results.
export function ResultsTabs({ runs, runId, tab, onChange }: { runs: ThreadRun[]; runId: string; tab: ResultsTab; onChange: (next: { runId: string; tab: ResultsTab }) => void }) {
  return <div className="results-tabs">
    {runs.length > 1 && <select aria-label="Prompt" value={runId} onChange={e => onChange({ runId: e.target.value, tab })}>
      {runs.map((r, i) => <option key={r.id} value={r.id}>Prompt {i + 1}: {r.config.topic.slice(0, 60)}</option>)}</select>}
    <div className="segmented" role="tablist" aria-label="Results view">
      {([['preview', 'Apps'], ['changes', 'Changes']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} aria-pressed={tab === value} onClick={() => onChange({ runId, tab: value })}>{label}</button>)}
    </div>
  </div>;
}
// Both agents' results side by side, each under its own agent's screen: their apps running, or what each changed.
// reported: whether each agent's build report is in (its app link is asked for again when it arrives).
export function ResultsView({ run, tab, live, agentName, reported }: { run: ThreadRun; tab: ResultsTab; live: boolean; agentName: (seat: Seat) => string; reported: Record<Seat, boolean> }) {
  return <div className="results-grid" aria-label={tab === 'preview' ? 'Both apps' : 'What each agent changed'}>
    {seats.map(seat => tab === 'preview' ? <AppPane key={run.id + seat} runId={run.id} seat={seat} name={agentName(seat)} live={live} reported={reported[seat]} />
      : <ChangesPane key={run.id + seat} runId={run.id} seat={seat} name={agentName(seat)} live={live} />)}
  </div>;
}

function AppPane({ runId, seat, name, live, reported }: { runId: string; seat: Seat; name: string; live: boolean; reported: boolean }) {
  const [link, setLink] = useState<AppLink | null>(null), [nonce, setNonce] = useState(0);
  useEffect(() => {
    let current = true;
    rpc<AppLink>('build.preview', { runId, seat }).then(l => { if (current) setLink(l); }).catch(e => { if (current) setLink({ error: message(e) }); });
    return () => { current = false; };
  }, [runId, seat, nonce, reported]);
  const where = link?.kind === 'server' && link.url ? new URL(link.url).host : link?.entry || (link?.url ? 'its folder' : '');
  return <section className={`result-col ${seat}`} aria-label={`${name}'s app`}>
    <header><span className="seat-dot" /><strong>{name}</strong><span className="result-meta" title={link?.named === false ? 'It didn’t name its app, so this is the page AvA found' : undefined}>{where}{link?.named === false && where ? ' (found)' : ''}</span>
      <button className="icon-btn small" aria-label={`Reload ${name}'s app`} title="Reload" onClick={() => setNonce(n => n + 1)}><Icon.refresh /></button>
      {link?.url && <button className="icon-btn small" aria-label={`Open ${name}'s app in a new tab`} title="Open in a new tab" onClick={() => openApp(runId, seat, text => setLink({ error: text }))}><Icon.external /></button>}
    </header>
    {link?.error ? <p className="result-empty">{link.error}</p>
      : link?.url ? <iframe key={nonce} src={link.url} title={`${name}'s app`} sandbox={FRAME_SANDBOX} />
      : <p className="result-empty">{live ? 'Waiting for its app…' : 'Loading…'}</p>}
  </section>;
}

function ChangesPane({ runId, seat, name, live }: { runId: string; seat: Seat; name: string; live: boolean }) {
  const [changes, setChanges] = useState<Changes | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const load = () => rpc<Changes>('build.changes', { runId, seat }).then(c => { if (current) { setChanges(c); setError(''); } }).catch(e => { if (current) setError(message(e)); });
    void load(); const timer = live ? setInterval(load, 4000) : undefined;
    return () => { current = false; if (timer) clearInterval(timer); };
  }, [runId, seat, live]);
  // The patch, one part per file, in the same order as the file list.
  const parts = changes?.patch ? changes.patch.split(/^(?=diff --git )/m).filter(p => p.startsWith('diff --git ')) : [];
  return <section className={`result-col ${seat}`} aria-label={`What ${name} changed`}>
    <header><span className="seat-dot" /><strong>{name}</strong>
      {changes && <span className="result-meta">{changes.totalFiles === 1 ? '1 file' : `${changes.totalFiles} files`} · <span className="plus">+{changes.added}</span> <span className="minus">−{changes.removed}</span></span>}</header>
    <div className="changes">
      {error ? <p className="result-empty">{error}</p> : !changes ? <p className="result-empty">Loading…</p> : !changes.files.length ? <p className="result-empty">No changes{live ? ' yet' : ''}.</p>
        : changes.files.map((file, i) => {
          const part = parts.find(p => p.includes(` b/${file.path}\n`) || p.includes(` a/${file.path}\n`)) ?? parts[i] ?? '';
          const lines = part.split('\n'), from = lines.findIndex(l => l.startsWith('@@')), body = from < 0 ? [] : lines.slice(from, from + 1500);
          return <details key={file.path} open={changes.files.length <= 4}>
            <summary><span className={`file-status ${file.status}`} title={file.status}>{STATUS_MARK[file.status]}</span><span className="file-path">{file.path}</span>
              <span className="file-counts">{file.added === null ? 'binary' : <><span className="plus">+{file.added}</span> <span className="minus">−{file.removed}</span></>}</span></summary>
            {body.length ? <pre className="patch">{body.map((line, n) => <span key={n} className={line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : undefined}>{line}{'\n'}</span>)}</pre>
              : <p className="result-empty small">{file.added === null ? 'Binary file' : 'No text changes shown'}</p>}
          </details>;
        })}
      {changes?.truncated && <p className="result-empty small">The change is too large to show in full.</p>}
    </div>
  </section>;
}
