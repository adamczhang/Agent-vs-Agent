import type { Starter } from './debate-starters.js';
import type { PlantedBug } from './types.js';

// Built-in Build prompts (H4, owner 2026-10-04): five app builds, and three bug hunts of increasing difficulty in CLI-MODE,
// the owner's Claude Code plugin. Each app build runs in the browser as plain files, so both apps open side by side. Each
// hunt fetches one public commit of CLI-MODE from GitHub (H7: no history, nothing but the files a copy takes, so it runs
// on any computer), leaves out its tests and agent instructions, and plants its bugs: realistic one-line slips, each against a docstring or comment that says what
// the code should do. The agents never see the planted bugs; AvA scores their BUG lines against them.
// (How to report, the BUG line, is added by AvA to every bug hunt's prompt.)

const app = (id: string, name: string, task: string, requirements: string[], judged: string): Starter => ({
  id, name, mode: 'build', buildKind: 'build',
  text: [`# ${name}`, task, `## Requirements\n\n${requirements.map(r => `- ${r}`).join('\n')}`, `## How it will be judged\n\n${judged}`].join('\n\n'),
});

export const APP_BUILDS: Starter[] = [
  app('build-pomodoro', 'Pomodoro timer', 'Build a Pomodoro timer for focused work: 25-minute focus sessions and 5-minute breaks, with a 15-minute long break after every fourth focus session.',
    ['Start, pause, resume and reset, with the remaining time shown large (MM:SS) and in the page title.', 'A count of focus sessions finished today, kept after a reload (localStorage).',
      'A short sound (Web Audio, no files) and a visible change when a session ends; the next session waits for Start.', 'Settings for the three durations, kept after a reload.',
      'Keyboard: Space starts and pauses, R resets.', 'No frameworks or network requests.'],
    'It keeps correct time even when the tab is in the background (based on the clock, not on counting ticks), the long break comes after every fourth focus session, and it looks finished.'),
  app('build-kanban', 'Kanban board', 'Build a Kanban board with three columns, To do, Doing and Done, for one person\'s tasks.',
    ['Add a card with a title and an optional note; edit and delete cards.', 'Move cards between columns and reorder them within a column by drag and drop, and by keyboard (a focused card moves with arrow keys).',
      'A count on each column, and a search box that filters cards as you type.', 'Everything is kept after a reload (localStorage).', 'No frameworks or network requests.'],
    'Drag and drop lands cards exactly where they are dropped, nothing is lost on reload, keyboard moves work, and an empty board explains itself.'),
  app('build-expense-splitter', 'Trip expense splitter', 'Build a trip expense splitter: people pay for things during a trip, and at the end the app says who should pay whom to settle up.',
    ['Add and remove people; add expenses with who paid, the amount, and who shares it (everyone by default, or chosen people).', 'Each person\'s balance: what they paid minus their share.',
      'Settle up: the fewest payments that bring every balance to zero, listed as "A pays B $x".', 'Amounts in cents internally, so totals never drift (no floating-point errors); show two decimals.',
      'Kept after a reload (localStorage). No frameworks or network requests.'],
    'The balances always sum to zero, the settle-up list is correct and short (try 4 people and 6 uneven expenses, including one shared by only two people), and editing an expense updates everything.'),
  app('build-sudoku', 'Sudoku with a solver', 'Build a Sudoku game with a puzzle generator and a solver.',
    ['Generate a new puzzle at easy, medium or hard difficulty; every puzzle has exactly one solution.', 'Play with mouse and keyboard: select a cell, type 1-9, Backspace clears; given digits can\'t change.',
      'Pencil marks (a toggle), conflicts highlighted, and a timer.', 'Solve fills the board; Check marks wrong entries.', 'No frameworks or network requests.'],
    'Generated puzzles really have one solution, the solver is right and fast (under a second), the board is comfortable to play, and finishing a puzzle is celebrated.'),
  app('build-pixel-editor', 'Pixel art editor', 'Build a pixel art editor for small sprites.',
    ['A grid of 16x16 or 32x32 pixels, zoomed to fill the space, with optional grid lines.', 'Tools: pencil, eraser, fill (flood fill), line, and a color picker from the canvas; a palette of 16 colors plus a custom color.',
      'Undo and redo (at least 50 steps), with Ctrl+Z and Ctrl+Y.', 'Export as a PNG at 1x and 8x, and save to and open from a .json file.', 'No frameworks or network requests.'],
    'Drawing feels immediate (no gaps when dragging fast), fill respects edges, undo covers every tool, and the exported PNG matches the canvas pixel for pixel.'),
];

// Harder app builds (H8): each must get an exact, checkable behavior right, and exposes a function on window so the
// operator can check it in the browser's console with cases the agents haven't seen.
export const HARD_BUILDS: Starter[] = [
  app('build-chess', 'Chess with every rule (hard)', 'Build a two-player chess game that knows every rule, with a move generator exact enough to pass perft, the standard test of chess move generators.',
    ['Click or drag to move; only legal moves are allowed, and the legal targets of a selected piece are shown.', 'Every rule: castling (not out of, through or into check, and only with unmoved king and rook), en passant (only on the move right after the double step), promotion to queen, rook, bishop or knight (the player chooses), check, checkmate, stalemate, threefold repetition, the fifty-move rule, and insufficient material.',
      'Load a position from FEN (a text box), show the current position\'s FEN, and undo moves.', 'The move list in standard algebraic notation (Nf3, exd5, O-O, e8=Q+, Qh4#), and export of the game as PGN.',
      'In the browser\'s console: window.perft(fen, depth) returns the number of leaf nodes of the legal move tree from that position to that depth (a whole number), in under 10 seconds for depth 3.', 'No frameworks, chess libraries or network requests.'],
    'perft is exact: from the starting position, depths 1 to 4 give 20, 400, 8902 and 197281; from "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", depths 1 to 3 give 48, 2039 and 97862. The operator also checks positions you haven\'t been given. Then the game: every rule above, played through the board, and the notation.'),
  app('build-spreadsheet', 'Spreadsheet with formulas (hard)', 'Build a spreadsheet: a grid of cells A1 to Z100 whose cells hold numbers, text or formulas, recalculated as you type.',
    ['Formulas start with =: numbers, cell references (A1), + - * / and ^ (power), unary minus, parentheses, and the functions SUM, AVERAGE, MIN, MAX and COUNT over ranges (A1:B3) and lists (SUM(A1, B2:B4, 3)).', 'Usual precedence: ^ before * and / before + and -; ^ is right-associative (2^3^2 is 512), and unary minus applies after ^ (-2^2 is -4).',
      'An empty cell counts as 0 in arithmetic; AVERAGE, MIN, MAX and COUNT skip empty and text cells. Text in arithmetic gives #VALUE!. Dividing by zero gives #DIV/0!. A cell in a reference cycle, and every cell that depends on one, shows #CYCLE!. An error in a cell a formula uses shows that error.',
      'Numbers show at up to 10 significant digits, without trailing zeros (0.1+0.2 shows 0.3; 1/3 shows 0.3333333333).', 'Select a cell to see and edit its formula; Enter and Tab move down and right; copy and paste adjust relative references (pasting =A1+B2 one row down gives =A2+B3), and $ fixes a column or row ($A$1).',
      'Kept after a reload (localStorage). In the browser\'s console: window.evaluateSheet(cells) takes an object such as {A1: "5", A2: "=A1*2"} and returns every given cell\'s displayed value as a string ({A1: "5", A2: "10"}).', 'No frameworks or network requests.'],
    'evaluateSheet is exact. For example: {A1: "=2+3*4^2"} gives "50"; {A1: "=-2^2"} gives "-4"; {A1: "=2^3^2"} gives "512"; {A1: "1", A2: "0", A3: "=A1/A2", A4: "=A3+1"} gives A3 and A4 "#DIV/0!"; {A1: "=B1", B1: "=A1", C1: "=A1+1"} gives "#CYCLE!" for all three; {A1: "4", A2: "x", A3: "=AVERAGE(A1:A2, 6)"} gives A3 "5". The operator also checks cases you haven\'t been given. Then the grid: editing, recalculation, copy and paste, and reload.'),
  app('build-regex-engine', 'Regex engine (hard)', 'Build a regular-expression tester with its own matching engine, written from scratch: the page must never use JavaScript\'s RegExp (or any library) to match.',
    ['The syntax: literal characters, . (any character, newlines included), * + ? (greedy), alternation |, groups ( ), the empty alternative ((|a) is allowed), character classes [abc], [a-z] and [^...], the escapes \\. \\* \\[ \\] \\\\ and the like, and the anchors ^ and $.', 'Full match: a pattern matches a text only if it matches the whole text.',
      'No catastrophic backtracking: (a*)*b against 30 a\'s with no b answers in under 50 ms. Patterns that can match empty inside a loop ((a*)* or (|a)+) never hang.', 'The page: a pattern box, a list of test strings (one per line) each marked match or no match as you type, and a clear message for an invalid pattern.',
      'In the browser\'s console: window.regexFullMatch(pattern, text) returns true or false, and throws an Error for an invalid pattern.', 'No frameworks or network requests.'],
    'regexFullMatch is exact. For example: ("a(b|c)*d", "abcbcd") is true and ("a(b|c)*d", "abcbce") false; ("(a|ab)(c|bcd)(d*)", "abcd") true; ("(a*)*b", 30 a\'s) false, quickly; ("[a-c]+[^a-c]?", "abcabcz") true and ("[a-c]+[^a-c]?", "abcabczz") false; ("x?y?z?", "") true; ("(|a)+b", "aab") true; ("a.c", "a\\nc") true. The operator also checks cases you haven\'t been given. Then the page: live results, and invalid patterns.'),
];

// CLI-MODE on GitHub, at the commit the hunts were checked against (main, 'Usage test: timed runs').
const CLI_MODE = 'https://github.com/adamczhang/CLI-MODE', COMMIT = '270a2807bcecf10fbb414f2515b29ec596e48a19';
const LEFT_OUT = ['checks', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md'];
const scripts = 'plugins/cli-mode/scripts/';
const bug = (file: string, find: string, replace: string, what: string): PlantedBug => ({ file: scripts + file, find, replace, what });
const COUNTS = 'Code that behaves differently from what its docstring or comments say: a wrong result, a wrong decision, or an unsafe input let through. Style, naming and missing tests don\'t count.';
// The expert hunts (H6): bugs no docstring gives away, so what counts is how the code behaves, worked out from its use.
const EXPERT_COUNTS = 'Code that does the wrong thing when it runs: a wrong result or decision, data lost or corrupted, or an unsafe input let through. The docstrings and comments may not mention it; work out what the code is for from how it is used. Style, naming, performance and missing tests don\'t count.';
// A decoy (H6): correct code made to look wrong. A BUG line on it counts against the agent.
const decoy = (file: string, find: string, replace: string, what: string): PlantedBug => ({ ...bug(file, find, replace, what), decoy: true });
const hunt = (id: string, name: string, task: string, bugs: PlantedBug[], options: { counts?: string; maxReports?: number } = {}): Starter => ({
  id, name, mode: 'build', buildKind: 'review',
  text: [`# ${name}`, `This repository is CLI-MODE, a Claude Code plugin that runs other coding agents (Codex, Grok Build, Antigravity and others) from inside Claude Code. ${task}`, `## What counts as a bug\n\n${options.counts ?? COUNTS}`].join('\n\n'),
  build: { project: CLI_MODE, hunt: { commit: COMMIT, exclude: LEFT_OUT, bugs, ...(options.maxReports ? { maxReports: options.maxReports } : {}) } },
});

export const BUG_HUNTS: Starter[] = [
  hunt('hunt-cli-mode-easy', 'Bug hunt 1 (easy): agent names',
    `One bug was introduced into ${scripts}names.py, the module that generates, validates and resolves agent names: one of its functions no longer does what its docstring says. Find it.`,
    [bug('names.py', '        if len(found) == 1:\n            return \'match\', found[0][1]', '        if len(found) >= 1:\n            return \'match\', found[0][1]',
      'resolve(): a short form (-7K) that several live agents share picks the first of them instead of reporting them as ambiguous.')]),
  hunt('hunt-cli-mode-medium', 'Bug hunt 2 (medium): turn receipts and model catalogs',
    `Three bugs were introduced into two modules: ${scripts}changes.py (what an agent's turn changed: snapshots, receipts, undo and diffs) and ${scripts}catalogs.py (refreshing a provider's model catalog from its session metadata). Find all three.`,
    [bug('changes.py', "        added, removed, path = (entry.split('\\t', 2) + ['', ''])[:3]", "        removed, added, path = (entry.split('\\t', 2) + ['', ''])[:3]",
      'compare(): git\'s --numstat lists lines added before lines removed, so every receipt reports added lines as removed and the other way round.'),
    bug('changes.py', "        cut = out.rfind('\\n', 0, DIFF_MAX)", "        cut = out.find('\\n', 0, DIFF_MAX)",
      'diff_text(): a long diff is cut at its first line break instead of its last one before DIFF_MAX, so almost all of it is lost.'),
    bug('catalogs.py', "        access['options'] = [item for item in access['options'] if item['nativeValue'] in advertised]", "        access['options'] = [item for item in access['options'] if item['nativeValue'] not in advertised]",
      'from_metadata(): keeps only the access options the provider does not advertise, instead of the ones it does.')]),
  hunt('hunt-cli-mode-hard', 'Bug hunt 3 (hard): the whole plugin',
    `Five bugs were introduced somewhere in ${scripts} (about 40 Python and JavaScript files). Each makes the code behave differently from what its docstrings and comments say. Find as many as you can.`,
    [bug('operations.py', '            return ctypes.get_last_error() != 87  # Missing PID; access denied stays unknown/live.', '            return ctypes.get_last_error() == 87  # Missing PID; access denied stays unknown/live.',
      'operation_running(): a process ID that no longer exists (error 87) now counts as running, and one it can\'t open (access denied) as stopped: the opposite of the comment.'),
    bug('test_gate.py', '    return TIMEOUT if value and value != OFF else DETECTED_TIMEOUT', '    return DETECTED_TIMEOUT if value and value != OFF else TIMEOUT',
      'timeout_for(): a command set with /cli test gets the short detected-command limit, and a detected one the long limit, the other way round from the docstring.'),
    bug('progress.py', "                    or previous['status'] == 'in_progress' and event['status'] == 'pending')):", "                    or previous['status'] == 'pending' and event['status'] == 'in_progress')):",
      'ActivityRelay.feed(): drops the normal step from pending to running, and lets a running tool fall back to pending, instead of the other way round.'),
    bug('confirmation.py', "                 'weekly': 'Weekly', '7d': 'Weekly'}.get(label, label)", "                 'weekly': 'Weekly', '7d': 'Five hour'}.get(label, label)",
      'window_rows(): a 7d quota window is labelled Five hour instead of Weekly.'),
    bug('agent_folder.py', "NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]*$')", "NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9./-]*$')",
      'NAME: lets dots and slashes into an agent folder name, so path() can point outside Agent_Working_Folder (A/../../x), where the docstring says such names are refused.')]),
];

// The expert hunts (H6): no count given, bugs no docstring gives away (each needs a caller, a data shape or an invariant
// kept elsewhere to see), decoys that look wrong but aren't, and a cap on the BUG lines that count. Designed and checked
// against commit 270a280: every original and planted line occurs once, and all of them together still compile.
export const EXPERT_HUNTS: Starter[] = [
  hunt('hunt-cli-mode-state-queue', 'Bug hunt 4 (expert): state and queue',
    `Bugs were introduced into the code that keeps CLI-MODE's state and runs its queued turns: ${scripts}state.py and ${scripts}queue_worker.py, about 2,100 lines. How many isn't said. Find as many as you can.`,
    [bug("state.py", "                self.recover_captures(value if committed else before)", "                self.recover_captures(before if committed else value)",
      "State.edit(): after a committed edit, cleanup runs against the state before the edit, so the payload file written in that same edit is deleted at once and the queued prompt can never be sent."),
    bug("state.py", "        used = index + 1", "        used = index",
      "direct_targets(): reports one word fewer than it used, so a named agent stays in the task text (or a bare /d name is sent as a task)."),
    bug("queue_worker.py", "            batch, position = batch[:kept], ends[kept - 1]", "            batch, position = batch[:kept], ends[kept]",
      "relay(): when a long answer is split, the next part resumes after the first event not shown, so that event is lost."),
    bug("queue_worker.py", "                        if not path.startswith(own)), key=lambda item: item[1][1], reverse=True)", "                        if not path.startswith(own)), key=lambda item: item[1][0], reverse=True)",
      "/cli dir: lists files largest first, while saying newest first (the value is (size, mtime))."),
    decoy("state.py", "    ready.sort(key=lambda item: item['name'] != state.get('main'))", "    ready.sort(key=lambda item: item['name'] == state.get('main'), reverse=True)",
      "Still correct: a stable sort with reverse=True puts the current agent first and keeps the others in order, as before.")],
    { counts: EXPERT_COUNTS, maxReports: 6 }),
  hunt('hunt-cli-mode-whole', 'Bug hunt 5 (expert): the whole plugin',
    `Bugs were introduced somewhere in ${scripts} (about 40 Python and JavaScript files). How many, and where, isn't said. Find as many as you can.`,
    [bug("auto_mode.py", "        top_label, top = levels[-1] if levels else ('its highest', None)", "        top_label, top = levels[0] if levels else ('its highest', None)",
      "The ESCALATE line names the lowest effort as the one to escalate to (the levels are sorted lowest first)."),
    bug("dispatch.py", "                while finished < 2:", "                while finished < 1:",
      "The turn loop stops when the first of its two reader threads ends, so a bridge turn (whose stderr ends at once) stops before its output is read."),
    bug("presentation.py", "                start=start + 1, rows=rows)", "                start=start, rows=rows)",
      "A paginated menu numbers its items from 0, so each number picks the item above it and the first can’t be chosen."),
    bug("relay_view.py", "        elif mark[0] == opened[0] and len(mark) >= len(opened) and not line.strip()[len(mark):].strip():", "        elif mark[0] == opened[0] and len(mark) > len(opened) and not line.strip()[len(mark):].strip():",
      "A code fence closed by one of the same length counts as still open, so everything after it renders as code."),
    bug("acpx.py", "        control = args[2:] if args[:1] == ['-s'] else args", "        control = args[1:] if args[:1] == ['-s'] else args",
      "-s <name> set …: the session name stays at the front of the control, so live settings never go to the running owner."),
    bug("binding.py", "                                 if value['session'] != owned['name'] or operation_running(value)}", "                                 if value['session'] != owned['name'] and operation_running(value)}",
      "Closing one agent drops other agents’ uncertain operations, and its own still-running submitters, from the record."),
    decoy("agent_folder.py", "                if len(files) >= LIMIT:", "                if len(files) == LIMIT:",
      "Still correct: each file adds exactly one new key, so the count reaches LIMIT exactly."),
    decoy("relay_view.py", "    running = sum(tool['status'] not in TERMINAL for tool in tools)", "    running = sum(tool['status'] in ('pending', 'in_progress') for tool in tools)",
      "Still correct: a tool’s status is always one of the four, so not finished means pending or running.")],
    { counts: EXPERT_COUNTS, maxReports: 8 }),
];

export const BUILD_STARTERS: Starter[] = [...APP_BUILDS, ...HARD_BUILDS, ...BUG_HUNTS, ...EXPERT_HUNTS];
