import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../src/types';
import { rpc } from './api';
import { Icon } from './icons';

// The same text menu the hosts show for /ava CLI1 and /ava CLI2 (src/menus.ts), in a small window over the agent's
// screen: every numbered line is clickable, or type its number. Nothing here needs a terminal command.
interface MenuChoice { label: string; value: string }
interface Menu { id: string; phase: string; title: string; choices: MenuChoice[]; text: string; search?: boolean; context?: { query?: string } }
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

// startPhase: open at that menu (the header's CLI name opens the list of CLIs).
export function AgentSetup({ pairId, seat, onClose, onError, confirmActivate, startPhase }: { pairId: string; seat: Seat; onClose: () => void; onError: (text: string) => void; confirmActivate: () => Promise<boolean>; startPhase?: string }) {
  const [menu, setMenu] = useState<Menu | null>(null), [busy, setBusy] = useState('Loading…'), [typed, setTyped] = useState(''), [query, setQuery] = useState('');
  // A long model list (the Vercel AI Gateway's) can be searched: the result is a numbered menu like the others.
  async function search(text: string) {
    setBusy('Searching…');
    try { setMenu(await rpc<Menu>('menu.search', { pairId, seat, query: text })); } catch (e) { onError(message(e)); } finally { setBusy(''); }
  }
  const input = useRef<HTMLInputElement>(null), number = seat === 'cli1' ? 1 : 2;
  async function load(phase?: string) {
    setBusy('Loading…');
    try { setMenu(await rpc<Menu>('menu.show', { pairId, seat, ...(phase ? { phase } : {}) })); } catch (e) { onError(message(e)); } finally { setBusy(''); }
  }
  useEffect(() => { void load(startPhase && startPhase !== 'home' ? startPhase : undefined); }, [pairId, seat, startPhase]);
  useEffect(() => { if (!busy) input.current?.focus(); }, [busy, menu?.id]);
  async function choose(choice: string) {
    if (!menu || busy) return;
    const item = /^\d+$/.test(choice) ? menu.choices[Number(choice) - 1] : undefined;
    if (/^\d+$/.test(choice) && !item) { onError('Choose a number from the menu.'); return; }
    if (item?.value === 'activate' && !(await confirmActivate())) return;
    setBusy(item?.value === 'activate' ? 'Activating… one short model request to check access' : 'Loading…'); setTyped('');
    try {
      const result = await rpc<{ menu: Menu; activation?: unknown }>('menu.choose', { pairId, seat, menuId: menu.id, choice });
      // A successful activation is the end of setup: the window closes, and the agent's header shows it ready.
      if (item?.value === 'activate' && result.activation) { onClose(); return; }
      setMenu(result.menu);
    }
    // A stale menu (the agent changed elsewhere) just reloads.
    catch (e) { onError(message(e)); await load(); }
    finally { setBusy(''); }
  }
  // The screen: the menu's own text lines, with its numbered choices as buttons. Its last line tells host users what
  // to type; here a click or a typed number does it.
  const lines = menu ? menu.text.split('\n').filter(l => !/^Reply: /.test(l) && !/^B\. Back/.test(l)) : [];
  return <section className="setup" role="dialog" aria-label={`Set up Agent ${number}`} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <div className="setup-screen" aria-busy={!!busy}>
      {menu?.search && <form className="setup-search" onSubmit={e => { e.preventDefault(); void search(query); }}>
        <label><span aria-hidden="true">/</span><input aria-label="Search models" placeholder="Search all models (name or id), Enter" value={query} maxLength={100} disabled={!!busy} onChange={e => setQuery(e.target.value)} /></label>
      </form>}
      {lines.map((line, i) => {
        const match = line.match(/^(\d+)\. (.*)$/), choice = match ? menu!.choices[Number(match[1]) - 1] : undefined;
        if (!match || !choice) return <div key={i} className={`setup-text${i === 1 ? ' title' : ''}`}>{line}</div>;
        const tone = choice.value === 'activate' ? ' primary' : /^Permissions: Bypass|^Bypass/.test(choice.label) ? ' warn' : '';
        return <button key={i} type="button" className={`setup-line${tone}`} disabled={!!busy} onClick={() => void choose(match[1]!)}><span className="setup-key">{match[1]}.</span>{match[2]}</button>;
      })}
      {busy && <div className="setup-text busy" role="status">{busy}</div>}
    </div>
    <form className="setup-prompt" onSubmit={e => { e.preventDefault(); if (typed.trim()) void choose(typed.trim().toLowerCase()); }}>
      <button type="button" className="setup-line inline" disabled={!!busy || menu?.phase === 'home'} onClick={() => void choose('b')}><span className="setup-key">B.</span>Back</button>
      {/* The CLI can change at any time; a change takes effect when the agent is activated. */}
      <button type="button" className="setup-line inline" disabled={!!busy || menu?.phase === 'provider'} onClick={() => void load('provider')}><span className="setup-key">C.</span>Change CLI</button>
      <button type="button" className="setup-line inline" onClick={onClose}><span className="setup-key">X.</span>Close</button>
      <label><span aria-hidden="true">›</span><input ref={input} aria-label="Type a number, B, C or X" inputMode="numeric" maxLength={3} value={typed} disabled={!!busy} placeholder="number"
        onChange={e => { const v = e.target.value; if (/^x$/i.test(v)) { onClose(); return; } if (/^c$/i.test(v)) { setTyped(''); if (menu?.phase !== 'provider') void load('provider'); return; } setTyped(v.replace(/[^\dbB]/g, '')); }} /></label>
    </form>
    <button type="button" className="icon-btn small setup-close" aria-label="Close setup" onClick={onClose}><Icon.close /></button>
  </section>;
}
