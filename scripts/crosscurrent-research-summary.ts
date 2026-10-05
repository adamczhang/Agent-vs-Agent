// Audit saved J11 games and produce the compact report used by the roadmap. No changes to the live game.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { analyze, apply, BOTS, choose, key, randomState, start, VARIANTS, type Rules } from './research/crosscurrent.js';

type Stats = { decisions: number; evaluations: number; depths: number[] };
type Game = { first: string; second: string; seed: number; winner: number; plies: number; moves: number[]; finalBoard: string; stats: Stats[] };
type Match = { games: Game[]; pairs: number; wins: number; losses: number; draws: number; matchPointRate: number; pairedBootstrap95: number[]; summary: { meanPlies: number } };
type Study = {
  status: string; seedBase: number; variant: Rules; method: { bots: typeof BOTS };
  random?: { summary: { games: number; draws: number }; outcomes: Array<{ winner: number; plies: number }> };
  calibration?: Match; searchBudget?: Match;
  equalSearch?: { games: Game[]; summary: { games: number; firstWins: number; secondWins: number; draws: number; meanPlies: number }; firstPlayerMatchPoints?: number; bootstrap95?: number[] };
  branching?: Array<{ ply: number; meanUnique: number; meanRaw: number }>;
  tactics?: { positions: number; regrets: Record<string, number>; solvedOutcomes: { wins: number; draws: number; losses: number } };
};
const folder = 'pilot-evidence/stage-d/', target = `${folder}j11-summary.json`;
if (existsSync(target)) throw new Error('Do not overwrite the saved summary.');
const load = (name: string): Study => {
  const data = JSON.parse(readFileSync(`${folder}j11-${name}.json`, 'utf8')) as Study;
  assert.equal(data.status, 'complete', name); return data;
};
let detailedGames = 0, randomGames = 0;
function audit(data: Study) {
  for (const game of [...data.calibration?.games ?? [], ...data.searchBudget?.games ?? [], ...data.equalSearch?.games ?? []]) {
    let s = start();
    for (const action of game.moves) {
      assert.equal(analyze(s, data.variant).winner, null, 'No move follows a terminal position.');
      s = apply(s, action, data.variant);
      assert.equal(s.board.filter(v => v === 3).length, 1);
    }
    assert.equal(s.ply, game.plies); assert.ok(s.ply <= 48);
    assert.equal(key(s), game.finalBoard); assert.equal(analyze(s, data.variant).winner, game.winner);
    for (let seat = 0; seat < 2; seat++) {
      const stat = game.stats[seat]!, bot = data.method.bots[seat === 0 ? game.first : game.second]!;
      assert.ok(stat.evaluations <= stat.decisions * bot.budget);
      assert.equal(stat.depths.reduce((a, b) => a + b, 0), stat.decisions);
    }
    detailedGames++;
  }
  if (data.random) for (let i = 0; i < data.random.outcomes.length; i++) {
    let s = start(); const seed = data.seedBase + i;
    while (analyze(s, data.variant).winner === null) s = apply(s, choose(s, data.variant, BOTS.random!, seed ^ Math.imul(s.ply + 1, 2654435761)).action, data.variant);
    assert.equal(s.ply, data.random.outcomes[i]!.plies); assert.equal(analyze(s, data.variant).winner, data.random.outcomes[i]!.winner);
    randomGames++;
  }
}
const variants = ['current', 'free-shift', 'four-edges', 'combined', 'three-edges'];
const rows = variants.map(name => {
  const data = load(name), ladder = load(`${name}-ladder`); audit(data); audit(ladder);
  const match = data.searchBudget!, count = match.games.length;
  return { variant: name, exploratory: name === 'three-edges', searchGames: count, searchDrawRate: match.draws / count, meanPlies: match.summary.meanPlies,
    higherBudgetMatchPoints: match.matchPointRate, higherBudget95: match.pairedBootstrap95, wins: match.wins, losses: match.losses, draws: match.draws,
    middleVersusGreedyMatchPoints: ladder.searchBudget!.matchPointRate, middleVersusGreedy95: ladder.searchBudget!.pairedBootstrap95,
    randomDrawRate: data.random!.summary.draws / data.random!.summary.games,
    uniqueOpeningBoards: data.branching!.find(b => b.ply === 0)!.meanUnique, meanUniqueBoardsAtPly16: data.branching!.find(b => b.ply === 16)!.meanUnique,
    exactEndgames: { positions: data.tactics!.positions, regrets: data.tactics!.regrets, solvedOutcomes: data.tactics!.solvedOutcomes } };
});
const sensitivity = ['current', 'combined'].map(name => { const data = load(`${name}-sensitivity`); audit(data); const m = data.searchBudget!; return { variant: name, games: m.games.length, drawRate: m.draws / m.games.length, higherBudgetMatchPoints: m.matchPointRate, interval95: m.pairedBootstrap95, meanPlies: m.summary.meanPlies }; });
const balance = ['current', 'combined'].map(name => { const data = load(`${name}-balance`); audit(data); const e = data.equalSearch!; return { variant: name, ...e.summary, firstPlayerMatchPoints: e.firstPlayerMatchPoints, interval95: e.bootstrap95 }; });
const matched = JSON.parse(readFileSync(`${folder}j11-matched-search.json`, 'utf8')) as { records: Array<{ sample: number; variant: string; bot: string; depth: number; evaluations: number; generated: number }>; groups: unknown };
// Reproduce the matched-position probe as part of the audit.
for (const expected of matched.records) {
  const s = randomState(24, 20261004 + expected.sample * 991 + 24).state;
  const actual = choose(s, VARIANTS.find(v => v.id === expected.variant)!, BOTS[expected.bot]!, 20261004 + expected.sample).stats;
  assert.equal(actual.depth, expected.depth); assert.equal(actual.evaluations, expected.evaluations); assert.equal(actual.generated, expected.generated);
}
const result = {
  step: 'J11', date: '2026-10-04', baselineCommit: 'b42f995', prototypeOnly: true, liveProviderRequests: 0,
  totals: { studyGames: detailedGames + randomGames, detailedGamesReplayedAndAudited: detailedGames, randomGamesReproduced: randomGames, exactEndgameAnalyses: 5 * 64, sharedExactEndgameBoards: 64, matchedSearchDecisionsReproduced: matched.records.length },
  primaryComparison: rows, sensitivity, balance, matchedSearch: matched.groups,
  interpretation: [
    'Independent shifts substantially increase distinct choices and reduce completed lookahead at a fixed evaluation budget.',
    'The two changes together did not establish greater strategic depth than Classic: primary high-budget gain is modest and its interval includes 50%; a held-out search configuration shows a positive gain but retains many draws.',
    'The four-edge goal alone is very draw-prone under the tested search players.',
    'Free shifts with an opposite-pair or three-edge goal produce shorter, more decisive games under these players; duration alone does not establish strategic depth.',
    'Equal-agent self-play is an estimate for this search policy, not a proof of opening balance or optimal play.'
  ],
  proposal: {
    recommendation: 'Keep Classic as the default. The next upgrade candidate is an opt-in experimental Three Edges variant: independent shifts with a three-edge star goal.',
    rationale: 'This exploratory follow-up keeps the expanded choice space, with 1 draw in 80 budget matches versus 36 for the four-edge combination. Its roughly 20-placement games need further evaluation; these results do not prove greater depth.',
    rules: ['7x7 with one neutral star initially at D4; the star moves with its line', 'Place one owned stone on an empty square', 'Shift any row or column one square with wrapping, including an empty or unchanged line', 'Win with a star-containing orthogonal group touching at least three of the four edges; connections do not wrap', 'Both qualifying or a full board without a qualifier draws; maximum 48 placements'],
    interface: ['Separate placement and line selection', 'Four edge indicators and a three-edge target for each player', 'An explicit per-run ruleset version so existing Classic games replay correctly', 'A clear agent notation, such as MOVE: E3 ROW 4 RIGHT'],
    promotionGate: 'Color-swapped live LLM games against Classic under comparable budgets, an independent search policy, and human clarity/play tests before considering any default change.',
    notRecommendedNow: ['Replacing Classic outright', 'Making the draw-prone four-edge goal the default', 'Adding a new scoring tiebreaker or relocation rule without separate tests']
  },
  research: [
    { title: 'Depth in Strategic Games', authors: 'Lantz et al.', year: 2017, url: 'https://www.nealen.net/papers/Lantz2017Depth.pdf', application: 'Use a partial strategy ladder and move-quality checks; state-space size and branching alone do not measure depth.' },
    { title: 'Evolutionary Game Design', authors: 'Browne and Maire', year: 2010, url: 'https://rafal.io/static/papers/evolutionary_game_design_ludi.pdf', application: 'Evaluate self-play outcomes and duration, then validate appeal with people; these proxies are not a universal quality measure.' }
  ],
  limitations: ['Related heuristic/beam-search agents, not optimal strategies or independent algorithm families', 'Only up to five searched plies, with selective rather than full-width search', 'Evaluation budgets are not equal wall-clock budgets', 'Exploratory follow-ups were selected after the primary results', 'The endgame panel is conditioned on current-rule survival to ply 46', 'No human or LLM playtest of the proposed variant', 'A larger branching factor and a longer game are not proof of depth']
};
assert.equal(result.totals.studyGames, 6232); assert.equal(detailedGames, 1232); assert.equal(randomGames, 5000);
writeFileSync(target, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ totals: result.totals, rows: rows.map(({ exactEndgames, ...row }) => row), sensitivity, balance, matchedSearch: matched.groups, proposal: result.proposal.recommendation }));
