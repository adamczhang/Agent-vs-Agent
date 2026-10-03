// Vercel AI Gateway: the fifth provider. Its agent is the Codex agent pointed at the Gateway (the same wiring Vercel's
// own `vercel ai-gateway setup` writes for Codex), configured per process so the user's Codex setup is never touched.
// It needs an AI Gateway API key: AI_GATEWAY_API_KEY from the environment, or AvA's own key, created on request with
// the user's Vercel CLI login and kept in the data folder. The key never leaves this module except into the agent's
// environment.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AvAError } from './types.js';

export const GATEWAY = {
  codexBaseUrl: 'https://ai-gateway.vercel.sh/codex/v1',
  modelsUrl: 'https://ai-gateway.vercel.sh/v1/models',
  keyName: 'agent-vs-agent',
};
export interface GatewayModel { id: string; name: string; maker: string; released: number; context: number; tags: string[]; efforts: string[] }

// ---- The key ----
const keyFile = (dataRoot: string) => join(dataRoot, 'secrets', 'ai-gateway.json');
// AVA_GATEWAY_KEY_DIR names another data folder whose stored key to use (the live scripts run in temporary folders but
// use the key stored in the shared one), so the key never has to sit in the process environment, where every agent
// would inherit it.
export function gatewayKey(dataRoot: string): { key: string; source: 'environment' | 'stored' } | undefined {
  if (process.env.AI_GATEWAY_API_KEY) return { key: process.env.AI_GATEWAY_API_KEY, source: 'environment' };
  for (const folder of [dataRoot, process.env.AVA_GATEWAY_KEY_DIR].filter((f): f is string => !!f)) {
    try { const stored = JSON.parse(readFileSync(keyFile(folder), 'utf8')) as { key?: unknown }; if (typeof stored.key === 'string' && stored.key) return { key: stored.key, source: 'stored' }; } catch { /* none here */ }
  }
  return undefined;
}
// What the menus may show about the key: where it comes from and its last characters, never the key.
export function gatewayKeyStatus(dataRoot: string) {
  const found = gatewayKey(dataRoot);
  if (!found) return { source: 'none' as const };
  let meta: { name?: string; budget?: string } = {};
  try { meta = JSON.parse(readFileSync(keyFile(dataRoot), 'utf8')); } catch { /* environment key */ }
  return { source: found.source, ending: found.key.slice(-4), ...(found.source === 'stored' ? { name: meta.name, budget: meta.budget } : {}) };
}
export function forgetGatewayKey(dataRoot: string) { rmSync(keyFile(dataRoot), { force: true }); }
export function saveGatewayKey(dataRoot: string, key: string, meta: { name: string; budget: string; id?: string }) {
  const file = keyFile(dataRoot); mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ key, ...meta, createdAt: new Date().toISOString() }), { mode: 0o600 });
}
// The key in an API response: the one string that looks like a Gateway key (a field named like one, or the vck_ prefix).
export function findKey(value: unknown): string | undefined {
  if (typeof value === 'string') return /^vck_[A-Za-z0-9_-]{16,}$/.test(value) ? value : undefined;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const name of ['apiKeyString', 'apiKey', 'key', 'token', 'secret']) { const v = record[name]; if (typeof v === 'string' && v.length >= 20 && !/\s/.test(v)) return v; }
  for (const v of Object.values(record)) { const found = findKey(v); if (found) return found; }
  return undefined;
}
// ---- Credit ----
// The key's credit (GET /v1/credits, which uses no model), for the room's usage popover. Read in the background at most
// once a minute; callers get the last answer at once (undefined until the first one arrives).
export function parseCredits(body: unknown): { balance: number; used?: number } | undefined {
  const r = body as { balance?: unknown; total_used?: unknown } | null, balance = Number(r?.balance), used = Number(r?.total_used);
  return Number.isFinite(balance) && r?.balance !== undefined && r?.balance !== null ? { balance, ...(Number.isFinite(used) && r?.total_used != null ? { used } : {}) } : undefined;
}
const credits = new Map<string, { value?: { balance: number; used?: number }; at: number; pending?: boolean }>();
export function gatewayCredit(dataRoot: string, fetcher: typeof fetch = fetch) {
  const key = gatewayKey(dataRoot)?.key; if (!key) return undefined;
  const cached = credits.get(key) ?? { at: 0 };
  if (!cached.pending && Date.now() - cached.at > 60_000) {
    cached.pending = true; credits.set(key, cached);
    void fetcher('https://ai-gateway.vercel.sh/v1/credits', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
      .then(async r => { if (r.ok) cached.value = parseCredits(await r.json()); })
      .catch(() => { /* keep the last answer */ })
      .finally(() => { cached.pending = false; cached.at = Date.now(); });
  }
  return cached.value;
}
export type RunVercel = (args: string[]) => Promise<string>;
// The Vercel CLI as the user installed it. On Windows that is an npm .cmd shim, which only cmd.exe can start, so the
// command line is built here from arguments that are fixed text or a number chosen from the menu (anything else is refused).
export const runVercel: RunVercel = args => new Promise((resolve, reject) => {
  if (args.some(a => !/^[A-Za-z0-9._:-]+$/.test(a))) { reject(new AvAError('VERCEL_CLI', 'Refused an unexpected Vercel CLI argument.')); return; }
  const [file, argv] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', `vercel ${args.join(' ')}`]] : ['vercel', args];
  execFile(file, argv, { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new AvAError('VERCEL_CLI', `The Vercel CLI failed: ${String(stderr || error.message).replace(/vck_[A-Za-z0-9_-]+/g, 'vck_…').trim().slice(0, 300)}`));
    else resolve(String(stdout));
  });
});
// Creates an AI Gateway key for AvA with the user's Vercel CLI login, with a monthly budget, and stores it.
export async function createGatewayKey(dataRoot: string, budget: number, run: RunVercel = runVercel) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 10_000) throw new AvAError('INVALID_BUDGET', 'Choose a budget from the menu.');
  const output = await run(['ai-gateway', 'api-keys', 'create', '--name', GATEWAY.keyName, '--limit', String(budget), '--refresh-period', 'monthly', '--non-interactive']);
  const start = output.indexOf('{'); let parsed: unknown;
  try { parsed = JSON.parse(output.slice(start)); } catch { parsed = output.match(/vck_[A-Za-z0-9_-]{16,}/)?.[0]; }
  const key = findKey(parsed);
  if (!key) throw new AvAError('VERCEL_KEY', 'The Vercel CLI created no readable key. Check `vercel whoami`, or set AI_GATEWAY_API_KEY yourself.');
  const id = parsed && typeof parsed === 'object' ? String((parsed as Record<string, unknown>).id ?? (parsed as { apiKey?: { id?: string } }).apiKey?.id ?? '') : '';
  saveGatewayKey(dataRoot, key, { name: GATEWAY.keyName, budget: `$${budget} a month`, ...(id ? { id } : {}) });
  return gatewayKeyStatus(dataRoot);
}

// ---- The models ----
const CODEX_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
// Language models that can call tools (an agent needs them). Each lists its reasoning efforts, from the model's own
// reasoning options: named efforts as given; a token budget or an on/off switch as low, medium and high (the Gateway
// maps the effort to the provider's control).
export function parseModels(body: unknown): GatewayModel[] {
  const list = (body as { data?: unknown[]; models?: unknown[] })?.data ?? (body as { models?: unknown[] })?.models ?? [];
  return (list as Array<Record<string, unknown>>).filter(m => m.type === 'language' && Array.isArray(m.tags) && (m.tags as string[]).includes('tool-use') && typeof m.id === 'string').map(m => {
    const options = Array.isArray(m.reasoning_options) ? m.reasoning_options as Array<{ type?: string; values?: string[] }> : [];
    // Only efforts the Codex agent can pass on (its model_reasoning_effort); "max" and the like aren't among them.
    const named = (options.find(o => o.type === 'effort' && Array.isArray(o.values))?.values ?? []).filter(v => CODEX_EFFORTS.includes(v));
    const efforts = named.length ? named : options.some(o => o.type === 'budget_tokens' || o.type === 'toggle' || o.type === 'effort') ? ['low', 'medium', 'high'] : [];
    const id = String(m.id);
    return { id, name: String(m.name ?? id), maker: String(m.owned_by ?? id.split('/')[0]), released: Number(m.released ?? m.created ?? 0), context: Number(m.context_window ?? 0), tags: m.tags as string[], efforts };
  });
}
const cacheFile = (dataRoot: string) => join(dataRoot, 'cache', 'gateway-models.json');
let memory: { at: number; models: GatewayModel[] } | undefined;
export type FetchModels = () => Promise<unknown>;
const fetchModels: FetchModels = async () => { const r = await fetch(GATEWAY.modelsUrl, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
// The Gateway's public model list (no key needed), cached for an hour, with the last copy on disk as a fallback.
export async function gatewayModels(dataRoot: string, fetcher: FetchModels = fetchModels): Promise<GatewayModel[]> {
  if (memory && Date.now() - memory.at < 3_600_000) return memory.models;
  try {
    const body = await fetcher(), models = parseModels(body);
    if (!models.length) throw new Error('empty list');
    memory = { at: Date.now(), models };
    try { mkdirSync(dirname(cacheFile(dataRoot)), { recursive: true }); writeFileSync(cacheFile(dataRoot), JSON.stringify(body)); } catch { /* cache only */ }
    return models;
  } catch (error) {
    if (existsSync(cacheFile(dataRoot))) { const models = parseModels(JSON.parse(readFileSync(cacheFile(dataRoot), 'utf8'))); if (models.length) return models; }
    throw new AvAError('GATEWAY_MODELS', `Couldn't load the AI Gateway model list (${error instanceof Error ? error.message : String(error)}).`);
  }
}
export function resetGatewayCache() { memory = undefined; }
// Makers by how they present themselves.
const MAKERS: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', xai: 'xAI', spacexai: 'xAI (SpaceX)', meta: 'Meta', mistral: 'Mistral', deepseek: 'DeepSeek', alibaba: 'Alibaba (Qwen)',
  zai: 'Z.ai (GLM)', moonshotai: 'Moonshot AI (Kimi)', minimax: 'MiniMax', amazon: 'Amazon', nvidia: 'NVIDIA', cohere: 'Cohere', bytedance: 'ByteDance', tencent: 'Tencent',
  inclusionai: 'inclusionAI', xiaomi: 'Xiaomi', sakana: 'Sakana AI', inception: 'Inception', poolside: 'Poolside', stepfun: 'StepFun', 'arcee-ai': 'Arcee AI', meituan: 'Meituan',
};
export const makerName = (maker: string) => MAKERS[maker] ?? maker.charAt(0).toUpperCase() + maker.slice(1);
