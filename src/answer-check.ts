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
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => unmark(l).trim()).filter(Boolean);
  for (const line of lines.reverse()) { const m = line.match(/^(?:final\s+)?answer\s*[:：]\s*(.+)$/i); if (m) return m[1]!.trim(); }
  return null;
}
// Markdown emphasis and code marks, in pairs around text (**2131**, _Dev_, `x`). A lone mark stays (x_1, 5623_7, 2**10),
// and the answer key gets the same treatment, so a key such as x_1 matches the answer x_1 (Q3).
const unmark = (s: string) => { for (let pass = 0, next = s; pass < 3; pass++, s = next) if ((next = s.replace(/(\*\*|__|\*|_|`)(?=\S)(.+?)(?<=\S)\1/g, '$2')) === s) break; return s; };
const clean = (s: string) => unmark(s).toLowerCase().replace(/^["'“”‘’]+|["'“”‘’.!]+$/g, '').replace(/\s+/g, ' ').trim();
// A number as written: a sign (the Unicode minus too), digits, an optional decimal part, an optional "/ denominator".
const NUMBER = /[-−]?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/;
// Its exact value as a fraction, or null (a zero denominator).
function value(token: string) {
  const [top, bottom = '1'] = token.replace('−', '-').split('/').map(s => s.trim());
  const [whole, decimals = ''] = top!.split('.');
  const n = BigInt(whole! + decimals), d = 10n ** BigInt(decimals.length) * BigInt(bottom);
  return d === 0n ? null : { n, d };
}
// Whether an answer matches one accepted answer. A number (whole, decimal or fraction) by value: the first number in
// the answer, after thousands separators and anything before an "=" go ("2,131 tilings", "2^10 = 1024", "74/144" for
// 37/72). It must be that number exactly ("3.5" isn't 3, "3/4" isn't 3) and the only candidate ("12 or 13" counts for
// nothing). Anything else as text, case and surrounding punctuation ignored; an answer may add words after it
// ("Monday, 13 March").
export function matches(answer: string, expected: string) {
  const a = clean(answer), e = clean(expected);
  if (new RegExp(`^${NUMBER.source}$`).test(e)) {
    const plain = a.replace(/(\d)[,\s](?=\d{3}\b)/g, '$1'), side = plain.slice(plain.lastIndexOf('=') + 1);
    if (/\b(?:or|and)\b|±|\+\/-/.test(side)) return false;
    const found = side.match(NUMBER);
    if (!found || /^\s*(?:\^|\*\*|e\d)/i.test(side.slice(found.index! + found[0].length))) return false;
    const x = value(found[0]), y = value(e);
    return !!x && !!y && x.n * y.d === y.n * x.d;
  }
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
