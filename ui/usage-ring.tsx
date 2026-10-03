import { useEffect, useRef, useState } from 'react';
import type { AgentUsage, Provider } from '../src/types';

// Each agent's context and usage, the way Claude shows its own: a small ring beside the agent's status that fills as its
// context window does, and a popover (click) with the numbers. Claude's ring fills with plan usage, but the CLIs don't pass
// their plan limits to AvA, and context is what changes during a run, so here the ring is the context window.
const WARN_AT = 0.8, FULL_AT = 0.95;
// Where each CLI shows its own plan limits (5-hour and weekly windows), since it doesn't report them to AvA.
const PLAN_HINT: Partial<Record<Provider, string>> = {
  codex: 'Codex doesn’t pass its plan limits to AvA. See them with /status in Codex.',
  claude: 'Claude Code doesn’t pass its plan limits to AvA. See them with /usage in Claude Code.',
  'grok-build': 'Grok Build doesn’t report plan usage to AvA.',
  antigravity: 'Antigravity doesn’t report plan usage to AvA.',
};
// 709.2k, 1M, 258.4k: Claude's style.
export function tokens(n: number) {
  const short = (v: number, unit: string) => `${(Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`;
  return n >= 1_000_000 ? short(n / 1_000_000, 'M') : n >= 1000 ? short(n / 1000, 'k') : String(n);
}
const money = (c: { amount?: number; currency?: string }) => c.amount === undefined ? '' : `${c.currency && c.currency !== 'USD' ? `${c.currency} ` : '$'}${c.amount.toFixed(2)}`;
const ago = (at: number) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; };

export function UsageRing({ name, provider, usage }: { name: string; provider: Provider | undefined; usage: AgentUsage | null | undefined }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const context = usage?.context, share = context ? Math.min(1, context.used / context.size) : 0, percent = Math.round(share * 100);
  const tone = !context ? 'unknown' : share >= FULL_AT ? 'full' : share >= WARN_AT ? 'warn' : '';
  const label = context ? `${name}: ${percent}% of its context window used (${tokens(context.used)} of ${tokens(context.size)} tokens)` : `${name}: context not reported yet`;
  // A 16 px ring: r 6.5 on a 2 px stroke; the arc starts at 12 o'clock.
  const r = 6.5, around = 2 * Math.PI * r;
  const hasCost = usage?.cost?.amount !== undefined, t = usage?.tokens, shown = t && [['Input', t.input], ['Output', t.output], ['Cached', t.cachedRead]].filter((row): row is [string, number] => typeof row[1] === 'number');
  return <div className="usage-wrap" ref={ref}>
    <button ref={button} className={`usage-ring ${tone}`} aria-label={`${label}. Show context and usage`} title={context ? `Context ${percent}%` : 'Context and usage'} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="track" cx="8" cy="8" r={r} />
        {context && share > 0 && <circle className="fill" cx="8" cy="8" r={r} strokeDasharray={`${Math.max(share * around, 1.2)} ${around}`} transform="rotate(-90 8 8)" />}
      </svg>
    </button>
    {open && <div className="usage-pop" role="dialog" aria-label={`${name}: context and usage`}>
      <section>
        <div className="usage-row"><strong>Context window</strong>{context && <span className={`usage-pct ${tone}`}>{percent}%</span>}</div>
        {context ? <>
          <div className="usage-bar" aria-hidden="true"><i className={tone} style={{ width: `${Math.max(percent, 1)}%` }} /></div>
          <p>{tokens(context.used)} / {tokens(context.size)} tokens{share >= WARN_AT ? `. ${share >= FULL_AT ? 'Nearly full: the agent may compact or forget earlier turns.' : 'Getting full.'}` : ''}</p>
        </> : <p className="muted">{provider === 'grok-build' || provider === 'antigravity' ? `${name} doesn’t report its context window to AvA.` : 'Reported after the agent’s next reply.'}</p>}
      </section>
      {(!!shown?.length || hasCost) && <section>
        <div className="usage-row"><strong>This session</strong></div>
        {shown && shown.length > 0 && <dl>{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{tokens(v)}</dd></div>)}</dl>}
        {hasCost && <dl><div title="The agent's own estimate at API prices. A subscription login isn't billed per request."><dt>Cost at API prices</dt><dd>{money(usage!.cost!)}</dd></div></dl>}
      </section>}
      <section>
        <div className="usage-row"><strong>{provider === 'vercel' ? 'Gateway credit' : 'Plan usage'}</strong></div>
        {provider === 'vercel' ? usage?.credit ? <dl><div><dt>Left</dt><dd>${usage.credit.balance.toFixed(2)}</dd></div>{usage.credit.used !== undefined && <div><dt>Used</dt><dd>${usage.credit.used.toFixed(2)}</dd></div>}</dl>
          : <p className="muted">Checking the key’s credit…</p>
          : <p className="muted">{(provider && PLAN_HINT[provider]) ?? 'Not reported to AvA.'}</p>}
      </section>
      {usage && <p className="usage-foot">Updated {ago(usage.at)}</p>}
    </div>}
  </div>;
}
