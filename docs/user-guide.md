# Agent vs Agent: user guide

The v0.3.1 room in detail. For installation and an overview, see the [README](../README.md).

**Host** means the Codex or Claude Code app where the plugin is installed and `/ava` commands are entered. **Agent** means a separate CLI process in one of the room's two seats. Either host can use any supported pair of agents; using Codex as the host does not require using Codex as an agent. Vercel AI Gateway is an additional model route through the Codex adapter, not a separate CLI.

For development and validation, see [Contributing](../CONTRIBUTING.md). For the local token model, Bypass and vulnerability reporting, see [Security](../SECURITY.md).

## Opening the room and activating agents

- Type `/ava` for short help, or `/ava doctor` for diagnostics in either host. Doctor checks CLI installation and versions, Codex and Claude Code sign-in status where available, and the Gateway key's credit endpoint. It sends **no model requests**. Grok Build and Antigravity sign-in checks are reported as unavailable; only activation proves model access.
- An outdated Codex or Claude Code is flagged in the activation menu with its update command. The Gateway also requires a compatible Codex CLI.
- Type `/ava start` in Codex or Claude Code (the same `/ava` commands work in both hosts). The room opens in your browser panel, or you get its link.
  - **The version:** the room shows the AvA version beside its title.
  - **After an update:** the new version takes over from the older AvA service once nothing is running in it, closing that service's idle agents. Open the room again with `/ava start`; links to the old room stop working.
- Above each agent's screen, **Activate** stands where the agent's name goes. Click it to open that agent's setup menu: the same text menu the hosts print for `/ava CLI1`, in a small window. Click a line, or type its number; **B** goes back, **C** changes the CLI and **X** closes.
  - Choose the CLI (Claude Code, Codex CLI, Grok Build or Antigravity; the same CLI can take both seats), then its model, effort, speed, account route and permissions. Models show their name and version (Opus 5.5). Speed reads **Default** or **Fast**, and any setting left alone reads **Default**.
  - **Quick activate** (beside **Activate**, **Quick activate both** below, or the last line of the menu) activates an agent in one click.
    - **What it uses:** the settings that agent last activated with, in any room: CLI, model, effort, speed, permissions and internet. Its description says what it will use.
    - **The first time:** the CLI's strongest model at high effort, with Ask permissions and internet off. The CLI is the one chosen for the agent, otherwise Claude Code for Agent 1 and Codex for Agent 2.
    - **A Gateway model** is chosen once with **Activate**.
  - **Changing the CLI:** once a CLI is chosen, its name stands beside **Activate**; click it (or **C. Change CLI** in the menu) to pick another, before or after activation.
  - **Activate and verify** sends one short request to check that the model answers, and the setup window closes. Codex and Claude Code report their context window with that check, so the ring beside the agent's status fills in at once; Grok Build and Antigravity don't report theirs.
- **Vercel AI Gateway** is the fifth provider choice. Available models and makers are loaded from the Gateway catalog.
  - **Model:** pick a maker, then a model (newest first, 20 per page), or type in the search box to search them all. **Effort** offers that model's own reasoning levels.
  - **The agent:** Codex, pointed at the Gateway (as `vercel ai-gateway setup` configures Codex), set up for AvA's own process only. Your Codex and Claude Code settings are never changed.
  - **The key:** the Gateway works only with an AI Gateway API key. Your Vercel login can't call it directly, but it can create a key.
    - **Gateway key** in the menu creates one named `agent-vs-agent`, with a monthly budget, using your Vercel CLI login.
    - Alternatively, from a checkout, run `npm run gateway-key -- set` and paste a key you already have (it isn't shown), or set `AI_GATEWAY_API_KEY`.
    - AvA keeps its key in the data folder (`secrets/ai-gateway.json`) and never shows it. `npm run gateway-key -- status` says whether the Gateway accepts it.
  - **Internet switch:** the Gateway agent has no built-in web search, so the switch only lets its commands reach the network.
- Once an agent is active, click its name to change its settings. A new model, effort or CLI needs reactivating, which starts a fresh session for that agent. Permissions change at once.
- The text menus still work in both hosts: `/ava CLI1`, `/ava CLI2`, with choices like `/ava CLI1 2`.

### Permissions

Each agent's setup menu has a **Permissions** line.

- **Ask** (the default):
  - **Prompt and Debate:** agents can't use tools that need permission.
  - **Build:** recognized file tools may read and edit inside each agent's own folder. AvA refuses command execution, unknown tools, linked paths, and sandbox escalation.
  - Refusals show in the agent's screen.
- **Bypass:** AvA approves every tool request the agent makes, in every mode, which is useful for benchmarks where the agents should run code. The pane shows a red **Bypass** tag.
  - **Codex:** runs in its own full-access mode.
  - **Claude Code, Grok Build and Antigravity:** AvA's gate approves each request. Each CLI's own name for this is shown: bypass permissions, full access, always allow, YOLO.
  - Web tools still follow the internet switch whenever the agent asks for them. Codex's commands in full-access mode can reach the network regardless.

Bypass trusts the agent with your machine. Use it for tasks you'd let that CLI run unattended.

## Saved prompts and their files

**Prompt library** in the sidebar opens the same saved library in Prompt, Debate and Build, including Build's bug hunts. Its tabs show each mode's prompts (and **All**); it opens on the current mode, and prompts saved for any mode appear in every tab. The library is shared by the Codex and Claude Code hosts. It includes starter prompts that you can edit or delete: fifteen challenges and races for Prompt, fifteen debates (below), and for Build nine app builds and six bug hunts.
  - **The app builds:** a Snake game, a Pomodoro timer, a Kanban board, a trip expense splitter, Sudoku with a solver, and a pixel art editor. Each runs in the browser as plain files, so both open side by side in Results.
  - **Three hard app builds:** chess with every rule, a spreadsheet with formulas, and a regular-expression engine written from scratch.
    - **Exact behavior:** each must get something exactly right: chess move generation (perft), formula evaluation, or matching.
    - **Checking it:** each app exposes a function on `window` (`perft`, `evaluateSheet`, `regexFullMatch`), so you can test it in the browser's console. The prompt gives some expected results; check with others too.
  - **The bug hunts:** three scored hunts in CLI-MODE, of increasing difficulty: one planted bug in a named file, three in two named modules, and five anywhere in the plugin's scripts. Each fetches the same pinned commit of CLI-MODE from GitHub (https://github.com/adamczhang/CLI-MODE) and leaves out its tests, so they work on any computer with internet access. A fourth, unscored hunt works on any repository you give it.

- **New prompt** creates a saved prompt. Give it a name, select a mode (or **Any mode**), and write its instructions in Markdown. **Import .md / .txt** brings an existing prompt into the editor; **Export Markdown** downloads its text.
- The folder button beside the composer saves the current draft and its attached files. **Use current draft** does the same from inside the library.
- **Files** keeps up to eight reference images or text files with each prompt. Add or drop files, edit their names, preview them, download them, or remove them before saving. The room's usual limits apply: 8 MB per image and 512 KB per text file. Removing a file in the editor takes effect when you save.
- **Save prompt** keeps the prompt and its files. **Load into composer** brings them into the current room and selects the saved mode. You can adjust the draft before sending. Loading alone sends no model request.
- **Run now** saves and sends the prompt to both active agents in the current mode, using the room's current options and project folder. It waits for a ready session. A Bug hunt needs a repository folder. Saving a prompt never changes provider, model or permissions, and only a Debate prompt sets internet access (below).
- **Debate prompts** all follow one template:
  - **Motion:** both debaters see it, with any definitions both sides should use.
  - **Agent 1 and Agent 2:** each has its **side** (for or against the motion; the two are always opposite) and a private brief that only it sees. Each also has an **Internet** on or off choice.
  - **Rounds:** how many speeches each debater gives.
  - **Loading or running one** fills the debate Options with the sides, briefs, internet choices and rounds. It also clears stop conditions, minutes and a request limit left over from an earlier debate.
  - **Internet:** each agent's switch changes when the debate starts.
  - **While a debate runs,** a debate prompt can't be loaded: stop it or close the thread first.
  - **Export Markdown** writes the whole template in one file, and **Import** reads it back.
- Search by name, prompt text or attached filename, and filter by mode. **Delete prompt** removes its library copy after confirmation; earlier runs retain independent attachment copies. Unsaved edits require a discard confirmation before leaving.

The library shows its storage folder and lets you copy the path. Saved prompts live under `prompts/` in the configured data folder; `AVA_DATA_DIR` overrides the folder set by `config.dataDir`. Each prompt has its own ID-named folder containing `prompt.md`, `prompt.json` (name, mode and file metadata), `debate.json` for a Debate prompt's template, and `files/` with original filenames. These files persist across plugin upgrades and **Clear history**. **Reload saved version** picks up an externally edited `prompt.md`; conflicting edits from another window are refused until you reload. Import standalone Markdown through the library instead of creating an incomplete prompt folder manually.

Saved prompts do not yet have benchmark pass/fail scoring; that is separate roadmap work.

### Formal debates

Every debate runs like a competitive debate:

- **Assigned sides.** Agent 1 argues for the motion (the Proposition) and Agent 2 against (the Opposition). Swap them in Options or in a debate prompt. Each argues its side whatever its own view, which keeps two agreeable assistants from settling after a turn or two.
- **A brief before the start.** Each debater gets a private brief through its own 1:1 line: the motion, its side, the format, how it will be judged, and your private notes for it. It replies READY, and the debate starts once both have. You can read both exchanges in the 1:1 windows.
- **Speeches.** Round 1 is each side's opening case. The middle rounds are rebuttals: answer the other side's strongest point first, then strengthen your own case. The last round is a closing, with no new arguments. Debaters are told to back claims with evidence and never invent facts or sources.
- **An independent judge.** When the debate completes, a fresh session of the strongest model at its highest effort reads the speeches and scores each side.
  - **Who judges:** Claude Code (Opus at max effort) by default, Codex, or no judge, chosen in Options.
  - **What it sees:** the motion and the speeches, never the briefs or which CLI argued which side. It can search the web to check facts.
  - **Judged blind:** the judge reads every speech in one plain typography (straight quotes, plain dashes, no Markdown emphasis), because each CLI's typing habits told the two apart. A debater's model name, or anything it says about being a particular AI system, is replaced with [name removed]. A system named in the third person stays, since it can be evidence. The debaters are asked to stay anonymous, and the judge not to guess who wrote what. The room keeps every speech as it was, and the ballot says the judging was blind.
    - **Three ballots:** when a judged debate ends, each debater also scores it, in its own session through its 1:1 line, so nothing new starts. Each is told its ballot is one of three.
      - **The result:** the side most ballots name wins. Two debaters that each vote for themselves cancel out and the judge decides; one that concedes gives the other side the win.
      - **On the card:** all three ballots, then the judge's full scores.
      - **Missing ballots:** a ballot that doesn't come (an agent that isn't active, a reply that isn't a ballot) is shown as missing, and the result counts the ballots there are.
      - **Waiting:** the next debate waits for the debaters' ballots, as for any 1:1 reply. **Judge again** asks the judge only.
    - **A limit:** blinding hides typing habits and names, not how each model argues. In a live test, Claude Code and Codex still told which debater was Claude in every blinded debate. A judge from a CLI that also debated may recognize its own side.
  - **The score:** 1 to 5 for each debater in three categories (factual accuracy and evidence; challenging the opposition's strongest points; a cohesive stance), plus a winner and the reasons.
  - **The ballot** appears below the debate, with any factual claims the judge questioned. **Judge this debate** or **Judge again** asks it on demand, for example after a debate you stopped.
- **The library's built-in debates** are formal motions, each with briefs for both sides. Ten are on general topics:
  - smartphones in schools;
  - social media and teenagers;
  - nuclear power;
  - universal basic income;
  - rent control;
  - the four-day week;
  - open AI models;
  - a market for kidneys;
  - youth tackle football;
  - the fall of Rome.

  Five hard ones are technical: winning them takes exact evidence and real clash on mechanisms, not general points:
  - ranked-choice (instant-runoff) voting;
  - the replication crisis in social psychology;
  - nominal GDP targeting;
  - the strategic bombing of Germany (closed book: internet off for both sides);
  - living standards in the Industrial Revolution (closed book).

  They replace the earlier debate starters you never edited.
- **A time per speech,** 2 minutes by default (Options, or a debate prompt), covers thinking, web searches and writing together. A speech that runs over is cut off and recorded as forfeited, the other side speaks next, and the judge counts the forfeit.
- **One debate per thread.** A concluded, judged debate stays in history as its own thread, with its ballot, and the thread list shows the result ("Agent 2 won 14–10").
  - **After it ends,** the agents stay loaded and Ready, and you can change either one.
  - **The next debate** you run starts a new thread: both agents get fresh sessions (neither remembers the last debate) without being closed. Each fresh session starts beside the current one and takes over once it's ready.
- **The Debate builder** (the third button in the sidebar, under the mode switch) sets a debate up step by step.
  - **The form:** the motion and its definitions, which side Agent 1 argues, a private brief for each side, internet, rounds and speech time. The grey hint in each box says what a good entry looks like and disappears as you type.
  - **Saving:** **Save** adds the debate to the prompt library, and **Save and load** also fills the room's composer and Options. **Start from** opens any saved debate to edit.
  - **The Build builder** has a form for each kind.
    - **App build:** what to build, its requirements, how it will be judged, and an optional project to start from.
    - **Bug hunt:** the repository to hunt in, what to hunt for (name a file for an easy hunt, the whole repository for a hard one), and what counts as a bug.
      - **The repository** is a folder, or a public git repository's address such as `https://github.com/owner/repo`.
      - **Check** reports what a copy would hold. For an address, it also gives the default branch's commit, and fetches what the hunt needs so its first run starts at once.
    - **Score this hunt** adds:
      - **The commit to copy.** A repository on the web needs the full hash: **Check**, then **Use**.
      - **Only these folders:** a slice of a large repository.
      - **The paths to leave out:** tests and agent instructions by default.
      - **The bugs to plant:** each one's file, its original code exactly as it is, the bugged code, and what's wrong. **Check** says whether each one applies.
      - **Decoys:** tick **A decoy** on a planted change that keeps the code correct but makes it look wrong. A BUG line on a decoy counts against the agent that wrote it.
      - **BUG lines that count:** only each agent's first ones count. Use this for a hunt that doesn't say how many bugs it has, so reporting everything can't win.
    - **Loading:** a saved Build prompt fills in its kind and its folder. A scored hunt shows **Planted bugs** beside the message box while the box still holds its text.

## The room

A white, three-part window:
- **Left:** the mode switch and a tools row (Prompt library, the builder for the current mode, and Settings; Gamer has no builder). A faint divider separates these controls from Search and the thread list below.
- **Upper panes:** each agent's own screen (thinking, tool use and output as its CLI exposes them). Drag the divider between the two agents to change their widths.
- **Lower pane:** the shared channel, with the text box along the bottom edge. Drag the horizontal line above it up or down to give more space to the CLI screens or the lower pane. This also works in Stats and Results. Double-click a divider (or focus it and press Enter) to reset that split; arrow keys adjust it, with Shift for larger steps. Both proportions are remembered in this browser.

There is no third model acting as a relay. One message of yours goes to both agents at once; after that they take turns.

### Modes

Switched at the top of the sidebar. Each mode has its own thread and its own two agents in this room: switching to Build after a debate opens a clear Build screen, and switching back finds the debate as you left it, still running if it was, until you close it. A mode used for the first time starts with the same agent settings, ready for **Activate both**. Two modes with active agents use four agents, the default limit (Settings).

- **Prompt:** one prompt goes to both agents at the same moment, exactly as you wrote it. Each answers once in plain text, shown with how long it took, and the run ends. **Stats** has the timing and speed. Tools follow each agent's permissions.
  - **Challenges and races.** A challenge is short to write, takes real reasoning and has one exact answer. A race is the same kind of question, judged on speed. The strongest models answer the first ten built-in ones correctly within seconds; the five hard ones take them minutes.
    - **The answer key:** each has one, which the agents never see. They end with a line `ANSWER: …`, and when both have answered, AvA checks that line. Numbers are compared by value (2,131 is 2131, 74/144 is 37/72, and after an `=` only what follows counts). A number must be exact and the only candidate: 3.5 isn't 3, and "12 or 13" counts as no answer.
    - **The result:** it appears below the answers, with each agent's final answer, right or wrong, and its time. The winner is the agent that got it right, or the faster one if both did.
    - **Built in:** every answer was computed by program.
      - **Six challenges:** domino tilings, a logic puzzle, tracing code, rising digits, a dice-triangle probability, a shortest route.
      - **Four races:** trailing zeros, base seven, counting sevens, a day of the week.
      - **Five hard challenges:** twenty generations of the Game of Life, the eight queens kept off both long diagonals, a king's random walk, a 150-step code trace, and the digit sum of 3^300. Without tools, the strongest models need about 1 to 7 minutes for each.
    - **The Prompt builder** (sidebar) sets up your own: the task, the answer form, and the expected answer, which stays hidden from the agents. A loaded prompt with a key shows **Answer key** beside the message box.
  - **One thread per prompt.** Each Prompt run is its own thread. The next prompt gives both agents a fresh session (clean context) with the same settings. The agents stay loaded and **Ready** throughout, because each fresh session starts beside the current one before taking over.
- **Debate:** the agents talk to each other. Prime each one privately with its 1:1 line (say "you are a CEO" and "you are a college student"), then give the shared topic. **Options → First to speak** picks who opens: Agent 1 (the default), Agent 2, or both independently at once. The choice is remembered in this browser and in saved presets. Your topic reaches both agents at the start: while Agent 1 writes its opening, Agent 2 reads the topic (it replies READY, which isn't posted; one extra short request) and then answers that opening. After the opening, agents alternate. Turns are asked to be short and conversational, in plain text, with no word count; any length or format you give in the topic comes first. A new shared message waits for the next turn; the next speaker answers first, then the other receives both the message and that answer. The room shows who is speaking, who is next, and how many prompts are queued.
- **Build** has two kinds, chosen in the row above the text box: **App build** and **Bug hunt**.
- **App build:** both agents build the same thing at the same moment, each in its own folder, and post a link to their app in the shared channel.
  - **Each build is its own thread,** with no messages while it runs. The next build gives both agents fresh sessions (the same agents, clean context) and folders of their own; the earlier build keeps its folders, so its Results still open.
  - **Setting up first:** in a Build session, an agent's 1:1 line may use the same scoped file tools. Under Ask, provide an existing project to copy; cloning, installing dependencies and running tests require execution isolation or an explicit Bypass choice.
  - **Where they work:** from scratch, each agent starts with an empty folder. Type a project folder in the row above the text box to have each start from its own copy of it instead. In a git repository, the copy holds tracked files plus uncommitted work, without ignored output such as `node_modules`. Your original is never touched.
  - **The app link:** each agent ends its report with `APP:` and the page to open, or the address of a server it left running. The room shows that as **Open app**:
    - **A page:** AvA serves the agent's folder on a loopback port of its own, so the app can't reach the room or its token, and the link works only from the room.
    - **A server** (an app with an API, say): it keeps running until the next build starts, Clear Session, or Clear history. Anything else an agent leaves running, such as a file watcher, is stopped when its build ends, and its screen says so.
  - **Results** (the window button, or **Side by side** under a report) shows both apps running, each under its own agent's screen, with the prompt row below. Drag the horizontal divider to change the height of the previews. **Apps / Changes** in the prompt row switches to what each agent changed, file by file. The chat button brings the conversation back.
  - **If an agent stops early,** the other still finishes, and the stopped agent's screen says why. (Grok Build, for example, ends its turn when a permission is refused.) If an agent's report is complete but a command it ran is stuck waiting for input, AvA takes the report as final after a minute of quiet.
  - **Bug hunt:** switch the row above the text box to **Bug hunt** and give the repository to hunt in. Each agent hunts in its own copy and reports each bug on a line `BUG: <file>:<line> — <what is wrong>`; each hunt is its own thread, as each build is.
    - **Reading the code under Ask:** Claude Code reads and searches with its file tools, which AvA allows inside the copy. Codex reads only through commands, so in a bug hunt it may run read-only ones (`rg`, `cat`, `ls`) and is told to run nothing else; in an app build under Ask it runs no commands.
    - **No clone to make:** AvA copies the repository's files into each agent's folder when the hunt starts (a second or two for a few hundred files), without its git history, and the original is never touched.
    - **A repository on the web:**
      - **Fetching:** AvA fetches the one commit it needs: no history, and only the files the copies take (a few seconds for CLI-MODE).
      - **The cache:** the fetch goes into `repos` in its data folder, and later runs copy from there without downloading anything.
      - **Public repositories only:** AvA never uses your saved git passwords and never asks for one.
      - **Why AvA fetches, not the agents:** a clone's history would show the planted bugs in a diff, and under Ask the agents can't fetch anything anyway.
    - **Scored hunts** come with planted bugs: small edits made to every copy before the agents start, so both begin from the same seeded code. A hunt may be pinned to one commit (so every run gets the same code) and leave out folders, such as the tests that would point at the bugs. When both agents have reported, a result card lists the planted bugs and which agent found each: a BUG line counts when it names the bug's file and a line within three lines of it. The agent that found more wins; with as many found, the one that reported fewer decoys (correct code planted to look wrong), then the faster one. Nothing about the planted bugs reaches the agents, not even which files changed: planted files keep the time they were copied. A small project (up to 40 files and 64 KB of text) also comes with the prompt, numbered by line. That way an agent that reads files only through commands, such as Codex under Ask, can still review it. Build output, binary files, and files that may hold secrets (such as `.env` or private keys) are left out of the prompt; the prompt names those files, and they stay in each copy.
  - **Folder access:** under Ask, scoped file operations are approved inside the working folder. Commands, unknown tools, paths outside it, links, and requests to leave the sandbox are refused.
    - Codex switches to its own `workspace-write` sandbox for the build, and back after.
    - A command that mentions the working folder is still refused: its effects are not confined by that path. Builds that need execution must wait for execution isolation or use an explicitly chosen Bypass mode.
  - **Limits:** 30 minutes by default, set in Options.
- **Gamer:** the agents play chess, checkers, Go or Crosscurrent against each other, with AvA as the referee. The board takes the conversation pane's place. Beside it, set up a game (the game, Go's board size, who moves first, the time per move) and press **Start**. Crosscurrent uses 7x7 only.
  - **The brief:** before the game, each agent gets one message in its 1:1 line and replies READY. It holds its side, the rules, the notation (SAN and FEN in chess, PDN in checkers, GTP coordinates and a grid in Go, a placement square and independently chosen shift line in Crosscurrent), what each turn looks like, and how to answer.
  - **Each turn** gives the agent to move only its opponent's last move and the position, never the legal moves or the moves so far, so each turn stays short however long the game runs. It answers `MOVE: <move>`.
  - **The referee** checks every move against the one board it keeps. An illegal answer is refused with the reason and asked again; three in a row lose. A move past its time limit loses, and `MOVE: resign` resigns. The agents never see each other's replies, only the moves.
  - **Each game is its own thread,** with fresh sessions. Step through a game with the arrows above its moves; **New game** sets up the next one.
  - **For a fair game,** keep both agents' internet off. The brief asks them not to use the web, but the switch is what turns their web tools off.

### Gamer and Crosscurrent

Choose **Gamer**, activate its two agents, and choose Chess, Checkers, Go or **Crosscurrent**. Select the board size when offered, the player who moves first, and the time per move. Starting briefs both agents on the rules before asking for their first move. AvA validates every answer; three illegal answers in a row, running out of time, or resigning loses the game. Finished games keep their result and move-by-move replay.

Crosscurrent uses **7x7 only**, with **one shared neutral star**:

1. The star starts at D4, with every other square empty. Circle moves first; Diamond moves second.
2. Place your stone in an empty square, then independently choose any eligible row to shift left or right, or column to shift up or down, by exactly one square. The line need not contain your placement; empty or unchanged lines are legal. All contents move, including the star, opposing stones and empty squares; contents pushed off one end reappear at the other. The star cannot be replaced or captured.
3. The exact line shifted on the preceding turn is **resting** and cannot shift this turn in either direction. You can still place on it or shift a perpendicular line. Your chosen line becomes the resting line for the next turn, even if it was empty. The board marks it with a dashed outline.
4. After the shift, check both players. A winning connected group must contain the star and touch **at least three of the four edges**. The star connects to either player's orthogonally adjacent stones and contributes its own edge contacts to both players. Corners touch two edges. Groups may branch or bend; diagonals and wrapping do not connect. A group without the star cannot win.
5. If exactly one player qualifies, that player wins, even if the opponent made the move. Both players qualifying is a draw. A full board without a qualifying group is also a draw. There is no passing or capturing.

Moves look like `MOVE: E3 ROW 4 RIGHT`: place at E3, then shift row 4 right. `MOVE: A1 COL D DOWN` places at A1 and shifts column D down. Columns count from A on the left; **row 1 is at the top**. In the agents' text board, `O` is Circle, `X` is Diamond, `*` is the shared star, and `.` is empty. The visual board shows the star, shifted line, resting line, new stone, reached edges and winning connections. Replay follows the selected move. **New game** previews the next selection; **Back to this game** returns to the recorded game. Go keeps its size preference; Crosscurrent always uses 7x7.

Older saved games keep their own rules: unversioned/Classic games use placement-linked shifts and an opposite-edge goal; Three Edges v2 permits independent shifts without cooldown. Malformed saved moves and unsupported ruleset versions show a replay error instead of silently displaying an incomplete board as the result.

The star occupies one square, leaving at most **48 placements** per game. Crosscurrent's opening balance has not yet been established.

### Tactical analysis and puzzles

On a completed Crosscurrent cooldown game, select **Analyze game**. Analysis runs locally in a cancellable browser worker. Findings identify immediate wins, avoidable losses, already-forced losses and short forcing sequences. Select a finding to jump to that move, or **Explore** an alternative and enter further legal replies. **Return to recorded game** closes the variation; the saved moves are unchanged. A safe alternative avoids the stated immediate loss, not necessarily defeat later in the game. Longer-term positional strength is unassessed.

**Puzzles** in the Gamer toolbar contains twenty verified positions, five each for immediate wins, defense, cooldown defense and forcing sequences. Enter a move to practice, or reveal one solution. Grading accepts every move that satisfies the stated goal, not just the reference answer.

**Compare agents on puzzles** uses the room's configured models in fresh, separate sessions, with Ask permissions and internet off. Select one puzzle or all twenty and a time limit or performance preset. The ceiling is four model requests per position: two activation checks and two answers. Two free agent slots are required. Saved results separate accuracy, time, illegal moves and provider failures and can be exported as JSON. Cancel from the panel or Settings > Stop all; a provider failure or timeout stops the batch, and restart never resends uncertain work.

### Match series

Select **Series** from Gamer or Debate. Choose a game or a debate motion, the clock, and 1–10 pairs of matches. Each match uses fresh sessions. The two matches in each pair swap game colors, or debate stances and opening order; models keep their identities. Games start from the same initial board. Debate series keep the motion fixed and save the participant reviews and independent ballot.

The panel shows the request ceiling and agent settings before starting. Requested and accepted settings, code fingerprints, transcripts and results are retained. Only complete pairs contribute to the score; partial matches and failures remain visible. The conservative 95% range assumes independent trial pairs and can be wide for small samples. Use **Open match replay**, **Export JSON** or **Export Markdown** from the saved results. Cancel a running series from the panel or Settings > Stop all. A restart marks unfinished work interrupted, with no automatic retry.

### Performance presets

The **Performance** selector is available in game setup, Prompt/Build/Debate Options, puzzles and series:

| Preset | Requested effort | Time limit |
| --- | --- | --- |
| Quick | Low | 60 seconds |
| Standard | Medium | 120 seconds |
| Deep | High | 300 seconds |

The clock applies per game move, debate speech or puzzle answer; in Prompt and Build it covers the whole answer. The preview shows each selected model's actual supported effort and any fallback. Starting applies the settings in fresh sessions and records the accepted configuration. Model, speed option, internet and permissions are retained for ordinary runs; puzzle/series isolation follows their stated settings. **Custom** retains current effort; editing the clock switches back to Custom. New Gamer preferences start with Quick; earlier custom choices remain available. Presets describe settings, not a guaranteed speed or quality improvement.

### Understanding debate judgments

The ballot separates the independent judge's assessment, each participant's self-review and the panel result. Disagreements are flagged and participant explanations can be expanded. Identities are withheld and typography normalized, but a model may still infer authorship.

**Check presentation order** is an optional diagnostic with a ceiling of four model requests: two fresh sessions of the recorded judge, each with an activation check and one ballot. Both see the same blinded speeches, grouped in opposite presentation orders, with original round and speaking-order labels preserved. Results and earlier checks are saved separately and never replace the match's votes. A changed verdict may include sampling variation; matching verdicts do not establish unbiased judging. Cancel the check from its panel or Settings > Stop all. Rejudging and deleting the thread wait for the check to settle.

### Threads

A thread is one continuous session with both agents. In a plain conversation, send as many prompts as you like; the agents remember the whole thread. A Prompt run, a formal debate, a build and a game each get a thread of their own, with the same agents in fresh sessions.

- **Close thread** (in the thread's header, or **⋯ → Close thread**) stops the conversation, closes both agents and any app server they left running, and keeps the thread in the list. Both agents keep their settings (CLI, model, effort, speed, permissions, internet): **Activate both** starts the next thread with one short check each.
- **New thread** (the compose button at the top of the sidebar) opens a clean page in the current mode, with its own two agents to activate. Each thread with live agents runs two CLI processes on this computer. From the third, AvA asks before opening another and again before activating its agents; you can go ahead anyway.
- **Clear Session** (**⋯ → Clear Session**) stops anything running and gives this page's two agents fresh sessions. That starts a new thread at the top of the list; the old one stays readable. Each new session makes one short access check per agent.
- The list is the shared pool: threads from every chat and every mode, in Codex or Claude Code, each labeled with its mode. Choosing a thread switches to its mode. Search covers every saved message.
- **Renaming:** double-click a thread's title (in the header or the list), or use **⋯ → Rename**. An empty name goes back to the first prompt.

### 1:1 lines

Two chips above the text box (**Codex 1:1**, **Claude Code 1:1**) each open a private chat window with one agent. Use them to prime each agent with different context or instructions.
- A 1:1 message goes into that agent's own session, in the same thread, so the agent carries it into the shared conversation. Nothing from it appears in the shared channel or reaches the other agent.
- An agent can't answer two things at once. A 1:1 message therefore needs the shared conversation stopped or paused, and the conversation waits while a 1:1 reply is being written.

### Settings

Open **Settings** (the gear in the sidebar) to see active or starting agents across every room in the shared conversation pool, their recorded process counts, and memory usage. Memory is sampled every five seconds while the panel is open; missing readings show **Unavailable**.

**Maximum active agents** defaults to **4**. Set 2–32, or 0 for unlimited. The limit includes starting agents and is enforced before activation in both the room and host menus. Lowering it does not stop existing work; it blocks additional activations until capacity is available. This is an agent-count limit, not a limit on RAM or child processes.

**Stop all AvA agents** asks for confirmation, cancels shared and private replies, closes previews and owned sessions, and checks recorded processes. Conversations, files and the Prompt library stay saved. A cleanup problem is reported as needing attention; uncertain work is never resent. Activate agents again when you want to continue.

### Internet switch

Next to each 1:1 chip, the globe button turns that agent's internet access on or off (off by default). AvA enforces it, not just the agent:
- **Claude Code and Antigravity:** instantly. Their web tools ask permission each time, and AvA allows them only while the switch is on.
- **Codex and Grok Build:** their web search runs without asking, so AvA sets it when the agent starts. Switching restarts that agent in the same session (it keeps its memory). This takes a few seconds and needs the shared chat paused or stopped.
- **Every prompt** also tells each agent its current setting. Each agent's screen shows the switch at work.

### Attachments

The paperclip (or paste, or drag and drop) attaches images (PNG, JPEG, GIF, WebP, up to 8 MB) and text or code files (up to 512 KB, inlined into the prompt). Other file types are refused rather than silently dropped. Grok Build declares no image input, so with Grok in either seat AvA refuses an image up front.

### Controls, options and stats

- **Controls** (while a conversation runs):
  - **Pause** drains current replies and freezes the clock at a reply boundary.
  - **Next reply** advances one agent while paused. A message sent while paused gets one reply from each agent, then pauses again.
  - **Stop** cancels active work.
- **Options** (the sliders beside the text box) apply to the next prompt. Per agent: its side (**Swap sides**), its private brief, internet, and a stop condition. Shared: the judge, how the conversation ends, rounds, minutes, request limit, pace, and saved presets. They match a Debate prompt's template. An internet choice made here switches the agent when the debate starts; using the agent's own switch replaces it.
  - **Rounds:** by default a debate runs for 7 rounds, each agent speaking once a round. The chip beside the message box shows the next debate's length; click it to pick another number of rounds (this also overrides a time written in the prompt). The agents can't end it early by agreeing; the status line shows the round, and the last round is a closing statement. A timed prompt ("…for 15 minutes") runs for its time instead, except a formal debate (one with sides), which always runs for its rounds: its time control is the time per speech. A room message ending "…for N minutes" changes a timed conversation's time, never a debate with rounds. **Ends** can also stop the debate when either or both agents say they're done, and a stop condition you write still ends it.
- **Context and usage** (the small ring beside each agent's status, like Claude's usage ring) fills as that agent's context window does. It turns amber at 80% and red at 95%. Click it for the numbers:
  - **Context window:** tokens in use of the model's window, e.g. 161.5k / 200k.
  - **This session:** input, output and cached tokens, and the agent's cost estimate at API prices (a subscription isn't billed per request), when the agent reports them.
  - **Plan usage:** the CLIs don't pass their 5-hour and weekly limits to AvA, so this says where to see them (`/status` in Codex, `/usage` in Claude Code). A Vercel Gateway agent shows the key's credit instead.
  - Codex and Claude Code report after each reply; Grok Build and Antigravity don't report their context.
- **Stats** (the chart button) covers the whole thread: conversation time, time to first token, reply time, tokens per second, a per-agent table, and a timeline. Codex, Claude Code and Gateway counts use saved provider reports for each request; only Grok Build and Antigravity use estimates (characters ÷ 4), marked ≈. Missing reports and older history stay unavailable. The context ring shows session totals, which also include activation and private messages.
- **⋯** also has Replay and Export (JSON or Markdown, including the 1:1 lines).
- **Delete one thread:** point at it in the list and click the trash button that appears. After a confirmation, it deletes that thread's prompts, replies, 1:1 messages, ballot, attachments only it used, and its agents' folders. A thread whose agents are still active must be closed first.
- **⋯ → Clear history** permanently deletes every saved thread in the shared data folder after a confirmation. That covers prompts, replies, 1:1 messages, attachments, and the agents' working folders with everything they built. It also stops app servers they left running and gives this page's agents fresh sessions.

The two agents are isolated from each other. Each sees only the shared topic, your shared messages, and the other's final replies: never the other's 1:1 messages, private instructions, thinking, or tool activity. Closing the room leaves a running conversation running; reopening it sends no model prompts.

## Running benchmarks

Open **More > Benchmarks** in a room. Choose tasks and repetitions, then **Validate selected** to check that each reference solution passes and an empty attempt fails. Validation runs the tasks' local verifier scripts, not models, under the verifier guard. Validating a task is your decision to run its scripts on this machine, so use only task bundles you wrote or trust.

**Run selected** uses the two configured models in fresh, separate sessions for each task/repetition. It shows the request ceiling first: two access checks and two task answers per task/repetition. The room's existing conversations keep their sessions. Two agent slots must be available within the Resources limit. Cancel a job from its progress panel, or use Resources > Stop all. Restarted or uncertain jobs are recorded as interrupted and never automatically retried.

The CLI uses the same runner: `npm run bench -- run benchmarks/starter --agents codex:MODEL,claude:MODEL --repeat 3 --data <isolated-data-folder>`. Commands `validate <suite>`, `jobs`, `status <job-id>` and `cancel <job-id>` share that data folder. Save the printed request ID; `--request-id` can recover the original start after a lost acknowledgement. Browsing, validation, status and cancellation do not generate replies. `scripts/bench-acceptance.ts` without `--live` exercises the three original starter tasks with mocks in temporary storage; `--tasks` picks others.

A Build task's hidden tests run the code the agent wrote, so they run under the [verifier guard](benchmarks.md#the-verifier-guard).
- **Allowed:** reading that attempt's files, and writing a throwaway temp folder.
- **Refused:** anything else, including starting processes, using the network or writing into the attempt. The refusal is recorded as the check's reason.

The guard needs a Node that can block network access. Node 26 can; without it, live tasks with program verifiers are refused before any agent starts. Ask-mode file tools still refuse shell commands, so agents build with file tools only.

When a job finishes, **Report (HTML)** and **Report (Markdown)** in its progress area save a report you can share: each agent's scores and pass@k, each task's result, and every check's evidence, with no room link or token. See [Reports](benchmarks.md#reports).

### Saved results and scoreboard

In **More > Benchmarks > Results**, filter by real or simulated runs, suite, task, model, UTC date range, or the current job. Each model/effort/speed configuration has its own scoreboard row; real and simulated results stay separate. Pass rate counts only graded passes and failures. Errors, cancellations and interruptions remain visible as ungraded attempts, and missing token reports remain unavailable.

**pass@k** estimates the chance of at least one pass from k samples. It averages the standard sampling estimate over eligible task batches within settled jobs. Different task versions, content fingerprints, jobs and agent configurations are not pooled into one sample batch. A batch with ungraded attempts or too few samples is omitted. **Inconsistent batches** counts fully graded batches containing both passes and failures. **Results over time** groups the selected results by UTC day.

Choose **Inspect** on an attempt for its saved answer, task/version fingerprint, model/effort, AvA version, and every check's outcome, elapsed time, output excerpt and exit code when available. These records and their artifact copies survive Clear history and reruns; earlier attempts are never overwritten.

**Export JSON** and **Export CSV** export all attempts matching the filters, not just the visible page, up to 5,000 attempts or 16 MiB per export. JSON includes the saved prompt and check definitions; CSV includes per-check evidence and the answer. Secret-shaped strings are redacted and CSV formula prefixes are escaped. Narrow the filters for larger histories.

The CLI offers `npm run bench -- results --data <folder>` and `npm run bench -- export json --out <new-file> --data <folder>` (or `csv`). Both accept `--suite`, `--task`, `--provider`, `--model`, `--job`, ISO timestamps with `--from`/`--to`, and `--source only|exclude|all` for simulated/real/all runs. Exports refuse to overwrite an existing file. These commands perform no model work.

## Hosts

### Codex

Typed `/ava …` commands are routed by the plugin's prompt hook to its `ava_command` tool.
- A fresh installation needs its hook reviewed in Codex's Plugins settings or `/hooks`; installation alone doesn't approve a hook.
- Ordinary messages stay with Codex.

### Claude Code

The same `/ava …` commands as in Codex, provided by the plugin's `ava` skill. Its full name, `/agent-vs-agent:ava …`, also works (useful if another plugin ever claims `/ava`).
- Each Claude Code conversation keeps its own pair of agents, like a Codex chat, and resuming the conversation brings them back.
- A skill replaces the prompt hook, so there is no hook to review.
- The skill pre-approves only `ava_command`, only while it runs, and Claude can't run it by itself.
- Each Claude Code session gets its own room.

Both plugins drive the same background service and share one conversation pool.

## Providers and data

- **Locked versions:** ACPX 0.19.4, the Codex ACP adapter 2.1.1, and the Claude ACP adapter 0.85.1. Every agent runs your installed CLI: Codex 0.159.1 or newer (also used for the Vercel AI Gateway) and Claude Code 2.1.286 or newer. AvA says which to update if one is older.
- **Accounts:** the four coding CLIs use their own sign-in (provider-login); AvA never asks for their API keys. The Vercel AI Gateway is API-key only: AvA keeps its key in the data folder's `secrets/` and passes it only to Gateway agents. Model and option lists come from the running provider.
- **API keys:** conflicting API credential environment variables block the provider-login route rather than silently switching accounts.
- **Data folder:** all state lives in one folder that both hosts share: `%USERPROFILE%\AgentVsAgent` by default. Set `AVA_DATA_DIR`, or `"config": {"dataDir": …}` in `package.json` before `npm run package`, to use another one. (Not AppData: the Claude desktop app redirects AppData into private storage, which would split the history.)
  - It is outside AppData on purpose: the Claude desktop app is a packaged Windows app, and Windows would redirect its AppData writes.
  - SQLite holds runs, messages, activity and settings. Each agent session has its own working folder under `workspaces/`.
  - Existing history can be copied in with `node --import tsx scripts/import-data.ts --from <old folder>`.
- **Codex participants:** these run with plugins, apps and hooks disabled, so a child agent can't start AvA recursively. That doesn't change your Codex configuration.

## Safety

- **Loopback only:** the service binds only to 127.0.0.1, checks Host and Origin, and requires a random bearer token.
  - The room receives the token in the URL fragment and removes it from the address bar. Don't share the room link or `server.json` in the data folder.
  - Current source protects `server.json` and Gateway secrets with an owner-only Windows ACL. This does not protect against programs already running as your account.
- **Interrupted work:** on a service interruption or an uncertain cancellation, AvA quarantines the run and never resends work whose outcome is unknown.
  - **Release** (or `/ava reconcile`) frees the pair once no provider process from it is running.
- **Separate origins:** app previews run on separate loopback origins behind a cookie that only the room's link sets.
