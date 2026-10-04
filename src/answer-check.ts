import { SEATS, type AnswerCheck, type PromptResult, type Seat } from './types.js';

// Prompt mode's answer key (owner, 2026-10-04). A challenge prompt is short to write, hard to answer and has one exact
// answer; a race prompt is the same kind of question, judged on speed. Each prompt asks for a final line
// "ANSWER: <answer>". AvA reads that line from each agent's reply and checks it against the key, which the agents never
// see. The winner is the agent that answered correctly, or the faster one if both did.
export const ANSWER_FORMAT = 'End your reply with one line in exactly this form: ANSWER: <your answer>';
// How a challenge and a race are framed for the agents (the built-in prompts and the Prompt builder say it the same way).
export const KIND_NOTE = { race: 'This is a race: answer as fast as you can, but only a correct answer counts.', challenge: 'Take the time you need: only your final answer is checked.' } as const;
export const NO_TOOLS = 'Work it out yourself, without tools or the web.';
// A challenge or race prompt's closing lines: how it's judged, and the exact answer line, with what goes in it.
export const answerInstructions = (kind: 'challenge' | 'race', form: string) => `${KIND_NOTE[kind]} ${NO_TOOLS} ${ANSWER_FORMAT.replace('<your answer>', form.trim() || '<your answer>')}`;

// The agent's final answer: its last "ANSWER:" line (Markdown emphasis and code marks ignored), else nothing.
export function finalAnswer(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/[*_`]/g, '').trim()).filter(Boolean);
  for (const line of lines.reverse()) { const m = line.match(/^(?:final\s+)?answer\s*[:：]\s*(.+)$/i); if (m) return m[1]!.trim(); }
  return null;
}
const clean = (s: string) => s.toLowerCase().replace(/^["'“”‘’]+|["'“”‘’.!]+$/g, '').replace(/\s+/g, ' ').trim();
const gcd = (a: bigint, b: bigint): bigint => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
const fraction = (s: string) => { const m = s.match(/(-?\d+)\s*\/\s*(\d+)/); if (!m || m[2] === '0') return null; const n = BigInt(m[1]!), d = BigInt(m[2]!), g = gcd(n, d) || 1n; return `${n / g}/${d / g}`; };
// Whether an answer matches one accepted answer: whole numbers by value (2,131 = 2131), fractions in lowest terms, and
// anything else as text, case and surrounding punctuation ignored (an answer may add words after it: "Monday, 13 March").
export function matches(answer: string, expected: string) {
  const a = clean(answer), e = clean(expected);
  if (/^-?\d+$/.test(e)) { const n = a.replace(/(\d)[,\s](?=\d{3}\b)/g, '$1').match(/-?\d+/); return !!n && BigInt(n[0]) === BigInt(e); }
  if (/^-?\d+\s*\/\s*\d+$/.test(e)) return fraction(a) !== null && fraction(a) === fraction(e);
  return a === e || a.startsWith(e) && !/[a-z0-9]/.test(a[e.length] ?? '');
}
// The result: each agent's answer, whether it's right, and how long it took; the winner is the right one, or the faster.
export function promptResult(check: AnswerCheck, replies: Partial<Record<Seat, { text: string; ms: number | null }>>): PromptResult {
  const seats = Object.fromEntries(SEATS.map(seat => {
    const reply = replies[seat], answer = reply ? finalAnswer(reply.text) : null;
    return [seat, { answer, correct: !!answer && check.answers.some(e => matches(answer, e)), ms: reply?.ms ?? null }];
  })) as PromptResult['seats'];
  const right = SEATS.filter(s => seats[s].correct).sort((a, b) => (seats[a].ms ?? Infinity) - (seats[b].ms ?? Infinity));
  return { kind: check.kind, seats, ...(right[0] ? { winner: right[0] } : {}) };
}
