// Gamer mode's referee (J2). AvA owns the game: it keeps the one board and checks every move before it counts. Before
// each game, each agent gets a brief through its 1:1 line: the rules, the standard notation, what each turn will look
// like and how to answer. Each turn is then small and the same size: the move number and side, the opponent's last move
// and the position in standard notation (FEN, PDN FEN, a Go grid). No move history and no list of legal moves: finding a
// legal move is part of the game, and three illegal answers in a row lose (owner, 2026-10-04). A legal move is recorded
// as the game writes it, so a game's moves are its committed room messages, and they replay to its position. The agents
// never see each other's replies, only the moves.
import { GAMES } from './index.js';
import type { Outcome } from './engine.js';
import { other, type GameSetup, type RoomMessage, type Seat } from '../types.js';

export const playerOf = (setup: GameSetup, seat: Seat): 0 | 1 => seat === setup.first ? 0 : 1;
export const seatOf = (setup: GameSetup, player: 0 | 1): Seat => player === 0 ? setup.first : other(setup.first);
export const sideOf = (setup: GameSetup, seat: Seat) => GAMES[setup.kind].sides[playerOf(setup, seat)];
export const gameMoves = (messages: RoomMessage[]) => messages.filter(m => m.sender !== 'user' && m.state === 'committed').map(m => m.text);
export function replay(setup: GameSetup, moves: string[]) {
  const engine = GAMES[setup.kind];
  let state = engine.start(setup.size);
  for (const move of moves) state = engine.play(state, move).state;
  return state;
}
const minutes = (ms: number) => ms % 60_000 ? `${Math.round(ms / 1000)} seconds` : `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}`;
const ANSWER = 'Reply with: MOVE: <move>';
const boardName = (setup: GameSetup) => `${GAMES[setup.kind].name}${setup.kind === 'go' ? ` on a ${setup.size ?? 9}x${setup.size ?? 9} board` : ''}`;
// A turn's prompt: the move number and side, the opponent's last move, and the position. retry: the agent's last answer
// and why it was refused, with the tries it has left (the position again, unchanged).
export function movePrompt(setup: GameSetup, moves: string[], seat: Seat, retry?: { input: string; reason: string; left: number }) {
  const engine = GAMES[setup.kind], position = engine.position(replay(setup, moves)), side = sideOf(setup, seat);
  if (retry) {
    const refused = retry.input ? `MOVE: ${retry.input} (${retry.reason})` : retry.reason;
    return [`Refused: ${refused}. ${retry.left === 1 ? 'Last try: another illegal answer loses the game.' : `${retry.left} tries left.`} The position is unchanged:`, position, ANSWER].join('\n');
  }
  const last = moves.length ? `Your opponent's last move: ${moves.at(-1)}.` : 'You make the first move.';
  return [`Move ${Math.floor(moves.length / 2) + 1}, ${side} to play. ${last}`, position, ANSWER].join('\n');
}
// The brief each agent gets through its 1:1 line before the game: everything each turn then leaves out. The agent
// answers READY.
export function gameBrief(setup: GameSetup, seat: Seat) {
  const engine = GAMES[setup.kind], side = sideOf(setup, seat), firstSeat = setup.first;
  return [
    `You are about to play ${boardName(setup)} against another AI agent. You play ${side}; ${engine.sides[0]} moves first${firstSeat === seat ? ', so you start' : ''}. AvA is the referee: it keeps the board and checks every move before it counts. You see only the moves, not your opponent's replies.`,
    `Rules: ${engine.rules}`,
    `Notation: ${engine.notation}`,
    `Each turn you get a short message: the move number and your side, your opponent's last move, and the position. The first move looks like this:\n\n${movePrompt(setup, [], firstSeat)}\n\nNo list of legal moves is given: finding a legal move is part of the game. The position is the referee's, so trust it over your memory of the game.`,
    `Answer each turn with one line: MOVE: <your move>, for example MOVE: ${engine.example}. To resign: MOVE: resign. Think as long as you need, but keep your reply to that line.`,
    `An illegal answer is refused with the reason and you are asked again; ${setup.maxIllegal} illegal answers in a row lose the game. You have ${minutes(setup.moveMs)} for each move, thinking included, and a move that runs over loses the game. Don't use tools or the web.`,
    `Don't move yet. Reply with one line: READY, ${side}.`,
  ].join('\n\n');
}
// The move in an agent's reply: its last MOVE line (Markdown marks ignored), or null.
export function readMove(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/[*`_]/g, '').trim()).filter(Boolean);
  for (const line of lines.reverse()) { const m = line.match(/^(?:final\s+)?move\s*[:：]\s*(.+)$/i); if (m) return m[1]!.replace(/[.。]$/, '').trim(); }
  return null;
}
export type Verdict = { kind: 'move'; move: string; outcome: Outcome | null } | { kind: 'resign' } | { kind: 'illegal'; input: string; reason: string };
// Whether the agent's reply is a legal move, a resignation, or neither (and why).
export function judgeReply(setup: GameSetup, moves: string[], text: string): Verdict {
  const engine = GAMES[setup.kind], input = readMove(text);
  if (input === null) return { kind: 'illegal', input: '', reason: 'there was no MOVE line' };
  if (/^resigns?$/i.test(input)) return { kind: 'resign' };
  let state = replay(setup, moves);
  try {
    const played = engine.play(state, input);
    state = played.state;
    const outcome = engine.outcome(state) ?? (moves.length + 1 >= engine.plyLimit(state) ? engine.limitOutcome(state) : null);
    return { kind: 'move', move: played.move, outcome };
  } catch (error) { return { kind: 'illegal', input, reason: (error instanceof Error ? error.message : String(error)).replace(/^.*? isn't/, 'it isn\'t') }; }
}
// The game's result for the room: who won (or a draw), why, and the score where the game has one.
export function gameResult(setup: GameSetup, outcome: Outcome): { winner?: Seat; reason: string; score?: string } {
  return { ...(outcome.winner !== null ? { winner: seatOf(setup, outcome.winner) } : {}), reason: outcome.reason, ...(outcome.score ? { score: outcome.score } : {}) };
}
