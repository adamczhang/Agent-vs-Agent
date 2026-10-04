import type { ConfigOption } from './providers.js';
import { DEFAULT_ROUNDS, JUDGE_CATEGORIES, SEATS, type JudgeCategory, type Judgment, type RoomMessage, type RunConfig, type Seat, type Stance } from './types.js';

// A formal debate (owner, 2026-10-03): as in competitive debate, each side is assigned. Both debaters are briefed
// privately before it starts, speak in a set order (an opening case, rebuttals, a closing), and are scored at the end by
// an independent judge on evidence, clash and a cohesive stance.
export const SIDE: Record<Stance, string> = { for: 'the Proposition, for the motion', against: 'the Opposition, against the motion' };
export const SIDE_NAME: Record<Stance, string> = { for: 'Proposition', against: 'Opposition' };
const JUDGING = 'How you will be judged: when the debate ends, an independent judge scores each debater from 1 to 5 on three things, then names the winner. 1. Factual accuracy and evidence: are your facts right, and is your case backed by real evidence? 2. Challenging the opposition’s strongest points: do you take on their best arguments directly? 3. A cohesive stance: one clear position, and a logical case that holds together from your opening to your closing.';
const RULES = 'Rules: support your claims with evidence, such as specific facts, figures, studies, cases or named sources. Never invent a fact, figure, quotation or source; if you aren’t sure of something, say so or argue from reasoning. Build one cohesive case and keep it consistent. Answer your opponent’s strongest arguments, not its weakest: an argument you leave unanswered counts as conceded.';

// The private brief each debater gets through its 1:1 line before the debate starts.
export function debateBrief(config: RunConfig, seat: Seat, context: string, web: string) {
  const rounds = config.rounds ?? DEFAULT_ROUNDS, stance = config.stances![seat];
  const order = config.opening === 'both' ? 'You both give your opening speeches at the same time; after that you take turns.'
    : (config.opening ?? 'cli1') === seat ? 'You give the first speech; then you take turns.' : 'Your opponent gives the first speech; yours answers it, then you take turns.';
  return [
    'You are about to take part in a formal debate against another AI agent, judged by an independent judge.',
    `Motion: ${config.topic}`,
    `Your side: ${SIDE[stance]}. Sides are assigned, as in competitive debate: argue yours as well as it can be argued, whatever your own view, for the whole debate. Your opponent argues the other side.`,
    `Format: ${rounds} rounds, with one speech from each of you per round. ${order} Round 1 is your opening speech: set out your case, with two or three main arguments, each with its reasoning and evidence.${rounds > 2 ? ' The middle rounds are rebuttals: answer your opponent’s strongest point first, then strengthen your case.' : ''} Round ${rounds} is your closing speech: no new arguments; show why your side wins the key clashes.`,
    JUDGING, RULES, ...(config.speechMs ? [timeRule(config.speechMs)] : []),
    ...(context.trim() ? [`Your private brief (only you see it; your opponent has its own): ${context.trim()}`] : []),
    web,
    'Prepare now: think about your strongest case and the arguments your opponent is most likely to make. Then reply with one short line: READY, and your side in a few words. Do not write your opening speech yet.',
  ].join('\n\n');
}

// The time limit on each speech, said the same way in the brief and in every speech prompt.
export const minutesText = (ms: number) => ms % 60_000 ? `${Math.round(ms / 1000)} seconds` : `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}`;
export const timeRule = (ms: number) => `Time limit: each speech must be finished within ${minutesText(ms)}, thinking and any web searches included. A speech that runs over is cut off and forfeited, so keep your preparation short.`;
// What a speech that ran over its time limit leaves in the debate.
export const forfeitText = (ms: number) => `[Out of time: this speech ran past its ${minutesText(ms)} limit and was forfeited.]`;
// What this turn's speech is: the opening, a rebuttal, or the closing.
export function speechRule(round: number, rounds: number, opponentSpoke: boolean) {
  if (round >= rounds && rounds > 1) return `Round ${rounds} of ${rounds}: your closing speech. No new arguments: show the judge why your side wins the key clashes, how you answered your opponent’s best points, and why your case holds together.`;
  if (round === 1) return `Round 1 of ${rounds}: your opening speech. Set out your case: two or three main arguments, each with its reasoning and evidence.${opponentSpoke ? ' Your opponent has already opened: answer its strongest point as well.' : ''}${rounds === 1 ? ' This is your only speech.' : ''}`;
  return `Round ${round} of ${rounds}: a rebuttal. First answer the strongest point in your opponent’s last speech, then strengthen your case with new evidence or reasoning. Don’t drop your opponent’s main arguments: one left unanswered counts as conceded.`;
}
export const FORMAL_STYLE = `Speak as a debater: plain sentences in a few short paragraphs, with no headings or bullet lists. ${RULES} Your full brief came in your private 1:1 line before the debate.`;

// The judge: the strongest model the CLI lists, at its highest effort ("max" where offered).
const EFFORT_ORDER = ['max', 'ultra', 'xhigh', 'high', 'medium'];
export function maxEffort(controls: ConfigOption[]) {
  const control = controls.find(c => /effort/i.test(c.id));
  for (const level of EFFORT_ORDER) { const option = control?.options.find(o => o.value.toLowerCase() === level); if (control && option) return { key: control.id, value: option.value }; }
  return undefined;
}
// The judge sees the motion, which side each debater argued, and the speeches in order: never the debaters' private
// briefs, their 1:1 lines, or which CLI or model each one is.
export function judgePrompt(config: RunConfig, messages: RoomMessage[], web: string) {
  const stances = config.stances!, counts: Record<Seat, number> = { cli1: 0, cli2: 0 };
  const speeches = messages.filter(m => m.state !== 'queued' && m.state !== 'not_delivered').flatMap(m => {
    if (m.sender === 'user') return m.text === config.topic ? [] : [`Moderator: ${m.text}`];
    counts[m.sender]++;
    return [`${SIDE_NAME[stances[m.sender]]}, round ${counts[m.sender]}:\n${m.text}`];
  });
  return [
    'You are the judge of a formal debate between two AI debaters. Judge it as an expert, fair and independent adjudicator would.',
    `Motion: ${config.topic}`,
    'The Proposition argued for the motion and the Opposition against it. Sides were assigned, so judge how well each argued its side, not which side you agree with. Length and style count only for clarity.',
    ...(config.speechMs ? [`Each speech had a ${minutesText(config.speechMs)} time limit. A speech marked "Out of time" was forfeited: count it as a speech the debater failed to give.`] : []),
    `The debate, in speaking order (${config.rounds ?? Math.max(counts.cli1, counts.cli2)} rounds):\n\n${speeches.join('\n\n')}`,
    'Score each debater from 1 (poor) to 5 (excellent) on:',
    '1. evidence: Factual accuracy and evidence. Are its factual statements correct, and is its case supported by specific, real evidence (data, studies, cases, named sources)? Penalize invented, wrong or misleading facts.',
    '2. clash: Challenging the opposition’s strongest points. Did it identify the other side’s best arguments and answer them directly, rather than ignoring them or attacking weak ones? An argument it left unanswered counts against it.',
    '3. stance: A cohesive stance. Did it hold one clear position and build a logical case that fits together from its opening to its closing?',
    'Then name the winner: the debater who, on balance, made the stronger case. There are no ties.',
    web,
    'Reply with only a JSON object, with no Markdown fences:',
    '{"scores":{"proposition":{"evidence":1-5,"clash":1-5,"stance":1-5},"opposition":{"evidence":1-5,"clash":1-5,"stance":1-5}},"winner":"proposition" or "opposition","reason":"two to four sentences explaining the decision","notes":{"proposition":"one sentence","opposition":"one sentence"},"issues":[{"debater":"proposition" or "opposition","claim":"a factual claim","problem":"why it is wrong or unsupported"}]}',
  ].join('\n\n');
}
// The judge's JSON, mapped back to the seats. The last object with scores is the answer.
export function parseBallot(text: string, stances: Record<Seat, Stance>): Pick<Judgment, 'scores' | 'winner' | 'reason' | 'notes' | 'issues'> {
  const objects: unknown[] = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false, end = -1;
    for (let i = start; i < text.length && end < 0; i++) {
      const c = text[i];
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; }
      else if (c === '"') inString = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) end = i;
    }
    if (end < 0) continue;
    try { objects.push(JSON.parse(text.slice(start, end + 1))); start = end; } catch { /* try the next brace */ }
  }
  const value = objects.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'scores' in v).at(-1);
  if (!value) throw new Error('The judge did not answer with a ballot.');
  const seatOf = (side: unknown) => SEATS.find(s => SIDE_NAME[stances[s]].toLowerCase() === String(side).toLowerCase());
  const raw = value.scores as Record<string, Record<string, unknown>> | undefined, scores = {} as Record<Seat, Record<JudgeCategory, number>>;
  for (const seat of SEATS) {
    const own = raw?.[SIDE_NAME[stances[seat]].toLowerCase()];
    scores[seat] = {} as Record<JudgeCategory, number>;
    for (const { key } of JUDGE_CATEGORIES) {
      const n = Number(own?.[key]);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('The judge did not give every score as a whole number from 1 to 5.');
      scores[seat][key] = n;
    }
  }
  const winner = seatOf(value.winner);
  if (!winner) throw new Error('The judge did not name a winner.');
  const notes = (value.notes ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(value.issues) ? value.issues.flatMap(i => {
    const issue = i as Record<string, unknown>, seat = seatOf(issue?.debater);
    return seat && issue.claim ? [{ seat, claim: String(issue.claim).slice(0, 500), problem: String(issue.problem ?? '').slice(0, 500) }] : [];
  }).slice(0, 10) : [];
  return { scores, winner, reason: String(value.reason ?? '').slice(0, 2000),
    notes: Object.fromEntries(SEATS.flatMap(s => { const note = notes[SIDE_NAME[stances[s]].toLowerCase()]; return note ? [[s, String(note).slice(0, 500)]] : []; })), issues };
}
export const total = (scores: Record<JudgeCategory, number>) => JUDGE_CATEGORIES.reduce((sum, c) => sum + scores[c.key], 0);
