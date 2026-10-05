import { crosscurrent, type CrosscurrentState } from './crosscurrent.js';
import { actionFor, actionText, escape, fromProduction, minimumWinningStones, outcome, play, wins } from './crosscurrent-tactics.js';

export type TacticalVerdict = 'win' | 'missed-win' | 'avoidable-loss' | 'forced-loss' | 'forcing' | 'draw' | 'unresolved';
export interface MoveAnalysis {
  ply: number; move: string; player: 1 | 2; verdict: TacticalVerdict; explanation: string;
  alternatives: string[]; winningReply?: string; minimumStones: number;
}
export const VERDICT_NAMES: Record<TacticalVerdict, string> = {
  win: 'Winning move', 'missed-win': 'Missed immediate win', 'avoidable-loss': 'Allowed an avoidable loss',
  'forced-loss': 'Already facing a forced loss', forcing: 'Forced win within three turns', draw: 'Draw', unresolved: 'No immediate mistake proved',
};
// Proofs cover every legal reply, including draws. No claim of optimal long-term play is made.
export function analyzeMove(position: CrosscurrentState, move: string, ply: number): MoveAnalysis {
  if (position.ruleset !== 'three-edges-cooldown-v3') throw new Error('Tactical analysis supports Three Edges + cooldown games.');
  const next = crosscurrent.play(position, move).state, s = fromProduction(position), child = fromProduction(next);
  const beforeWins = wins(s), after = outcome(child), reply = after === null ? wins(child, true)[0] : undefined;
  const base = { ply, move, player: s.turn, minimumStones: minimumWinningStones(s.star) };
  if (after === s.turn) return { ...base, verdict: 'win', alternatives: [], explanation: 'The completed shift gives this player the only winning connection.' };
  if (beforeWins.length) return { ...base, verdict: 'missed-win', alternatives: beforeWins.slice(0, 3).map(actionText), explanation: 'An immediate winning move was available. The recorded move does not win.', ...(reply !== undefined ? { winningReply: actionText(reply) } : {}) };
  if (after === 0) return { ...base, verdict: 'draw', alternatives: [], explanation: crosscurrent.outcome(next)!.reason + '.' };
  if (after !== null || reply !== undefined) {
    const defense = escape(s);
    return { ...base, verdict: defense ? 'avoidable-loss' : 'forced-loss', alternatives: defense ? [actionText(defense.action)] : [],
      explanation: defense ? 'This move loses immediately or allows a winning reply. The alternative avoids defeat on that reply; it is not a proof of saving the whole game.' : 'Every legal move here loses immediately or on the next opposing reply. The decisive error, if any, happened earlier.',
      ...(reply !== undefined ? { winningReply: actionText(reply) } : {}) };
  }
  if (escape(child) === null) return { ...base, verdict: 'forcing', alternatives: [], explanation: 'Every legal opponent response loses immediately or permits a winning reply. This is a verified short forcing sequence.' };
  return { ...base, verdict: 'unresolved', alternatives: [], explanation: 'No immediate winning opportunity or avoidable one-reply loss was found. Longer-term strength is unassessed.' };
}

export function analyzeGame(moves: string[], onMove?: (move: MoveAnalysis) => void): MoveAnalysis[] {
  if (moves.length > 48) throw new Error('A Crosscurrent game has at most 48 moves.');
  let s = crosscurrent.start(); const result: MoveAnalysis[] = [];
  for (const [i, move] of moves.entries()) { const entry = analyzeMove(s, move, i + 1); result.push(entry); onMove?.(entry); s = crosscurrent.play(s, move).state; }
  return result;
}
// An independently playable continuation for a viewer, never appended to the saved game.
export function variationPosition(position: CrosscurrentState, moves: string[]) {
  return moves.reduce((s, move) => { play(fromProduction(s), actionFor(move)); return crosscurrent.play(s, move).state; }, position);
}
