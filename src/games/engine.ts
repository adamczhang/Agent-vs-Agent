// One game's rules, as Gamer mode's referee uses them (J1). The two players are 0 (who moves first: White in chess, Black
// in checkers and Go) and 1. Every engine is small, complete for its game, and written for agent-against-agent play:
// it accepts a move as an agent writes it (in the game's standard notation), refuses an illegal one with the reason, and
// says when the game is over. Agents are never shown the legal moves; legal() is the referee's own (and the tests').
// No dependencies: the service and the room both use it (the room replays a game's moves to draw its board).
export type GameKind = 'chess' | 'checkers' | 'go';
export interface Outcome { winner: 0 | 1 | null; reason: string; score?: string }
export interface GameEngine<S> {
  kind: GameKind; name: string;
  // The two players' names: White and Black in chess, Black and White in checkers and Go.
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
  // turns that stay small): FEN in chess, PDN FEN in checkers, a compact grid in Go.
  position(s: S): string;
  // The position read back from a turn's text (its history aside): how the simulator's players see the board.
  fromPosition(text: string): S;
  // For the brief before each game: the rules, the notation for moves and positions, and an example move.
  rules: string;
  notation: string;
  example: string;
}
