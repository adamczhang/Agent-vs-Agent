import type { Catalog, ConfigOption } from './providers.js';
import type { ProviderConfig, Seat } from './types.js';
export const RUN_PROFILES = {
  quick: { name: 'Quick', effort: 'low', timeMs: 60000 },
  standard: { name: 'Standard', effort: 'medium', timeMs: 120000 },
  deep: { name: 'Deep', effort: 'high', timeMs: 300000 },
} as const;
export type RunProfile = keyof typeof RUN_PROFILES;
export interface ProfileChoice { config: ProviderConfig; effort: string; note?: string }
export interface ProfilePlan { profile: RunProfile; timeMs: number; agents: Record<Seat, ProfileChoice> }
export function profileChoice(config: ProviderConfig, controls: ConfigOption[], profile: RunProfile): ProfileChoice {
  const wanted = RUN_PROFILES[profile].effort, control = controls.find(c => /effort/i.test(c.id));
  if (!control?.options.length) return { config: { ...config }, effort: config.effort?.value ?? 'provider default', note: 'This model exposes no selectable effort; its current effort is retained.' };
  const levels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const candidates = control.options.filter(o => levels.includes(o.value.toLowerCase()));
  const selected = control.options.find(o => o.value.toLowerCase() === wanted) ?? candidates.sort((a, b) => Math.abs(levels.indexOf(a.value.toLowerCase()) - levels.indexOf(wanted)) - Math.abs(levels.indexOf(b.value.toLowerCase()) - levels.indexOf(wanted)) || levels.indexOf(a.value.toLowerCase()) - levels.indexOf(b.value.toLowerCase()))[0];
  if (!selected) return { config: { ...config }, effort: config.effort?.value ?? control.currentValue, note: 'The available effort choices do not map to this preset; the current setting is retained.' };
  return { config: { ...config, effort: { key: control.id, value: selected.value } }, effort: selected.value, ...(selected.value.toLowerCase() !== wanted ? { note: `${wanted} is unavailable; this model will use ${selected.value}.` } : {}) };
}
export async function planProfile(agents: Record<Seat, ProviderConfig>, profile: RunProfile, catalog: (config: ProviderConfig) => Promise<Catalog>): Promise<ProfilePlan> {
  const [cli1, cli2] = await Promise.all((['cli1', 'cli2'] as const).map(async seat => profileChoice(agents[seat], (await catalog(agents[seat])).controls, profile)));
  return { profile, timeMs: RUN_PROFILES[profile].timeMs, agents: { cli1: cli1!, cli2: cli2! } };
}
