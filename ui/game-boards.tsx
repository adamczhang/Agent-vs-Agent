import type { ReactNode } from 'react';
import { COLUMNS } from '../src/games/go.js';
import { CROSSCURRENT_COLUMNS, CROSSCURRENT_STAR, crosscurrentConnection, crosscurrentMoveText, crosscurrentPoint, crosscurrentRestingLine, crosscurrentShift, type CrosscurrentMove, type CrosscurrentState } from '../src/games/crosscurrent.js';

// Gamer mode's boards (J3), drawn as SVG to match the room: quiet slate squares for chess and checkers, warm wood for Go,
// the last move picked out in the room's blue. The chess pieces are flat silhouettes drawn for AvA on a 45-unit grid, so
// they look the same on every system (font glyphs don't), in white and near-black with one outline.
const PIECES: Record<string, ReactNode> = {
  p: <><circle cx="22.5" cy="14" r="5.2" /><path d="M16.5 36C17 29.5 20 25 20.6 21.4h3.8C25 25 28 29.5 28.5 36z" /><rect x="17.5" y="19" width="10" height="3" rx="1.4" /></>,
  r: <><path d="M15 36l1.6-16.5h11.8L30 36z" /><path d="M13.5 20v-8h4v3.2h3v-3.2h4v3.2h3v-3.2h4v8z" /><rect x="14.6" y="18.6" width="15.8" height="2.6" rx="1" /></>,
  n: <><path d="M14.5 36c0-6.5 3-9.6 5.4-12.6-2.2.3-4.8 1.1-6.4-.4-1.6-1.6-.6-4.2 2-6.2 2.2-1.6 3.6-4 5-6.3l.7-3.2 2.6 2.8c6 1.2 8.9 6.7 8.6 14.2-.2 5-1.7 7.8-1.1 11.5z" /><circle cx="20.6" cy="15.6" r="1.1" className="eye" /></>,
  b: <><path d="M16 36c.5-6 2.5-9 4-11h5c1.5 2 3.5 5 4 11z" /><path d="M22.5 9.6c-5.6 4.4-6.6 9.6-5 13h10c1.6-3.4.6-8.6-5-13z" /><circle cx="22.5" cy="7.4" r="2.3" /><path d="M21.5 14.5l3.4 4" className="detail" fill="none" /></>,
  q: <><path d="M14.5 36L17 24h11l2.5 12z" /><path d="M13 24.5l2-12.5 3.6 8.4 3.9-10.4 3.9 10.4 3.6-8.4 2 12.5z" /><circle cx="15" cy="10.8" r="2" /><circle cx="22.5" cy="8.6" r="2" /><circle cx="30" cy="10.8" r="2" /><rect x="15.3" y="23" width="14.4" height="2.6" rx="1" /></>,
  k: <><path d="M14.5 36L17 23.5h11l2.5 12.5z" /><path d="M14 23.5c0-7 4.4-9 8.5-9s8.5 2 8.5 9z" /><rect x="21.3" y="4.5" width="2.4" height="10" rx=".8" /><rect x="18.3" y="7.3" width="8.4" height="2.4" rx=".8" /></>,
};
const BASE = <rect x="11" y="35.5" width="23" height="4.6" rx="2" />;
const FILES = 'abcdefgh';

export function ChessBoard({ board, last, check }: { board: string[]; last?: [number, number] | undefined; check?: number | undefined }) {
  return <svg className="board chess-board" viewBox="0 0 400 400" role="img" aria-label="Chess board">
    {board.map((_, i) => { const r = Math.floor(i / 8), f = i % 8; return <rect key={`s${i}`} x={f * 50} y={r * 50} width="50" height="50" className={`sq ${(r + f) % 2 ? 'dark' : 'light'}${last?.includes(i) ? ' last' : ''}${check === i ? ' check' : ''}`} />; })}
    {FILES.split('').map((file, f) => <text key={file} x={f * 50 + 46} y="396" className={`coord ${(7 + f) % 2 ? 'on-dark' : 'on-light'}`} textAnchor="end">{file}</text>)}
    {[...Array(8).keys()].map(r => <text key={r} x="3" y={r * 50 + 12} className={`coord ${r % 2 ? 'on-dark' : 'on-light'}`}>{8 - r}</text>)}
    {board.map((p, i) => p && <g key={`p${i}`} transform={`translate(${(i % 8) * 50 + 2.5} ${Math.floor(i / 8) * 50 + 2.5})`} className={`piece ${p === p.toUpperCase() ? 'white' : 'black'}`}>{BASE}{PIECES[p.toLowerCase()]}</g>)}
  </svg>;
}

// Checkers: the 32 dark squares numbered as in published games, men as discs, kings crowned.
const square = (i: number) => { const r = i >> 2; return { r, c: r % 2 === 0 ? 2 * (i % 4) + 1 : 2 * (i % 4) }; };
export function CheckersBoard({ board, path }: { board: string[]; path?: number[] | undefined }) {
  const cells = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) cells.push(<rect key={`${r}-${c}`} x={c * 50} y={r * 50} width="50" height="50" className={`sq ${(r + c) % 2 ? 'dark' : 'light'}`} />);
  return <svg className="board checkers-board" viewBox="0 0 400 400" role="img" aria-label="Checkers board">
    {cells}
    {board.map((_, i) => { const { r, c } = square(i); return <g key={`n${i}`}>{path?.includes(i) && <rect x={c * 50} y={r * 50} width="50" height="50" className="sq last" />}<text x={c * 50 + 4} y={r * 50 + 12} className="coord on-dark">{i + 1}</text></g>; })}
    {board.map((p, i) => { if (!p) return null; const { r, c } = square(i), x = c * 50 + 25, y = r * 50 + 26, side = p.toLowerCase() === 'b' ? 'black' : 'white';
      return <g key={`m${i}`} className={`man ${side}`}><circle cx={x} cy={y + 1.5} r="18" className="rim" /><circle cx={x} cy={y} r="18" /><circle cx={x} cy={y} r="12.5" className="ring" />
        {p === p.toUpperCase() && <path d={`M${x - 8} ${y + 4.5}l-1.6-9 5 4.2 4.6-6.4 4.6 6.4 5-4.2-1.6 9z`} className="crown" />}</g>; })}
  </svg>;
}

// Go: the grid, its star points, the stones, and a ring on the last one played.
const STARS: Record<number, number[]> = { 9: [2, 4, 6], 13: [3, 6, 9], 19: [3, 9, 15] };
export function GoBoard({ size, board, last }: { size: number; board: number[]; last?: number | undefined }) {
  const step = 400 / (size + 1), at = (k: number) => step * (k + 1), lines = [];
  for (let k = 0; k < size; k++) lines.push(<line key={`h${k}`} x1={at(0)} y1={at(k)} x2={at(size - 1)} y2={at(k)} />, <line key={`v${k}`} x1={at(k)} y1={at(0)} x2={at(k)} y2={at(size - 1)} />);
  const mid = (size - 1) / 2, stars = (STARS[size] ?? []).flatMap(a => (STARS[size] ?? []).map(b => [a, b] as const)).filter(([a, b]) => size === 19 || (a !== mid && b !== mid) || (a === mid && b === mid));
  const font = Math.max(7, step * .32);
  return <svg className="board go-board" viewBox="0 0 400 400" role="img" aria-label={`Go board, ${size} by ${size}`}>
    <rect width="400" height="400" rx="6" className="wood" />
    <g className="grid">{lines}</g>
    {stars.map(([a, b]) => <circle key={`${a}-${b}`} cx={at(a)} cy={at(b)} r={Math.max(2, step * .09)} className="star" />)}
    {[...Array(size).keys()].map(k => <g key={`c${k}`} className="go-coord" fontSize={font}><text x={at(k)} y={step * .45 + font * .35} textAnchor="middle">{COLUMNS[k]}</text><text x={at(k)} y={400 - step * .3} textAnchor="middle">{COLUMNS[k]}</text>
      <text x={step * .45} y={at(k) + font * .35} textAnchor="middle">{size - k}</text><text x={400 - step * .45} y={at(k) + font * .35} textAnchor="middle">{size - k}</text></g>)}
    {board.map((v, i) => v ? <g key={`st${i}`} className={`stone ${v === 1 ? 'black' : 'white'}`}><circle cx={at(i % size) + step * .03} cy={at(Math.floor(i / size)) + step * .05} r={step * .47} className="shadow" /><circle cx={at(i % size)} cy={at(Math.floor(i / size))} r={step * .47} />
      {last === i && <circle cx={at(i % size)} cy={at(Math.floor(i / size))} r={step * .2} className="last-ring" />}</g> : null)}
  </svg>;
}

// Crosscurrent uses square cells, circles and diamonds. The moved line is shaded, the new stone is ringed, and
// winning paths are drawn through the stones. Its coordinates deliberately count rows from the top.
export function CrosscurrentBoard({ state, move }: { state: CrosscurrentState; move?: CrosscurrentMove | undefined }) {
  const { size, board } = state, step = 336 / size, pad = 32;
  const center = (i: number) => [pad + (i % size + .5) * step, pad + (Math.floor(i / size) + .5) * step] as const;
  const motion = move ? crosscurrentShift(size, move) : undefined;
  const resting = crosscurrentRestingLine(state);
  const description = board.map((v, i) => v ? `${crosscurrentPoint(size, i)} ${v === 1 ? 'Circle' : v === 2 ? 'Diamond' : 'neutral star'}` : '').filter(Boolean).join(', ');
  return <svg className="board crosscurrent-board" viewBox="0 0 400 400" role="img" aria-label={`Crosscurrent board, ${size} by ${size}`}>
    <title>{`Crosscurrent: ${size} by ${size}`}</title><desc>{description}. Rows start at 1 at the top. Shaded squares show the shifted line; a ring marks the new stone.{resting && ` Resting line: ${resting.name}. The dashed outline marks the line unavailable for shifting this turn.`}</desc>
    <rect width="400" height="400" className="surface" />
    {board.map((_, i) => <rect key={`cell${i}`} x={pad + i % size * step} y={pad + Math.floor(i / size) * step} width={step} height={step} className={`cell${motion?.line.includes(i) ? ' shifted' : ''}${resting?.cells.includes(i) ? ' resting' : ''}`} />)}
    {resting && <rect className="cooldown-outline" x={pad + (resting.horizontal ? 0 : resting.index * step) + 2} y={pad + (resting.horizontal ? resting.index * step : 0) + 2} width={(resting.horizontal ? size * step : step) - 4} height={(resting.horizontal ? step : size * step) - 4} rx="3" />}
    {Array.from({ length: size }, (_, k) => <g key={`coord${k}`} className="crosscurrent-coord"><text x={pad + (k + .5) * step} y="21" textAnchor="middle">{CROSSCURRENT_COLUMNS[k]}</text><text x="16" y={pad + (k + .5) * step + 4} textAnchor="middle">{k + 1}</text></g>)}
    {([1, 2] as const).map(color => { const path = crosscurrentConnection(state, color); return path && <polyline key={`path${color}`} points={path.map(i => center(i).join(',')).join(' ')} className={`connection ${color === 1 ? 'circle' : 'diamond'}`} />; })}
    {board.map((v, i) => { if (!v) return null; const [x, y] = center(i), radius = step * .27;
      if (v === CROSSCURRENT_STAR) return <polygon key={`star${i}`} className="crosscurrent-star" points={Array.from({ length: 10 }, (_, k) => { const angle = -Math.PI / 2 + k * Math.PI / 5, r = radius * (k % 2 ? .45 : 1.15); return `${x + Math.cos(angle) * r},${y + Math.sin(angle) * r}`; }).join(' ')} />;
      return <g key={`stone${i}`} className={`crosscurrent-stone ${v === 1 ? 'circle' : 'diamond'}`}>
      {v === 1 ? <circle cx={x} cy={y} r={radius} /> : <polygon points={`${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`} />}
      {motion?.destination === i && <circle cx={x} cy={y} r={radius + 5} className="new-stone" />}
    </g>; })}
    {move && <text x="200" y="390" textAnchor="middle" className="crosscurrent-coord">{crosscurrentMoveText(size, move)} {({ LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓' })[move.direction]}</text>}
  </svg>;
}
