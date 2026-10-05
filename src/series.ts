import type { GameSetup, Judgment, JudgeProvider, ProviderConfig, RunConfig, Seat } from './types.js';
import { conversationConfig } from './types.js';
import { gameEngine } from './games/index.js';
import type { RunProfile } from './run-profiles.js';
export interface SeriesInput {
  kind: 'game' | 'debate'; pairs: number; agents: Record<Seat, ProviderConfig>; internet: boolean;
  game?: GameSetup; motion?: string; rounds?: number; speechMs?: number; judge?: JudgeProvider;
  profile?: RunProfile;
}
export interface SeriesMatch {
  index: number; pair: number; first: Seat; status: 'completed' | 'failed'; winner?: Seat; reason: string; runId?: string; threadId?: string;
  participants: Record<Seat, ProviderConfig>; moves: string[]; config: RunConfig; judgment?: Judgment;
  illegal?: Record<Seat, number>; elapsedMs: number;
}
export interface SeriesJob {
  id: string; createdAt: string; updatedAt: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  input: SeriesInput; version: string; engineVersion: string; simulation: boolean;
  resolvedAgents?: Record<Seat, ProviderConfig>; resolvedJudge?: ProviderConfig;
  requestCeiling: number; requestsAdmitted: number; matches: SeriesMatch[];
  current?: { index: number; pairId?: string; runId?: string; phase: string }; error?: string;
}
export function seriesConfig(input: SeriesInput, index: number) {
  const first: Seat = index % 2 ? 'cli2' : 'cli1';
  return input.kind === 'game'
    ? conversationConfig(`Series game ${index + 1}: ${input.game!.kind}`, { mode: 'game', game: { ...input.game!, first }, paceMs: 0 })
    : conversationConfig(input.motion!, { mode: 'conversation', stances: { cli1: first === 'cli1' ? 'for' : 'against', cli2: first === 'cli2' ? 'for' : 'against' }, opening: first, rounds: input.rounds, speechMs: input.speechMs, paceMs: 0 });
}
export function seriesCeiling(input: SeriesInput) {
  const config = seriesConfig(input, 0);
  if (input.kind === 'game') { const engine = gameEngine(config.game!); return input.pairs * 2 * (4 + engine.plyLimit(engine.start(config.game!.size)) * config.game!.maxIllegal); }
  // Two activations, two briefs, speeches with one format repair each, two participant reviews, judge activation and ballot.
  return input.pairs * 2 * (8 + config.maxRequests);
}
export function seriesSummary(job: SeriesJob) {
  const pairs: number[] = [], included: SeriesMatch[] = [];
  for (let i = 0; i < job.input.pairs; i++) {
    const a = job.matches.find(m => m.index === i * 2 && m.status === 'completed'), b = job.matches.find(m => m.index === i * 2 + 1 && m.status === 'completed');
    if (!a || !b) continue; included.push(a, b);
    const points = (m: SeriesMatch) => m.winner === 'cli1' ? 1 : m.winner === 'cli2' ? 0 : .5;
    pairs.push((points(a) + points(b)) / 2);
  }
  const score = pairs.length ? pairs.reduce((n, x) => n + x, 0) / pairs.length : null;
  // Hoeffding bound for independent bounded pair scores. Deliberately stays wide for small samples and all-win samples.
  const radius = pairs.length ? Math.sqrt(Math.log(40) / (2 * pairs.length)) : 1;
  return { completedPairs: pairs.length, scoredMatches: included.length, unscoredMatches: job.matches.length - included.length,
    cli1Wins: included.filter(m => m.winner === 'cli1').length, cli2Wins: included.filter(m => m.winner === 'cli2').length, draws: included.filter(m => !m.winner).length,
    cli1Score: score, interval95: score === null ? null : [Math.max(0, score - radius), Math.min(1, score + radius)],
    uncertainty: 'Conservative 95% range assuming independent trial pairs. Only complete pairs count. These trials do not establish performance on other games, motions or configurations.' };
}
export function seriesReport(job: SeriesJob) {
  const summary = seriesSummary(job), name = (seat: Seat) => { const p = (job.resolvedAgents ?? job.input.agents)[seat]; return `${p.provider} / ${p.model}${p.effort ? ` / ${p.effort.value} effort` : ''}`; };
  return [`# AvA ${job.input.kind} series`, '', `Status: ${job.status}${job.simulation ? ' (simulation)' : ''}`, `Agent 1: ${name('cli1')}`, `Agent 2: ${name('cli2')}`, `AvA: ${job.version}; engine: ${job.engineVersion}`, `Requests: ${job.requestsAdmitted} / ${job.requestCeiling}`, '',
    `Complete pairs: ${summary.completedPairs}; excluded partial/failed matches: ${summary.unscoredMatches}.`,
    `Agent 1 wins / Agent 2 wins / draws: ${summary.cli1Wins} / ${summary.cli2Wins} / ${summary.draws}.`,
    summary.cli1Score === null ? 'No paired score yet.' : `Agent 1 points: ${(100 * summary.cli1Score).toFixed(1)}%. Range: ${summary.interval95!.map(x => (100 * x).toFixed(1)).join('–')}%.`, summary.uncertainty, '',
    ...job.matches.map(m => `- Match ${m.index + 1}: ${m.status}; ${m.winner ? name(m.winner) : 'draw/unscored'}; ${m.reason}`), ...(job.error ? ['', `Stopped: ${job.error}`] : [])].join('\n');
}
