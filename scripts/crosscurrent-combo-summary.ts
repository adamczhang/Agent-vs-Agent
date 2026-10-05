// Replay and audit J13 evidence before reporting it. Historical study files remain immutable.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { analyze, apply, BOTS, choose, COMBOS, commonOpening, key, restore, start, successors, type Bot, type Combo } from './research/crosscurrent-combos.js';
import { rng } from './research/crosscurrent.js';
type Stat = { decisions: number; evaluations: number; generated: number; changed: number; depths: number[]; doubleShifts: number; ms: number };
type Game = { first: string; second: string; seed: number; openingPlies: number; winner: number; plies: number; simultaneous: boolean; moves: number[]; finalState: string; stats: Stat[] };
type Match = { strong: string; weak: string; pairs: number; wins: number; losses: number; draws: number; score: number; interval95: number[]; games: Game[] };
type Study = { variant: Combo; phase: string; status: string; seed: number; seconds: number; bots: Record<string, Bot>; branching?: Array<{ ply: number; count: number; raw: number; states: number; boards: number }>; ladder?: Match; bridge?: Match; equal?: { games: Game[] }; random?: { outcomes: Array<{ winner: number; plies: number; simultaneous: boolean }> }; tactics?: { records: Array<{ state: string; optimal: number; values: Record<string, number>; choices: number }> } };
const folder = 'pilot-evidence/stage-d/', output = process.argv[2] ?? `${folder}j13-summary.json`;
if (existsSync(output)) throw new Error('Refusing to overwrite an existing report.');
const studies = readdirSync(folder).filter(f => /^j13-.*\.json$/.test(f)).map(file => ({ file, data: JSON.parse(readFileSync(folder + file, 'utf8')) as Study })).filter(({ data }) => data.variant && data.bots);
assert.equal(studies.filter(s => s.data.phase === 'primary').length, 12);
const totals = { detailedGames: 0, randomGames: 0, exactEndgames: 0 };
function interval(scores: number[], seed: number) {
  const random = rng(seed), samples: number[] = [];
  for (let i = 0; i < 3000; i++) { let sum = 0; for (let j = 0; j < scores.length; j++) sum += scores[Math.floor(random() * scores.length)]!; samples.push(sum / scores.length); }
  samples.sort((a, b) => a - b); return [samples[75]!, samples[2924]!];
}
function pairScores(m: Match) {
  return Array.from({ length: m.pairs }, (_, i) => {
    const a = m.games[i * 2]!, b = m.games[i * 2 + 1]!;
    return ((a.winner === 1 ? 1 : a.winner === 0 ? .5 : 0) + (b.winner === 2 ? 1 : b.winner === 0 ? .5 : 0)) / 2;
  });
}
function audit(data: Study) {
  assert.equal(data.status, 'complete');
  for (const m of [data.ladder, data.bridge]) if (m) {
    assert.equal(m.games.length, m.pairs * 2);
    const wins = m.games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === m.strong).length;
    const losses = m.games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === m.weak).length;
    assert.equal(m.wins, wins); assert.equal(m.losses, losses); assert.equal(m.draws, m.games.length - wins - losses);
    assert.equal(m.score, (wins + m.draws * .5) / m.games.length);
    assert.deepEqual(m.interval95, interval(pairScores(m), data.seed ^ 99173));
    for (let i = 0; i < m.games.length; i += 2) {
      const a: Game = m.games[i]!, b: Game = m.games[i + 1]!;
      assert.equal(a.seed, b.seed); assert.equal(a.first, b.second); assert.equal(a.second, b.first);
      assert.deepEqual(a.moves.slice(0, a.openingPlies), b.moves.slice(0, b.openingPlies));
    }
  }
  for (const g of [...data.ladder?.games ?? [], ...data.bridge?.games ?? [], ...data.equal?.games ?? []]) {
    if (g.openingPlies) assert.deepEqual(g.moves.slice(0, g.openingPlies), commonOpening(g.openingPlies, g.seed));
    let s = start(data.variant);
    for (const move of g.moves) { assert.equal(analyze(s, data.variant).winner, null); s = apply(s, move, data.variant); }
    assert.equal(s.ply, g.plies); assert.ok(s.ply <= 48); assert.equal(key(s), g.finalState); assert.equal(analyze(s, data.variant).winner, g.winner);
    assert.equal(g.stats.reduce((sum, x) => sum + x.decisions, 0), g.plies - g.openingPlies);
    for (let seat = 0; seat < 2; seat++) {
      const stat = g.stats[seat]!, bot = data.bots[seat === 0 ? g.first : g.second]!;
      assert.equal(stat.decisions, stat.depths.reduce((a, b) => a + b, 0)); assert.ok(stat.evaluations <= stat.decisions * bot.budget);
      assert.equal(stat.doubleShifts, g.moves.filter((a, i) => i >= g.openingPlies && i % 2 === seat && a % 2).length);
      if (data.variant.power === 'reserve') assert.ok(stat.doubleShifts <= 1);
    }
    totals.detailedGames++;
  }
  for (let i = 0; i < (data.random?.outcomes.length ?? 0); i++) {
    let s = start(data.variant); const seed = data.seed + i;
    while (analyze(s, data.variant).winner === null) s = apply(s, choose(s, data.variant, BOTS.random!, seed ^ Math.imul(s.ply + 1, 2654435761)).action, data.variant);
    assert.equal(s.ply, data.random!.outcomes[i]!.plies); assert.equal(analyze(s, data.variant).winner, data.random!.outcomes[i]!.winner); totals.randomGames++;
  }
  for (let i = 0; i < (data.tactics?.records.length ?? 0); i++) {
    const record = data.tactics!.records[i]!, s = restore(data.variant, commonOpening(46, data.seed + 30000 + i)), values = new Map<number, number>();
    assert.equal(key(s), record.state);
    const value = (winner: number | null) => winner === 0 ? 0 : winner === s.turn ? 1 : -1;
    for (const c of successors(s, data.variant)) {
      const a = analyze(c.state, data.variant); let v = a.winner === null ? 1 : value(a.winner);
      if (a.winner === null) for (const reply of successors(c.state, data.variant)) { const last = analyze(reply.state, data.variant).winner; assert.notEqual(last, null); v = Math.min(v, value(last)); if (v === -1) break; }
      values.set(c.action, v);
    }
    assert.equal(record.choices, values.size); assert.equal(record.optimal, Math.max(...values.values()));
    for (const name of Object.keys(record.values)) assert.equal(record.values[name], values.get(choose(s, data.variant, data.bots[name]!, data.seed + i).action));
    totals.exactEndgames++;
  }
}
function describe(games: Game[]) {
  const lengths = games.map(g => g.plies).sort((a, b) => a - b), usage: Record<string, { decisions: number; depth: number; evaluations: number; changed: number; ms: number }> = {};
  let doubles = 0, finalDoubles = 0, firstTenDoubles = 0;
  for (const g of games) {
    g.moves.forEach((a, i) => { if (a % 2) { doubles++; if (i === g.moves.length - 1) finalDoubles++; if (i < 10) firstTenDoubles++; } });
    for (let seat = 0; seat < 2; seat++) {
      const name = seat === 0 ? g.first : g.second, x = g.stats[seat]!;
      const u = usage[name] ??= { decisions: 0, depth: 0, evaluations: 0, changed: 0, ms: 0 };
      u.decisions += x.decisions; u.depth += x.depths.reduce((a, b, i) => a + i * b, 0); u.evaluations += x.evaluations; u.changed += x.changed; u.ms += x.ms;
    }
  }
  return { games: games.length, firstWins: games.filter(g => g.winner === 1).length, secondWins: games.filter(g => g.winner === 2).length, draws: games.filter(g => g.winner === 0).length,
    meanPlies: lengths.reduce((a, b) => a + b, 0) / games.length, medianPlies: lengths[Math.floor(lengths.length / 2)], doubleShifts: doubles, doubleShiftsOnFinalTurn: finalDoubles, doubleShiftsInFirstTenTurns: firstTenDoubles,
    usage: Object.fromEntries(Object.entries(usage).map(([name, u]) => [name, { decisions: u.decisions, meanDepth: u.depth / u.decisions, meanEvaluations: u.evaluations / u.decisions, changedFromGreedy: u.changed / u.decisions, meanMs: u.ms / u.decisions }])) };
}
const reports = studies.map(({ file, data }) => {
  audit(data);
  const match = (m: Match | undefined) => m && { strong: m.strong, weak: m.weak, wins: m.wins, losses: m.losses, score: m.score, interval95: m.interval95, ...describe(m.games) };
  const equalScores = data.equal?.games.map(g => g.winner === 1 ? 1 : g.winner === 0 ? .5 : 0);
  const baseline = studies.find(s => s.data.variant.id === 'baseline' && s.data.phase === data.phase && s.data.seed === data.seed && s.data.ladder?.strong === data.ladder?.strong && s.data.ladder?.weak === data.ladder?.weak)?.data.ladder;
  let budgetScoreDifference;
  if (baseline && data.ladder && data.bots[data.ladder.strong]!.algorithm === data.bots[data.ladder.weak]!.algorithm) {
    const a = pairScores(data.ladder), b = pairScores(baseline), differences = a.map((x, i) => x - b[i]!);
    assert.equal(a.length, b.length);
    budgetScoreDifference = { mean: differences.reduce((a, b) => a + b, 0) / differences.length, interval95: interval(differences, data.seed ^ 33107) };
  }
  return { file, variant: data.variant, phase: data.phase, seed: data.seed, bots: data.bots, branching: data.branching, ladder: match(data.ladder), bridge: match(data.bridge), budgetScoreDifferenceVersusBaseline: budgetScoreDifference,
    equal: data.equal && { ...describe(data.equal.games), firstPlayerScore: equalScores!.reduce<number>((a, b) => a + b, 0) / equalScores!.length, interval95: interval(equalScores!, data.seed ^ 99173) }, randomGames: data.random?.outcomes.length ?? 0,
    tacticalRegrets: data.tactics && Object.fromEntries(['greedy', 'ab8k', 'ab32k', 'uct32k'].map(name => [name, data.tactics!.records.filter(r => r.values[name]! < r.optimal).length])) };
});
const result = { step: 'J13', baselineCommit: 'c61e871', prototypeOnly: true, liveProviderRequests: 0, totals: { games: totals.detailedGames + totals.randomGames, ...totals }, variants: COMBOS, reports,
  limitations: ['Related evaluators with selective alpha-beta and selective UCT using heuristic leaves', 'Alpha-beta depth means a completed iteration; UCT depth means the deepest visited node', 'Evaluation budgets are not equal wall-clock budgets; timings include competing local processes', 'Unadjusted intervals across multiple variants do not prove a depth ranking', 'Common late boards condition on survival under control and cooldown, with reserve powers unused', 'No live LLM matches or human playtests'],
  recommendation: {
    nextDefaultCandidate: 'rest',
    rule: 'After placing, shift any line except the exact row or column the opponent just shifted. Both directions are unavailable on that line for one turn; all other Three Edges rules remain unchanged.',
    rationale: 'One extra rule; near-even first/second outcomes in the 96-game held-out self-play sample; low draws; a positive response to larger search budgets across all three tested configurations. This is a practical recommendation, not the largest observed search-budget score or a proof of greater depth.',
    advancedCandidate: 'control+rest+double',
    advancedTradeoff: 'Higher primary search-budget payoff and near-even observed self-play, but three added mechanics and 9 draws in 48 UCT ladder games. Its added depth over simpler candidates is not established.',
    avoidAsDefault: 'control+double: the first player won 91 of 96 fresh equal-agent games.',
    nextEvidence: 'Live LLM and human clarity tests of cooldown before another production-default change. Keep first-player bias, illegal-rule errors and playing strength as separate measurements.',
    productionChanged: false,
  } };
if (output === `${folder}j13-summary.json`) {
  assert.equal(studies.length, 32); assert.equal(result.totals.games, 3856);
  assert.equal(totals.randomGames, 1536); assert.equal(totals.detailedGames, 2320); assert.equal(totals.exactEndgames, 384);
}
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ totals: result.totals, rows: reports.map(r => ({ file: r.file, variant: r.variant.id, score: r.ladder?.score, interval95: r.ladder?.interval95, draws: r.ladder?.draws, games: r.ladder?.games, turns: r.ladder?.meanPlies, equal: r.equal && { first: r.equal.firstWins, second: r.equal.secondWins, draws: r.equal.draws } })) }));
