import test from 'node:test';
import assert from 'node:assert/strict';
import { AvAService } from '../src/service.js';
import { conversationConfig, SEATS, type GameSetup, type Pair, type ProviderConfig, type Run, type Seat } from '../src/types.js';
import { gameBrief, judgeReply, movePrompt, readMove, replay } from '../src/games/referee.js';
import { GAMES, type GameKind } from '../src/games/index.js';
import { SimulatedParticipant, SimulationFactory } from '../src/simulation.js';
import { TestFactory, flush } from './fakes.js';
import { tempDir } from './temp.js';

const until = async (check: () => boolean, ms = 3000) => { for (let i = 0; i < ms / 5 && !check(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(check(), 'timed out'); };
const setup = (kind: GameKind, first: Seat = 'cli1'): GameSetup => ({ kind, first, moveMs: 300_000, maxIllegal: 3, ...(kind === 'go' ? { size: 9 } : {}) });

test('J2 referee: each turn is short (the move, the opponent\'s last move, the position in standard notation), with no legal moves', () => {
  const chess = setup('chess');
  assert.equal(movePrompt(chess, ['e4', 'e5'], 'cli1'), "Move 2, White to play. Your opponent's last move: e5.\nFEN: rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2\nReply with: MOVE: <move>");
  assert.equal(movePrompt(setup('checkers', 'cli2'), [], 'cli2'), 'Move 1, Black to play. You make the first move.\nFEN: B:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,11,12\nReply with: MOVE: <move>');
  assert.match(movePrompt(setup('go'), ['E5', 'D4'], 'cli1'), /^Move 2, Black to play\. Your opponent's last move: D4\.\n {3}ABCDEFGHJ\n 9 \.{9}\n[\s\S]* 5 \.\.\.\.X\.\.\.\.\n 4 \.\.\.O\.{5}\n[\s\S]*Captures: Black 0, White 0\.\nReply with: MOVE: <move>$/);
  // The turn stays the same size as the game goes on: no move history.
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7'];
  assert.ok(movePrompt(chess, moves, 'cli1').length < 160); assert.doesNotMatch(movePrompt(chess, moves, 'cli1'), /e4|legal/);
  assert.equal(movePrompt(setup('go'), [], 'cli1', { input: 'Z9', reason: 'off the board', left: 1 }).split('\n')[0], 'Refused: MOVE: Z9 (off the board). Last try: another illegal answer loses the game. The position is unchanged:');
  assert.match(movePrompt(chess, [], 'cli1', { input: '', reason: 'there was no MOVE line', left: 2 }), /^Refused: there was no MOVE line\. 2 tries left\./);
  assert.equal(readMove('I like the center.\n**MOVE:** `Nf3`'), 'Nf3');
  assert.equal(readMove('No move here.'), null);
  assert.deepEqual(judgeReply(chess, ['e4', 'e5'], 'MOVE: Nf3'), { kind: 'move', move: 'Nf3', outcome: null });
  assert.deepEqual(judgeReply(chess, ['e4', 'e5'], 'MOVE: Ke3'), { kind: 'illegal', input: 'Ke3', reason: "it isn't a legal move here" });
  assert.deepEqual(judgeReply(chess, [], 'Thinking.'), { kind: 'illegal', input: '', reason: 'there was no MOVE line' });
  assert.deepEqual(judgeReply(chess, [], 'MOVE: resign'), { kind: 'resign' });
  assert.deepEqual(judgeReply(chess, ['f3', 'e5', 'g4'], 'MOVE: Qh4'), { kind: 'move', move: 'Qh4#', outcome: { winner: 1, reason: 'checkmate' } });
  // Each turn's position reads back to the same position (the simulator's players read their turns so).
  for (const [game, played] of [[chess, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']], [setup('checkers'), ['11-15', '23-19', '8-11', '22-17']], [setup('go'), ['E5', 'D4', 'pass']]] as const) {
    const engine = GAMES[game.kind], text = movePrompt(game, [...played], played.length % 2 ? 'cli2' : 'cli1');
    assert.equal(engine.position(engine.fromPosition(text)), engine.position(replay(game, [...played])), game.kind);
  }
  assert.throws(() => GAMES.go.fromPosition(movePrompt(chess, [], 'cli1')), /Not a Go position/);
  assert.throws(() => conversationConfig('Chess', { mode: 'game', game: { ...setup('chess'), size: 9 } }), /one board/);
  assert.throws(() => conversationConfig('Go', { mode: 'game', game: { ...setup('go'), size: 11 } }), /9x9, 13x13 or 19x19/);
  assert.deepEqual([conversationConfig('Go', { mode: 'game', game: setup('go', 'cli2') }).opening, conversationConfig('Chess', { game: setup('chess') }).game], ['cli2', undefined]);
});

test('J2 brief: the side, the rules, the standard notation, a sample turn, the answer and the limits, before the game', () => {
  const brief = gameBrief(setup('chess', 'cli2'), 'cli1');
  for (const part of [/^You are about to play Chess against another AI agent\. You play Black; White moves first\. /, /Rules: The standard rules of chess \(FIDE\)/, /Notation: Moves in standard algebraic notation \(SAN\).*Positions in FEN/,
    /The first move looks like this:\n\nMove 1, White to play\. You make the first move\.\nFEN: rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w KQkq - 0 1\nReply with: MOVE: <move>\n\nNo list of legal moves is given/,
    /MOVE: <your move>, for example MOVE: e4\. To resign: MOVE: resign\./, /3 illegal answers in a row lose the game\. You have 5 minutes for each move/, /Reply with one line: READY, Black\.$/])
    assert.match(brief, part);
  assert.match(gameBrief(setup('chess', 'cli2'), 'cli2'), /You play White; White moves first, so you start\./);
  assert.match(gameBrief(setup('checkers'), 'cli1'), /play Checkers.*You play Black; Black moves first, so you start\.[\s\S]*Notation: Squares are numbered 1 to 32[\s\S]*Moves in PDN[\s\S]*PDN FEN[\s\S]*MOVE: 11-15/);
  assert.match(gameBrief({ ...setup('go'), size: 13, moveMs: 90_000 }, 'cli2'), /play Go on a 13x13 board.*You play White; Black moves first\.[\s\S]*GTP coordinates[\s\S]*\n13 \.{13}\n[\s\S]*MOVE: D4[\s\S]*90 seconds for each move/);
});

async function room(factory: TestFactory) {
  const service = new AvAService(tempDir('ava-gamer-'), factory, 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  const pair = await service.call('pair.create', { thread: 'gamer' }) as Pair;
  for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
  return { service, pair, close: async () => { await service.shutdown(); service.store.close(); } };
}
const seated = (service: AvAService, factory: TestFactory, pair: Pair, seat: Seat) => factory.agents.find(a => !a.closed && a.sessionId === service.store.pair(pair.id).slots[seat].sessionId);
// A game's start: each player's brief, answered READY, then the run. Returns the run and both briefs as sent.
async function start(service: AvAService, factory: TestFactory, pair: Pair, requestId: string, game: GameSetup) {
  const starting = service.call('run.start', { pairId: pair.id, text: game.kind, requestId, options: { mode: 'game', paceMs: 0, game } }) as Promise<Run>;
  const briefs = {} as Record<Seat, string>;
  for (const seat of SEATS) {
    await until(() => { const call = seated(service, factory, pair, seat)?.calls.at(-1); return !!call && !call.settled && /You are about to play/.test(call.request.text); });
    const agent = seated(service, factory, pair, seat)!;
    briefs[seat] = agent.calls.at(-1)!.request.text; agent.raw(`READY, ${seat}.`);
  }
  return { run: await starting, briefs };
}
// The agent playing seat: its next move request, answered with this text. Returns the prompt it got.
async function play(service: AvAService, factory: TestFactory, pair: Pair, seat: Seat, text: string) {
  const agent = () => seated(service, factory, pair, seat)!;
  await until(() => !!agent()?.calls.at(-1) && !agent().calls.at(-1)!.settled && /Reply with: MOVE: <move>$/.test(agent().calls.at(-1)!.request.text));
  const prompt = agent().calls.at(-1)!.request.text;
  agent().raw(text); await flush();
  return prompt;
}

test('J2: a game of chess runs move by move with AvA as referee: briefed first, an illegal answer is asked again, mate ends the run', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const { run, briefs } = await start(service, factory, pair, 'chess', setup('chess'));
    assert.deepEqual([run.config.mode, run.config.opening, run.config.game?.kind], ['game', 'cli1', 'chess']);
    // Each brief came through the player's 1:1 line, with the web off whatever the agent's setting.
    for (const part of [/Private message from the operator/, /You play White; White moves first, so you start/, /Internet access: off/]) assert.match(briefs.cli1, part);
    assert.match(briefs.cli2, /You play Black; White moves first\./);
    const thread = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ id: string; runIds: string[] }> }).threads.find(t => t.runIds.includes(run.id))!.id;
    const direct = (await service.call('thread.get', { threadId: thread }) as { direct: { messages: Array<{ seat: Seat; sender: string; text: string }> } }).direct.messages;
    for (const seat of SEATS) assert.ok(direct.some(m => m.seat === seat && m.sender === 'agent' && /READY/.test(m.text)), `${seat}'s READY is in its 1:1 line`);
    const first = await play(service, factory, pair, 'cli1', 'MOVE: f3');
    assert.match(first, /^Move 1, White to play\. You make the first move\.\nFEN: rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w KQkq - 0 1\n/);
    const second = await play(service, factory, pair, 'cli2', 'I take the center.\nMOVE: e5');
    assert.match(second, /^Move 1, Black to play\. Your opponent's last move: f3\.\nFEN: /); assert.doesNotMatch(second, /legal|Rules/);
    await assert.rejects(service.call('run.broadcast', { runId: run.id, text: 'Play e4!', requestId: 'tip' }), /takes no messages/, 'nobody else speaks to the players');
    // An illegal answer: refused with the reason, and asked again.
    await play(service, factory, pair, 'cli1', 'MOVE: Ke3');
    const again = await play(service, factory, pair, 'cli1', 'MOVE: g4');
    assert.match(again, /^Refused: MOVE: Ke3 \(it isn't a legal move here\)\. 2 tries left\. The position is unchanged:\nFEN: rnbqkbnr\/pppp1ppp\/8\/4p3\/8\/5P2\/PPPPP1PP\/RNBQKBNR w KQkq e6 0 2\n/);
    assert.equal(service.store.run(run.id).game?.illegal.cli1, 1);
    await play(service, factory, pair, 'cli2', 'MOVE: Qh4');
    await until(() => service.store.run(run.id).status === 'completed');
    const done = service.store.run(run.id);
    assert.deepEqual([done.reason, done.game?.result], ['game_over', { winner: 'cli2', reason: 'checkmate' }]);
    assert.deepEqual(service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text), ['f3', 'e5', 'g4', 'Qh4#'], 'only legal moves count, as the game writes them');
    const threads = (await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ verdict?: unknown; runIds: string[] }> }).threads.filter(t => t.runIds.length);
    assert.deepEqual(threads[0]!.verdict, { status: 'done', kind: 'game', winner: 'cli2', reason: 'checkmate' });
    // The next game is its own thread, with fresh sessions, briefed again.
    const before = service.store.pair(pair.id).slots.cli1.sessionId;
    const next = await start(service, factory, pair, 'checkers', setup('checkers', 'cli2'));
    assert.notEqual(service.store.pair(pair.id).slots.cli1.sessionId, before);
    assert.match(next.briefs.cli2, /play Checkers against another AI agent\. You play Black; Black moves first, so you start\./);
    assert.match(await play(service, factory, pair, 'cli2', 'MOVE: 11-15'), /^Move 1, Black to play\. You make the first move\.\nFEN: B:W21,/);
  } finally { await close(); }
});

test('J2: a brief that fails stops the game before it starts, and the next start renews both sessions', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const starting = service.call('run.start', { pairId: pair.id, text: 'chess', requestId: 'fails', options: { mode: 'game', paceMs: 0, game: setup('chess') } }) as Promise<Run>;
    await until(() => SEATS.every(seat => /You are about to play/.test(seated(service, factory, pair, seat)?.calls.at(-1)?.request.text ?? '')));
    seated(service, factory, pair, 'cli1')!.raw('READY, White.');
    const call = seated(service, factory, pair, 'cli2')!.calls.at(-1)!; call.settled = true; call.reject(new Error('provider down'));
    await assert.rejects(starting, /didn’t take its game brief/);
    assert.equal(service.store.pair(pair.id).activeRunId, null);
    const sessions = SEATS.map(seat => service.store.pair(pair.id).slots[seat].sessionId);
    const { run } = await start(service, factory, pair, 'retry', setup('chess'));
    assert.deepEqual(SEATS.map((seat, i) => service.store.pair(pair.id).slots[seat].sessionId !== sessions[i]), [true, true]);
    assert.equal(run.config.game?.kind, 'chess');
  } finally { await close(); }
});

test('J3: the simulator\'s players answer the brief READY and play legal moves to the end of a game', async () => {
  const service = new AvAService(tempDir('ava-gamer-sim-'), new SimulationFactory(5), 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'gamer-sim' }) as Pair;
    for (const [seat, provider] of [['cli1', 'codex'], ['cli2', 'claude']] as const) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider, model: 'sim-model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    const run = await service.call('run.start', { pairId: pair.id, text: 'go', requestId: 'sim-go', options: { mode: 'game', paceMs: 0, game: setup('go') } }) as Run;
    await until(() => service.store.run(run.id).status !== 'running', 20_000);
    const done = service.store.run(run.id), moves = service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text);
    // A Go move can be refused for superko (the simulator sees no history), but never three times in a row.
    assert.equal(done.status, 'completed'); assert.ok(done.game?.result, 'the game has a result'); assert.doesNotMatch(done.game!.result!.reason, /illegal/);
    assert.ok(moves.length > 20); assert.doesNotThrow(() => replay(setup('go'), moves));
    const briefs = service.store.db.prepare("SELECT text FROM direct_messages WHERE sender='agent'").all() as Array<{ text: string }>;
    assert.deepEqual(briefs.map(b => b.text.replace(/ \(simulated\)$/, '')).sort(), ['READY, Black.', 'READY, White.']);
  } finally { await service.shutdown(); service.store.close(); }
});

test('J3 simulator: a refused move isn\'t played again in that position, and a Go player passes on its last try', async () => {
  const player = new SimulatedParticipant({ provider: 'codex', model: 'sim-model', auth: 'provider-login' } as ProviderConfig, 'cli1', 1);
  const ask = async (text: string) => (await player.request({ id: 'move', text, signal: new AbortController().signal, onStarted() {}, onEvent() {} })).text;
  // Black's man on 1 can go to 5 or 6: once 1-5 is refused, only 1-6 is left.
  const position = 'FEN: B:W32:B1\nReply with: MOVE: <move>';
  assert.match(await ask(`Move 1, Black to play. You make the first move.\n${position}`), /^MOVE: 1-[56]$/);
  for (let i = 0; i < 10; i++) assert.equal(await ask(`Refused: MOVE: 1-5 (it isn't a legal move here). 2 tries left. The position is unchanged:\n${position}`), 'MOVE: 1-6');
  assert.equal(await ask(movePrompt(setup('go'), ['E5'], 'cli2', { input: 'D4', reason: "it isn't legal: it repeats an earlier position", left: 1 })), 'MOVE: pass');
});

test('J2: three illegal answers in a row lose the game; so does resigning; Go ends after two passes, scored', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const { run: lost } = await start(service, factory, pair, 'illegal', setup('chess'));
    for (const text of ['MOVE: e5', 'No move.', 'MOVE: Qh5']) await play(service, factory, pair, 'cli1', text);
    await until(() => service.store.run(lost.id).status === 'completed');
    assert.deepEqual(service.store.run(lost.id).game, { illegal: { cli1: 3, cli2: 0 }, result: { winner: 'cli2', reason: 'White gave 3 illegal answers in a row' } });
    const { run: resigned } = await start(service, factory, pair, 'resign', setup('checkers'));
    await play(service, factory, pair, 'cli1', 'MOVE: 9-13'); await play(service, factory, pair, 'cli2', 'MOVE: resign');
    await until(() => service.store.run(resigned.id).status === 'completed');
    assert.deepEqual(service.store.run(resigned.id).game?.result, { winner: 'cli1', reason: 'White resigned' });
    const { run: goRun } = await start(service, factory, pair, 'go', setup('go', 'cli2'));
    await play(service, factory, pair, 'cli2', 'MOVE: E5'); await play(service, factory, pair, 'cli1', 'MOVE: pass'); await play(service, factory, pair, 'cli2', 'MOVE: pass');
    await until(() => service.store.run(goRun.id).status === 'completed');
    assert.deepEqual(service.store.run(goRun.id).game?.result, { winner: 'cli2', reason: 'both players passed', score: 'B+73.5 (Black 81, White 7.5)' });
  } finally { await close(); }
});

test('J8: 7x7 Crosscurrent briefs, repairs, records, finishes and replays a star connection', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const config: GameSetup = { ...setup('crosscurrent', 'cli2'), size: 7, ruleset: 'classic-v1' };
    assert.equal(conversationConfig('Crosscurrent', { mode: 'game', game: setup('crosscurrent') }).game?.size, 7);
    for (const size of [3, 4, 5, 9, 7.5]) await assert.rejects(service.call('run.start', { pairId: pair.id, text: 'Bad board', requestId: `crosscurrent-bad-${size}`, options: { mode: 'game', game: { ...config, size } } }));
    const { run, briefs } = await start(service, factory, pair, 'crosscurrent', config);
    assert.match(briefs.cli2, /Crosscurrent on a 7x7 board.*You play Circle; Circle moves first, so you start/);
    for (const rule of [/both steps are mandatory/i, /connections do NOT wrap/, /even if the other player made the move/, /If both qualify, it is a draw/, /rows 1 to 7 start at the TOP/, /MOVE: A1 RIGHT/, /one neutral star at D4/, /group must contain the star/, /at most 48 turns/]) assert.match(briefs.cli1, rule);
    const first = await play(service, factory, pair, 'cli2', 'MOVE: a4 right');
    assert.match(first, /Crosscurrent 7x7\n {3}ABCDEFG\n 1 \.{7}\n[\s\S]* 4 \.{3}\*\.{3}\n[\s\S]*Circle to play\./);
    assert.doesNotMatch(first, /legal|Rules/);
    await play(service, factory, pair, 'cli1', 'MOVE: A1 RIGHT');
    await play(service, factory, pair, 'cli2', 'MOVE: B4 RIGHT');
    const retry = await play(service, factory, pair, 'cli2', 'MOVE: A4 RIGHT');
    assert.match(retry, /^Refused: MOVE: B4 RIGHT \(it isn't empty\)/);
    for (const move of ['A4 RIGHT', 'A4 RIGHT', 'F4 RIGHT', 'A4 RIGHT']) {
      await play(service, factory, pair, 'cli1', 'MOVE: A1 RIGHT');
      await play(service, factory, pair, 'cli2', `MOVE: ${move}`);
    }
    await until(() => service.store.run(run.id).status === 'completed');
    const done = service.store.run(run.id), moves = service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text);
    assert.deepEqual(moves, ['A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'A4 RIGHT', 'A1 RIGHT', 'F4 RIGHT', 'A1 RIGHT', 'A4 RIGHT']);
    assert.deepEqual(done.game, { illegal: { cli1: 0, cli2: 1 }, result: { winner: 'cli2', reason: 'Circle connected left to right with the star' } });
    assert.equal(done.reason, 'game_over');
    assert.deepEqual(GAMES.crosscurrent.outcome(replay(config, moves)), { winner: 0, reason: 'Circle connected left to right with the star' });
    const threads = await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ runIds: string[]; verdict?: unknown }> };
    assert.deepEqual(threads.threads.find(t => t.runIds.includes(run.id))?.verdict, { status: 'done', kind: 'game', winner: 'cli2', reason: 'Circle connected left to right with the star' });
  } finally { await close(); }
});

test('J8: simulated Crosscurrent players finish 7x7 games without illegal moves', async () => {
  const service = new AvAService(tempDir('ava-crosscurrent-sim-'), new SimulationFactory(1), 'simulation', { processes: async () => [], stopProcesses: async () => {} });
  try {
    const pair = await service.call('pair.create', { thread: 'crosscurrent-sim' }) as Pair;
    for (const seat of SEATS) { await service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } }); await service.call('slot.activate', { pairId: pair.id, seat }); }
    for (let game = 0; game < 3; game++) {
      const config = setup('crosscurrent');
      const run = await service.call('run.start', { pairId: pair.id, text: 'Crosscurrent', requestId: `crosscurrent-sim-${game}`, options: { mode: 'game', paceMs: 0, game: config } }) as Run;
      await until(() => service.store.run(run.id).status === 'completed', 10_000);
      const done = service.store.run(run.id), moves = service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text);
      assert.deepEqual(done.game?.illegal, { cli1: 0, cli2: 0 });
      assert.equal(done.config.game?.size, 7);
      assert.equal(done.config.game?.ruleset, 'three-edges-cooldown-v3');
      assert.ok(moves.length > 0 && moves.length <= 48);
      assert.ok(GAMES.crosscurrent.outcome(replay(done.config.game!, moves)));
    }
  } finally { await service.shutdown(); service.store.close(); }
});

test('J8 simulator: a refused Crosscurrent move keeps both its square and direction', async () => {
  const player = new SimulatedParticipant({ provider: 'codex', model: 'sim-model', auth: 'provider-login' }, 'cli1', 1);
  const ask = async (text: string) => (await player.request({ id: 'move', text, signal: new AbortController().signal, onStarted() {}, onEvent() {} })).text;
  const position = 'Crosscurrent 7x7\n   ABCDEFG\n 1 .OXOXOO\n 2 XOXOXOX\n 3 OXOXOXO\n 4 XOX*XOX\n 5 OXOXOXO\n 6 XOXOXOX\n 7 OXOXOXO\nDiamond to play.\nReply with: MOVE: <move>';
  for (const move of ['A1 LEFT', 'A1 UP', 'A1 DOWN']) await ask(`Refused: MOVE: ${move} (test refusal). 2 tries left. The position is unchanged:\n${position}`);
  assert.equal(await ask(`Move 24, Diamond to play.\n${position}`), 'MOVE: A1 RIGHT', 'each refused direction was remembered');
});

test('J12: Three Edges v2 still briefs, repairs, permits repeated shifts, finishes and persists its ruleset', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const { run, briefs } = await start(service, factory, pair, 'three-edges', { ...setup('crosscurrent', 'cli2'), ruleset: 'three-edges-v2' });
    assert.equal(run.config.game?.ruleset, 'three-edges-v2');
    for (const brief of Object.values(briefs)) for (const rule of [/independently choose ANY row/, /AT LEAST THREE/, /Two opposite edges alone do not win/, /MOVE: E3 ROW 4 RIGHT/]) assert.match(brief, rule);
    await play(service, factory, pair, 'cli2', 'MOVE: A1 RIGHT');
    const notationRepair = await play(service, factory, pair, 'cli2', 'MOVE: D4 ROW 1 LEFT');
    assert.match(notationRepair, /ROW 1-7 LEFT\/RIGHT or COL A-G UP\/DOWN/);
    const starRepair = await play(service, factory, pair, 'cli2', 'MOVE: A1 COL D DOWN');
    assert.match(starRepair, /it isn't empty/);
    const moves = ['A1 COL D DOWN', 'G1 COL D UP'];
    const circle = ['D1', 'D2', 'D3', 'D5', 'D6', 'D7', 'C4', 'B4', 'A4'], diamond = ['B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'F1', 'F2'];
    for (let i = 0; i < circle.length; i++) { moves.push(`${circle[i]} COL G DOWN`); if (diamond[i]) moves.push(`${diamond[i]} COL G DOWN`); }
    for (let i = 1; i < moves.length; i++) {
      const prompt = await play(service, factory, pair, i % 2 ? 'cli1' : 'cli2', `MOVE: ${moves[i]}`);
      assert.match(prompt, /Crosscurrent 7x7 Three Edges \(v2\)/);
      if (i === 1) assert.match(prompt, / 5 \.\.\.\*\.\.\./, 'the remote first shift moved the star to D5');
    }
    await until(() => service.store.run(run.id).status === 'completed');
    const done = service.store.run(run.id), recorded = service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text);
    assert.deepEqual(recorded, moves);
    assert.deepEqual(done.game, { illegal: { cli1: 0, cli2: 2 }, result: { winner: 'cli2', reason: 'Circle connected at least three edges with the star' } });
    assert.equal(done.reason, 'game_over');
    assert.deepEqual(GAMES.crosscurrent.outcome(replay(done.config.game!, moves)), { winner: 0, reason: 'Circle connected at least three edges with the star' });
    const threads = await service.call('threads.list', { pairId: pair.id }) as { threads: Array<{ runIds: string[]; verdict?: unknown }> };
    assert.deepEqual(threads.threads.find(t => t.runIds.includes(run.id))?.verdict, { status: 'done', kind: 'game', winner: 'cli2', reason: 'Circle connected at least three edges with the star' });
  } finally { await close(); }
});

test('J12 simulator: a refused independent shift is remembered with its placement, axis and line', async () => {
  const player = new SimulatedParticipant({ provider: 'codex', model: 'sim-model', auth: 'provider-login' }, 'cli1', 1);
  const ask = async (text: string) => (await player.request({ id: 'move', text, signal: new AbortController().signal, onStarted() {}, onEvent() {} })).text;
  const position = 'Crosscurrent 7x7 Three Edges (v2)\n   ABCDEFG\n 1 .OXOXOO\n 2 XOXOXOX\n 3 OXOXOXO\n 4 XOX*XOX\n 5 OXOXOXO\n 6 XOXOXOX\n 7 OXOXOXO\nDiamond to play.\nReply with: MOVE: <move>';
  const legal = GAMES.crosscurrent.legal(GAMES.crosscurrent.fromPosition(position));
  const allowed = 'A1 COL D DOWN';
  for (const move of legal.filter(m => m !== allowed)) await ask(`Refused: MOVE: ${move} (test refusal). 2 tries left. The position is unchanged:\n${position}`);
  assert.equal(await ask(`Move 24, Diamond to play.\n${position}`), `MOVE: ${allowed}`);
});

test('J14: the cooldown default briefs, repairs a resting-line violation in either direction, releases it and completes', async () => {
  const factory = new TestFactory(), { service, pair, close } = await room(factory);
  try {
    const { run, briefs } = await start(service, factory, pair, 'cooldown', setup('crosscurrent', 'cli2'));
    assert.equal(run.config.game?.ruleset, 'three-edges-cooldown-v3');
    for (const brief of Object.values(briefs)) {
      assert.match(brief, /Cooldown:.*cannot be shifted this turn, in either direction/);
      assert.match(brief, /Resting line: none\./);
    }
    const moves = ['A1 COL D DOWN', 'G1 COL G DOWN', 'D1 COL D UP', 'B1 COL F DOWN', 'D1 COL G DOWN', 'B2 COL F DOWN', 'D2 COL G DOWN', 'B3 COL F DOWN', 'D3 COL G DOWN', 'C1 COL F DOWN', 'D5 COL G DOWN', 'C2 COL F DOWN', 'D6 COL G DOWN', 'C3 COL F DOWN', 'C4 COL G DOWN', 'F1 COL F DOWN', 'B4 COL G DOWN', 'F1 COL F DOWN', 'A4 COL G DOWN'];
    await play(service, factory, pair, 'cli2', `MOVE: ${moves[0]}`);
    const prompt = await play(service, factory, pair, 'cli1', 'MOVE: G1 COL D UP');
    assert.match(prompt, /Three Edges \+ Cooldown \(v3\)/); assert.match(prompt, /Resting line: COL D\./);
    const firstRepair = await play(service, factory, pair, 'cli1', 'MOVE: G1 COL D DOWN');
    const secondRepair = await play(service, factory, pair, 'cli1', `MOVE: ${moves[1]}`);
    for (const repair of [firstRepair, secondRepair]) {
      assert.match(repair, /COL D is resting/); assert.match(repair, /Resting line: COL D\./);
      assert.match(repair, / 5 \.\.\.\*\.\.\./, 'failed shifts did not move the star');
    }
    for (let i = 2; i < moves.length; i++) {
      const prompt = await play(service, factory, pair, i % 2 ? 'cli1' : 'cli2', `MOVE: ${moves[i]}`);
      if (i === 2) assert.match(prompt, /Resting line: COL G\./, 'column D becomes available again');
    }
    await until(() => service.store.run(run.id).status === 'completed');
    const done = service.store.run(run.id), recorded = service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text);
    assert.deepEqual(recorded, moves);
    assert.deepEqual(done.game, { illegal: { cli1: 2, cli2: 0 }, result: { winner: 'cli2', reason: 'Circle connected at least three edges with the star' } });
    assert.match(GAMES.crosscurrent.position(replay(done.config.game!, recorded)), /Resting line: COL G\./);
  } finally { await close(); }
});
