import { useEffect, useMemo, useRef, useState } from 'react';
import { GAMES, type GameKind } from '../src/games/index.js';
import { CROSSCURRENT_DEFAULT_RULESET, GAME_BOARDS, GAME_KINDS } from '../src/games/engine.js';
import type { ChessState } from '../src/games/chess.js';
import type { CheckersState } from '../src/games/checkers.js';
import type { GoState } from '../src/games/go.js';
import { crosscurrent, crosscurrentParse, CROSSCURRENT_EDGES, CROSSCURRENT_STAR, crosscurrentGroup, crosscurrentHasCooldown, crosscurrentMoveText, crosscurrentPoint, crosscurrentRestingLine, crosscurrentShift, type CrosscurrentState } from '../src/games/crosscurrent.js';
import { GAME_DEFAULTS, type GameSetup, type ProviderConfig, type Seat } from '../src/types.js';
import { RUN_PROFILES, type RunProfile } from '../src/run-profiles.js';
import { ChessBoard, CheckersBoard, GoBoard, CrosscurrentBoard } from './game-boards.js';
import { Icon } from './icons.js';
import type { ThreadRun } from './model.js';
import { gameReplay, type GamePosition } from './game-replay.js';
import { GameAnalysis } from './game-analysis.js';
import { ProfileSelector } from './profile-selector.js';

// Gamer mode's view (J3): it takes the conversation pane's place. Before a game, the board for the chosen game and its
// setup; during and after one, the board, the players, the moves and the result. The room only draws the game: the
// service's referee owns it, and the board here is the moves it accepted, replayed with the same engines.
const SEATS: Seat[] = ['cli1', 'cli2'];
const KINDS: Array<[GameKind, string]> = GAME_KINDS.map(kind => [kind, GAMES[kind].name]);
const MINUTES = [1, 2, 5, 10];
interface Choice { kind: GameKind; size: number; first: Seat; minutes: number; profile?: RunProfile | '' }
const CHOICE_KEY = 'ava-game';
function loadChoice(): Choice {
  try { const c = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null; if (c && GAME_KINDS.includes(c.kind as GameKind)) return { kind: c.kind as GameKind, size: GAME_BOARDS.go!.sizes.includes(c.size ?? 0) ? c.size! : 9, first: c.first === 'cli2' ? 'cli2' : 'cli1', minutes: MINUTES.includes(c.minutes ?? 0) ? c.minutes! : 5, profile: c.profile && c.profile in RUN_PROFILES ? c.profile : '' }; } catch { /* storage unavailable */ }
  return { kind: 'chess', size: 9, first: 'cli1', minutes: 1, profile: 'quick' };
}
export const choiceSetup = (c: Choice): GameSetup => ({ kind: c.kind, ...(c.kind === 'go' ? { size: c.size } : c.kind === 'crosscurrent' ? { size: 7, ruleset: CROSSCURRENT_DEFAULT_RULESET } : {}), first: c.first, moveMs: c.minutes * 60_000, maxIllegal: GAME_DEFAULTS.maxIllegal });
// The game's title for its thread: "Chess: Claude Code (White) vs Codex (Black)".
export function gameTitle(setup: GameSetup, names: Record<Seat, string>) {
  const engine = GAMES[setup.kind], side = (s: Seat) => engine.sides[s === setup.first ? 0 : 1];
  const size = setup.size ?? GAME_BOARDS[setup.kind]?.defaultSize;
  return `${engine.name}${size ? ` ${size}x${size}` : ''}: ${names[setup.first]} (${side(setup.first)}) vs ${names[setup.first === 'cli1' ? 'cli2' : 'cli1']} (${side(setup.first === 'cli1' ? 'cli2' : 'cli1')})`;
}
function Board({ setup, position }: { setup: GameSetup; position: GamePosition }) {
  if (setup.kind === 'chess') return <ChessBoard board={(position.state as ChessState).board} last={position.last as [number, number] | undefined} check={position.check} />;
  if (setup.kind === 'checkers') return <CheckersBoard board={(position.state as CheckersState).board} path={position.last} />;
  if (setup.kind === 'crosscurrent') return <CrosscurrentBoard state={position.state as CrosscurrentState} move={position.shift} />;
  const go = position.state as GoState;
  return <GoBoard size={go.size} board={go.board} last={position.last?.[0]} />;
}

export function GameView({ run, moves, live, speaking, names, canStart, blocked, busy, onStart, pairId, agents }: {
  run: ThreadRun | null; moves: string[]; live: boolean; speaking: Seat[]; names: Record<Seat, string>;
  canStart: boolean; blocked: string; busy: boolean; onStart: (setup: GameSetup, profile?: RunProfile) => void;
  pairId?: string; agents?: Partial<Record<Seat, ProviderConfig | null>>;
}) {
  const [choice, setChoice] = useState<Choice>(loadChoice);
  useEffect(() => { try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* storage unavailable */ } }, [choice]);
  const setup = run?.config.game ?? choiceSetup(choice), engine = GAMES[setup.kind];
  const replayed = useMemo(() => gameReplay(setup, moves), [setup.kind, setup.size, setup.ruleset, setup.first, JSON.stringify(moves)]), all = replayed.positions;
  // The position shown: the latest (following the game), or one picked from the moves.
  const [ply, setPly] = useState<number | null>(null);
  const [variation, setVariation] = useState<{ from: number; moves: string[]; position: GamePosition } | null>(null), [candidate, setCandidate] = useState(''), [variationError, setVariationError] = useState('');
  const showPly = (next: number | null) => { setVariation(null); setVariationError(''); setPly(next); };
  const explore = (from: number, line: string[]) => {
    try {
      const initial = all[from]?.state as CrosscurrentState | undefined;
      if (!initial) throw new Error('That recorded position is unavailable.');
      const state = line.reduce((s, move) => crosscurrent.play(s, move).state, initial), move = line.at(-1);
      setVariation({ from, moves: line, position: { state, ...(move ? { shift: crosscurrentParse(7, move)! } : {}) } }); setCandidate(''); setVariationError('');
    } catch (error) { setVariationError(error instanceof Error ? error.message : String(error)); }
  };
  // A finished game's next one is set up in place of its moves, on request.
  const [setupOpen, setSetupOpen] = useState(false);
  const previewSetup = choiceSetup(choice);
  const preview = useMemo<GamePosition>(() => ({ state: GAMES[choice.kind].start(previewSetup.size) }), [choice.kind, previewSetup.size]);
  useEffect(() => { setPly(null); setVariation(null); setVariationError(''); setSetupOpen(false); }, [run?.id]);
  const shown = Math.max(0, Math.min(ply ?? all.length - 1, all.length - 1)), position = all[shown];
  const showingSetup = !run || setupOpen, shownSetup = showingSetup ? previewSetup : setup, shownPosition = showingSetup ? preview : variation?.position ?? position;
  const shift = showingSetup ? undefined : shownPosition?.shift;
  const crossState = shownSetup.kind === 'crosscurrent' && shownPosition ? shownPosition.state as CrosscurrentState : null, crossSize = crossState?.size ?? 7;
  const classic = crossState?.ruleset === 'classic-v1';
  const cooldown = crossState !== null && crosscurrentHasCooldown(crossState), resting = crossState && crosscurrentRestingLine(crossState);
  const sideOf = (seat: Seat) => engine.sides[seat === setup.first ? 0 : 1];
  const toMove: Seat = moves.length % 2 === 0 ? setup.first : setup.first === 'cli1' ? 'cli2' : 'cli1';
  const result = run?.game?.result, illegal = run?.game?.illegal;
  const status = !run ? `${engine.name}: ${sideOf(setup.first)} moves first`
    : result ? (result.winner ? `${names[result.winner]} wins (${sideOf(result.winner)}): ${result.reason}` : `Draw: ${result.reason}`) + (result.score ? `. ${result.score}` : '')
    : live ? `${sideOf(toMove)} to move · move ${Math.floor(moves.length / 2) + 1}` : `Stopped at move ${Math.floor(moves.length / 2) + 1}, ${sideOf(toMove)} to move`;
  const list = useRef<HTMLOListElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ply === null) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [moves.length, ply]);
  useEffect(() => { sidebar.current?.scrollTo({ top: 0 }); }, [run?.id, setupOpen, result?.reason]);
  // In a narrow app panel the whole view scrolls, not the sidebar. Starting from its setup must reveal the board.
  useEffect(() => { pane.current?.scrollTo({ top: 0 }); }, [run?.id]);
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) rows.push(<li key={i}><span className="game-move-no">{i / 2 + 1}.</span>
    {[i, i + 1].map(k => k < moves.length ? <button key={k} type="button" disabled={k + 1 >= all.length} aria-current={!variation && shown === k + 1 ? 'true' : undefined} onClick={() => showPly(k + 1 === moves.length ? null : k + 1)}>{moves[k]}</button> : <span key={k} />)}</li>);
  const setupCard = (title: string) => <section className="game-card game-setup" aria-label="Game setup">
    <header><h3>{title}</h3>{run && <button type="button" className="link" onClick={() => setSetupOpen(false)}>Back to this game</button>}</header>
    <div className="game-field"><span>Game</span><div className="segmented game-kinds" role="radiogroup" aria-label="Game">{KINDS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={choice.kind === k} onClick={() => setChoice(c => ({ ...c, kind: k }))}>{label}</button>)}</div></div>
    {choice.kind === 'go' && <div className="game-field"><span>Board</span><div className="segmented" role="radiogroup" aria-label="Go board size">{GAME_BOARDS.go!.sizes.map(n => <button key={n} type="button" role="radio" aria-checked={previewSetup.size === n} onClick={() => setChoice(c => ({ ...c, size: n }))}>{n}×{n}</button>)}</div></div>}
    {choice.kind === 'crosscurrent' && <div className="game-field"><span>Board</span><span className="game-note">7×7 · one shared star · Three Edges + cooldown</span></div>}
    <div className="game-field"><span>{GAMES[choice.kind].sides[0]}</span><div className="segmented" role="radiogroup" aria-label={`Who plays ${GAMES[choice.kind].sides[0]} (moves first)`}>{SEATS.map(s => <button key={s} type="button" role="radio" aria-checked={choice.first === s} onClick={() => setChoice(c => ({ ...c, first: s }))}><span className={`seat-dot ${s}`} />{names[s]}</button>)}</div></div>
    <ProfileSelector pairId={pairId} agents={agents} unit="move" value={choice.profile ?? ''} onChange={(profile, timeMs) => setChoice(c => ({ ...c, profile, ...(timeMs ? { minutes: timeMs / 60000 } : {}) }))} />
    <div className="game-field"><span>Per move</span><div className="segmented" role="radiogroup" aria-label="Time per move">{MINUTES.map(m => <button key={m} type="button" role="radio" aria-checked={choice.minutes === m} onClick={() => setChoice(c => ({ ...c, profile: '', minutes: m }))}>{m} min</button>)}</div></div>
    <button type="button" className="button primary" disabled={!canStart || busy} title={blocked || undefined} onClick={() => onStart(choiceSetup(choice), choice.profile || undefined)}><Icon.play /> {busy ? 'Briefing the players…' : `Start ${GAMES[choice.kind].name.toLowerCase()}`}</button>
    {blocked && <p className="game-note">{blocked}</p>}
    <p className="game-note">Each agent is first briefed in its 1:1 line: the rules, the standard notation and what each turn looks like. Each turn then gives only the position and the opponent’s last move, never the legal moves. AvA checks every move: three illegal answers in a row lose, as does running out of time.</p>
  </section>;
  return <div ref={pane} className="game-view" aria-label="Game">
    <div className="game-stage">{shownPosition ? <Board setup={shownSetup} position={shownPosition} /> : <p className="game-note">Board unavailable for this saved game.</p>}</div>
    <aside ref={sidebar} className="game-side">
      {!showingSetup && variation && <section className="game-card" aria-label="Analysis variation">
        <header><h3>Variation after turn {variation.from}</h3><button className="link" onClick={() => setVariation(null)}>Return to recorded game</button></header>
        <p className="game-note">{variation.moves.join(' → ') || 'Starting position'}</p>
        <form onSubmit={e => { e.preventDefault(); explore(variation.from, [...variation.moves, candidate]); }}>
          <label>Explore a reply<input aria-label="Variation move" value={candidate} placeholder="E3 ROW 4 RIGHT" onChange={e => setCandidate(e.target.value)} /></label>
          <button className="button" disabled={!candidate.trim()}>Play variation move</button>
        </form>
        <button className="link" disabled={!variation.moves.length} onClick={() => explore(variation.from, variation.moves.slice(0, -1))}>Undo variation move</button>
        {variationError && <p role="alert">{variationError}</p>}
      </section>}
      {!showingSetup && replayed.error && <section className="game-card game-replay-error" role="alert"><strong>Replay unavailable</strong><p className="game-note">{replayed.error}</p>{position && <p className="game-note">Board shown: after {shown} of {moves.length} recorded moves.</p>}</section>}
      {run && <section className="game-card" aria-label="Players">
        {SEATS.map(s => <div key={s} className={`game-player${live && toMove === s ? ' to-move' : ''}${result?.winner === s ? ' won' : ''}`}>
          <span className={`game-token ${sideOf(s).toLowerCase()} ${setup.kind}`} aria-hidden="true" />
          <span className="game-player-name"><span className={`seat-dot ${s}`} />Agent {s === 'cli1' ? 1 : 2} · {names[s]}<small>{sideOf(s)}{illegal?.[s] ? ` · ${illegal[s]} illegal answer${illegal[s] === 1 ? '' : 's'}` : ''}</small></span>
          {live && speaking.includes(s) && <span className="game-thinking">thinking…</span>}
          {result?.winner === s && <span className="game-badge">Winner</span>}
        </div>)}
        <p className={`game-status${result ? ' over' : ''}`} role="status">{(replayed.error || variation) && result ? 'Recorded result: ' : ''}{status}</p>
        {!live && canStart && !setupOpen && <button type="button" className="button game-new" onClick={() => setSetupOpen(true)}><Icon.game /> New game</button>}
      </section>}
      {crossState && <section className="game-card crosscurrent-progress" aria-label="Crosscurrent edge progress">
        <header><h3>{classic ? 'Classic' : 'Three Edges'}</h3><span className="game-note">{classic ? 'Connect opposite edges' : 'Reach any 3 edges'}</span></header>
        {cooldown && <p className="game-note crosscurrent-cooldown" aria-label="Resting line">{resting ? <>Resting: <strong>{resting.name}</strong> · no shift this turn</> : 'Resting: none · first turn'}</p>}
        {([1, 2] as const).map(color => { const { edges } = crosscurrentGroup(crossState, color), name = color === 1 ? 'Circle' : 'Diamond'; return <div key={color} role="group" className={`crosscurrent-progress-player ${name.toLowerCase()}`} aria-label={`${name} edge progress`}>
          <div><span><i className={`game-token crosscurrent ${name.toLowerCase()}`} aria-hidden="true" />{name}</span><small>{edges.filter(Boolean).length} of 4 reached</small></div>
          <div className="crosscurrent-edges">{CROSSCURRENT_EDGES.map((edge, i) => <span key={edge} className={`crosscurrent-edge${edges[i] ? ' reached' : ''}`} aria-label={`${edge} ${edges[i] ? 'reached' : 'not reached'}`}>{edges[i] ? '✓ ' : ''}{edge}</span>)}</div>
        </div>; })}
      </section>}
      {run && !setupOpen && <section className="game-card game-moves-card" aria-label="Moves">
        <header><h3>Moves</h3><div className="game-replay" role="group" aria-label="Step through the game">
          <button type="button" className="icon-btn" aria-label="First position" disabled={shown === 0 && !variation} onClick={() => showPly(0)}>«</button>
          <button type="button" className="icon-btn" aria-label="Previous move" disabled={shown === 0 && !variation} onClick={() => showPly(Math.max(0, shown - 1))}>‹</button>
          <button type="button" className="icon-btn" aria-label="Next move" disabled={shown >= all.length - 1} onClick={() => showPly(shown + 1 >= all.length - 1 ? null : shown + 1)}>›</button>
          <button type="button" className="icon-btn" aria-label="Latest position" disabled={ply === null && !variation} onClick={() => showPly(null)}>»</button>
        </div></header>
        {moves.length ? <ol ref={list} className="game-moves">{rows}</ol> : <p className="game-note">{live ? `Waiting for ${names[toMove]}’s first move.` : 'No moves.'}</p>}
      </section>}
      {run && ['completed', 'stopped'].includes(run.status) && !live && !showingSetup && !replayed.error && setup.kind === 'crosscurrent' && setup.ruleset === 'three-edges-cooldown-v3' && moves.length > 0 && <GameAnalysis runId={run.id} moves={moves} onPosition={showPly} onVariation={explore} />}
      {(!run || setupOpen) && setupCard(run ? 'Next game' : 'New game')}
      {crossState && <section className="game-card" aria-label="Crosscurrent rules">
        <header><h3>Crosscurrent</h3><span className="game-note">{crossSize}×{crossSize}</span></header>
        <div className="crosscurrent-legend"><span><i className="game-token circle crosscurrent" aria-hidden="true" />Circle · O · first</span><span><i className="game-token diamond crosscurrent" aria-hidden="true" />Diamond · X</span><span><i className="game-token star crosscurrent" aria-hidden="true" />Shared star · *</span></div>
        <p className="game-note crosscurrent-star-location">Star: {crosscurrentPoint(crossSize, crossState.board.indexOf(CROSSCURRENT_STAR))}</p>
        <p className="game-note">Place a stone in an empty square, then shift {classic ? 'its whole row left or right, or its whole column up or down' : 'any row left or right, or any column up or down'}, by one square. All contents of that line, including the shared star, wrap around the edge.{!classic && ' The line can be separate from your placement, even empty.'}</p>
        {cooldown && <p className="game-note">The row or column just shifted rests for the opponent’s next turn: it cannot shift in either direction. You can still place on it or shift a perpendicular line. After another line shifts, the previous one is available again. The dashed outline marks the resting line.</p>}
        <p className="game-note">To win, your connected group must include the star and reach {classic ? 'top and bottom or left and right' : 'at least three of the four edges'}. The star starts at D4, connects to either side, and cannot be replaced or captured. Corners touch two edges; the star’s own edge contacts count for both players. Groups may branch or bend; diagonals and wrapping do not connect. Check after the shift: both players qualifying, or a full board without a qualifying group, is a draw.</p>
        <p className="game-note">Rows count from the top. {classic ? <>A move such as <code>A1 RIGHT</code> places at A1, then shifts row 1 right.</> : <><code>E3 ROW 4 RIGHT</code> places at E3, then shifts row 4 right. <code>A1 COL D DOWN</code> places at A1, then shifts column D down.</>}</p>
        {shift && <p className="game-note crosscurrent-last" role="status">Move shown: {crosscurrentMoveText(crossSize, shift)}. New stone at {crosscurrentPoint(crossSize, crosscurrentShift(crossSize, shift).destination)}; the shaded line moved.</p>}
      </section>}
    </aside>
  </div>;
}
