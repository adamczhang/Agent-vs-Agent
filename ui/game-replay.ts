// Keep saved-game failures visible. Never silently show a truncated replay as the final board.
import { gameEngine } from '../src/games/index.js';
import { inCheck, playSan, type ChessState } from '../src/games/chess.js';
import { goParse } from '../src/games/go.js';
import { crosscurrentParse, type CrosscurrentMove, type CrosscurrentState } from '../src/games/crosscurrent.js';
import type { GameSetup } from '../src/types.js';
export interface GamePosition { state: unknown; last?: number[]; check?: number; shift?: CrosscurrentMove }
export interface GameReplay { positions: GamePosition[]; error?: string }
export function gameReplay(setup: GameSetup, moves: string[]): GameReplay {
  const positions: GamePosition[] = [];
  let engine, state: unknown;
  try { engine = gameEngine(setup); state = engine.start(setup.size); positions.push({ state }); }
  catch (error) { return { positions, error: error instanceof Error ? error.message : String(error) }; }
  for (const [index, move] of moves.entries()) {
    let last: number[] | undefined, shift: CrosscurrentMove | undefined;
    try {
      if (setup.kind === 'chess') { const played = playSan(state as ChessState, move); last = [played.from, played.to]; state = played.state; }
      else {
        if (setup.kind === 'checkers') last = move.split(/[-x]/).map(n => Number(n) - 1);
        else if (setup.kind === 'crosscurrent') { const current = state as CrosscurrentState; shift = crosscurrentParse(current.size, move, current.ruleset) ?? undefined; }
        else { const at = goParse(setup.size ?? 9, move); last = typeof at === 'number' ? [at] : []; }
        state = engine.play(state, move).state;
      }
      const check = setup.kind === 'chess' && inCheck(state as ChessState) ? (state as ChessState).board.indexOf((state as ChessState).turn === 'w' ? 'K' : 'k') : undefined;
      positions.push({ state, ...(last ? { last } : {}), ...(check !== undefined ? { check } : {}), ...(shift ? { shift } : {}) });
    } catch (error) {
      return { positions, error: `Recorded move ${index + 1} (${move}) cannot be replayed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { positions };
}
