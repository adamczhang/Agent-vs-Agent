export const SEATS = ['cli1', 'cli2'] as const;
export type Seat = typeof SEATS[number];
// vercel: the Vercel AI Gateway (hundreds of models from many makers), driven by the Codex agent; see src/gateway.ts.
export const PROVIDERS = ['claude', 'codex', 'grok-build', 'antigravity', 'vercel'] as const;
export type Provider = typeof PROVIDERS[number];
export type RunStatus = 'running' | 'pausing' | 'paused' | 'stopping' | 'completed' | 'stopped' | 'needs_attention';
export interface ProviderConfig {
  provider: Provider;
  model: string;
  effort?: { key: string; value: string };
  speed?: { key: string; value: string };
  auth: 'provider-login' | 'api';
}
export interface Slot {
  seat: Seat;
  generation: number;
  state: 'empty' | 'configuring' | 'verifying' | 'ready' | 'failed';
  config: ProviderConfig | null;
  sessionId: string | null;
  verifiedAt: number | null;
  error: string | null;
  // The agent's internet switch (off unless the user turns it on). Enforced by AvA where the provider allows it.
  internet?: boolean;
  // Tool permissions. 'ask' (the default): AvA allows tools only where the mode does (a Build session's own folder).
  // 'bypass': AvA approves every tool request in every mode, and Codex runs with full access.
  permissions?: 'ask' | 'bypass';
}
export interface Pair { id: string; thread: string; activeRunId: string | null; lastRunId?: string; slots: Record<Seat, Slot> }
// A file the user attached to a room message, stored in the data folder. Images go to the agents as image content;
// text files are inlined into the prompt.
export interface AttachmentRef { id: string; name: string; mediaType: string; size: number; kind: 'image' | 'text' }
export interface RunConfig {
  // conversation (shown as Debate): the agents talk to each other. benchmark: both get the same prompt at the same
  // moment, each answers once in plain text, and the run ends. build: like a benchmark, but each agent works in its own
  // copy of a project and may read, edit and run commands there (absent on older runs: conversation).
  mode?: 'conversation' | 'benchmark' | 'build';
  // Build runs: the task kind, the project it started from, and the folder (inside each agent's workspace) that holds
  // that agent's own copy.
  build?: { kind: 'review' | 'build'; source: string; folder: string };
  // Who answers the opening prompt in a conversation: both at once (default), or one agent, with the other replying.
  opening?: 'both' | Seat;
  topic: string;
  instructions: Record<Seat, string>;
  stopWhen: Record<Seat, string>;
  completion: 'duration' | 'either' | 'both';
  durationMs: number;
  maxRequests: number;
  perTurnMs: number;
  paceMs: number;
  lead: Seat;
}
export interface Run {
  id: string; pairId: string; status: RunStatus; config: RunConfig;
  generations: Record<Seat, number>; sessions: Record<Seat, string>;
  requests: number; elapsedMs: number; nextSeat: Seat;
  stopFlags: Record<Seat, boolean>; reason: string | null;
  // Recorded at start so history keeps its identities after the slots change. Absent on runs from before snapshots.
  participants?: Record<Seat, ProviderConfig>; createdAt?: string;
}
export interface RoomMessage {
  id: string; seq: number; runId: string; sender: Seat | 'user'; text: string;
  state: 'queued' | 'admitted' | 'committed' | 'not_delivered';
  turnId: string | null;
  deliveredTo?: Seat[];
  attachments?: AttachmentRef[];
}
export interface Activity { type: 'output' | 'thought' | 'tool' | 'status'; text: string; meta?: Record<string, unknown> }
export interface AgentRequest {
  id: string; text: string; signal: AbortSignal;
  // Images for this prompt, base64 (ACP image content). Text files are already inlined into `text`.
  attachments?: Array<{ mediaType: string; data: string }>;
  onStarted(): void; onEvent(event: Activity): void;
}
export interface AgentResult { status: 'completed' | 'cancelled'; text: string; stopReason?: string }
// What an agent last reported about its context window (ACP usage_update: tokens in use of the model's window) and this
// session's token totals and cost (its session record), plus, for the Vercel AI Gateway, the key's credit. Fields an
// agent doesn't report are absent, never zero.
export interface AgentUsage {
  context?: { used: number; size: number };
  tokens?: { input?: number; output?: number; cachedRead?: number; total?: number };
  cost?: { amount?: number; currency?: string };
  credit?: { balance: number; used?: number };
  at: number;
}
export interface Participant {
  sessionId: string;
  request(request: AgentRequest): Promise<AgentResult>;
  close(): Promise<void>;
}
export interface Clock { now(): number; timer(callback: () => void, delayMs: number): () => void }
export const systemClock: Clock = {
  now: () => performance.now(),
  timer(callback, ms) { const timer = setTimeout(callback, Math.max(0, ms)); return () => clearTimeout(timer); },
};
export class AvAError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'AvAError'; }
}
export function other(seat: Seat): Seat { return seat === 'cli1' ? 'cli2' : 'cli1'; }
export function conversationConfig(topic: string, overrides: Partial<RunConfig> = {}): RunConfig {
  const benchmark = overrides.mode === 'benchmark' || overrides.mode === 'build';
  // A benchmark prompt is sent as written, so "…for 15 minutes" in it is part of the task, not a time limit.
  const duration = benchmark ? null : topic.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|seconds?|secs?|s)\s*[.!]?$/i);
  // A build run defaults to 30 minutes; a benchmark to 60 (one answer, but it may be long); a debate to 20.
  const durationMs = duration ? Number(duration[1]) * (/^(m|min)/i.test(duration[2]!) ? 60_000 : 1000) : overrides.mode === 'build' ? 1_800_000 : benchmark ? 3_600_000 : 1_200_000;
  const config: RunConfig = {
    topic, instructions: { cli1: '', cli2: '' }, stopWhen: { cli1: '', cli2: '' },
    completion: duration ? 'duration' : 'either', durationMs,
    maxRequests: duration ? Math.max(20, Math.ceil(durationMs / 5000) + 20) : 20,
    perTurnMs: benchmark ? 3_600_000 : 300_000, paceMs: benchmark ? 0 : 5000, lead: 'cli1', ...overrides,
  };
  // One agent opens: the other speaks next, then they alternate.
  if (config.opening && config.opening !== 'both' && !overrides.lead) config.lead = other(config.opening);
  // A benchmark is exactly one simultaneous answer from each agent.
  if (benchmark) { config.opening = 'both'; config.maxRequests = 2; config.perTurnMs = Math.min(config.perTurnMs, config.durationMs); }
  if (!config.topic.trim() || config.topic.length > 16000) throw new AvAError('INVALID_CONFIG', 'Enter a topic of 1–16000 characters.');
  for (const [key, value] of Object.entries({ durationMs: config.durationMs, maxRequests: config.maxRequests, perTurnMs: config.perTurnMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new AvAError('INVALID_CONFIG', `${key} must be positive.`);
  }
  if (!Number.isInteger(config.maxRequests) || config.maxRequests > 10000 || config.durationMs > 86_400_000 || config.perTurnMs > 3_600_000 || !Number.isFinite(config.paceMs) || config.paceMs < 0) {
    throw new AvAError('INVALID_CONFIG', 'Run limits are outside supported bounds.');
  }
  return config;
}
