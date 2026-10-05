// J15: forensic tactics and a heterogeneous policy tournament on the unchanged cooldown rules.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { crosscurrent, crosscurrentParse, crosscurrentLineId } from '../src/games/crosscurrent.js';
import { BOTS, choose as oldChoose, actions as rawActions, label, start } from './research/crosscurrent-combos.js';
import { rng } from './research/crosscurrent.js';
import { RULES, children, components, EDGE, escape, fork, fromProduction, outcome, play, ranked, safe, safeGreedy, safetyReport, stateKey, toProduction, wins, type State } from './research/crosscurrent-tactics.js';

const args = process.argv.slice(2), option = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] ?? fallback; };
const phase = option('--phase', 'forensics'), firstName = option('--a', 'wide128'), secondName = option('--b', 'fork'), seed = Number(option('--seed', '1500000'));
const output = option('--out', `pilot-evidence/stage-d/j15-${phase}${phase === 'match' ? `-${firstName}-${secondName}` : phase === 'self' ? `-${firstName}` : ''}.json`);
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`); mkdirSync(dirname(output), { recursive: true });
const encode = (move: string) => { const m = crosscurrentParse(7, move)!; return m.at * 56 + crosscurrentLineId(7, m) * 4 + Number(m.direction === 'RIGHT' || m.direction === 'DOWN') * 2; };
const policyNames = ['beam32', 'safe-network', 'safe-edge', 'fork', 'wide128'];
interface Choice { action: number; ms: number; oldEvaluations: number; guarded: boolean; certifiedFork: boolean }
function choose(s: State, name: string, seed: number): Choice {
  const at = performance.now(), immediate = wins(s, true)[0];
  let action: number, oldEvaluations = 0, guarded = false, certifiedFork = false;
  if (immediate !== undefined) action = immediate;
  else if (name === 'safe-network' || name === 'safe-edge') action = safeGreedy(s, name === 'safe-edge' ? 'edge' : 'network', seed);
  else if (name === 'fork') {
    const proof = fork(s, 12, seed); certifiedFork = proof !== null;
    action = proof?.action ?? safeGreedy(s, 'network', seed);
  } else {
    if (name !== 'beam32' && name !== 'wide128') throw new Error('Unknown policy.');
    const chosen = oldChoose(s, RULES, name === 'beam32' ? BOTS.ab32k! : { ...BOTS.ab32k!, budget: 131072, beam: 12, depth: 7 }, seed);
    action = chosen.action; oldEvaluations = chosen.stats.evaluations;
    if (name === 'wide128') {
      const next = play(s, action), c = { action, state: next, winner: outcome(next), key: stateKey(next) };
      if (!safe(c, s.turn)) { const guardedMove = safeGreedy(s, 'network', seed); guarded = guardedMove !== action; action = guardedMove; }
    }
  }
  return { action, ms: performance.now() - at, oldEvaluations, guarded, certifiedFork };
}
function opening(seed: number) {
  const random = rng(seed), moves: number[] = []; let s = start(RULES);
  for (let i = 0; i < 4; i++) { const legal = rawActions(s, RULES), a = legal[Math.floor(random() * legal.length)]!; moves.push(a); s = play(s, a); }
  return moves;
}
function shape(s: State) {
  const winner = outcome(s); if (!winner) return null;
  const group = components(s.board, s.star, winner), borders = [Array.from({ length: 7 }, (_, i) => i), Array.from({ length: 7 }, (_, i) => 42 + i), Array.from({ length: 7 }, (_, i) => i * 7), Array.from({ length: 7 }, (_, i) => i * 7 + 6)];
  let noncornerMask = 0, ownedMask = 0;
  for (let i = 0; i < 49; i++) if (group.labels[i] === group.root) {
    if (![0, 6, 42, 48].includes(i)) noncornerMask |= EDGE[i]!;
    if (s.board[i] === winner) ownedMask |= EDGE[i]!;
  }
  const count = (mask: number) => mask.toString(2).replaceAll('0', '').length;
  return { fullOuterLine: borders.some(edge => edge.every(i => group.labels[i] === group.root)), cornerDependent: count(noncornerMask) < 3, needsStarEdgeCredit: count(ownedMask) < 3, starOnEdge: EDGE[s.star] !== 0, starInCorner: [0, 6, 42, 48].includes(s.star), groupSize: group.size };
}
function game(first: string, second: string, gameSeed: number, moves: number[] = []) {
  let s = moves.reduce((s, a) => play(s, a), start(RULES)); const openingPlies = moves.length, decisions: Array<Choice & { color: number; ply: number }> = [];
  moves = [...moves];
  while (outcome(s) === null) {
    const chosen = choose(s, s.turn === 1 ? first : second, gameSeed ^ Math.imul(s.ply + 1, 2654435761));
    decisions.push({ ...chosen, color: s.turn, ply: s.ply }); moves.push(chosen.action); s = play(s, chosen.action);
  }
  return { first, second, seed: gameSeed, openingPlies, winner: outcome(s)!, moves, plies: s.ply, finalState: stateKey(s), shape: shape(s), decisions };
}
type Game = ReturnType<typeof game>;
function interval(scores: number[]) {
  const random = rng(seed ^ 51991), samples: number[] = [];
  for (let i = 0; i < 3000; i++) { let sum = 0; for (let j = 0; j < scores.length; j++) sum += scores[Math.floor(random() * scores.length)]!; samples.push(sum / scores.length); }
  samples.sort((a, b) => a - b); return [samples[75]!, samples[2924]!];
}
function summary(games: Game[]) {
  const lengths = games.map(g => g.plies).sort((a, b) => a - b), decisive = games.filter(g => g.winner !== 0);
  return { games: games.length, firstWins: games.filter(g => g.winner === 1).length, secondWins: games.filter(g => g.winner === 2).length, draws: games.filter(g => g.winner === 0).length, meanPlies: lengths.reduce((a, b) => a + b, 0) / games.length, medianPlies: lengths[Math.floor(lengths.length / 2)], decisive: decisive.length, fullOuterLineWins: decisive.filter(g => g.shape?.fullOuterLine).length, cornerDependentWins: decisive.filter(g => g.shape?.cornerDependent).length, starCreditWins: decisive.filter(g => g.shape?.needsStarEdgeCredit).length, certifiedForkDecisions: games.reduce((n, g) => n + g.decisions.filter(d => d.certifiedFork).length, 0) };
}
const begun = performance.now();
const result: Record<string, unknown> = { step: 'J15', baselineCommit: '8b4de01', phase, seed, status: 'running', policies: policyNames, method: 'Exact immediate-win and one-reply defense checks; safe policies differ in their longer-horizon goals. Fork tests only 12 heuristic setup candidates, but any positive certificate checks all replies. wide128 uses selective beam 12, maximum depth 7, with an exact immediate-loss guard. Budgets/time are not equal across policies.' };
const save = () => writeFileSync(output, JSON.stringify(result, null, 2)); save();
try {
  if (phase === 'pilot') result.game = game(firstName, secondName, seed, opening(seed));
  else if (phase === 'match') {
    const games: Game[] = [], scores: number[] = [], pairs = Number(option('--pairs', '12'));
    for (let i = 0; i < pairs; i++) {
      const gameSeed = seed + i, moves = opening(gameSeed), a = game(firstName, secondName, gameSeed, moves), b = game(secondName, firstName, gameSeed, moves);
      games.push(a, b); scores.push(((a.winner === 1 ? 1 : a.winner === 0 ? .5 : 0) + (b.winner === 2 ? 1 : b.winner === 0 ? .5 : 0)) / 2);
      if ((i + 1) % 3 === 0) console.log(JSON.stringify({ firstName, secondName, pairs: i + 1, seconds: Math.round((performance.now() - begun) / 1000) }));
    }
    result.match = { firstPolicy: firstName, secondPolicy: secondName, pairs, score: scores.reduce((a, b) => a + b, 0) / pairs, interval95: interval(scores), summary: summary(games), games };
  } else if (phase === 'self') {
    const games: Game[] = [], count = Number(option('--games', '32'));
    for (let i = 0; i < count; i++) { games.push(game(firstName, firstName, seed + i)); if ((i + 1) % 8 === 0) console.log(JSON.stringify({ self: firstName, games: i + 1 })); }
    const scores = games.map(g => g.winner === 1 ? 1 : g.winner === 0 ? .5 : 0);
    result.self = { policy: firstName, firstScore: scores.reduce<number>((a, b) => a + b, 0) / games.length, interval95: interval(scores), summary: summary(games), games };
  } else if (phase === 'forensics') {
    type PriorGame = { moves: number[]; first: string; second: string; winner: number; seed: number };
    const records: Array<{ file: string; index: number; policies: string[]; plies: number; winner: number; shape: ReturnType<typeof shape>; missedWins: number; avoidableOneReplyLosses: number; forcedOneReplyLosses: number; quietShifts: number }> = [];
    const events: Array<Record<string, unknown>> = []; let examinedMoves = 0;
    let certificate: Record<string, unknown> | undefined;
    const files = ['j13-rest-primary.json', 'j13-rest-sensitivity.json', 'j13-rest-uct.json', 'j13-rest-balance.json'];
    for (const file of files) {
      const data = JSON.parse(readFileSync(`pilot-evidence/stage-d/${file}`, 'utf8'));
      const games: PriorGame[] = [...data.ladder?.games ?? [], ...data.bridge?.games ?? [], ...data.equal?.games ?? []];
      for (const [index, g] of games.entries()) {
        let s = start(RULES), missedWins = 0, avoidableOneReplyLosses = 0, forcedOneReplyLosses = 0, quietShifts = 0;
        for (const action of g.moves) {
          assert.equal(outcome(s), null); const next = play(s, action), after = outcome(next), win = wins(s, true)[0];
          if (win !== undefined && after !== s.turn) missedWins++;
          const threatened = after !== 0 && (after === 3 - s.turn || after === null && wins(next, true).length > 0);
          if (threatened) {
            const defense = escape(s);
            if (defense) {
              avoidableOneReplyLosses++;
              if (events.length < 32) events.push({ file, index, ply: s.ply, policy: s.turn === 1 ? g.first : g.second, position: crosscurrent.position(toProduction(s)), actual: label(action), safeAlternative: label(defense.action) });
            } else {
              forcedOneReplyLosses++;
              if (!certificate) {
                const relaxed = escape(s, false);
                if (relaxed) certificate = { file, index, prefix: g.moves.slice(0, s.ply), position: crosscurrent.position(toProduction(s)), proof: safetyReport(s), withoutCooldownEscape: label(relaxed.action) };
              }
            }
          }
          const placed = s.board.slice(); placed[Math.floor(action / 56)] = s.turn;
          if (placed.every((v, i) => next.board[i] === v)) quietShifts++;
          s = next; examinedMoves++;
        }
        assert.equal(outcome(s), g.winner);
        records.push({ file, index, policies: [g.first, g.second], plies: s.ply, winner: g.winner, shape: shape(s), missedWins, avoidableOneReplyLosses, forcedOneReplyLosses, quietShifts });
      }
      console.log(JSON.stringify({ audited: file, games: records.length, examinedMoves }));
    }
    const live = JSON.parse(readFileSync('pilot-evidence/stage-d/j14-live.json', 'utf8')); let s = start(RULES);
    const liveTurns = [];
    for (const [i, move] of live.game.moves.entries()) {
      const a = encode(move), next = play(s, a);
      if (i >= 8) {
        const report = safetyReport(s), representative = children(s).find(c => c.key === stateKey(next))!;
        liveTurns.push({ turn: i + 1, actual: move, immediateWins: report.immediateWins.length, distinctResponses: report.choices, safeResponses: report.safeActions.length, permitsImmediateLoss: report.refutations.some(([action]) => action === representative.action), safeExamples: ranked(s, 'network').filter(c => report.safeActions.includes(c.action)).slice(0, 4).map(c => label(c.action)) });
      }
      s = next;
    }
    result.forensics = { games: records.length, examinedMoves, missedWins: records.reduce((n, r) => n + r.missedWins, 0), avoidableOneReplyLosses: records.reduce((n, r) => n + r.avoidableOneReplyLosses, 0), forcedOneReplyLosses: records.reduce((n, r) => n + r.forcedOneReplyLosses, 0), records, events, cooldownCertificate: certificate, liveTurns };
  } else throw new Error('Unknown phase.');
  result.status = 'complete'; result.seconds = (performance.now() - begun) / 1000; save();
  console.log(JSON.stringify({ phase, status: result.status, seconds: result.seconds, output, match: result.match && Object.fromEntries(Object.entries(result.match).filter(([k]) => k !== 'games')), self: result.self && Object.fromEntries(Object.entries(result.self).filter(([k]) => k !== 'games')), forensics: result.forensics && Object.fromEntries(Object.entries(result.forensics).filter(([k]) => !['records', 'events', 'cooldownCertificate'].includes(k))) }));
} catch (error) { result.status = 'failed'; result.error = String(error); save(); throw error; }
