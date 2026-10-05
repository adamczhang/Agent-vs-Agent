// Crosscurrent (J14): Three Edges with one turn of cooldown on the last shifted line.
// Classic and Three Edges without cooldown are retained for saved games. Shifts wrap; connections do not.
import { CROSSCURRENT_DEFAULT_RULESET, CROSSCURRENT_RULESETS, GAME_BOARDS, type CrosscurrentRuleset, type GameEngine, type Outcome } from './engine.js';

export const CROSSCURRENT_COLUMNS = 'ABCDEFG';
export const CROSSCURRENT_STAR = 3;
export const CROSSCURRENT_DIRECTIONS = ['LEFT', 'RIGHT', 'UP', 'DOWN'] as const;
export type CrosscurrentDirection = typeof CROSSCURRENT_DIRECTIONS[number];
export interface CrosscurrentState {
  size: number;
  ruleset: CrosscurrentRuleset;
  resting: number | null; // Rows 0..6, columns 7..13. Null initially and in older rulesets.
  board: number[]; // 0 empty, 1 Circle (O), 2 Diamond (X), 3 neutral star (*); row 0 is row 1, at the top.
  turn: 1 | 2;
}
// line is the independent row/column index in Three Edges; Classic derives it from the placement.
export interface CrosscurrentMove { at: number; direction: CrosscurrentDirection; line?: number }
export const crosscurrentPoint = (size: number, i: number) => `${CROSSCURRENT_COLUMNS[i % size]}${Math.floor(i / size) + 1}`;
export const CROSSCURRENT_EDGES = ['Top', 'Bottom', 'Left', 'Right'] as const;
export const crosscurrentHasCooldown = (s: CrosscurrentState) => s.ruleset === 'three-edges-cooldown-v3';
export function crosscurrentLineId(size: number, move: CrosscurrentMove) {
  return move.direction === 'LEFT' || move.direction === 'RIGHT' ? move.line ?? Math.floor(move.at / size) : size + (move.line ?? move.at % size);
}
export const crosscurrentLineName = (size: number, id: number) => id < size ? `ROW ${id + 1}` : `COL ${CROSSCURRENT_COLUMNS[id - size]}`;
export function crosscurrentRestingLine(s: CrosscurrentState) {
  if (!crosscurrentHasCooldown(s) || s.resting === null) return null;
  const horizontal = s.resting < s.size, index = s.resting % s.size;
  return { id: s.resting, name: crosscurrentLineName(s.size, s.resting), horizontal, index, cells: Array.from({ length: s.size }, (_, k) => horizontal ? index * s.size + k : k * s.size + index) };
}
export function crosscurrentMoveText(size: number, move: CrosscurrentMove) {
  const horizontal = move.direction === 'LEFT' || move.direction === 'RIGHT';
  const line = move.line === undefined ? '' : horizontal ? ` ROW ${move.line + 1}` : ` COL ${CROSSCURRENT_COLUMNS[move.line]}`;
  return `${crosscurrentPoint(size, move.at)}${line} ${move.direction}`;
}

export function crosscurrentStart(size = 7, ruleset: CrosscurrentRuleset = CROSSCURRENT_DEFAULT_RULESET): CrosscurrentState {
  if (!GAME_BOARDS.crosscurrent!.sizes.includes(size)) throw new Error('Crosscurrent is played on a 7x7 board.');
  if (!CROSSCURRENT_RULESETS.includes(ruleset)) throw new Error(`Unsupported Crosscurrent ruleset: ${String(ruleset)}`);
  const board = Array<number>(size * size).fill(0);
  board[24] = CROSSCURRENT_STAR; // D4, the center.
  return { size, ruleset, resting: null, board, turn: 1 };
}
export function crosscurrentParse(size: number, input: string, ruleset: CrosscurrentRuleset = CROSSCURRENT_DEFAULT_RULESET): CrosscurrentMove | null {
  const classic = ruleset === 'classic-v1';
  const match = input.trim().toUpperCase().match(classic ? /^([A-G])([1-7])\s+(LEFT|RIGHT|UP|DOWN)$/ : /^([A-G])([1-7])\s+(?:ROW\s+([1-7])\s+(LEFT|RIGHT)|COL\s+([A-G])\s+(UP|DOWN))$/);
  if (!match) return null;
  const col = CROSSCURRENT_COLUMNS.indexOf(match[1]!), row = Number(match[2]) - 1;
  const line = classic ? undefined : match[3] ? Number(match[3]) - 1 : CROSSCURRENT_COLUMNS.indexOf(match[5]!);
  return col < size && row < size && (line === undefined || line < size) ? { at: row * size + col, direction: (classic ? match[3] : match[4] ?? match[6]) as CrosscurrentDirection, ...(line === undefined ? {} : { line }) } : null;
}
// Ordered source squares and the destination of the newly placed stone, also used to explain the move in the room.
export function crosscurrentShift(size: number, move: CrosscurrentMove) {
  const row = Math.floor(move.at / size), col = move.at % size;
  const horizontal = move.direction === 'LEFT' || move.direction === 'RIGHT';
  const delta = move.direction === 'RIGHT' || move.direction === 'DOWN' ? 1 : -1;
  const index = move.line ?? (horizontal ? row : col);
  const line = Array.from({ length: size }, (_, k) => horizontal ? index * size + k : k * size + index);
  const offset = line.indexOf(move.at);
  return { line, delta, destination: offset < 0 ? move.at : line[(offset + delta + size) % size]! };
}
// One traversal supplies the reached-edge indicators and paths from each reached edge back to the star.
export function crosscurrentGroup(s: CrosscurrentState, color: 1 | 2) {
  const star = s.board.indexOf(CROSSCURRENT_STAR);
  if (star < 0) return { edges: [false, false, false, false], paths: [null, null, null, null] as Array<number[] | null> };
  const queue = [star], parent = new Map<number, number>([[star, -1]]);
  const edges: Array<number | undefined> = [undefined, undefined, undefined, undefined]; // top, bottom, left, right
  for (let k = 0; k < queue.length; k++) {
    const at = queue[k]!, row = Math.floor(at / s.size), col = at % s.size;
    if (row === 0) edges[0] ??= at;
    if (row === s.size - 1) edges[1] ??= at;
    if (col === 0) edges[2] ??= at;
    if (col === s.size - 1) edges[3] ??= at;
    for (const [r, c] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]] as Array<[number, number]>) {
      if (r < 0 || r >= s.size || c < 0 || c >= s.size) continue;
      const next = r * s.size + c;
      if (s.board[next] === color && !parent.has(next)) { parent.set(next, at); queue.push(next); }
    }
  }
  const toStar = (at: number) => { const path: number[] = []; for (let p = at; p !== -1; p = parent.get(p)!) path.push(p); return path; };
  return { edges: edges.map(e => e !== undefined), paths: edges.map(e => e === undefined ? null : toStar(e)) };
}
// The winning walk can revisit branches; every segment follows connected stones through the star.
export function crosscurrentConnection(s: CrosscurrentState, color: 1 | 2): number[] | null {
  const { paths } = crosscurrentGroup(s, color);
  if (s.ruleset === 'classic-v1') {
    for (const [a, b] of [[paths[0], paths[1]], [paths[2], paths[3]]]) if (a && b) return [...a, ...b.toReversed().slice(1)];
  } else if (paths.filter(Boolean).length >= 3) {
    const walk = [s.board.indexOf(CROSSCURRENT_STAR)];
    for (const path of paths) if (path) walk.push(...path.toReversed().slice(1), ...path.slice(1));
    return walk;
  }
  return null;
}
export function crosscurrentOutcome(s: CrosscurrentState): Outcome | null {
  const circle = crosscurrentConnection(s, 1), diamond = crosscurrentConnection(s, 2);
  const classic = s.ruleset === 'classic-v1';
  if (circle && diamond) return { winner: null, reason: `both players connected ${classic ? 'opposite' : 'at least three'} edges with the star` };
  const path = circle ?? diamond;
  if (path) {
    const vertical = Math.floor(path[0]! / s.size) === 0 && Math.floor(path.at(-1)! / s.size) === s.size - 1;
    return { winner: circle ? 0 : 1, reason: `${circle ? 'Circle' : 'Diamond'} connected ${classic ? vertical ? 'top to bottom' : 'left to right' : 'at least three edges'} with the star` };
  }
  return s.board.includes(0) ? null : { winner: null, reason: 'the board is full with no winning connection' };
}
export function crosscurrentLegal(s: CrosscurrentState): string[] {
  if (crosscurrentOutcome(s)) return [];
  return s.board.flatMap((v, at) => v ? [] : CROSSCURRENT_DIRECTIONS.flatMap(direction => s.ruleset === 'classic-v1'
    ? [crosscurrentMoveText(s.size, { at, direction })]
    : Array.from({ length: s.size }, (_, line) => ({ at, direction, line }))
      .filter(move => !crosscurrentHasCooldown(s) || crosscurrentLineId(s.size, move) !== s.resting)
      .map(move => crosscurrentMoveText(s.size, move))));
}
export function crosscurrentPlay(s: CrosscurrentState, input: string) {
  if (crosscurrentOutcome(s)) throw new Error('The game is already over.');
  const move = crosscurrentParse(s.size, input, s.ruleset);
  if (!move) throw new Error(`${input} isn't a move on this board: ${s.ruleset === 'classic-v1' ? 'use a square and LEFT, RIGHT, UP or DOWN, for example A1 RIGHT' : 'use a placement square, then ROW 1-7 LEFT/RIGHT or COL A-G UP/DOWN, for example E3 ROW 4 RIGHT'}. Rows count from the top`);
  if (s.board[move.at] !== 0) throw new Error(`${crosscurrentPoint(s.size, move.at)} isn't empty`);
  const resting = crosscurrentHasCooldown(s) ? crosscurrentLineId(s.size, move) : null;
  if (resting !== null && resting === s.resting) throw new Error(`${crosscurrentLineName(s.size, resting)} is resting after the last shift; choose another row or column. Placement on the resting line is allowed`);
  const board = s.board.slice();
  board[move.at] = s.turn;
  const { line, delta } = crosscurrentShift(s.size, move), contents = line.map(i => board[i]!);
  line.forEach((_, k) => { board[line[(k + delta + s.size) % s.size]!] = contents[k]!; });
  return { state: { ...s, board, resting, turn: s.turn === 1 ? 2 : 1 } as CrosscurrentState, move: crosscurrentMoveText(s.size, move) };
}
export function crosscurrentPosition(s: CrosscurrentState): string {
  const lines = [`Crosscurrent ${s.size}x${s.size}${s.ruleset === 'classic-v1' ? '' : crosscurrentHasCooldown(s) ? ' Three Edges + Cooldown (v3)' : ' Three Edges (v2)'}`, `   ${CROSSCURRENT_COLUMNS.slice(0, s.size)}`];
  for (let r = 0; r < s.size; r++) lines.push(`${String(r + 1).padStart(2)} ${s.board.slice(r * s.size, (r + 1) * s.size).map(v => '.OX*'[v]).join('')}`);
  if (crosscurrentHasCooldown(s)) lines.push(`Resting line: ${s.resting === null ? 'none' : crosscurrentLineName(s.size, s.resting)}.`);
  return [...lines, `${s.turn === 1 ? 'Circle' : 'Diamond'} to play.`].join('\n');
}
export function crosscurrentFromPosition(text: string): CrosscurrentState {
  const header = text.match(/^Crosscurrent (7)x7( Three Edges \(v2\)| Three Edges \+ Cooldown \(v3\))?\r?$/m), size = Number(header?.[1]);
  const rows = [...text.matchAll(/^ ?(\d) ([OX.*]+)\r?$/gm)], turn = text.match(/^(Circle|Diamond) to play\.\r?$/m)?.[1];
  if (!header || rows.length !== size || rows.some((r, i) => Number(r[1]) !== i + 1 || r[2]!.length !== size) || !turn) throw new Error('Not a Crosscurrent position.');
  const board = rows.flatMap(r => [...r[2]!].map(v => '.OX*'.indexOf(v)));
  if (board.filter(v => v === CROSSCURRENT_STAR).length !== 1) throw new Error('Not a Crosscurrent position: exactly one star is required.');
  const circles = board.filter(v => v === 1).length, diamonds = board.filter(v => v === 2).length;
  if (turn === 'Circle' ? circles !== diamonds : circles !== diamonds + 1) throw new Error('Not a Crosscurrent position: stone counts do not match the side to play.');
  const ruleset = !header[2] ? 'classic-v1' : header[2].includes('Cooldown') ? 'three-edges-cooldown-v3' : 'three-edges-v2';
  const markers = text.split(/\r?\n/).filter(line => line.startsWith('Resting line:'));
  let resting: number | null = null;
  if (ruleset === 'three-edges-cooldown-v3') {
    const marker = markers.length === 1 ? markers[0]!.match(/^Resting line: (none|ROW ([1-7])|COL ([A-G]))\.$/) : null;
    if (!marker) throw new Error('Not a Crosscurrent position: exactly one valid resting line is required.');
    resting = marker[2] ? Number(marker[2]) - 1 : marker[3] ? size + CROSSCURRENT_COLUMNS.indexOf(marker[3]) : null;
    if (circles + diamonds === 0 ? resting !== null || board[24] !== CROSSCURRENT_STAR : resting === null) throw new Error('Not a Crosscurrent position: resting line does not match the turn history.');
  } else if (markers.length) throw new Error('Not a Crosscurrent position: this ruleset has no resting line.');
  return { size, ruleset, resting, board, turn: turn === 'Circle' ? 1 : 2 };
}

export const crosscurrentClassic: GameEngine<CrosscurrentState> = {
  kind: 'crosscurrent', name: 'Crosscurrent', sides: ['Circle', 'Diamond'],
  start: size => crosscurrentStart(size, 'classic-v1'), toMove: s => s.turn === 1 ? 0 : 1, legal: crosscurrentLegal, play: crosscurrentPlay,
  outcome: crosscurrentOutcome, plyLimit: s => s.size * s.size - 1,
  limitOutcome: s => crosscurrentOutcome(s) ?? { winner: null, reason: 'the move limit' },
  position: crosscurrentPosition, fromPosition: crosscurrentFromPosition,
  rules: 'Crosscurrent uses only a 7x7 board, starting with one neutral star at D4 and all other squares empty. Circle moves first. On your turn, place your stone in an empty square, then shift its entire row LEFT or RIGHT, or its entire column UP or DOWN, by exactly one square. All contents move, including the star, opposing stones and empty squares; contents leaving one end wrap to the other end. Both steps are mandatory; no passing or captures. The star belongs to neither player, cannot be replaced, and connects to either player\'s orthogonally adjacent stones. Only after the shift, check both players: a winning connected group must contain the star and reach top and bottom OR left and right. The group may branch or bend, using horizontal and vertical neighbors only: no diagonals, and connections do NOT wrap. A group that does not include the star cannot win. If only one player qualifies, that player wins, even if the other player made the move. If both qualify, it is a draw. A full board with no qualifying group is a draw. Each turn adds one stone; the star occupies one square, so play lasts at most 48 turns.',
  notation: 'A move is the placement square followed by the shift direction, for example A1 RIGHT. Columns A to G run left to right; rows 1 to 7 start at the TOP and increase downwards. LEFT and RIGHT shift the placement square\'s row; UP and DOWN shift its column. Positions begin with Crosscurrent 7x7, followed by column letters and numbered rows: O is Circle, X is Diamond, * is the shared neutral star, . is empty, then the side to play.',
  example: 'A1 RIGHT',
};
export const crosscurrentThreeEdges: GameEngine<CrosscurrentState> = {
  ...crosscurrentClassic, start: size => crosscurrentStart(size, 'three-edges-v2'),
  rules: 'Crosscurrent Three Edges uses only a 7x7 board, starting with one neutral star at D4 and all other squares empty. Circle moves first. On your turn, place your stone in an empty square, then independently choose ANY row to shift LEFT or RIGHT, or ANY column to shift UP or DOWN, by exactly one square. The shifted line need not contain your placement. Empty or unchanged lines are legal choices. All contents of the chosen line move, including the star, opposing stones and empty squares; contents leaving one end wrap to the other end. Both steps are mandatory; no passing or captures. The star belongs to neither player, cannot be replaced, and connects to either player\'s orthogonally adjacent stones. Only after the shift, check both players: a winning connected group must contain the star and reach AT LEAST THREE of the four edges (top, bottom, left, right). Two opposite edges alone do not win. Corner squares touch two edges; the star itself contributes its edge contacts to both players. For example, a complete outer row connected to the star reaches three edges. The group may branch or bend, using horizontal and vertical neighbors only: no diagonals, and connections do NOT wrap. A group that does not include the star cannot win. If only one player qualifies, that player wins, even if the other player made the move. If both qualify, it is a draw. A full board with no qualifying group is a draw. Each turn adds one stone; the star occupies one square, so play lasts at most 48 turns.',
  notation: 'A move names the placement square, the independently chosen line and its direction: E3 ROW 4 RIGHT places at E3 and shifts row 4 right; A1 COL D DOWN places at A1 and shifts column D down. ROW accepts only LEFT or RIGHT; COL accepts only UP or DOWN. Columns A to G run left to right; rows 1 to 7 start at the TOP and increase downwards. Positions begin with Crosscurrent 7x7 Three Edges (v2), followed by column letters and numbered rows: O is Circle, X is Diamond, * is the shared neutral star, . is empty, then the side to play.',
  example: 'E3 ROW 4 RIGHT',
};
export const crosscurrent: GameEngine<CrosscurrentState> = {
  ...crosscurrentThreeEdges, start: crosscurrentStart,
  rules: crosscurrentThreeEdges.rules.replace('Empty or unchanged lines are legal choices.', 'Cooldown: the exact row or column shifted on the previous turn is resting and cannot be shifted this turn, in either direction. You may still place on it or shift a perpendicular line. After your move, only the line you just shifted rests; the previous resting line becomes available again. On the first turn no line is resting. Empty or unchanged lines are legal choices and also start cooldown.'),
  notation: crosscurrentThreeEdges.notation.replace('Crosscurrent 7x7 Three Edges (v2)', 'Crosscurrent 7x7 Three Edges + Cooldown (v3)') + ' Before the side to play, each position includes Resting line: ROW 4. or Resting line: COL D., naming the line unavailable for shifting this turn. The initial position says Resting line: none. A row and a column are different lines, even where they cross.',
};
