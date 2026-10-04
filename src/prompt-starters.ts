import { answerInstructions } from './answer-check.js';
import type { AnswerCheck } from './types.js';
import type { Starter } from './debate-starters.js';

// Built-in Prompt-mode prompts (owner, 2026-10-04): short to write, intensive to answer, each with one exact answer
// that AvA checks. Challenges take real reasoning (about one to five minutes); races are quicker and judged on speed.
// Every answer was computed by program, and the logic puzzle was checked to have exactly one solution.
const prompt = (id: string, name: string, kind: AnswerCheck['kind'], body: string, form: string, answers: string[]): Starter & { check: AnswerCheck } => ({
  id, name, mode: 'benchmark', buildKind: 'build',
  text: `# ${name.replace(/^(?:Hard challenge|Challenge|Race): /, '')}\n\n${body}\n\n${answerInstructions(kind, form)}`,
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
// Hard challenges (P9): the strongest models answered every earlier challenge in under 20 seconds, so these take the
// same kinds of problem to a scale that needs minutes of exact work: a long simulation, a large count, a long trace.
// Every answer was computed by program, and each was calibrated live with Claude Code and Codex at high effort, without
// tools: both answered every one correctly, in 0.5 to 6.8 minutes.
const LIFE = 'In Conway’s Game of Life on an unbounded grid, a live cell with two or three live neighbours (of its eight) stays alive, a dead cell with exactly three live neighbours comes alive, and every other cell is dead in the next generation. Start with exactly these five live cells, given as (column, row) with rows numbered downward: (1, 0), (2, 0), (0, 1), (1, 1), (1, 2).';
export const HARD_PROMPTS = [
  prompt('prompt-hard-life', 'Hard challenge: Twenty generations', 'challenge', `${LIFE} How many cells are alive after 20 generations?`, '<a whole number>', ['32']),
  prompt('prompt-hard-queens', 'Hard challenge: Queens off the diagonals', 'challenge',
    'The eight queens puzzle has 92 solutions: ways to place eight queens on a chessboard so that no two attack each other. In how many of those 92 solutions is no queen on either of the board’s two long diagonals (a1 to h8 and a8 to h1)?',
    '<a whole number>', ['12']),
  prompt('prompt-hard-king', 'Hard challenge: The wandering king', 'challenge',
    'A king starts in a corner of an empty 5 × 5 board. On each move it goes to one of the squares it can reach in one king’s move (horizontally, vertically or diagonally adjacent, and on the board), each with equal probability. What is the expected number of moves until it first reaches the diagonally opposite corner?',
    '<a fraction in lowest terms, such as 3/8>', ['9540/127']),
  prompt('prompt-hard-trace', 'Hard challenge: The long trace', 'challenge',
    'What does this Python program print?\n\n```python\ns = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]\nfor step in range(150):\n    i = (step * 7) % len(s)\n    j = (i + s[i] + step) % len(s)\n    s[i], s[j] = (s[i] * 3 + s[j] + step) % 10, (s[i] + 2 * s[j]) % 10\nprint("".join(map(str, s)))\n```',
    '<the ten digits it prints>', ['6363896389']),
  prompt('prompt-hard-power', 'Hard challenge: Digits of a power', 'challenge', 'What is the sum of the decimal digits of 3^300 (3 to the power 300)?', '<a whole number>', ['693']),
];
// The Prompt starters before the answer keys, retired where unedited (fingerprints as in debate-starters.ts).
export const RETIRED_PROMPT_STARTERS: Record<string, string[]> = {
  'starter-state-tracking': ['10789626b3bd4a4ebc8a071a'], 'starter-intervals': ['e76574b57b0db5bdd5fce156'],
};
