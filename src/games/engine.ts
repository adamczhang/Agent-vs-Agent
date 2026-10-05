// One game's rules, as Gamer mode's referee uses them (J1). The two players are 0 (who moves first: White in chess, Black
// in checkers and Go, Circle in Crosscurrent) and 1. Every engine is small, complete for its game, and written for agent-against-agent play:
// it accepts a move as an agent writes it (in the game's standard notation), refuses an illegal one with the reason, and
// says when the game is over. Agents are never shown the legal moves; legal() is the referee's own (and the tests').
// No dependencies: the service and the room both use it (the room replays a game's moves to draw its board).
export const GAME_KINDS = ['chess', 'checkers', 'go', 'crosscurrent'] as const;
export type GameKind = typeof GAME_KINDS[number];
export const CROSSCURRENT_RULESETS = ['classic-v1', 'three-edges-v2', 'three-edges-cooldown-v3'] as const;
export type CrosscurrentRuleset = typeof CROSSCURRENT_RULESETS[number];
export const CROSSCURRENT_DEFAULT_RULESET: CrosscurrentRuleset = 'three-edges-cooldown-v3';
// Setup metadata stays independent of the engines: types.ts is also loaded by the light MCP entry point.
export const GAME_BOARDS: Partial<Record<GameKind, { sizes: readonly number[]; defaultSize: number }>> = {
  go: { sizes: [9, 13, 19], defaultSize: 9 },
  crosscurrent: { sizes: [7], defaultSize: 7 },
};
export interface Outcome { winner: 0 | 1 | null; reason: string; score?: string }
export interface GameEngine<S> {
  kind: GameKind; name: string;
  // The two players' names, in move order.
  sides: [string, string];
  start(size?: number): S;
  toMove(s: S): 0 | 1;
  legal(s: S): string[];
  // The move an agent wrote, played: throws, with the reason, if it isn't legal. move: as the game records it.
  play(s: S, input: string): { state: S; move: string };
  outcome(s: S): Outcome | null;
  // How many moves (plies) a game may last, and its result when it reaches them.
  plyLimit(s: S): number;
  limitOutcome(s: S): Outcome;
  // The position in the game's standard notation, as each turn gives it (owner, 2026-10-04: standard notation, and
  // turns that stay small): FEN in chess, PDN FEN in checkers, a compact grid in Go and Crosscurrent.
  position(s: S): string;
  // The position read back from a turn's text (its history aside): how the simulator's players see the board.
  fromPosition(text: string): S;
  // For the brief before each game: the rules, the notation for moves and positions, and an example move.
  rules: string;
  notation: string;
  example: string;
}
