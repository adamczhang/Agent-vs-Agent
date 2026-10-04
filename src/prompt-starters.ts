import { answerInstructions } from './answer-check.js';
import type { AnswerCheck } from './types.js';
import type { Starter } from './debate-starters.js';

// Built-in Prompt-mode prompts (owner, 2026-10-04): short to write, intensive to answer, each with one exact answer
// that AvA checks. Challenges take real reasoning (about one to five minutes); races are quicker and judged on speed.
// Every answer was computed by program, and the logic puzzle was checked to have exactly one solution.
const prompt = (id: string, name: string, kind: AnswerCheck['kind'], body: string, form: string, answers: string[]): Starter & { check: AnswerCheck } => ({
  id, name, mode: 'benchmark', buildKind: 'build',
  text: `# ${name.replace(/^(Challenge|Race): /, '')}\n\n${body}\n\n${answerInstructions(kind, form)}`,
  check: { kind, answers },
});

export const PROMPT_STARTERS = [
  prompt('prompt-domino-tiling', 'Challenge: Domino tilings', 'challenge',
    'In how many different ways can a 3 × 12 rectangle be completely covered by 18 non-overlapping 1 × 2 dominoes? Each domino may lie horizontally or vertically. Coverings that differ only by rotating or reflecting the whole rectangle count as different.',
    '<a whole number>', ['2131']),
  prompt('prompt-fish-owner', 'Challenge: Who owns the fish?', 'challenge',
    'Ava, Ben, Cara and Dev live in four houses in a row, numbered 1 to 4 from left to right. Each owns a different pet (cat, dog, fish, parrot) and prefers a different drink (tea, coffee, milk, juice).\n\n1. Cara lives in an end house.\n2. Ava owns the parrot.\n3. Dev owns neither the cat nor the dog.\n4. The coffee drinker lives in house 3.\n5. Ben lives directly to the right of the tea drinker.\n6. The fish owner drinks juice.\n7. The dog owner lives next to the milk drinker.\n8. The cat owner lives somewhere to the left of the juice drinker.\n\nWho owns the fish?',
    '<a name>', ['Dev']),
  prompt('prompt-trace-code', 'Challenge: Trace the code', 'challenge',
    'What does this Python program print?\n\n```python\nx = 0\nfor i in range(1, 25):\n    if i % 3 == 0 or bin(i).count("1") == 3:\n        x = (x * 7 + i) % 1000\n    elif i % 5 == 0:\n        x = x - i\nprint(x)\n```',
    '<the number it prints>', ['965']),
  prompt('prompt-rising-digits', 'Challenge: Rising digits', 'challenge',
    'How many five-digit numbers have digits that strictly increase from left to right and add up to 25? (For example, 12389 has strictly increasing digits.)',
    '<a whole number>', ['12']),
  prompt('prompt-dice-triangle', 'Challenge: Dice triangle', 'challenge',
    'Three fair six-sided dice are rolled. What is the probability that the three numbers rolled can be the side lengths of a triangle with positive area?',
    '<a fraction in lowest terms, such as 3/8>', ['37/72']),
  prompt('prompt-shortest-route', 'Challenge: Shortest route', 'challenge',
    'A map has these two-way roads, each with its length in kilometres:\n\nA–B 7, A–C 9, A–F 14, B–C 10, B–D 15, B–G 21, C–D 11, C–F 2, D–E 6, D–G 4, E–F 9, E–H 8, F–G 12, G–H 5\n\nWhat is the length of the shortest route from A to H?',
    '<the length in kilometres, as a number>', ['28']),
  prompt('prompt-trailing-zeros', 'Race: Trailing zeros', 'race',
    'How many zeros are at the end of 2026! (that is, 1 × 2 × 3 × … × 2026)?',
    '<a whole number>', ['505']),
  prompt('prompt-base-seven', 'Race: Base seven', 'race',
    'Write the number 2026 (in base ten) in base 7.',
    '<the base-7 digits>', ['5623']),
  prompt('prompt-count-sevens', 'Race: Count the sevens', 'race',
    'If you write out every whole number from 1 to 2026, how many times do you write the digit 7?',
    '<a whole number>', ['602']),
  prompt('prompt-day-of-week', 'Race: Day of the week', 'race',
    'On what day of the week will 13 March 2147 fall, in the Gregorian calendar?',
    '<a day of the week>', ['Monday']),
];
// The Prompt starters before the answer keys, retired where unedited (fingerprints as in debate-starters.ts).
export const RETIRED_PROMPT_STARTERS: Record<string, string[]> = {
  'starter-state-tracking': ['10789626b3bd4a4ebc8a071a'], 'starter-intervals': ['e76574b57b0db5bdd5fce156'],
};
