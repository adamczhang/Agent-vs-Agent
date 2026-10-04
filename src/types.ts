export const SEATS = ['cli1', 'cli2'] as const;
export type Seat = typeof SEATS[number];
// vercel: the Vercel AI Gateway (hundreds of models from many makers), driven by the Codex agent; see src/gateway.ts.
export const PROVIDERS = ['claude', 'codex', 'grok-build', 'antigravity', 'cursor', 'vercel'] as const;
export type Provider = typeof PROVIDERS[number];
export type RunStatus = 'running' | 'pausing' | 'paused' | 'stopping' | 'completed' | 'stopped' | 'needs_attention';
export interface ProviderConfig {
  provider: Provider;
  model: string;
  // The model's name as the CLI lists it ("Opus 5.5" for Claude Code's "opus"), for display. Absent on older settings.
  modelName?: string;
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
// roomMode: the mode this pair serves in its room (E9): a room keeps one pair per mode, so each mode's thread and agents
// stay as they were while another mode is in use.
export interface Pair { id: string; thread: string; activeRunId: string | null; lastRunId?: string; slots: Record<Seat, Slot>; roomMode?: RoomMode }
export type RoomMode = NonNullable<RunConfig['mode']>;
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
  // Who answers the opening prompt: agent 1 by default, or agent 2 or independent simultaneous openings.
  opening?: 'both' | Seat;
  topic: string;
  instructions: Record<Seat, string>;
  stopWhen: Record<Seat, string>;
  // rounds (a debate's default since G1): each agent speaks `rounds` times, then the debate ends. Agents can't end it
  // early by asking to stop (only through a stop condition the operator wrote).
  completion: 'duration' | 'either' | 'both' | 'rounds';
  rounds?: number;
  // A formal debate (G6): each agent's assigned side. Both agents are briefed through their 1:1 lines before it starts
  // (the motion, their side, their private brief, the format and how they'll be judged), and each turn is a speech.
  stances?: Record<Seat, Stance>;
  // The independent judge for a formal debate (G7): the CLI whose strongest model, at its highest effort, scores both
  // debaters when the debate ends.
  judge?: { provider: JudgeProvider };
  // A formal debate's time limit per speech (thinking, searches and writing together). A speech that runs over is cut
  // off and forfeited, and the debate goes on.
  speechMs?: number;
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
  // A formal debate's ballot from its judge (G7).
  judgment?: Judgment;
}
export type Stance = 'for' | 'against';
export type JudgeProvider = 'claude' | 'codex';
// The judge's three categories, each scored 1 to 5 for each debater (owner's criteria, 2026-10-03).
export const JUDGE_CATEGORIES = [
  { key: 'evidence', label: 'Factual accuracy & evidence' },
  { key: 'clash', label: 'Challenging the opposition’s strongest points' },
  { key: 'stance', label: 'Cohesive stance' },
] as const;
export type JudgeCategory = typeof JUDGE_CATEGORIES[number]['key'];
export interface Judgment {
  status: 'judging' | 'done' | 'failed';
  judge: ProviderConfig;
  startedAt: string; finishedAt?: string;
  scores?: Record<Seat, Record<JudgeCategory, number>>;
  winner?: Seat;
  reason?: string;
  notes?: Partial<Record<Seat, string>>;
  // Factual claims the judge found wrong or unsupported.
  issues?: Array<{ seat: Seat; claim: string; problem: string }>;
  error?: string;
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
export interface AgentResult { status: 'completed' | 'cancelled'; text: string; stopReason?: string; usage?: AgentUsage['tokens'] }
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
// How many times each agent speaks in a debate unless the prompt or the options say otherwise.
export const DEFAULT_ROUNDS = 7;
export const MAX_ROUNDS = 100;
// A formal debate's default time per speech (owner, 2026-10-03); 0 means no limit.
export const DEFAULT_SPEECH_MINUTES = 2;
export function conversationConfig(topic: string, overrides: Partial<RunConfig> = {}): RunConfig {
  const benchmark = overrides.mode === 'benchmark' || overrides.mode === 'build';
  // A benchmark prompt is sent as written, so "…for 15 minutes" in it is part of the task, not a time limit.
  const duration = benchmark ? null : topic.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|seconds?|secs?|s)\s*[.!]?$/i);
  // A build run defaults to 30 minutes; a benchmark to 60 (one answer, but it may be long); a timed debate to 20.
  const durationMs = duration ? Number(duration[1]) * (/^(m|min)/i.test(duration[2]!) ? 60_000 : 1000) : overrides.mode === 'build' ? 1_800_000 : benchmark ? 3_600_000 : 1_200_000;
  const config: RunConfig = {
    topic, instructions: { cli1: '', cli2: '' }, stopWhen: { cli1: '', cli2: '' },
    // A debate runs for its rounds unless the topic gives a time ("…for 5 minutes"). Ending when either agent asked
    // made agents that agree stop after a turn or two (G1).
    completion: duration ? 'duration' : benchmark ? 'either' : 'rounds', durationMs,
    maxRequests: duration ? Math.max(20, Math.ceil(durationMs / 5000) + 20) : 20,
    perTurnMs: benchmark ? 3_600_000 : 300_000, paceMs: benchmark ? 0 : 5000, lead: 'cli1', opening: benchmark ? 'both' : 'cli1', ...overrides,
  };
  // The rounds set the length: requests for every turn plus the briefing (E7; a formal debate is briefed through the 1:1
  // lines instead), and an hour as the time limit's backstop.
  if (config.completion === 'rounds' && !benchmark) {
    config.rounds ??= DEFAULT_ROUNDS;
    if (!Number.isInteger(config.rounds) || config.rounds < 1 || config.rounds > MAX_ROUNDS) throw new AvAError('INVALID_CONFIG', `Rounds must be a whole number from 1 to ${MAX_ROUNDS}.`);
    if (overrides.maxRequests === undefined) config.maxRequests = config.rounds * 2 + (config.stances ? 0 : 1);
    // Rounds chosen over a time in the topic ("…for 5 minutes") win: that time no longer cuts the debate short.
    if (overrides.durationMs === undefined) config.durationMs = 3_600_000;
  } else { delete config.rounds; if (config.completion === 'rounds') config.completion = 'either'; }
  if (benchmark) { delete config.stances; delete config.judge; delete config.speechMs; }
  if (config.speechMs !== undefined) {
    if (!config.stances) delete config.speechMs;
    else if (!Number.isFinite(config.speechMs) || config.speechMs < 30_000 || config.speechMs > 1_800_000) throw new AvAError('INVALID_CONFIG', 'A speech time limit must be from 30 seconds to 30 minutes.');
    // The turn's own backstop leaves room for the speech limit to act first.
    else config.perTurnMs = Math.min(3_600_000, Math.max(config.perTurnMs, config.speechMs + 60_000));
  }
  else if (config.stances && config.stances.cli1 === config.stances.cli2) throw new AvAError('INVALID_CONFIG', 'The two debaters need opposite sides.');
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
