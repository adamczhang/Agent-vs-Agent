// J13 offline factorial study. Each output is new evidence, never an overwrite of an earlier run.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { actions, analyze, apply, BOTS, choose, COMBOS, commonOpening, key, restore, start, successors, type Bot, type Combo } from './research/crosscurrent-combos.js';
import { rng } from './research/crosscurrent.js';
const args = process.argv.slice(2), option = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] ?? fallback; };
const phase = option('--phase', 'pilot'), seed = Number(option('--seed', '20261005'));
const selected = option('--variants', 'baseline').split(',').map(id => { const r = COMBOS.find(c => c.id === id); if (!r) throw new Error('Unknown combination.'); return r; });
const bot = (name: string): Bot => { if (!BOTS[name]) throw new Error('Unknown bot.'); return { ...BOTS[name]!, enemyCost: Number(option('--enemy-cost', '2')), aware: option('--aware', 'yes') === 'yes', beam: Number(option('--beam', String(BOTS[name]!.beam))) }; };
const elapsed = performance.now();
function game(r: Combo, first: string, second: string, gameSeed: number, opening: number[] = []) {
  let s = restore(r, opening); const moves = [...opening], players = [bot(first), bot(second)];
  const stats = [0, 1].map(() => ({ decisions: 0, evaluations: 0, generated: 0, changed: 0, depths: [0, 0, 0, 0, 0, 0], doubleShifts: 0, ms: 0 }));
  while (analyze(s, r).winner === null) {
    const p = s.turn - 1, at = performance.now(), chosen = choose(s, r, players[p]!, gameSeed ^ Math.imul(s.ply + 1, 2654435761));
    const stat = stats[p]!; stat.ms += performance.now() - at; stat.decisions++; stat.evaluations += chosen.stats.evaluations; stat.generated += chosen.stats.generated; stat.changed += Number(chosen.stats.changed); stat.depths[chosen.stats.depth]!++; stat.doubleShifts += chosen.action % 2;
    if (chosen.stats.evaluations > players[p]!.budget) throw new Error('Budget exceeded.');
    moves.push(chosen.action); s = apply(s, chosen.action, r);
    if (s.ply > 48 || s.board[s.star] !== 3) throw new Error('Broken game invariant.');
  }
  const a = analyze(s, r);
  return { first, second, seed: gameSeed, openingPlies: opening.length, winner: a.winner!, plies: s.ply, simultaneous: a.winner === 0 && a.masks.every(m => [1, 2, 4, 8].filter(bit => m & bit).length >= 3), moves, finalState: key(s), stats };
}
type Game = ReturnType<typeof game>;
function summary(games: Game[]) {
  const length = games.map(g => g.plies).sort((a, b) => a - b);
  return { games: games.length, firstWins: games.filter(g => g.winner === 1).length, secondWins: games.filter(g => g.winner === 2).length, draws: games.filter(g => g.winner === 0).length, simultaneous: games.filter(g => g.simultaneous).length,
    meanPlies: length.reduce((a, b) => a + b, 0) / games.length, medianPlies: length[Math.floor(length.length / 2)]!, meanDoubleShifts: games.reduce((a, g) => a + g.stats.reduce((b, s) => b + s.doubleShifts, 0), 0) / games.length };
}
export function interval(scores: number[], seed: number) {
  const random = rng(seed), samples: number[] = [];
  for (let i = 0; i < 3000; i++) { let sum = 0; for (let j = 0; j < scores.length; j++) sum += scores[Math.floor(random() * scores.length)]!; samples.push(sum / scores.length); }
  samples.sort((a, b) => a - b); return [samples[75]!, samples[2924]!];
}
function ladder(r: Combo, strong: string, weak: string, pairs: number, offset: number) {
  const games: Game[] = [], scores: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const gameSeed = seed + offset + i, opening = commonOpening(4, gameSeed);
    const a = game(r, strong, weak, gameSeed, opening), b = game(r, weak, strong, gameSeed, opening); games.push(a, b);
    scores.push(((a.winner === 1 ? 1 : a.winner === 0 ? .5 : 0) + (b.winner === 2 ? 1 : b.winner === 0 ? .5 : 0)) / 2);
    if ((i + 1) % 4 === 0) console.log(JSON.stringify({ variant: r.id, match: `${strong}/${weak}`, pairs: i + 1, seconds: Math.round((performance.now() - elapsed) / 1000) }));
  }
  const wins = games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === strong).length;
  const losses = games.filter(g => g.winner !== 0 && (g.winner === 1 ? g.first : g.second) === weak).length;
  return { strong, weak, pairs, wins, losses, draws: games.length - wins - losses, score: scores.reduce((a, b) => a + b, 0) / pairs, interval95: interval(scores, seed ^ 99173), summary: summary(games), games };
}
function tactics(r: Combo, count: number) {
  const records: Array<{ state: string; optimal: number; values: Record<string, number>; choices: number }> = [];
  for (let i = 0; i < count; i++) {
    const s = restore(r, commonOpening(46, seed + 30000 + i)), outcomes = new Map<number, number>();
    const value = (winner: number | null) => winner === 0 ? 0 : winner === s.turn ? 1 : -1;
    for (const c of successors(s, r)) {
      const a = analyze(c.state, r); let v = a.winner === null ? 1 : value(a.winner);
      if (a.winner === null) for (const reply of successors(c.state, r)) { const last = analyze(reply.state, r).winner; if (last === null) throw new Error('Endgame did not end.'); v = Math.min(v, value(last)); if (v === -1) break; }
      outcomes.set(c.action, v);
    }
    const optimal = Math.max(...outcomes.values()), values: Record<string, number> = {};
    for (const name of ['greedy', 'ab8k', 'ab32k', 'uct32k']) values[name] = outcomes.get(choose(s, r, bot(name), seed + i).action)!;
    records.push({ state: key(s), optimal, values, choices: outcomes.size });
  }
  return { positions: count, regrets: Object.fromEntries(['greedy', 'ab8k', 'ab32k', 'uct32k'].map(name => [name, records.filter(x => x.values[name]! < x.optimal).length])), records };
}
for (const r of selected) {
  const path = resolve(option('--out', `pilot-evidence/stage-d/j13-${r.id}-${option('--tag', phase)}.json`));
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`); mkdirSync(dirname(path), { recursive: true });
  const begun = performance.now(), result: Record<string, unknown> = { step: 'J13', variant: r, phase, seed, status: 'running', bots: Object.fromEntries(Object.keys(BOTS).map(name => [name, bot(name)])) };
  const save = () => writeFileSync(path, JSON.stringify(result, null, 2)); save();
  try {
    if (phase === 'pilot') result.pilot = game(r, option('--strong', 'ab32k'), option('--weak', 'ab8k'), seed, commonOpening(4, seed));
    else if (phase === 'matches') result.ladder = ladder(r, option('--strong', 'ab32k'), option('--weak', 'ab8k'), Number(option('--pairs', '32')), 20000);
    else if (phase === 'self') {
      const games = Array.from({ length: Number(option('--games', '96')) }, (_, i) => game(r, option('--bot', 'ab8k'), option('--bot', 'ab8k'), seed + i));
      const scores = games.map(g => g.winner === 1 ? 1 : g.winner === 0 ? .5 : 0);
      result.equal = { summary: summary(games), firstScore: scores.reduce<number>((a, b) => a + b, 0) / scores.length, interval95: interval(scores, seed ^ 99173), games };
    } else if (phase === 'primary') {
      result.branching = [0, 8, 16, 24].map(ply => {
        const records = Array.from({ length: ply ? 24 : 1 }, (_, i) => { const s = restore(r, commonOpening(ply, seed + i * 991 + ply)), children = successors(s, r); return { raw: actions(s, r).length, states: children.length, boards: new Set(children.map(c => c.state.board.join(''))).size }; });
        return { ply, count: records.length, raw: records.reduce((s, x) => s + x.raw, 0) / records.length, states: records.reduce((s, x) => s + x.states, 0) / records.length, boards: records.reduce((s, x) => s + x.boards, 0) / records.length };
      }); save();
      const random = Array.from({ length: 128 }, (_, i) => game(r, 'random', 'random', seed + i));
      result.random = { summary: summary(random), outcomes: random.map(({ winner, plies, simultaneous }) => ({ winner, plies, simultaneous })) }; save();
      result.ladder = ladder(r, 'ab32k', 'ab8k', 24, 20000); save();
      result.bridge = ladder(r, 'ab8k', 'greedy', 8, 10000); save();
      const games = Array.from({ length: 24 }, (_, i) => game(r, 'ab8k', 'ab8k', seed + 40000 + i));
      result.equal = { summary: summary(games), games }; save();
      result.tactics = tactics(r, 32);
    } else throw new Error('Unknown phase.');
    result.status = 'complete'; result.seconds = (performance.now() - begun) / 1000; save();
    const match = result.ladder as ReturnType<typeof ladder> | undefined;
    console.log(JSON.stringify({ variant: r.id, phase, status: 'complete', seconds: result.seconds, ladder: match && { score: match.score, interval95: match.interval95, summary: match.summary }, equal: (result.equal as { summary: unknown } | undefined)?.summary, output: path }));
  } catch (error) { result.status = 'failed'; result.error = String(error); save(); throw error; }
}
