import { useEffect, useMemo, useRef, useState } from 'react';
import { GAMES, type GameKind } from '../src/games/index.js';
import { inCheck, playSan, type ChessState } from '../src/games/chess.js';
import type { CheckersState } from '../src/games/checkers.js';
import { goParse, type GoState } from '../src/games/go.js';
import { GAME_DEFAULTS, type GameSetup, type Seat } from '../src/types.js';
import { ChessBoard, CheckersBoard, GoBoard } from './game-boards.js';
import { Icon } from './icons.js';
import type { ThreadRun } from './model.js';

// Gamer mode's view (J3): it takes the conversation pane's place. Before a game, the board for the chosen game and its
// setup; during and after one, the board, the players, the moves and the result. The room only draws the game: the
// service's referee owns it, and the board here is the moves it accepted, replayed with the same engines.
const SEATS: Seat[] = ['cli1', 'cli2'];
const KINDS: Array<[GameKind, string]> = [['chess', 'Chess'], ['checkers', 'Checkers'], ['go', 'Go']];
const MINUTES = [1, 2, 5, 10];
interface Choice { kind: GameKind; size: number; first: Seat; minutes: number }
const CHOICE_KEY = 'ava-game';
function loadChoice(): Choice {
  try { const c = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null; if (c && GAMES[c.kind as GameKind]) return { kind: c.kind as GameKind, size: [9, 13, 19].includes(c.size ?? 0) ? c.size! : 9, first: c.first === 'cli2' ? 'cli2' : 'cli1', minutes: MINUTES.includes(c.minutes ?? 0) ? c.minutes! : 5 }; } catch { /* storage unavailable */ }
  return { kind: 'chess', size: 9, first: 'cli1', minutes: GAME_DEFAULTS.moveMs / 60_000 };
}
export const choiceSetup = (c: Choice): GameSetup => ({ kind: c.kind, ...(c.kind === 'go' ? { size: c.size } : {}), first: c.first, moveMs: c.minutes * 60_000, maxIllegal: GAME_DEFAULTS.maxIllegal });
// The game's title for its thread: "Chess: Claude Code (White) vs Codex (Black)".
export function gameTitle(setup: GameSetup, names: Record<Seat, string>) {
  const engine = GAMES[setup.kind], side = (s: Seat) => engine.sides[s === setup.first ? 0 : 1];
  return `${engine.name}${setup.kind === 'go' ? ` ${setup.size}x${setup.size}` : ''}: ${names[setup.first]} (${side(setup.first)}) vs ${names[setup.first === 'cli1' ? 'cli2' : 'cli1']} (${side(setup.first === 'cli1' ? 'cli2' : 'cli1')})`;
}
// Every position of the game, with what to pick out on each: the last move's squares, and a king in check.
function positions(setup: GameSetup, moves: string[]) {
  const engine = GAMES[setup.kind];
  let state = engine.start(setup.size);
  const out: Array<{ state: unknown; last?: number[]; check?: number }> = [{ state }];
  for (const move of moves) {
    let last: number[] | undefined;
    try {
      if (setup.kind === 'chess') { const played = playSan(state as ChessState, move); last = [played.from, played.to]; state = played.state; }
      else {
        if (setup.kind === 'checkers') last = move.split(/[-x]/).map(n => Number(n) - 1);
        else { const at = goParse(setup.size ?? 9, move); last = typeof at === 'number' ? [at] : []; }
        state = engine.play(state, move).state;
      }
    } catch { break; }
    const check = setup.kind === 'chess' && inCheck(state as ChessState) ? (state as ChessState).board.indexOf((state as ChessState).turn === 'w' ? 'K' : 'k') : undefined;
    out.push({ state, ...(last ? { last } : {}), ...(check !== undefined ? { check } : {}) });
  }
  return out;
}
function Board({ setup, position }: { setup: GameSetup; position: { state: unknown; last?: number[]; check?: number } }) {
  if (setup.kind === 'chess') return <ChessBoard board={(position.state as ChessState).board} last={position.last as [number, number] | undefined} check={position.check} />;
  if (setup.kind === 'checkers') return <CheckersBoard board={(position.state as CheckersState).board} path={position.last} />;
  const go = position.state as GoState;
  return <GoBoard size={go.size} board={go.board} last={position.last?.[0]} />;
}

export function GameView({ run, moves, live, speaking, names, canStart, blocked, busy, onStart }: {
  run: ThreadRun | null; moves: string[]; live: boolean; speaking: Seat[]; names: Record<Seat, string>;
  canStart: boolean; blocked: string; busy: boolean; onStart: (setup: GameSetup) => void;
}) {
  const [choice, setChoice] = useState<Choice>(loadChoice);
  useEffect(() => { try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* storage unavailable */ } }, [choice]);
  const setup = run?.config.game ?? choiceSetup(choice), engine = GAMES[setup.kind];
  const all = useMemo(() => positions(setup, moves), [setup.kind, setup.size, setup.first, moves.join(' ')]);
  // The position shown: the latest (following the game), or one picked from the moves.
  const [ply, setPly] = useState<number | null>(null);
  // A finished game's next one is set up in place of its moves, on request.
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => { setPly(null); setSetupOpen(false); }, [run?.id]);
  const shown = Math.min(ply ?? all.length - 1, all.length - 1), position = all[shown]!;
  const sideOf = (seat: Seat) => engine.sides[seat === setup.first ? 0 : 1];
  const toMove: Seat = moves.length % 2 === 0 ? setup.first : setup.first === 'cli1' ? 'cli2' : 'cli1';
  const result = run?.game?.result, illegal = run?.game?.illegal;
  const status = !run ? `${engine.name}: ${sideOf(setup.first)} moves first`
    : result ? (result.winner ? `${names[result.winner]} wins (${sideOf(result.winner)}): ${result.reason}` : `Draw: ${result.reason}`) + (result.score ? `. ${result.score}` : '')
    : live ? `${sideOf(toMove)} to move · move ${Math.floor(moves.length / 2) + 1}` : `Stopped at move ${Math.floor(moves.length / 2) + 1}, ${sideOf(toMove)} to move`;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { if (ply === null) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [moves.length, ply]);
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) rows.push(<li key={i}><span className="game-move-no">{i / 2 + 1}.</span>
    {[i, i + 1].map(k => k < moves.length ? <button key={k} type="button" aria-current={shown === k + 1 ? 'true' : undefined} onClick={() => setPly(k + 1 === moves.length ? null : k + 1)}>{moves[k]}</button> : <span key={k} />)}</li>);
  const setupCard = (title: string) => <section className="game-card game-setup" aria-label="Game setup">
    <header><h3>{title}</h3>{run && <button type="button" className="link" onClick={() => setSetupOpen(false)}>Back to this game</button>}</header>
    <div className="game-field"><span>Game</span><div className="segmented" role="radiogroup" aria-label="Game">{KINDS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={choice.kind === k} onClick={() => setChoice(c => ({ ...c, kind: k }))}>{label}</button>)}</div></div>
    {choice.kind === 'go' && <div className="game-field"><span>Board</span><div className="segmented" role="radiogroup" aria-label="Go board size">{[9, 13, 19].map(n => <button key={n} type="button" role="radio" aria-checked={choice.size === n} onClick={() => setChoice(c => ({ ...c, size: n }))}>{n}×{n}</button>)}</div></div>}
    <div className="game-field"><span>{GAMES[choice.kind].sides[0]}</span><div className="segmented" role="radiogroup" aria-label={`Who plays ${GAMES[choice.kind].sides[0]} (moves first)`}>{SEATS.map(s => <button key={s} type="button" role="radio" aria-checked={choice.first === s} onClick={() => setChoice(c => ({ ...c, first: s }))}><span className={`seat-dot ${s}`} />{names[s]}</button>)}</div></div>
    <div className="game-field"><span>Per move</span><div className="segmented" role="radiogroup" aria-label="Time per move">{MINUTES.map(m => <button key={m} type="button" role="radio" aria-checked={choice.minutes === m} onClick={() => setChoice(c => ({ ...c, minutes: m }))}>{m} min</button>)}</div></div>
    <button type="button" className="button primary" disabled={!canStart || busy} title={blocked || undefined} onClick={() => onStart(choiceSetup(choice))}><Icon.play /> {busy ? 'Briefing the players…' : `Start ${GAMES[choice.kind].name.toLowerCase()}`}</button>
    {blocked && <p className="game-note">{blocked}</p>}
    <p className="game-note">Each agent is first briefed in its 1:1 line: the rules, the standard notation and what each turn looks like. Each turn then gives only the position and the opponent’s last move, never the legal moves. AvA checks every move: three illegal answers in a row lose, as does running out of time.</p>
  </section>;
  return <div className="game-view" aria-label="Game">
    <div className="game-stage"><Board setup={setup} position={run ? position : all[0]!} /></div>
    <aside className="game-side">
      {run && <section className="game-card" aria-label="Players">
        {SEATS.map(s => <div key={s} className={`game-player${live && toMove === s ? ' to-move' : ''}${result?.winner === s ? ' won' : ''}`}>
          <span className={`game-token ${sideOf(s).toLowerCase()} ${setup.kind}`} aria-hidden="true" />
          <span className="game-player-name"><span className={`seat-dot ${s}`} />Agent {s === 'cli1' ? 1 : 2} · {names[s]}<small>{sideOf(s)}{illegal?.[s] ? ` · ${illegal[s]} illegal answer${illegal[s] === 1 ? '' : 's'}` : ''}</small></span>
          {live && speaking.includes(s) && <span className="game-thinking">thinking…</span>}
          {result?.winner === s && <span className="game-badge">Winner</span>}
        </div>)}
        <p className={`game-status${result ? ' over' : ''}`} role="status">{status}</p>
        {!live && canStart && !setupOpen && <button type="button" className="button game-new" onClick={() => setSetupOpen(true)}><Icon.game /> New game</button>}
      </section>}
      {run && !setupOpen && <section className="game-card game-moves-card" aria-label="Moves">
        <header><h3>Moves</h3><div className="game-replay" role="group" aria-label="Step through the game">
          <button type="button" className="icon-btn" aria-label="First position" disabled={shown === 0} onClick={() => setPly(0)}>«</button>
          <button type="button" className="icon-btn" aria-label="Previous move" disabled={shown === 0} onClick={() => setPly(Math.max(0, shown - 1))}>‹</button>
          <button type="button" className="icon-btn" aria-label="Next move" disabled={shown >= all.length - 1} onClick={() => setPly(shown + 1 >= all.length - 1 ? null : shown + 1)}>›</button>
          <button type="button" className="icon-btn" aria-label="Latest position" disabled={ply === null} onClick={() => setPly(null)}>»</button>
        </div></header>
        {moves.length ? <ol ref={list} className="game-moves">{rows}</ol> : <p className="game-note">{live ? `Waiting for ${names[toMove]}’s first move.` : 'No moves.'}</p>}
      </section>}
      {(!run || setupOpen) && setupCard(run ? 'Next game' : 'New game')}
    </aside>
  </div>;
}
