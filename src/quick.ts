import type { ConfigOption } from './providers.js';
import type { Store } from './store.js';
import type { Provider, ProviderConfig, Seat } from './types.js';

// Quick activate (owner, 2026-10-03): one click activates an agent with the settings it last activated with: CLI,
// model, effort, speed, permissions and internet. With none yet: the CLI's strongest model at high effort, Ask
// permissions and internet off.
export interface QuickSettings { config: ProviderConfig; permissions: 'ask' | 'bypass'; internet: boolean }
// What a Quick activate would use, for the button's description. source "default": no settings remembered yet.
export interface QuickPlan { source: 'last' | 'default'; provider: Provider; model?: string; effort?: string; speed?: string; permissions: 'ask' | 'bypass'; internet: boolean }
// The CLI an agent starts with when nothing is remembered for it.
export const SEAT_DEFAULT: Record<Seat, Provider> = { cli1: 'claude', cli2: 'codex' };

// Remembered per agent (the CLI it last used) and per CLI (that CLI's last settings), in app_settings.
export class QuickMemory {
  constructor(private store: Store) {}
  private get(key: string): QuickSettings | undefined {
    const row = this.store.db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
    try { return row ? JSON.parse(String(row.value)) as QuickSettings : undefined; } catch { return undefined; }
  }
  private set(key: string, value: QuickSettings) { this.store.db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  remember(seat: Seat, settings: QuickSettings) { this.set(`quick:seat:${seat}`, settings); this.set(`quick:provider:${settings.config.provider}`, settings); }
  // The CLI to use: the one chosen for this agent, else the one it last used, else its default.
  provider(seat: Seat, chosen?: Provider) { return chosen ?? this.get(`quick:seat:${seat}`)?.config.provider ?? SEAT_DEFAULT[seat]; }
  settings(provider: Provider) { return this.get(`quick:provider:${provider}`); }
  plan(seat: Seat, chosen?: Provider): QuickPlan {
    const provider = this.provider(seat, chosen), saved = this.settings(provider);
    if (!saved) return { source: 'default', provider, effort: 'high', permissions: 'ask', internet: false };
    const { config } = saved;
    return { source: 'last', provider, model: config.modelName ?? config.model, ...(config.effort ? { effort: config.effort.value } : {}), ...(config.speed ? { speed: config.speed.value } : {}), permissions: saved.permissions, internet: saved.internet };
  }
}

// What Quick activate will do, in words: "Claude Code · Opus 5.5 · high effort · Ask · internet off (last used)".
export function describeQuick(plan: QuickPlan, name: string) {
  const speed = plan.speed ? (/^(on|true|fast|priority)$/i.test(plan.speed) ? 'Fast' : '') : '';
  return [name, plan.model ?? 'its strongest model', plan.effort ? `${plan.effort} effort` : '', speed, plan.permissions === 'bypass' ? 'Bypass' : 'Ask', `internet ${plan.internet ? 'on' : 'off'}`].filter(Boolean).join(' · ')
    + (plan.source === 'last' ? ' (last used)' : ' (defaults)');
}
// Variants that trade strength for speed or cost: never the default pick when a full model is listed.
const LIGHT = /\b(fast|flash|mini|lite|nano|haiku|luna|small)\b/i;
// The CLI's strongest model. CLIs list their models best first (after their "default" entry), so the first full model
// wins: Opus for Claude Code, the top GPT for Codex, the newest Grok. Antigravity lists each Gemini at High, Medium and
// Low, newest Flash first, so its Pro model at High comes first there.
export function strongestModel(provider: Provider, models: Array<{ id: string; name: string }>) {
  const real = models.filter(m => !/^(default|auto)$/i.test(m.id) && !/recommended/i.test(m.name));
  if (provider === 'antigravity') return real.find(m => /\bpro\b/i.test(m.name) && /\(high\)/i.test(m.name)) ?? real.find(m => /\(high\)/i.test(m.name)) ?? real[0];
  return real.find(m => !LIGHT.test(m.name) && !LIGHT.test(m.id)) ?? real[0];
}
// High reasoning, where the CLI has an effort setting with that choice.
export function highEffort(controls: ConfigOption[]) {
  const control = controls.find(c => /effort/i.test(c.id));
  const high = control?.options.find(o => /^high$/i.test(o.value));
  return control && high ? { key: control.id, value: high.value } : undefined;
}
