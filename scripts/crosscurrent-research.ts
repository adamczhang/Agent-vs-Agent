// Offline J11 study. No service, provider requests, network, or conversation-pool access.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyze, apply, BOTS, choose, key, qualifies, randomState, rawActions, rng, start, successors, VARIANTS, type Bot, type Rules, type SearchStats } from './research/crosscurrent.js';

const args = process.argv.slice(2), option = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] ?? fallback; };
const rules = VARIANTS.find(r => r.id === option('--variant', 'combined'));
if (!rules) throw new Error('Unknown variant.');
const phase = option('--phase', 'pilot'), seedBase = Number(option('--seed', '20261004')), enemyCost = Number(option('--enemy-cost', '2'));
const beamWidth = Number(option('--beam', '4'));
if (![2, 4].includes(enemyCost)) throw new Error('Use enemy cost 2 or 4.');
if (![4, 8].includes(beamWidth)) throw new Error('Use beam 4 or 8.');
const output = resolve(option('--out', `test-results/crosscurrent-${rules.id}-${phase}.json`));
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
mkdirSync(dirname(output), { recursive: true });
const begun = performance.now();
type Totals = { decisions: number; evaluations: number; cacheHits: number; generated: number; changed: number; depths: number[] };
const totals = (): Totals => ({ decisions: 0, evaluations: 0, cacheHits: 0, generated: 0, changed: 0, depths: [0, 0, 0, 0, 0, 0] });
const add = (a: Totals, b: SearchStats) => { a.decisions++; a.evaluations += b.evaluations; a.cacheHits += b.cacheHits; a.generated += b.generated; a.changed += Number(b.changedFromGreedy); a.depths[b.depth]!++; };
const bot = (name: string): Bot => { const b = BOTS[name]; if (!b) throw new Error('Unknown bot.'); return { ...b, enemyCost, beam: beamWidth }; };
function game(rule: Rules, first: string, second: string, seed: number, opening: number[] = []) {
  let s = start();
  for (const move of opening) { if (analyze(s, rule).winner !== null) throw new Error('Opening ended prematurely.'); s = apply(s, move, rule); }
  const stats = [totals(), totals()], moves = [...opening], bots = [bot(first), bot(second)], at = performance.now();
  while (analyze(s, rule).winner === null) {
    const selected = choose(s, rule, bots[s.turn - 1]!, seed ^ Math.imul(s.ply + 1, 2654435761));
    add(stats[s.turn - 1]!, selected.stats); moves.push(selected.action); s = apply(s, selected.action, rule);
    if (s.ply > 48 || s.board[s.star] !== 3 || s.board.filter(v => v === 3).length !== 1) throw new Error('Game invariant failed.');
  }
  const result = analyze(s, rule);
  return { first, second, seed, openingPlies: opening.length, winner: result.winner!, drawReason: result.winner !== 0 ? null : result.masks.every(m => qualifies(m, rule)) ? 'simultaneous' : 'full-board', plies: s.ply, ms: Math.round(performance.now() - at), stats, moves, finalBoard: key(s) };
}
type Game = ReturnType<typeof game>;
function summary(games: Game[]) {
  const lengths = games.map(g => g.plies).sort((a, b) => a - b);
  return { games: games.length, firstWins: games.filter(g => g.winner === 1).length, secondWins: games.filter(g => g.winner === 2).length, draws: games.filter(g => g.winner === 0).length, simultaneousDraws: games.filter(g => g.drawReason === 'simultaneous').length, fullBoardDraws: games.filter(g => g.drawReason === 'full-board').length, meanPlies: games.reduce((sum, g) => sum + g.plies, 0) / games.length, medianPlies: lengths[Math.floor(lengths.length / 2)] ?? null };
}
function interval(scores: number[]) {
  const random = rng(seedBase ^ 99173), samples = [];
  for (let i = 0; i < 3000; i++) { let sum = 0; for (let j = 0; j < scores.length; j++) sum += scores[Math.floor(random() * scores.length)]!; samples.push(sum / scores.length); }
  samples.sort((a, b) => a - b);
  return [samples[75], samples[2924]];
}
function ladder(rule: Rules, strong: string, weak: string, pairs: number, offset: number) {
  const games: Game[] = [], pairScores: number[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    const seed = seedBase + offset + pair, opening = randomState(4, seed).opening;
    const first = game(rule, strong, weak, seed, opening), second = game(rule, weak, strong, seed, opening);
    games.push(first, second);
    pairScores.push(((first.winner === 1 ? 1 : first.winner === 0 ? .5 : 0) + (second.winner === 2 ? 1 : second.winner === 0 ? .5 : 0)) / 2);
    if ((pair + 1) % 5 === 0) console.log(JSON.stringify({ variant: rule.id, phase: `${strong}-vs-${weak}`, pairs: pair + 1, seconds: Math.round((performance.now() - begun) / 1000) }));
  }
  const wins = games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === strong).length;
  const losses = games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === weak).length;
  return { strong, weak, pairs, wins, losses, draws: games.length - wins - losses, matchPointRate: pairScores.reduce((a, b) => a + b, 0) / pairs, pairedBootstrap95: interval(pairScores), summary: summary(games), games };
}
function metrics(rule: Rules) {
  return [0, 8, 16, 24, 32, 40, 46].map(ply => {
    const records = Array.from({ length: ply === 0 ? 1 : 24 }, (_, sample) => {
      const s = ply === 0 ? start() : randomState(ply, seedBase + sample * 991 + ply).state;
      const children = successors(s, rule);
      return { raw: rawActions(s, rule).length, unique: children.length, immediateWins: children.filter(c => analyze(c.state, rule).winner === s.turn).length };
    });
    return { ply, samples: records.length, meanRaw: records.reduce((s, r) => s + r.raw, 0) / records.length, meanUnique: records.reduce((s, r) => s + r.unique, 0) / records.length, immediateWinPositions: records.filter(r => r.immediateWins).length };
  });
}
function tacticalPanel(rule: Rules, count: number) {
  const records: Array<{ board: string; optimal: number; values: Record<string, number>; equivalentBestMoves: number; legalDistinct: number }> = [];
  for (let i = 0; i < count; i++) {
    const s = randomState(46, seedBase + 30000 + i).state, evaluated: Array<{ action: number; value: number }> = [];
    for (const child of successors(s, rule)) {
      const first = analyze(child.state, rule);
      let value: number;
      if (first.winner !== null) value = first.winner === 0 ? 0 : first.winner === s.turn ? 1 : -1;
      else {
        value = 1;
        for (const reply of successors(child.state, rule)) {
          const last = analyze(reply.state, rule).winner;
          if (last === null) throw new Error('Two-ply panel did not end.');
          value = Math.min(value, last === 0 ? 0 : last === s.turn ? 1 : -1);
          if (value === -1) break;
        }
      }
      evaluated.push({ action: child.action, value });
    }
    const best = Math.max(...evaluated.map(e => e.value)), values: Record<string, number> = {};
    for (const name of ['greedy', 'search4k', 'search16k']) { const selected = choose(s, rule, bot(name), seedBase + i); values[name] = evaluated.find(e => e.action === selected.action)!.value; }
    records.push({ board: key(s), optimal: best, values, equivalentBestMoves: evaluated.filter(e => e.value === best).length, legalDistinct: evaluated.length });
  }
  return { positions: count, selection: 'Common current-rule random-play survivors at ply 46; this is a controlled tactical panel, not a representative opening distribution.', solvedOutcomes: { wins: records.filter(r => r.optimal === 1).length, draws: records.filter(r => r.optimal === 0).length, losses: records.filter(r => r.optimal === -1).length }, regrets: Object.fromEntries(['greedy', 'search4k', 'search16k'].map(name => [name, records.filter(r => r.values[name]! < r.optimal).length])), records };
}
const result: Record<string, unknown> = { variant: rules, phase, seedBase, status: 'running', method: { legalDeduplication: 'Exact successor boards; no symmetry reduction in search.', randomPolicy: 'Uniform raw legal actions.', heuristic: { enemyCost, emptyCost: 1, ownCost: 0, goalCostWeight: 10, reachedEdgeWeight: .5, connectedGroupWeight: .03 }, search: `Iterative-deepening negamax with alpha-beta, beam ${beamWidth} plus one terminal draw, static-evaluation cache; only complete iterations replace the greedy fallback. Budgets count unique successor evaluations, not wall-clock time. Selective search is not a proof solver.`, bots: Object.fromEntries(Object.keys(BOTS).map(name => [name, bot(name)])), pairDesign: 'Identical 4-ply openings, seeded from current rules, with bot colors swapped. Confidence intervals resample opening pairs.' } };
const save = () => writeFileSync(output, JSON.stringify(result, null, 2));
save();
try {
  if (phase === 'pilot') result.pilot = game(rules, 'search16k', 'search4k', seedBase, randomState(4, seedBase).opening);
  else if (phase === 'all') {
    result.branching = metrics(rules); save();
    const randomGames = Array.from({ length: 1000 }, (_, i) => game(rules, 'random', 'random', seedBase + i));
    result.random = { summary: summary(randomGames), outcomes: randomGames.map(g => ({ winner: g.winner, plies: g.plies, drawReason: g.drawReason })) }; save();
    result.calibration = ladder(rules, 'greedy', 'random', 12, 10000); save();
    result.searchBudget = ladder(rules, 'search16k', 'search4k', Number(option('--pairs', '40')), 20000); save();
    const self = []; for (let i = 0; i < 24; i++) self.push(game(rules, 'search4k', 'search4k', seedBase + 40000 + i));
    result.equalSearch = { summary: summary(self), games: self }; save();
    result.tactics = tacticalPanel(rules, 64);
  } else if (phase === 'search') result.searchBudget = ladder(rules, option('--strong', 'search16k'), option('--weak', 'search4k'), Number(option('--pairs', '40')), 20000);
  else if (phase === 'self') {
    const games = [], name = option('--bot', 'search4k'), count = Number(option('--games', '96'));
    for (let i = 0; i < count; i++) { games.push(game(rules, name, name, seedBase + i)); if ((i + 1) % 12 === 0) console.log(JSON.stringify({ variant: rules.id, phase: 'self', games: i + 1 })); }
    const points: number[] = games.map(g => g.winner === 1 ? 1 : g.winner === 0 ? .5 : 0);
    result.equalSearch = { summary: summary(games), firstPlayerMatchPoints: points.reduce((a, b) => a + b, 0) / games.length, bootstrap95: interval(points), games };
  }
  else throw new Error('Unknown phase.');
  result.status = 'complete'; result.seconds = (performance.now() - begun) / 1000; save();
  console.log(JSON.stringify({ variant: rules.id, status: 'complete', output, seconds: result.seconds, random: (result.random as { summary: unknown } | undefined)?.summary, searchBudget: result.searchBudget && Object.fromEntries(Object.entries(result.searchBudget).filter(([k]) => k !== 'games')), equalSearch: (result.equalSearch as { summary: unknown } | undefined)?.summary, tactics: result.tactics && Object.fromEntries(Object.entries(result.tactics).filter(([k]) => k !== 'records')) }));
} catch (error) { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); save(); throw error; }
