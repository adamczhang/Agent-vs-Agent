import type { AgentUsage, ProviderConfig, Run, Seat } from './types.js';

// Per-run statistics from saved events. Reported per-request usage wins; only CLIs without token reports use estimates.
export const CHARS_PER_TOKEN = 4;
export interface TurnRow { id: string; seat: string; status: string; phaseId: string | null; phaseKind: string | null }
export interface EventRow { type: string; time: string; data: Record<string, unknown> }
export interface TokenStat { inputTokens: number | null; outputTokens: number | null; tokensPerSec: number | null; tokenSource: 'reported' | 'estimated' | 'mixed' | 'unavailable'; tokenSeconds: number }
export interface TurnStat extends TokenStat { turnId: string; seat: Seat; phase: string; status: string; startMs: number | null; firstActivityMs: number | null; firstOutputMs: number | null; durationMs: number | null; outputChars: number; charsPerSec: number | null }
export interface SeatStat extends TokenStat { seat: Seat; provider: string | null; model: string | null; requests: number; completed: number; unsuccessful: number; avgFirstActivityMs: number | null; avgDurationMs: number | null; outputChars: number; estimatedTokens: number | null; charsPerSec: number | null; estimatedTokensPerSec: number | null }
export interface RunStats { runId: string; topic: string; status: string; reason: string | null; createdAt: string | null; activeMs: number; wallMs: number | null; requests: number; replies: number; agents: number; maxParallel: number; pairedPhases: number; singlePhases: number; processesSpawned: number; avgFirstActivityMs: number | null; avgDurationMs: number | null; estimatedTokensPerSec: number | null; seats: SeatStat[]; turns: TurnStat[]; tokensEstimated: boolean; tokensPerSec: number | null; interrupted: boolean }

// A thread's statistics: every prompt (run) in the thread, placed back to back on one axis of conversation time, so
// the time the user spent between prompts doesn't stretch the timeline. Each request keeps its prompt number.
export interface ThreadStats extends Omit<RunStats, 'runId' | 'turns'> { threadId: string; prompts: number; runIds: string[]; turns: Array<TurnStat & { prompt: number }> }
function tokensFor(provider: string | undefined, chars: number, seconds: number, usage?: AgentUsage['tokens']): TokenStat {
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const estimated = !valid(usage?.output) && (provider === 'grok-build' || provider === 'antigravity');
  const outputTokens = valid(usage?.output) ? usage.output : estimated ? Math.round(chars / CHARS_PER_TOKEN) : null;
  return { inputTokens: valid(usage?.input) ? usage.input : null, outputTokens,
    tokenSource: outputTokens === null ? 'unavailable' : estimated ? 'estimated' : 'reported', tokenSeconds: Math.max(0, seconds),
    tokensPerSec: outputTokens !== null && seconds > 0 ? outputTokens / seconds : null };
}
function combineTokens(rows: TokenStat[]): TokenStat {
  const sum = (key: 'inputTokens' | 'outputTokens') => rows.length && rows.every(r => r[key] !== null) ? rows.reduce((n,r) => n + r[key]!,0) : null;
  const outputTokens = sum('outputTokens'), tokenSeconds = rows.reduce((n,r) => n + r.tokenSeconds,0);
  const sources = new Set(rows.map(r => r.tokenSource));
  return {inputTokens:sum('inputTokens'), outputTokens, tokenSeconds,
    tokensPerSec:outputTokens !== null && tokenSeconds > 0 ? outputTokens / tokenSeconds : null,
    tokenSource:outputTokens === null ? 'unavailable' : sources.size > 1 ? 'mixed' : rows[0]!.tokenSource};
}
export function combineStats(threadId: string, runs: RunStats[]): ThreadStats {
  let offset = 0;
  const turns = runs.flatMap((run, i) => {
    const placed = run.turns.map(t => ({ ...t, prompt: i + 1, startMs: t.startMs === null ? null : t.startMs + offset }));
    offset += Math.max(run.wallMs ?? 0, ...run.turns.map(t => t.startMs !== null && t.durationMs !== null ? t.startMs + t.durationMs : 0));
    return placed;
  });
  const sum = (pick: (r: RunStats) => number) => runs.reduce((n, r) => n + pick(r), 0);
  const weighted = (pick: (r: RunStats) => number | null, weight: (r: RunStats) => number) => { const rows = runs.filter(r => pick(r) !== null && weight(r) > 0), w = rows.reduce((n, r) => n + weight(r), 0); return w ? rows.reduce((n, r) => n + pick(r)! * weight(r), 0) / w : null; };
  const latest = runs.at(-1), first = runs[0];
  const seats = (['cli1', 'cli2'] as const).map(seat => {
    const rows = runs.map(r => r.seats.find(s => s.seat === seat)!).filter(Boolean), chars = rows.reduce((n, s) => n + s.outputChars, 0);
    const secs = rows.reduce((n, s) => n + (s.charsPerSec && s.outputChars ? s.outputChars / s.charsPerSec : 0), 0), cps = secs > 0 ? chars / secs : null;
    const avg = (pick: (s: SeatStat) => number | null, weight: (s: SeatStat) => number) => { const ok = rows.filter(s => pick(s) !== null && weight(s) > 0), w = ok.reduce((n, s) => n + weight(s), 0); return w ? ok.reduce((n, s) => n + pick(s)! * weight(s), 0) / w : null; };
    const who = [...rows].reverse().find(s => s.provider) ?? rows[0], tokens = combineTokens(rows);
    return { seat, provider: who?.provider ?? null, model: who?.model ?? null, requests: rows.reduce((n, s) => n + s.requests, 0), completed: rows.reduce((n, s) => n + s.completed, 0), unsuccessful: rows.reduce((n, s) => n + s.unsuccessful, 0),
      avgFirstActivityMs: avg(s => s.avgFirstActivityMs, s => s.requests), avgDurationMs: avg(s => s.avgDurationMs, s => s.completed), outputChars: chars, ...tokens, estimatedTokens: tokens.tokenSource === 'estimated' ? tokens.outputTokens : null, charsPerSec: cps, estimatedTokensPerSec: tokens.tokenSource === 'estimated' ? tokens.tokensPerSec : null } satisfies SeatStat;
  });
  const allChars = seats.reduce((n, s) => n + s.outputChars, 0), allSecs = seats.reduce((n, s) => n + (s.charsPerSec && s.outputChars ? s.outputChars / s.charsPerSec : 0), 0);
  return { threadId, prompts: runs.length, runIds: runs.map(r => r.runId), topic: first?.topic ?? '', status: latest?.status ?? 'empty', reason: latest?.reason ?? null, createdAt: first?.createdAt ?? null,
    activeMs: sum(r => r.activeMs), wallMs: runs.length ? sum(r => r.wallMs ?? r.activeMs) : null, requests: sum(r => r.requests), replies: sum(r => r.replies), agents: 2, maxParallel: Math.max(0, ...runs.map(r => r.maxParallel)),
    // Every run in a thread uses the same sessions, so each one reports the same recorded processes: don't add them up.
    pairedPhases: sum(r => r.pairedPhases), singlePhases: sum(r => r.singlePhases), processesSpawned: Math.max(0, ...runs.map(r => r.processesSpawned)),
    avgFirstActivityMs: weighted(r => r.avgFirstActivityMs, r => r.turns.filter(t => t.firstActivityMs !== null).length), avgDurationMs: weighted(r => r.avgDurationMs, r => r.turns.filter(t => t.status === 'completed' && t.durationMs !== null).length),
    estimatedTokensPerSec: seats.every(s => s.tokenSource === 'estimated') && allSecs > 0 ? allChars / allSecs / CHARS_PER_TOKEN : null, seats, turns, tokensEstimated: seats.some(s => s.tokenSource === 'estimated' || s.tokenSource === 'mixed'), tokensPerSec: combineTokens(seats).tokensPerSec, interrupted: runs.some(r => r.interrupted) };
}
const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function computeStats(run: Run, turns: TurnRow[], events: EventRow[], replies: number, processesSpawned: number): RunStats {
  const at = (e: EventRow) => Date.parse(e.time);
  const runStart = events.find(e => e.type === 'run_started'), runEnd = events.find(e => e.type === 'run_ended');
  const origin = runStart ? at(runStart) : events.length ? at(events[0]!) : 0;
  const usage = new Map<string, NonNullable<AgentUsage['tokens']>>();
  const byTurn = new Map<string, { start?: number; firstActivity?: number; firstOutput?: number; end?: number; chars: number }>();
  const slot = (id: string) => { let s = byTurn.get(id); if (!s) byTurn.set(id, s = { chars: 0 }); return s; };
  for (const e of events) {
    const turnId = typeof e.data.turnId === 'string' ? e.data.turnId : undefined; if (!turnId) continue;
    if(e.type === 'usage_reported' && e.data.tokens && typeof e.data.tokens === 'object') usage.set(turnId,e.data.tokens as NonNullable<AgentUsage['tokens']>);
    const s = slot(turnId), t = at(e);
    if (e.type === 'prompt_started') s.start ??= t;
    else if (e.type === 'activity') {
      s.firstActivity ??= t;
      if (e.data.type === 'output') { s.firstOutput ??= t; s.chars += typeof e.data.text === 'string' ? e.data.text.length : 0; }
    } else if (e.type === 'turn_ended' || e.type === 'room_committed') s.end ??= t;
  }
  const turnStats: TurnStat[] = turns.map(turn => {
    const s = byTurn.get(turn.id) ?? { chars: 0 }, rel = (t?: number) => t === undefined ? null : t - origin;
    const durationMs = s.start !== undefined && s.end !== undefined ? s.end - s.start : null;
    const generating = s.end !== undefined ? s.end - (s.firstOutput ?? s.firstActivity ?? s.end) : 0;
    return { turnId: turn.id, seat: turn.seat as Seat, phase: turn.phaseKind ?? 'unknown', status: turn.status, startMs: rel(s.start),
      firstActivityMs: s.start !== undefined && s.firstActivity !== undefined ? s.firstActivity - s.start : null,
      firstOutputMs: s.start !== undefined && s.firstOutput !== undefined ? s.firstOutput - s.start : null,
      ...tokensFor(run.participants?.[turn.seat as Seat]?.provider, s.chars, generating / 1000, usage.get(turn.id)),
      durationMs, outputChars: s.chars, charsPerSec: generating > 0 && s.chars ? s.chars / (generating / 1000) : null };
  });
  // Most requests in flight at once (2 during a paired opening).
  const edges = turnStats.flatMap(t => t.startMs !== null && t.durationMs !== null ? [[t.startMs, 1], [t.startMs + t.durationMs, -1]] as Array<[number, number]> : []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, maxParallel = 0; for (const [, d] of edges) { current += d; maxParallel = Math.max(maxParallel, current); }
  const speed = (rows: TurnStat[]) => { const chars = rows.reduce((n, t) => n + t.outputChars, 0), secs = rows.reduce((n, t) => n + (t.charsPerSec && t.outputChars ? t.outputChars / t.charsPerSec : 0), 0); return secs > 0 ? chars / secs : null; };
  const seats: SeatStat[] = (['cli1', 'cli2'] as const).map(seat => {
    const rows = turnStats.filter(t => t.seat === seat), who: ProviderConfig | undefined = run.participants?.[seat], cps = speed(rows), chars = rows.reduce((n, t) => n + t.outputChars, 0);
    const tokens = combineTokens(rows);
    return { seat, provider: who?.provider ?? null, model: who?.model ?? null, requests: rows.length, completed: rows.filter(t => t.status === 'completed').length,
      unsuccessful: rows.filter(t => t.status !== 'completed').length, avgFirstActivityMs: average(rows.flatMap(t => t.firstActivityMs ?? [])), avgDurationMs: average(rows.flatMap(t => t.status === 'completed' && t.durationMs !== null ? [t.durationMs] : [])),
      outputChars: chars, ...tokens, estimatedTokens: tokens.tokenSource === 'estimated' ? tokens.outputTokens : null, charsPerSec: cps, estimatedTokensPerSec: tokens.tokenSource === 'estimated' ? tokens.tokensPerSec : null };
  });
  const allSpeed = speed(turnStats);
  // A run cut off by a service restart only "ends" when the next service starts (and may be released later still), so
  // time it to its last recorded work. The event log keeps the original interruption even after a release.
  const WORK = new Set(['run_started', 'phase_admitted', 'prompt_started', 'activity', 'turn_ended', 'room_committed', 'room_queued', 'paused', 'duration_changed', 'phase_completed']);
  const lastWork = events.reduce((latest, e) => WORK.has(e.type) ? Math.max(latest, at(e)) : latest, origin);
  const interrupted = events.some(e => e.type === 'run_ended' && e.data.reason === 'service_interrupted');
  return { runId: run.id, topic: run.config.topic, status: run.status, reason: run.reason, createdAt: run.createdAt ?? null, activeMs: run.elapsedMs,
    wallMs: runStart ? (interrupted || !runEnd ? lastWork : at(runEnd)) - at(runStart) : null, requests: run.requests, replies, agents: 2, maxParallel,
    pairedPhases: new Set(turns.filter(t => t.phaseKind === 'paired').map(t => t.phaseId)).size,
    singlePhases: new Set(turns.filter(t => t.phaseKind === 'single').map(t => t.phaseId)).size, processesSpawned,
    avgFirstActivityMs: average(turnStats.flatMap(t => t.firstActivityMs ?? [])), avgDurationMs: average(turnStats.flatMap(t => t.status === 'completed' && t.durationMs !== null ? [t.durationMs] : [])),
    estimatedTokensPerSec: seats.every(s => s.tokenSource === 'estimated') && allSpeed !== null ? allSpeed / CHARS_PER_TOKEN : null, seats, turns: turnStats, tokensEstimated: seats.some(s => s.tokenSource === 'estimated' || s.tokenSource === 'mixed'), tokensPerSec: combineTokens(seats).tokensPerSec, interrupted };
}
