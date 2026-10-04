// Gamer mode's games (J1), by kind.
import { chess } from './chess.js';
import { checkers } from './checkers.js';
import { go } from './go.js';
import type { GameEngine, GameKind } from './engine.js';
export type { GameEngine, GameKind, Outcome } from './engine.js';
export const GAMES: Record<GameKind, GameEngine<unknown>> = { chess: chess as GameEngine<unknown>, checkers: checkers as GameEngine<unknown>, go: go as GameEngine<unknown> };
