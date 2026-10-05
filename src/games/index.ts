// Gamer mode's games (J1), by kind.
import { chess } from './chess.js';
import { checkers } from './checkers.js';
import { go } from './go.js';
import { crosscurrent, crosscurrentClassic, crosscurrentThreeEdges } from './crosscurrent.js';
import type { CrosscurrentRuleset, GameEngine, GameKind } from './engine.js';
export type { GameEngine, GameKind, Outcome } from './engine.js';
export const GAMES: Record<GameKind, GameEngine<unknown>> = { chess: chess as GameEngine<unknown>, checkers: checkers as GameEngine<unknown>, go: go as GameEngine<unknown>, crosscurrent: crosscurrent as GameEngine<unknown> };
// New setups are stamped before saving. An absent version identifies a pre-J12 Classic game.
export function gameEngine(setup: { kind: GameKind; ruleset?: CrosscurrentRuleset }): GameEngine<unknown> {
  if (setup.kind === 'crosscurrent') {
    if (setup.ruleset === undefined || setup.ruleset === 'classic-v1') return crosscurrentClassic as GameEngine<unknown>;
    if (setup.ruleset === 'three-edges-v2') return crosscurrentThreeEdges as GameEngine<unknown>;
    if (setup.ruleset !== 'three-edges-cooldown-v3') throw new Error(`Unsupported Crosscurrent ruleset: ${String(setup.ruleset)}`);
  }
  return GAMES[setup.kind];
}
