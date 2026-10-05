import { useEffect, useState } from 'react';
import { RUN_PROFILES, type ProfilePlan, type RunProfile } from '../src/run-profiles.js';
import type { ProviderConfig, Seat } from '../src/types.js';
import { names } from './model.js';
import { rpc } from './api.js';
export function ProfileSelector({ pairId, agents, value, onChange, unit = 'answer' }: { pairId?: string; agents?: Partial<Record<Seat, ProviderConfig | null>>; value: RunProfile | ''; onChange: (profile: RunProfile | '', timeMs?: number) => void; unit?: string }) {
  const [plan, setPlan] = useState<ProfilePlan>(), [error, setError] = useState('');
  const key = JSON.stringify(agents);
  useEffect(() => {
    setPlan(undefined); setError(''); let active = true;
    if (pairId && value) void rpc<ProfilePlan>('profile.plan', { pairId, profile: value }).then(p => { if (active) setPlan(p); }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [pairId, value, key]);
  return <div className="profile-selector">
    <label>Performance<select aria-label="Performance preset" value={value} onChange={e => { const v = e.target.value as RunProfile | ''; onChange(v, v ? RUN_PROFILES[v].timeMs : undefined); }}><option value="">Custom · keep current effort</option>{Object.entries(RUN_PROFILES).map(([id, p]) => <option key={id} value={id}>{p.name} · {p.effort} · {p.timeMs / 1000}s/{unit}</option>)}</select></label>
    {value && <p className="resource-note">{RUN_PROFILES[value].timeMs / 1000} seconds per {unit}. The selected models are retained; fresh sessions apply the effort settings when you start.</p>}
    {value && !plan && !error && <p className="resource-note" role="status">Checking supported effort settings…</p>}
    {plan && (['cli1', 'cli2'] as const).map(seat => <p className="resource-note" key={seat}>Agent {seat === 'cli1' ? 1 : 2}: {names[plan.agents[seat].config.provider]} · {plan.agents[seat].config.modelName ?? plan.agents[seat].config.model} · <strong>{plan.agents[seat].effort} effort</strong>{plan.agents[seat].note && ` · ${plan.agents[seat].note}`}</p>)}
    {error && <p role="alert">Preset preview unavailable: {error}</p>}
  </div>;
}
