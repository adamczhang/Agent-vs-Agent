import records from './crosscurrent-puzzles.json' with { type: 'json' };
import { crosscurrent } from './crosscurrent.js';
import { readMove } from './referee.js';
import { escape, fromProduction, outcome, wins } from './crosscurrent-tactics.js';
export type PuzzleGoal = 'win' | 'defend' | 'cooldown' | 'force';
export interface Puzzle { id: string; version: number; title: string; goal: PuzzleGoal; instruction: string; position: string }
export interface PuzzleGrade { status: 'pass' | 'fail' | 'illegal'; move: string; explanation: string }
export const PUZZLES: Array<Puzzle & { solution: string; source: { file: string; game: number; prefix: string[] } }> = records as typeof PUZZLES;
export const puzzleCatalog = (): Puzzle[] => PUZZLES.map(({ solution, source, ...p }) => p);
export function puzzle(id: string) { const found = PUZZLES.find(p => p.id === id); if (!found) throw new Error('Unknown Crosscurrent puzzle.'); return found; }
export function gradePuzzle(p: Puzzle, answer: string): PuzzleGrade {
  const move = readMove(answer) ?? answer.trim();
  let position, child;
  try { position = crosscurrent.fromPosition(p.position); child = fromProduction(crosscurrent.play(position, move).state); }
  catch (error) { return { status: 'illegal', move, explanation: error instanceof Error ? error.message : String(error) }; }
  const result = outcome(child), won = result === position.turn, safe = won || result === 0 || result === null && wins(child, true).length === 0;
  const passed = p.goal === 'win' ? won : p.goal === 'defend' ? safe : p.goal === 'cooldown' ? result === null && safe && wins(child, true, false).length > 0 : won || result === null && escape(child) === null;
  return { status: passed ? 'pass' : 'fail', move, explanation: passed ? 'The move satisfies the goal; all required replies were checked.' : 'The move is legal but does not satisfy the stated goal.' };
}
export function puzzlePrompt(p: Puzzle, timeMs: number) {
  return [`Crosscurrent puzzle: ${p.title}`, `Goal: ${p.instruction}`, `Rules: ${crosscurrent.rules}`, crosscurrent.notation, `Time limit: ${timeMs / 1000} seconds. Solve from this position independently. Do not use tools or the internet.`, p.position, 'Reply with: MOVE: <move>'].join('\n\n');
}
