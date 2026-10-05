// J15: replay the evidence through the production referee and verify every positive forcing certificate.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { crosscurrent, crosscurrentThreeEdges, type CrosscurrentState } from '../src/games/crosscurrent.js';
import { label } from './research/crosscurrent-combos.js';
import { rng } from './research/crosscurrent.js';
import { children, escape, fromProduction, minimumWinningStones, outcome, play, safetyReport, stateKey, wins } from './research/crosscurrent-tactics.js';

const base = 'pilot-evidence/stage-d/', output = `${base}j15-summary.json`;
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
const read = (file: string) => JSON.parse(readFileSync(base + file, 'utf8'));
const policies = ['beam32', 'safe-network', 'safe-edge', 'fork', 'wide128'];
interface Decision { action: number; ply: number; color: 1 | 2; certifiedFork: boolean; guarded: boolean; ms: number }
interface Game { first: string; second: string; seed: number; openingPlies: number; moves: number[]; plies: number; winner: number; finalState: string; decisions: Decision[]; shape: { fullOuterLine: boolean; cornerDependent: boolean; needsStarEdgeCredit: boolean } | null }
const counts = new Map(policies.map(name => [name, { games: 0, wins: 0, losses: 0, draws: 0, decisions: 0, missedImmediateWins: 0, avoidableOneReplyLosses: 0, forcedOneReplyLosses: 0, certifiedForks: 0, guardReplacements: 0 }]));
const forcingStates = new Set<string>();
const drawReasons: Record<string, number> = {}, forkPlies: number[] = [];
let earliestFork: { ply: number; prefix: string[]; setup: string; before: string; after: string; defenderChoices: number; actualContinuation: string[] } | undefined;
let productionMoves = 0, certificateRawReplies = 0, certificateDistinctReplies = 0;
const resultOf = (s: CrosscurrentState) => { const o = crosscurrent.outcome(s); return o === null ? null : o.winner === null ? 0 : o.winner + 1; };
function interval(scores: number[], seed: number) {
  const random = rng(seed ^ 51991), samples: number[] = [];
  for (let i = 0; i < 3000; i++) { let sum = 0; for (let j = 0; j < scores.length; j++) sum += scores[Math.floor(random() * scores.length)]!; samples.push(sum / scores.length); }
  samples.sort((a, b) => a - b); return [samples[75]!, samples[2924]!];
}

function verifyNoEscape(s: CrosscurrentState, proof = safetyReport(fromProduction(s))) {
  const key = stateKey(fromProduction(s)); if (forcingStates.has(key)) return;
  assert.equal(proof.safeActions.length, 0); assert.equal(proof.immediateWins.length, 0);
  const t = fromProduction(s), refutations = new Map(proof.refutations.map(([a, reply]) => [stateKey(play(t, a)), reply]));
  const seen = new Set<string>();
  // Enumerating production legal moves checks coverage, including actions deduplicated by the tactical kernel.
  for (const move of crosscurrent.legal(s)) {
    const child = crosscurrent.play(s, move).state, childKey = stateKey(fromProduction(child));
    assert.ok(refutations.has(childKey), 'certificate covers every production action');
    const reply = refutations.get(childKey)!;
    if (reply === null) assert.equal(resultOf(child), 3 - s.turn);
    else { assert.equal(resultOf(child), null); assert.equal(resultOf(crosscurrent.play(child, label(reply)).state), 3 - s.turn); }
    seen.add(childKey); certificateRawReplies++;
  }
  assert.equal(seen.size, proof.choices); assert.equal(refutations.size, proof.choices);
  certificateDistinctReplies += seen.size; forcingStates.add(key);
}

const matches: Array<Record<string, unknown>> = [], selfPlay: Array<Record<string, unknown>> = [], newGames: Game[] = [];
function audit(g: Game, tournament: boolean) {
  let s = crosscurrent.start();
  assert.equal(g.decisions.length, g.moves.length - g.openingPlies);
  for (const [ply, action] of g.moves.entries()) {
    assert.equal(resultOf(s), null); const t = fromProduction(s), next = crosscurrent.play(s, label(action)).state, after = resultOf(next);
    assert.deepEqual(fromProduction(next), play(t, action)); assert.equal(after, outcome(fromProduction(next))); productionMoves++;
    if (ply >= g.openingPlies) {
      const d = g.decisions[ply - g.openingPlies]!, policy = s.turn === 1 ? g.first : g.second, c = counts.get(policy)!;
      assert.equal(d.ply, ply); assert.equal(d.color, s.turn); assert.equal(d.action, action); c.decisions++;
      if (wins(t, true).length && after !== s.turn) c.missedImmediateWins++;
      const threatened = after !== 0 && (after === 3 - s.turn || after === null && wins(fromProduction(next), true).length > 0);
      if (threatened) { if (escape(t)) c.avoidableOneReplyLosses++; else c.forcedOneReplyLosses++; }
      if (d.certifiedFork) {
        assert.equal(policy, 'fork'); assert.equal(after, null); verifyNoEscape(next); c.certifiedForks++; forkPlies.push(ply);
        if (!earliestFork || ply < earliestFork.ply) earliestFork = { ply, prefix: g.moves.slice(0, ply).map(label), setup: label(action), before: crosscurrent.position(s), after: crosscurrent.position(next), defenderChoices: children(fromProduction(next)).length, actualContinuation: g.moves.slice(ply + 1).map(label) };
      }
      if (d.guarded) c.guardReplacements++;
    }
    s = next;
  }
  assert.equal(g.plies, g.moves.length); assert.equal(stateKey(fromProduction(s)), g.finalState); assert.equal(resultOf(s), g.winner);
  if (!g.winner) { const reason = crosscurrent.outcome(s)!.reason; drawReasons[reason] = (drawReasons[reason] ?? 0) + 1; }
  if (tournament) for (const [i, policy] of [g.first, g.second].entries()) {
    const c = counts.get(policy)!; c.games++; if (!g.winner) c.draws++; else if (g.winner === i + 1) c.wins++; else c.losses++;
  }
  newGames.push(g);
}
for (let a = 0; a < policies.length; a++) for (let b = a + 1; b < policies.length; b++) {
  const file = `j15-match-${policies[a]}-${policies[b]}.json`, data = read(file), m = data.match;
  assert.equal(data.status, 'complete'); assert.equal(data.seed, 1510000); assert.equal(m.games.length, 24);
  assert.equal(m.pairs, 12); assert.equal(m.firstPolicy, policies[a]); assert.equal(m.secondPolicy, policies[b]);
  let points = 0; const pairScores: number[] = [];
  for (let i = 0; i < m.games.length; i += 2) {
    const first: Game = m.games[i], second: Game = m.games[i + 1];
    assert.equal(first.seed, 1510000 + i / 2); assert.equal(second.seed, first.seed);
    assert.equal(first.first, policies[a]); assert.equal(first.second, policies[b]); assert.equal(second.first, policies[b]); assert.equal(second.second, policies[a]);
    assert.equal(first.openingPlies, 4); assert.equal(second.openingPlies, 4); assert.deepEqual(first.moves.slice(0, 4), second.moves.slice(0, 4));
    audit(first, true); audit(second, true);
    const pairPoints = (first.winner === 1 ? 1 : first.winner === 0 ? .5 : 0) + (second.winner === 2 ? 1 : second.winner === 0 ? .5 : 0);
    points += pairPoints; pairScores.push(pairPoints / 2);
  }
  assert.equal(points / 24, m.score); assert.deepEqual(interval(pairScores, data.seed), m.interval95);
  assert.equal(m.summary.draws, (m.games as Game[]).filter(g => g.winner === 0).length);
  assert.equal(m.summary.meanPlies, (m.games as Game[]).reduce((n, g) => n + g.plies, 0) / m.games.length);
  matches.push({ file, firstPolicy: m.firstPolicy, secondPolicy: m.secondPolicy, games: 24, firstPolicyScore: m.score, interval95: m.interval95, draws: m.summary.draws, meanPlies: m.summary.meanPlies });
  console.log(JSON.stringify({ audited: file, productionMoves, certifiedPositions: forcingStates.size }));
}
for (const policy of ['safe-network', 'fork', 'wide128']) {
  const file = `j15-self-${policy}.json`, data = read(file), self = data.self;
  assert.equal(data.status, 'complete'); assert.equal(data.seed, 1520000); assert.equal(self.games.length, 32);
  for (const [i, g] of (self.games as Game[]).entries()) { assert.equal(g.seed, 1520000 + i); assert.equal(g.first, policy); assert.equal(g.second, policy); assert.equal(g.openingPlies, 0); audit(g, false); }
  const scores = (self.games as Game[]).map(g => g.winner === 1 ? 1 : g.winner === 0 ? .5 : 0);
  assert.equal(self.firstScore, scores.reduce<number>((n, x) => n + x, 0) / 32); assert.deepEqual(interval(scores, data.seed), self.interval95);
  selfPlay.push({ file, policy, firstScore: self.firstScore, interval95: self.interval95, ...self.summary });
}
assert.equal(newGames.length, 336);
for (const [policy, c] of counts) { assert.equal(c.missedImmediateWins, 0); if (policy !== 'beam32') assert.equal(c.avoidableOneReplyLosses, 0, `${policy} honors the exact immediate-loss guard`); }
const newMoveCount = productionMoves;

// Also independently replay the 296 old games used to diagnose the earlier study.
let priorGames = 0;
for (const file of ['j13-rest-primary.json', 'j13-rest-sensitivity.json', 'j13-rest-uct.json', 'j13-rest-balance.json']) {
  const d = read(file), games: Game[] = [...d.ladder?.games ?? [], ...d.bridge?.games ?? [], ...d.equal?.games ?? []];
  for (const g of games) { let s = crosscurrent.start(); for (const a of g.moves) { s = crosscurrent.play(s, label(a)).state; productionMoves++; } assert.equal(resultOf(s), g.winner); priorGames++; }
}
assert.equal(priorGames, 296);
const forensic = read('j15-forensics.json').forensics, certificate = forensic.cooldownCertificate;
const forced: CrosscurrentState = certificate.prefix.reduce((s: CrosscurrentState, a: number) => crosscurrent.play(s, label(a)).state, crosscurrent.start());
assert.equal(crosscurrent.position(forced), certificate.position); verifyNoEscape(forced, certificate.proof);
const relaxed: CrosscurrentState = certificate.prefix.reduce((s: CrosscurrentState, a: number) => crosscurrentThreeEdges.play(s, label(a)).state, crosscurrentThreeEdges.start());
assert.deepEqual(forced.board, relaxed.board); assert.equal(forced.turn, relaxed.turn);
const relaxedReply = crosscurrentThreeEdges.play(relaxed, certificate.withoutCooldownEscape).state;
assert.notEqual(resultOf(relaxedReply), 3 - relaxed.turn);
for (const move of crosscurrentThreeEdges.legal(relaxedReply)) assert.notEqual(resultOf(crosscurrentThreeEdges.play(relaxedReply, move).state), relaxedReply.turn);

const live = read('j14-live.json'), prefix: string[] = live.game.moves.slice(0, 11);
const livePosition = prefix.reduce((s, move) => crosscurrent.play(s, move).state, crosscurrent.start());
const liveReport = safetyReport(fromProduction(livePosition)); assert.equal(liveReport.choices, 813); assert.equal(liveReport.safeActions.length, 407);
const inwardMove = 'E3 COL D DOWN', inward = crosscurrent.play(livePosition, inwardMove).state;
assert.equal(wins(fromProduction(inward)).length, 0);
// Check every reply with the production engine, without using the material-bound optimization.
for (const move of crosscurrent.legal(inward)) assert.notEqual(resultOf(crosscurrent.play(inward, move).state), inward.turn);
const inwardRelaxed: CrosscurrentState = { ...inward, ruleset: 'three-edges-v2', resting: null };
assert.equal(resultOf(crosscurrentThreeEdges.play(inwardRelaxed, 'A1 COL D UP').state), 1);
const fastest = ['B2 ROW 4 LEFT', 'G7 COL C UP', 'C1 ROW 3 LEFT', 'A1 COL B UP', 'D1 ROW 2 LEFT', 'B7 COL A UP', 'E1 ROW 7 RIGHT', 'D7 ROW 6 RIGHT', 'F1 ROW 7 LEFT', 'D7 ROW 6 LEFT', 'G1 ROW 7 RIGHT'];
const fastestFinal = fastest.reduce((s, move) => { assert.equal(resultOf(s), null); return crosscurrent.play(s, move).state; }, crosscurrent.start()); assert.equal(resultOf(fastestFinal), 1);
const fastestDiamond = ['C7 ROW 6 RIGHT', ...fastest], diamondFinal = fastestDiamond.reduce((s, move) => { assert.equal(resultOf(s), null); return crosscurrent.play(s, move).state; }, crosscurrent.start()); assert.equal(resultOf(diamondFinal), 2);
const decisive = newGames.filter(g => g.winner !== 0), priorRecords = forensic.records;
const result = {
  step: 'J15', baselineCommit: '8b4de01', status: 'complete', liveProviderRequests: 0,
  audit: { newGames: newGames.length, newMoves: newMoveCount, previousGames: priorGames, previousMoves: productionMoves - newMoveCount, productionEngineReplay: 'all legal, final states and outcomes match', exactForcingPositions: forcingStates.size, certificateRawReplies, certificateDistinctReplies, guardedPoliciesAvoidableOneReplyLosses: 0, kernelChecks: 'Every legal action at 120 seeded positions; 500 positions under eight board symmetries in test/crosscurrent-depth.test.ts.' },
  method: { openingPairsPerMatch: 12, commonFourPlyOpenings: true, swappedColors: true, selfPlayPerPolicy: 32, policies: { beam32: 'Previous 32k-evaluation selective beam-4 search, maximum depth 5; immediate-win shortcut.', 'safe-network': 'Greedy general connection evaluator with exhaustive immediate-win and one-reply-loss checks.', 'safe-edge': 'Same exact short defense but an outer-line completion objective.', fork: 'safe-network plus certified wins within three plies among 12 heuristic setup candidates; every defender reply checked for a positive certificate.', wide128: '128k-evaluation selective beam-12 search, maximum depth 7, plus exact immediate-loss guard.' }, score: 'Win 1, draw 0.5; intervals are paired bootstrap for matches and game bootstrap for self-play. All point estimates are specific to this policy pool and these seeds.' },
  matches, tournamentStandings: [...counts].map(([policy, c]) => ({ policy, games: c.games, wins: c.wins, losses: c.losses, draws: c.draws, score: (c.wins + .5 * c.draws) / c.games })).sort((a, b) => b.score - a.score),
  tacticalAuditAcrossAllNewGames: [...counts].map(([policy, { games, wins, losses, draws, ...c }]) => ({ policy, ...c })),
  selfPlay,
  morphology: { allNewGames: newGames.length, decisive: decisive.length, draws: newGames.length - decisive.length, drawReasons, meanPlies: newGames.reduce((n, g) => n + g.plies, 0) / newGames.length, fullOuterLineWins: decisive.filter(g => g.shape?.fullOuterLine).length, cornerDependentWins: decisive.filter(g => g.shape?.cornerDependent).length, starEdgeCreditWins: decisive.filter(g => g.shape?.needsStarEdgeCredit).length, certifiedForkPlies: forkPlies.sort((a, b) => a - b) },
  priorStudyCorrection: { games: forensic.games, moves: forensic.examinedMoves, missedImmediateWins: forensic.missedWins, avoidableOneReplyLosses: forensic.avoidableOneReplyLosses, forcedOneReplyLosses: forensic.forcedOneReplyLosses, fullOuterLineWins: priorRecords.filter((r: { shape: { fullOuterLine: boolean } | null }) => r.shape?.fullOuterLine).length, interpretation: 'In 285 of 292 decisive previous games the losing decision allowed a win on the next reply although another move avoided an immediate loss. Those alternatives are not proven to save the whole game. The previous search-budget ladder confounded deeper planning with incomplete immediate defense.' },
  tacticalCases: {
    materialBound: { formula: 'Minimum owned stones >= 6 + distance(star, nearest edge).', grid: Array.from({ length: 7 }, (_, r) => Array.from({ length: 7 }, (_, c) => minimumWinningStones(r * 7 + c))), proof: 'Any three sides contain an opposite pair. A spanning tree of the winning component requires at least six edges in that axis plus the star-to-third-side distance in the other. A component with the star and n owned stones has n tree edges. Taking the minimum over side triples gives this bound; a T-shaped component can attain it geometrically.', earliestPossibleCircleWin: 11, earliestPossibleDiamondWin: 12 },
    shortestCooperativeWins: { circle: { moves: fastest, finalPosition: crosscurrent.position(fastestFinal) }, diamond: { moves: fastestDiamond, finalPosition: crosscurrent.position(diamondFinal) }, meaning: 'Legal 11-turn Circle and 12-turn Diamond examples, not forced openings or optimal strategies. Corners count for both incident edges and the neutral star contributes its own edge contact.' },
    earliestCertifiedFork: earliestFork,
    liveGameDefense: { prefix, position: crosscurrent.position(livePosition), losingMove: live.game.moves[11], winningReply: live.game.moves[12], distinctChoices: liveReport.choices, choicesAvoidingImmediateLoss: liveReport.safeActions.length, defense: inwardMove, after: crosscurrent.position(inward), minimumStonesAfterDefense: minimumWinningStones(inward.board.indexOf(3)), attackingStonesAfterNextPlacement: 7, noCooldownCounterexample: 'A1 COL D UP', interpretation: 'Move the star inward to D3 and rest its column. Every legal reply leaves the star at least two cells from an edge, requiring eight owned stones while Circle can have only seven. Without cooldown, undoing that column shift wins immediately.' },
    cooldownForcingCase: { source: 'j15-forensics.json', position: certificate.position, distinctDefenses: certificate.proof.choices, defensesAvoidingImmediateLoss: 0, withoutCooldownDefense: certificate.withoutCooldownEscape, interpretation: 'The resting line excludes an escape. Every legal defense under cooldown loses immediately or on the next reply; allowing all lines again provides a defense. This is an exact local result, not proof that the preceding opening was forced.' }
  },
  defectsFixed: ['Unknown saved Crosscurrent rulesets silently selected the current engine; now rejected, with legacy undefined versions retained.', 'Invalid saved moves silently truncated board replay while retaining an apparently valid final result; now a visible replay error identifies the last valid position and disables unreplayable moves.'],
  recommendation: 'Keep the current mechanics. Use tactically complete defense and broader planning as the new research baseline. Clarify corner and star edge credit in the rules. Treat a built-in tactical analyzer/puzzle suite as the next useful addition before adding rules.',
  limits: ['No opening solved and no chess-level depth claim.', 'Exact certificates prove only the stated short horizon; setup candidates remain selectively searched.', 'Policies share some evaluation machinery, have unequal computational budgets and are not optimal players.', 'Only 12 paired openings per matchup and 32 empty-board games per self-play policy; the bootstrap intervals do not measure uncertainty across all possible policies or openings.', 'First-player balance remains unresolved: self-play results depend on policy.', 'No live provider strength evaluation or human playtest this turn.']
};
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, audit: result.audit, standings: result.tournamentStandings, selfPlay: result.selfPlay, morphology: result.morphology, tactics: result.tacticalAuditAcrossAllNewGames }));
