// J13 prototypes only. Production Gamer never imports this module.
import { analyze as geometry, SHIFTS, start as baseStart, mix, rng, type Analysis, type State as BoardState } from './crosscurrent.js';
export interface Combo { id: string; control: boolean; cooldown: boolean; power: 'none' | 'reserve' | 'star' }
export const COMBOS: Combo[] = (['none', 'reserve', 'star'] as const).flatMap(power => [false, true].flatMap(control => [false, true].map(cooldown => ({
  id: [control ? 'control' : '', cooldown ? 'rest' : '', power === 'reserve' ? 'double' : power === 'star' ? 'star' : ''].filter(Boolean).join('+') || 'baseline', control, cooldown, power,
}))));
export interface State extends BoardState { resting: number; reserve: number }
export interface Bot { name: string; algorithm: 'random' | 'greedy' | 'ab' | 'uct'; budget: number; beam: number; depth: number; enemyCost: number; aware: boolean }
export interface Stats { evaluations: number; generated: number; depth: number; iterations: number; changed: boolean }
export const BOTS: Record<string, Bot> = {
  random: { name: 'random', algorithm: 'random', budget: 0, beam: 4, depth: 0, enemyCost: 2, aware: true },
  greedy: { name: 'greedy', algorithm: 'greedy', budget: 4096, beam: 4, depth: 1, enemyCost: 2, aware: true },
  ab8k: { name: 'ab8k', algorithm: 'ab', budget: 8192, beam: 4, depth: 5, enemyCost: 2, aware: true },
  ab32k: { name: 'ab32k', algorithm: 'ab', budget: 32768, beam: 4, depth: 5, enemyCost: 2, aware: true },
  uct8k: { name: 'uct8k', algorithm: 'uct', budget: 8192, beam: 8, depth: 5, enemyCost: 2, aware: true },
  uct32k: { name: 'uct32k', algorithm: 'uct', budget: 32768, beam: 8, depth: 5, enemyCost: 2, aware: true },
};
const GOAL = { id: 'three-edges', freeShift: true, goal: 'three' as const };
export const start = (r: Combo): State => ({ ...baseStart(), resting: -1, reserve: r.power === 'reserve' ? 3 : 0 });
export const key = (s: State) => `${s.board.join('')}:${s.turn}:${s.resting}:${s.reserve}`;
export function lineCounts(s: State) {
  const counts = [new Uint8Array(14), new Uint8Array(14)];
  for (let i = 0; i < 49; i++) { const v = s.board[i]!; if (v === 1 || v === 2) { counts[v - 1]![Math.floor(i / 7)]!++; counts[v - 1]![7 + i % 7]!++; } }
  return counts;
}
export function analyze(s: State, r: Combo, bot: Pick<Bot, 'enemyCost' | 'aware'> = BOTS.ab8k!): Analysis {
  const result = geometry(s, GOAL, bot.enemyCost);
  if (result.winner !== null || !bot.aware) return result;
  let score = result.score;
  if (r.control) {
    const [a, b] = lineCounts(s);
    for (let i = 0; i < 14; i++) score += .75 * (Number(a![i]! > 0 && a![i]! >= b![i]!) - Number(b![i]! > 0 && b![i]! >= a![i]!));
  }
  if (r.power === 'reserve') score += 1.5 * (Number(!!(s.reserve & 1)) - Number(!!(s.reserve & 2)));
  return { ...result, score };
}
// Action: placement * 56 + direction-index * 2 + (distance - 1). Line identity ignores direction.
export function actions(s: State, r: Combo) {
  const out: number[] = [], counts = r.control ? lineCounts(s) : null;
  for (let at = 0; at < 49; at++) if (!s.board[at]) for (let line = 0; line < 14; line++) {
    if (r.cooldown && s.resting === line) continue;
    if (counts) {
      const own = counts[s.turn - 1]![line]! + Number(line < 7 ? Math.floor(at / 7) === line : at % 7 === line - 7);
      if (!own || own < counts[2 - s.turn]![line]!) continue;
    }
    const double = r.power === 'reserve' ? !!(s.reserve & (1 << (s.turn - 1))) : r.power === 'star' && (line < 7 ? Math.floor(s.star / 7) === line : s.star % 7 === line - 7);
    for (let direction = 0; direction < 2; direction++) {
      const action = at * 56 + (line * 2 + direction) * 2;
      out.push(action); if (double) out.push(action + 1);
    }
  }
  return out;
}
function transition(s: State, action: number, r: Combo): State {
  const at = Math.floor(action / 56), shift = SHIFTS[Math.floor(action % 56 / 2)]!, distance = action % 2 + 1;
  const board = s.board.slice(); board[at] = s.turn;
  for (let k = 0; k < 7; k++) board[shift.line[(k + shift.delta * distance + 7) % 7]!] = k === shift.line.indexOf(at) ? s.turn : s.board[shift.line[k]!]!;
  const starOffset = shift.line.indexOf(s.star);
  return { board, turn: s.turn === 1 ? 2 : 1, ply: s.ply + 1, star: starOffset < 0 ? s.star : shift.line[(starOffset + shift.delta * distance + 7) % 7]!,
    resting: r.cooldown ? Math.floor(action % 56 / 4) : -1,
    reserve: r.power === 'reserve' && distance === 2 ? s.reserve & ~(1 << (s.turn - 1)) : s.reserve };
}
export function apply(s: State, action: number, r: Combo) {
  if (!Number.isInteger(action) || !actions(s, r).includes(action)) throw new Error('Illegal prototype move.');
  return transition(s, action, r);
}
export function successors(s: State, r: Combo) {
  const unique = new Map<string, { state: State; action: number; key: string }>();
  for (const action of actions(s, r)) { const state = transition(s, action, r), k = key(state); if (!unique.has(k)) unique.set(k, { state, action, key: k }); }
  return [...unique.values()];
}
export function label(action: number) {
  const at = Math.floor(action / 56), shift = SHIFTS[Math.floor(action % 56 / 2)]!;
  return `${'ABCDEFG'[at % 7]}${Math.floor(at / 7) + 1} ${shift.horizontal ? `ROW ${shift.index + 1} ${shift.delta < 0 ? 'LEFT' : 'RIGHT'}` : `COL ${'ABCDEFG'[shift.index]} ${shift.delta < 0 ? 'UP' : 'DOWN'}`}${action % 2 ? ' 2' : ''}`;
}
class BudgetExceeded extends Error {}
type Child = ReturnType<typeof successors>[number] & { analysis: Analysis; tie: number };
export function choose(s: State, r: Combo, bot: Bot, seed: number): { action: number; stats: Stats } {
  const stats: Stats = { evaluations: 0, generated: 0, depth: 0, iterations: 0, changed: false };
  if (bot.algorithm === 'random') { const legal = actions(s, r); if (!legal.length) throw new Error('No move.'); return { action: legal[mix(seed) % legal.length]!, stats }; }
  const cache = new Map<string, Analysis>();
  const children = (state: State): Child[] => {
    const all = successors(state, r); stats.generated += all.length;
    const out = all.map(child => {
      let analysis = cache.get(child.key);
      if (!analysis) { if (stats.evaluations >= bot.budget) throw new BudgetExceeded(); analysis = analyze(child.state, r, bot); cache.set(child.key, analysis); stats.evaluations++; }
      let hash = seed; for (let i = 0; i < child.key.length; i++) hash = Math.imul(hash ^ child.key.charCodeAt(i), 16777619);
      return { ...child, analysis, tie: mix(hash) };
    });
    return out.sort((a, b) => (state.turn === 1 ? 1 : -1) * (b.analysis.score - a.analysis.score) || a.tie - b.tie);
  };
  const beam = (all: Child[]) => { const selected = all.slice(0, bot.beam), draw = all.find(c => c.analysis.winner === 0); if (draw && !selected.includes(draw)) selected.push(draw); return selected; };
  const root = children(s);
  if (!root.length) throw new Error('No move.');
  let best = root[0]!.action; stats.depth = 1;
  if (root[0]!.analysis.winner === s.turn || bot.algorithm === 'greedy') return { action: best, stats };
  if (bot.algorithm === 'ab') {
    const search = (child: Child, depth: number, alpha: number, beta: number): number => {
      if (child.analysis.winner !== null || !depth) return (child.state.turn === 1 ? 1 : -1) * child.analysis.score;
      let value = -Infinity;
      for (const reply of beam(children(child.state))) { value = Math.max(value, -search(reply, depth - 1, -beta, -alpha)); alpha = Math.max(alpha, value); if (alpha >= beta) break; }
      return value;
    };
    for (let depth = 2; depth <= bot.depth; depth++) {
      try {
        let value = -Infinity, candidate = best;
        for (const child of beam(root)) { const score = -search(child, depth - 1, -Infinity, -value); if (score > value) { value = score; candidate = child.action; } }
        best = candidate; stats.depth = depth; stats.iterations++;
        if (Math.abs(value) === 10000) break;
      } catch (error) { if (!(error instanceof BudgetExceeded)) throw error; break; }
    }
  } else {
    // UCT allocates lookahead adaptively. It uses heuristic leaves (not random playouts) and a static shortlist.
    // It is a second search policy, not independent evidence from a different evaluation function.
    interface Node { child: Child; visits: number; sum: number; next?: Node[] }
    const nodes = (all: Child[]) => beam(all).map(child => ({ child, visits: 0, sum: 0 } as Node));
    const roots = nodes(root), sign = s.turn === 1 ? 1 : -1;
    const select = (all: Node[], visits: number, maximizing: boolean) => all.reduce((best, n) => {
      const ucb = (x: Node) => x.visits ? (maximizing ? 1 : -1) * x.sum / x.visits + .8 * Math.sqrt(Math.log(visits + 1) / x.visits) : Infinity;
      return ucb(n) > ucb(best) ? n : best;
    });
    const visit = (node: Node, depth: number): number => {
      stats.depth = Math.max(stats.depth, depth);
      const a = node.child.analysis;
      let value: number;
      if (a.winner !== null) value = a.winner === 0 ? 0 : a.winner === s.turn ? 1 : -1;
      else if (depth === bot.depth || node.visits === 0) value = Math.tanh(sign * a.score / 20);
      else { node.next ??= nodes(children(node.child.state)); value = visit(select(node.next, node.visits, node.child.state.turn === s.turn), depth + 1); }
      node.visits++; node.sum += value; return value;
    };
    for (let n = 0; n < bot.budget / 4; n++) {
      try { visit(select(roots, n, true), 1); stats.iterations++; }
      catch (error) { if (!(error instanceof BudgetExceeded)) throw error; break; }
    }
    const visited = roots.filter(n => n.visits).sort((a, b) => b.visits - a.visits || b.sum / b.visits - a.sum / a.visits);
    if (visited.length) best = visited[0]!.child.action;
  }
  stats.changed = best !== root[0]!.action;
  return { action: best, stats };
}
// Openings legal under every tested combination: control + rest, with ordinary one-cell shifts only.
export function commonOpening(ply: number, seed: number) {
  const r = COMBOS.find(c => c.id === 'control+rest')!, random = rng(seed);
  for (let attempt = 0; attempt < 10000; attempt++) {
    let s = start(r); const moves: number[] = [];
    while (s.ply < ply && analyze(s, r).winner === null) { const legal = actions(s, r), action = legal[Math.floor(random() * legal.length)]!; moves.push(action); s = transition(s, action, r); }
    if (s.ply === ply && analyze(s, r).winner === null) return moves;
  }
  throw new Error('Could not find a common nonterminal opening.');
}
export const restore = (r: Combo, moves: number[]) => moves.reduce((s, a) => apply(s, a, r), start(r));
