// J11 research prototype. Not imported by Gamer or the service.
export type Color = 1 | 2;
export interface Rules { id: string; freeShift: boolean; goal: 'opposite' | 'three' | 'all' }
export const VARIANTS: Rules[] = [
  { id: 'current', freeShift: false, goal: 'opposite' },
  { id: 'free-shift', freeShift: true, goal: 'opposite' },
  { id: 'four-edges', freeShift: false, goal: 'all' },
  { id: 'combined', freeShift: true, goal: 'all' },
  { id: 'three-edges', freeShift: true, goal: 'three' },
];
export interface State { board: Uint8Array; turn: Color; ply: number; star: number }
export interface Analysis { winner: Color | 0 | null; score: number; masks: [number, number] }
export interface Child { action: number; state: State; key: string; analysis: Analysis; tie: number }
export interface SearchStats { evaluations: number; cacheHits: number; generated: number; depth: number; changedFromGreedy: boolean }
export interface Bot { name: string; budget: number; maxDepth: number; beam: number; enemyCost: number }
export const BOTS: Record<string, Bot> = {
  random: { name: 'random', budget: 0, maxDepth: 0, beam: 4, enemyCost: 2 },
  greedy: { name: 'greedy', budget: 2000, maxDepth: 1, beam: 4, enemyCost: 2 },
  search4k: { name: 'search4k', budget: 4096, maxDepth: 5, beam: 4, enemyCost: 2 },
  search16k: { name: 'search16k', budget: 16384, maxDepth: 5, beam: 4, enemyCost: 2 },
};
const NEIGHBORS = Array.from({ length: 49 }, (_, i) => {
  const r = Math.floor(i / 7), c = i % 7, out: number[] = [];
  if (r) out.push(i - 7); if (r < 6) out.push(i + 7); if (c) out.push(i - 1); if (c < 6) out.push(i + 1);
  return out;
});
const EDGES = Array.from({ length: 49 }, (_, i) => (i < 7 ? 1 : 0) | (i >= 42 ? 2 : 0) | (i % 7 === 0 ? 4 : 0) | (i % 7 === 6 ? 8 : 0));
export const SHIFTS = Array.from({ length: 28 }, (_, id) => {
  const horizontal = id < 14, index = Math.floor((id % 14) / 2), delta = id % 2 ? 1 : -1;
  const line = Array.from({ length: 7 }, (_, k) => horizontal ? index * 7 + k : k * 7 + index);
  const destinations = line.map((_, k) => line[(k + delta + 7) % 7]!);
  return { line, destinations, horizontal, index, delta };
});
export function start(): State { const board = new Uint8Array(49); board[24] = 3; return { board, turn: 1, ply: 0, star: 24 }; }
export function fromBoard(board: number[], turn: Color = 1): State { return { board: Uint8Array.from(board), turn, ply: board.filter(v => v === 1 || v === 2).length, star: board.indexOf(3) }; }
export function key(s: State) { return s.board.join(''); }
export function mix(n: number) { n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b); return (n ^ n >>> 16) >>> 0; }
export function rng(seed: number) { let value = seed >>> 0; return () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296; }
const shiftsFor = (at: number, rules: Rules) => rules.freeShift ? SHIFTS.map((_, i) => i) : [Math.floor(at / 7) * 2, Math.floor(at / 7) * 2 + 1, 14 + at % 7 * 2, 15 + at % 7 * 2];
export function rawActions(s: State, rules: Rules): number[] { const out: number[] = []; for (let at = 0; at < 49; at++) if (!s.board[at]) for (const shift of shiftsFor(at, rules)) out.push(at * 28 + shift); return out; }
export function label(action: number) {
  const at = Math.floor(action / 28), shift = SHIFTS[action % 28]!;
  return `${'ABCDEFG'[at % 7]}${Math.floor(at / 7) + 1} ${shift.horizontal ? `ROW ${shift.index + 1}` : `COL ${'ABCDEFG'[shift.index]}`} ${shift.horizontal ? shift.delta < 0 ? 'LEFT' : 'RIGHT' : shift.delta < 0 ? 'UP' : 'DOWN'}`;
}
export function apply(s: State, action: number, rules: Rules): State {
  const at = Math.floor(action / 28), id = action % 28, shift = SHIFTS[id];
  if (!Number.isInteger(action) || at < 0 || at >= 49 || !shift || s.board[at]) throw new Error('Invalid placement.');
  if (!rules.freeShift && !shiftsFor(at, rules).includes(id)) throw new Error('The line must contain the placement.');
  const board = s.board.slice(); board[at] = s.turn;
  const values = shift.line.map(i => board[i]!);
  for (let k = 0; k < 7; k++) board[shift.destinations[k]!] = values[k]!;
  const starOffset = shift.line.indexOf(s.star);
  return { board, turn: s.turn === 1 ? 2 : 1, ply: s.ply + 1, star: starOffset < 0 ? s.star : shift.destinations[starOffset]! };
}
const edgeCount = (mask: number) => (mask & 1) + (mask >> 1 & 1) + (mask >> 2 & 1) + (mask >> 3 & 1);
export const qualifies = (mask: number, rules: Rules) => rules.goal === 'all' ? mask === 15 : rules.goal === 'three' ? edgeCount(mask) >= 3 : (mask & 3) === 3 || (mask & 12) === 12;
// Integer-weight shortest paths. Zero-cost reachability is exactly the player's component containing the star.
// Scratch storage is local to each Node process; analyze() is synchronous and not recursively re-entered.
const distances = new Uint8Array(49), heads = new Int16Array(49), next = new Int16Array(256), vertices = new Uint8Array(256), edgeDistances = new Int16Array(4);
function measure(s: State, color: Color, rules: Rules, enemyCost: number) {
  distances.fill(255); heads.fill(-1); edgeDistances.fill(-1);
  distances[s.star] = 0; heads[0] = 0; vertices[0] = s.star; next[0] = -1;
  let entries = 1, found = 0, mask = 0, group = 0;
  for (let cost = 0; cost < heads.length; cost++) while (heads[cost]! >= 0) {
    const entry = heads[cost]!, at = vertices[entry]!; heads[cost] = next[entry]!;
    if (distances[at] !== cost) continue;
    if (cost === 0) { group++; mask |= EDGES[at]!; }
    for (let edge = 0; edge < 4; edge++) if ((EDGES[at]! & (1 << edge)) && edgeDistances[edge] === -1) { edgeDistances[edge] = cost; found++; }
    if (found === 4) {
      const [top, bottom, left, right] = edgeDistances;
      const sum = top! + bottom! + left! + right!;
      return { cost: rules.goal === 'all' ? sum / 2 : rules.goal === 'three' ? (sum - Math.max(top!, bottom!, left!, right!)) / 1.5 : Math.min(top! + bottom!, left! + right!), mask, group };
    }
    for (const neighbor of NEIGHBORS[at]!) {
      const v = s.board[neighbor]!, candidate = cost + (v === color || v === 3 ? 0 : v === 0 ? 1 : enemyCost);
      if (candidate < distances[neighbor]!) {
        if (candidate >= heads.length || entries >= vertices.length) throw new Error('Shortest-path scratch bound exceeded.');
        distances[neighbor] = candidate; vertices[entries] = neighbor; next[entries] = heads[candidate]!; heads[candidate] = entries++;
      }
    }
  }
  throw new Error('No edge distances found.');
}
export function analyze(s: State, rules: Rules, enemyCost = 2): Analysis {
  const a = measure(s, 1, rules, enemyCost), b = measure(s, 2, rules, enemyCost), aw = qualifies(a.mask, rules), bw = qualifies(b.mask, rules);
  const winner = aw && bw ? 0 : aw ? 1 : bw ? 2 : s.ply === 48 ? 0 : null;
  return { winner, masks: [a.mask, b.mask], score: winner === 0 ? 0 : winner === 1 ? 10000 : winner === 2 ? -10000 : 10 * (b.cost - a.cost) + .5 * (edgeCount(a.mask) - edgeCount(b.mask)) + .03 * (a.group - b.group) };
}
export function successors(s: State, rules: Rules) {
  const unique = new Map<string, { action: number; state: State; key: string }>();
  for (const action of rawActions(s, rules)) { const state = apply(s, action, rules), k = key(state); if (!unique.has(k)) unique.set(k, { action, state, key: k }); }
  return [...unique.values()];
}
class BudgetExceeded extends Error {}
export function choose(s: State, rules: Rules, bot: Bot, seed: number): { action: number; stats: SearchStats } {
  const stats: SearchStats = { evaluations: 0, cacheHits: 0, generated: 0, depth: 0, changedFromGreedy: false };
  if (bot.name === 'random') { const actions = rawActions(s, rules); return { action: actions[mix(seed) % actions.length]!, stats }; }
  const cache = new Map<string, Analysis>();
  const children = (state: State): Child[] => {
    const all = successors(state, rules); stats.generated += all.length;
    const sign = state.turn === 1 ? 1 : -1;
    const out = all.map(child => {
      let analysis = cache.get(child.key);
      if (analysis) stats.cacheHits++;
      else {
        if (stats.evaluations >= bot.budget) throw new BudgetExceeded();
        analysis = analyze(child.state, rules, bot.enemyCost); cache.set(child.key, analysis); stats.evaluations++;
      }
      let hash = seed; for (let i = 0; i < child.key.length; i++) hash = Math.imul(hash ^ child.key.charCodeAt(i), 16777619);
      return { ...child, analysis, tie: mix(hash) };
    });
    out.sort((a, b) => sign * (b.analysis.score - a.analysis.score) || a.tie - b.tie);
    return out;
  };
  const beam = (all: Child[]) => {
    const selected = all.slice(0, bot.beam), draw = all.find(c => c.analysis.winner === 0);
    if (draw && !selected.includes(draw)) selected.push(draw);
    return selected;
  };
  const root = children(s);
  if (!root.length) throw new Error('No move.');
  let best = root[0]!.action; stats.depth = 1;
  if (root[0]!.analysis.winner === s.turn || bot.maxDepth === 1) return { action: best, stats };
  const search = (child: Child, depth: number, alpha: number, beta: number): number => {
    const sign = child.state.turn === 1 ? 1 : -1;
    if (child.analysis.winner !== null || depth === 0) return sign * child.analysis.score;
    let value = -Infinity;
    for (const reply of beam(children(child.state))) {
      value = Math.max(value, -search(reply, depth - 1, -beta, -alpha)); alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  };
  for (let depth = 2; depth <= bot.maxDepth; depth++) {
    try {
      let value = -Infinity, candidate = best;
      for (const child of beam(root)) { const score = -search(child, depth - 1, -Infinity, -value); if (score > value) { value = score; candidate = child.action; } }
      best = candidate; stats.depth = depth;
      if (Math.abs(value) === 10000) break;
    } catch (error) { if (!(error instanceof BudgetExceeded)) throw error; break; }
  }
  stats.changedFromGreedy = best !== root[0]!.action;
  return { action: best, stats };
}
export function randomState(ply: number, seed: number) {
  const random = rng(seed), rules = VARIANTS[0]!;
  for (let attempt = 0; attempt < 10000; attempt++) {
    let state = start(); const opening: number[] = [];
    while (state.ply < ply && analyze(state, rules).winner === null) {
      const actions = rawActions(state, rules), action = actions[Math.floor(random() * actions.length)]!;
      opening.push(action); state = apply(state, action, rules);
    }
    if (state.ply === ply && analyze(state, rules).winner === null) return { state, opening };
  }
  throw new Error('Could not sample a common nonterminal position.');
}
