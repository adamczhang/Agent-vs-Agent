// Exact local tactics for 7x7 Three Edges + cooldown. A shift-first factorization enumerates the same moves as the referee.
import { crosscurrentLineId, crosscurrentMoveText, crosscurrentParse, type CrosscurrentState } from './crosscurrent.js';
export interface TacticalState { board: Uint8Array; turn: 1 | 2; star: number; ply: number; resting: number }
export type Winner = 0 | 1 | 2 | null;
export const actionText = (action: number) => crosscurrentMoveText(7, { at: Math.floor(action / 56), line: Math.floor(action % 56 / 4) % 7, direction: (['LEFT','RIGHT','UP','DOWN'] as const)[(action % 56 < 28 ? 0 : 2) + Math.floor(action % 4 / 2)]! });
export function actionFor(move: string) { const m = crosscurrentParse(7, move); if (!m) throw new Error('Invalid Crosscurrent move.'); return m.at * 56 + crosscurrentLineId(7, m) * 4 + Number(m.direction === 'RIGHT' || m.direction === 'DOWN') * 2; }
export const NEIGHBORS = Array.from({ length: 49 }, (_, i) => [i >= 7 ? i - 7 : -1, i < 42 ? i + 7 : -1, i % 7 ? i - 1 : -1, i % 7 < 6 ? i + 1 : -1].filter(n => n >= 0));
export const EDGE = Array.from({ length: 49 }, (_, i) => (i < 7 ? 1 : 0) | (i >= 42 ? 2 : 0) | (i % 7 === 0 ? 4 : 0) | (i % 7 === 6 ? 8 : 0));
export const POP = Array.from({ length: 16 }, (_, n) => n.toString(2).replaceAll('0', '').length);
// A connected group reaching three sides spans an opposite pair (six edges) plus the star's distance to a third side.
export const minimumWinningStones = (star: number) => 6 + Math.min(Math.floor(star / 7), 6 - Math.floor(star / 7), star % 7, 6 - star % 7);
const maps = Array.from({ length: 28 }, (_, id) => Array.from({ length: 49 }, (_, at) => {
  const line = Math.floor(id / 2), d = id % 2 ? 1 : -1, r = Math.floor(at / 7), c = at % 7;
  return line < 7 ? r === line ? r * 7 + (c + d + 7) % 7 : at : c === line - 7 ? ((r + d + 7) % 7) * 7 + c : at;
}));
export const stateKey = (s: TacticalState) => `${s.board.join('')}:${s.turn}:${s.resting}`;
export const fromProduction = (s: CrosscurrentState): TacticalState => ({ board: Uint8Array.from(s.board), turn: s.turn, star: s.board.indexOf(3), ply: s.board.filter(v => v === 1 || v === 2).length, resting: s.resting ?? -1,  });
export const toProduction = (s: TacticalState): CrosscurrentState => ({ size: 7, ruleset: 'three-edges-cooldown-v3', board: [...s.board], turn: s.turn, resting: s.resting < 0 ? null : s.resting });
export function components(board: Uint8Array, star: number, color: number) {
  const labels = new Uint8Array(49); labels.fill(255);
  const masks: number[] = [], sizes: number[] = [], queue = new Uint8Array(49);
  for (let i = 0; i < 49; i++) if ((board[i] === color || i === star) && labels[i] === 255) {
    const id = masks.length; let head = 0, tail = 1, mask = 0; labels[i] = id; queue[0] = i;
    while (head < tail) {
      const at = queue[head++]!; mask |= EDGE[at]!;
      for (const next of NEIGHBORS[at]!) if ((board[next] === color || next === star) && labels[next] === 255) { labels[next] = id; queue[tail++] = next; }
    }
    masks.push(mask); sizes.push(tail);
  }
  const root = labels[star]!;
  return { labels, masks, sizes, root, mask: masks[root]!, size: sizes[root]! };
}
export function outcome(s: TacticalState): Winner {
  const a = POP[components(s.board, s.star, 1).mask]! >= 3, b = POP[components(s.board, s.star, 2).mask]! >= 3;
  return a && b ? 0 : a ? 1 : b ? 2 : s.ply === 48 ? 0 : null;
}
function shifted(s: TacticalState, id: number) {
  const board = new Uint8Array(49), map = maps[id]!;
  for (let i = 0; i < 49; i++) board[map[i]!] = s.board[i]!;
  return { board, star: map[s.star]! };
}
function completes(group: ReturnType<typeof components>, at: number) {
  if (POP[group.mask]! >= 3) return true;
  let mask = EDGE[at]!, connected = false;
  for (const n of NEIGHBORS[at]!) { const id = group.labels[n]!; if (id !== 255) { mask |= group.masks[id]!; connected ||= id === group.root; } }
  return connected && POP[mask]! >= 3;
}
export function play(s: TacticalState, action: number, respectRest = true): TacticalState {
  if (outcome(s) !== null) throw new Error('The game is already over.');
  const at = Math.floor(action / 56), id = Math.floor(action % 56 / 2), line = Math.floor(id / 2);
  if (!Number.isInteger(action) || action < 0 || at >= 49 || action % 2 || s.board[at] || (respectRest && line === s.resting)) throw new Error('Illegal tactical move.');
  const next = shifted(s, id); next.board[maps[id]![at]!] = s.turn;
  return { ...s, ...next, turn: s.turn === 1 ? 2 : 1, ply: s.ply + 1, resting: respectRest ? line : -1 };
}
export interface Child { action: number; state: TacticalState; winner: Winner; key: string }
export function children(s: TacticalState, respectRest = true): Child[] {
  const result = new Map<string, Child>();
  if (outcome(s) !== null) return [];
  for (let id = 0; id < 28; id++) {
    const line = Math.floor(id / 2); if (respectRest && line === s.resting) continue;
    const next = shifted(s, id), own = components(next.board, next.star, s.turn), opponentWins = POP[components(next.board, next.star, 3 - s.turn).mask]! >= 3;
    for (let destination = 0; destination < 49; destination++) if (!next.board[destination]) {
      const ownWins = completes(own, destination), winner: Winner = ownWins && opponentWins ? 0 : ownWins ? s.turn : opponentWins ? s.turn === 1 ? 2 : 1 : s.ply === 47 ? 0 : null;
      const board = next.board.slice(); board[destination] = s.turn;
      const state: TacticalState = { ...s, board, star: next.star, turn: s.turn === 1 ? 2 : 1, ply: s.ply + 1, resting: respectRest ? line : -1 }, key = stateKey(state);
      if (!result.has(key)) result.set(key, { action: maps[id ^ 1]![destination]! * 56 + id * 2, state, winner, key });
    }
  }
  return [...result.values()];
}
export function wins(s: TacticalState, firstOnly = false, respectRest = true): number[] {
  // Any three edges contain an opposite pair, so a winning component needs >=7 cells: star + >=6 owned stones.
  const ownedAfterPlacement = s.board.filter(v => v === s.turn).length + 1;
  if (ownedAfterPlacement < 6) return [];
  if (outcome(s) !== null) return [];
  const result: number[] = [];
  for (let id = 0; id < 28; id++) {
    if (respectRest && Math.floor(id / 2) === s.resting) continue;
    if (ownedAfterPlacement < minimumWinningStones(maps[id]![s.star]!)) continue;
    const next = shifted(s, id);
    if (POP[components(next.board, next.star, 3 - s.turn).mask]! >= 3) continue;
    const own = components(next.board, next.star, s.turn);
    for (let destination = 0; destination < 49; destination++) if (!next.board[destination] && completes(own, destination)) {
      result.push(maps[id ^ 1]![destination]! * 56 + id * 2); if (firstOnly) return result;
    }
  }
  return result;
}
export function safe(c: Child, mover: 1 | 2) { return c.winner !== null ? c.winner === mover || c.winner === 0 : wins(c.state, true).length === 0; }
// Exact existence of a reply that avoids losing immediately or on the next opposing move.
export function escape(s: TacticalState, respectRest = true): Child | null {
  const all = children(s, respectRest), immediate = all.find(c => c.winner === s.turn || c.winner === 0);
  if (immediate) return immediate;
  // Ordering affects speed only: every candidate is examined before claiming no escape.
  all.sort((a, b) => (a.state.star % 7 === 0 || a.state.star % 7 === 6 ? 1 : 0) - (b.state.star % 7 === 0 || b.state.star % 7 === 6 ? 1 : 0));
  return all.find(c => c.winner === null && wins(c.state, true, respectRest).length === 0) ?? null;
}
export function safetyReport(s: TacticalState, respectRest = true) {
  const all = children(s, respectRest), safeActions: number[] = [], refutations: Array<[number, number | null]> = [];
  for (const c of all) {
    const reply = c.winner === null ? wins(c.state, true, respectRest)[0] ?? null : null;
    if (c.winner === s.turn || c.winner === 0 || c.winner === null && reply === null) safeActions.push(c.action);
    else refutations.push([c.action, reply]);
  }
  return { choices: all.length, immediateWins: all.filter(c => c.winner === s.turn).map(c => c.action), safeActions, refutations };
}
