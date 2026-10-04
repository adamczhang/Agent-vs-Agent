# Changelog

## Unreleased

### Added

- **Challenge and race prompts** in Prompt mode. Each comes with an answer key the agents never see; AvA checks each agent's final `ANSWER:` line when both have answered.
  - **Result card:** each agent's answer, right or wrong, and its time. The winner is the right answer, or the faster one if both are right.
  - **Ten built-in prompts** replace the earlier two Prompt starters (unedited copies are removed): six challenges and four races, every answer computed by program.
  - **The Prompt builder** sets up your own: the task, the answer form, and the hidden expected answer. The library editor has an Answer key section too.
- **One thread per Prompt run.** The next prompt gives both agents fresh sessions (clean context) with the same settings.

### Changed

- **Settings.** The Resources button is now **Settings**, with a gear icon, at the right of the sidebar's tools row.
- **No visible restart between threads.** A new Prompt run or debate no longer closes and reactivates the agents. Each fresh session starts beside the current one and takes over once it's ready, so the agents stay loaded and Ready, and a fresh session that fails leaves the current one in place.
- **Thread titles** use a prompt's heading ("Day of the week", or a debate's motion) instead of the raw Markdown.

## [0.4.3](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.4.3) - 2026-10-03

### Added

- **Formal debates.** Debates now run like competitive debates.
  - **Sides:** each agent argues an assigned side, Agent 1 for the motion and Agent 2 against unless you swap them.
  - **Briefs:** before the debate starts, each gets a private brief through its 1:1 line (the motion, its side, the format, how it will be judged, and your notes for it) and replies READY.
  - **Speeches:** an opening case, rebuttals that answer the other side's strongest point, then a closing, with evidence asked for and invented facts forbidden.
- **An independent judge.** When a debate completes, a fresh session of the strongest model at its highest effort scores each side.
  - **Who judges:** Claude Code (Opus at max effort) by default, or Codex, or none.
  - **The score:** 1 to 5 each for factual accuracy and evidence, for challenging the opposition's strongest points, and for a cohesive stance, then a winner with reasons and any claims it questioned.
  - **Blind and on demand:** the judge never sees the briefs or which CLI argued which side. **Judge this debate** and **Judge again** ask it on demand.
- **A time limit per speech** (2 minutes by default; set in Options or a debate prompt). It counts thinking, web searches and writing together. A speech that runs over is cut off and forfeited, the debate goes on, and the judge sees the forfeit.
- **The prompt builder:** the third button in the sidebar.
  - **In Debate,** a guided form sets up a formal debate: the motion and its definitions, which side each agent argues, a private brief for each side, internet, rounds and speech time. Grey hints in each box say what to write and disappear as you type.
  - **Saving and editing:** it saves to the prompt library and can open any saved debate to edit.
  - **Prompt and Build** have simple forms for now.
- **Each debate is its own thread.** A debate started after another in the same thread first gives both agents fresh sessions, so neither remembers the last one. The thread keeps the judge's ballot for review, and the thread list shows the result ("Agent 2 won 14–10").
- **Delete a thread** from history with the button that appears when you point at it. It removes the thread's prompts, replies, 1:1 messages and ballot, after a confirmation. A thread whose agents are still active must be closed first.
- **Ten formal motions** replace the built-in debates, each with briefs for both sides. Earlier debate starters you never edited are removed.
- **A rounds chip beside the message box** in Debate shows how long the next debate runs ("7 rounds", or the time or choice that ends it instead).
  - **Changing it:** click it to pick 3, 5, 7, 9, 11 or 15 rounds, or type another number.
  - **Rounds win:** picking rounds also overrides a time written in the prompt.

### Changed

- **Debates default to 7 rounds.**
- **Shutting down during a debate's briefs** no longer waits for them.

## 0.4.1 - 2026-10-03

Not released on its own; included in v0.4.3.

### Added

- **Quick activate.**
  - **Where:** each agent's header in the room, **Quick activate both**, and a choice in the `/ava CLI1` and `/ava CLI2` menus.
  - **What it uses:** the settings that agent last activated with (CLI, model, effort, speed, permissions and internet), in any room.
  - **The first time:** the CLI's strongest model at high effort, with Ask permissions and internet off.
- **The version in the room,** beside its title.
- **Updates take effect.** A newer plugin now replaces an older AvA service once nothing is running in it. Before, the hosts kept using the older service after an update for as long as any host was open.

### Changed

- **Speed reads Default or Fast.**
- **Models show their name and version,** for example "Opus 5.5" instead of "opus", in the menus, above each agent and in exports.

## 0.4.0 - 2026-10-03

Not released on its own; included in v0.4.3.

### Added

- **The debate prompt template.** Every Debate prompt in the library has:
  - the topic both agents see;
  - for each agent, private context that only it sees and an internet on or off choice;
  - the number of rounds.
- **Using a debate prompt.** Loading or running one sets up the next debate, and each agent's internet switches when it starts.
- **Options matches the template,** including an internet choice per agent. Use current draft saves the room's debate options as a prompt.
- **Export and import.** Export Markdown writes the whole template in one file, and Import reads it back.
- **Ten built-in debates that last,** each giving every agent a side or a role with private facts:
  - Ban cars downtown?
  - Monolith or microservices?
  - Vikings: offensive line or secondary?
  - Did the Industrial Revolution help workers?
  - Bring back the woolly mammoth?
  - Will AI write most code by 2030?
  - Negotiate a used car
  - The museum interrogation
  - Pitch a skeptical investor
  - Is a hot dog a sandwich?
- **Existing libraries get the new debates once.** The two old debate starters are replaced only if they were never edited.
- **Close thread.** In the thread's header, or ⋯ → Close thread.
  - It stops the conversation, closes both agents and any app server they left running, and keeps the thread in history.
  - Both agents keep their settings, and **Activate both** starts the next thread with one short check each.
- **One thread history across modes,** each thread labeled with its mode.
  - Each mode keeps its own thread and agents in the room. Switching to Build after a debate opens a clear Build screen, and the debate stays as it was until you close it.
  - A mode used for the first time starts with the same agent settings.
- **Change an agent's CLI at any time.** The chosen CLI's name stands beside Activate, and the setup menu has **Change CLI**.
- **Prompt library tabs** for Prompt, Debate and Build prompts, opening on the current mode.
- **Cursor's agent, as a preview.**
  - AvA starts Cursor's bundled runtime itself, with its own Cursor settings: nothing runs without asking, web searches ask, and commits aren't attributed to Cursor.
  - `/ava doctor` shows Cursor's version, sign-in and plan.
  - On a Cursor Free plan, Cursor refuses agent requests, and activation says so. Live checks on a paid plan are still to come.

### Changed

- **A debate runs for a set number of rounds,** 8 by default, set in Options.
  - The agents can no longer end it early by agreeing.
  - Each turn tells the agent which round it is, and the last round is a closing statement.
  - The status line shows the round.
  - A timed prompt ("…for 5 minutes") still runs for its time, and Options can still end it when either or both agents are done.
- **Debate gives your topic to both agents at the start.** Agent 2 reads it while Agent 1 opens (one extra short request; its READY isn't posted), then answers the opening.
- **Debate turns are asked to be short and conversational,** in plain text, instead of a word count.
- **Setup window:** it closes after a successful activation. Speed reads Fast or Normal, and every unchanged setting reads Default.
- **Usage ring:** it fills in with the activation check where the CLI reports usage (Codex, Claude Code). Grok Build and Antigravity, which never report it, say so.

## [0.3.5](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.3.5) - 2026-10-03

### Fixed

- **Securing secrets no longer waits on Windows PowerShell's module scan.** AvA secured `server.json` and its secrets folder with PowerShell cmdlets.
  - **The problem:** with no module cache, as in a new profile or a fresh LOCALAPPDATA, each call first scanned every installed module. On a machine with many modules that took over 10 seconds a call, so the service couldn't start in time.
  - **The fix:** secrets are now secured with .NET calls alone, and so is the check of when a process started. PowerShell loads no modules for either.

### Development

- **Smoke tests:** a service that neither starts nor fails is now diagnosed. The smoke test lists the service's processes and times PowerShell in the host's environment. It also reports how long the service took to start.
- **Browser tests:** the two benchmark scenarios get 90 seconds. With the 20-task suite they took 32 seconds on CI.

## [0.3.4](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.3.4) - 2026-10-03

### Fixed

- **Rubric judges grade each attempt in a fresh session.** The judge no longer sees earlier attempts, or the other agent's answer, while it scores. Each judged attempt now takes two requests: the new session's access check and the judgment. The request ceiling counts both, and `npm run bench -- run --judge` logs it before starting.
- **A judge's score is found among the other text in its reply.** Braces before or after the JSON object no longer cost the score.
- **Review prompts leave out files that may hold secrets.** `.env` files, private keys and credential files, along with build output, are no longer pasted into the prompt. The prompt names them instead, and they stay in each agent's copy. Large files are measured before they're read, and a file that can't be read just means the files aren't inlined.
- **Docker checks:**
  - A warning that Docker prints no longer makes a working Linux engine look like Windows containers.
  - A data folder with a comma in its path now mounts correctly.
  - The Benchmarks panel runs one Docker check at a time.
- **Process containment:**
  - The service no longer stops if its job helper exits while a request is on its way.
  - An agent's job ends as a whole unless one of its own processes is being kept. Previously, kept app servers that had since stopped prevented that.
  - No start signal is left behind for a launcher that has already exited.
- **A verifier's temporary folder** is removed after it has exited, and never fails or stalls the check.
- **Starting the service:** an owner that stops while a command is waiting for it is now replaced at once, instead of after the full wait.
- **Shared reports** replace the data and home folders whatever case, slashes or short name a check used.
- **Imports** check every task before writing any. A bad or repeated entry leaves the suite as it was, and odd exercise names no longer crash the title.

## 0.3.3 - 2026-10-03

### Fixed

- **The first `/ava` command after an install waits for a slow start.** Since 0.3.1, the service loads the engine when it first starts, so it reads the engine's files for the first time while antivirus scans them. On a slow machine that can take longer than the 15 seconds AvA waited, and the command failed with `did not become ready`.
  - AvA now waits up to 45 seconds for a service that's still starting. A service that fails is still reported as soon as it stops.
  - The packaged-plugin smoke tests print why a check failed, including the end of the service log.

## [0.3.2](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.3.2) - 2026-10-03

### Fixed

- **The service starts when AvA runs as an administrator** on a data folder where your account holds only Modify rights, such as one on a second drive.
  - **Cause:** an elevated process's new files belong to the Administrators group. Replacing that owner and the permissions in one step needed a right the account lacks there.
  - **Fix:** AvA now restricts the permissions first, then takes ownership.
  - Found by the Windows CI run of v0.3.1.

## [0.3.1](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.3.1) - 2026-10-03

### Fixed

- **The host connects to AvA faster.** The MCP server answers the host without loading the engine, which now loads only in the background service.
  - Before, the MCP server read about 550 files before answering, so a freshly installed copy could take seconds to connect. On a busy machine it could exceed the host's 30-second limit.
  - It now reads about 250.

## 0.3.0 - 2026-10-03

### Added

- **Rubric scores for benchmarks:** a task can carry a `rubric`, and a job can name a judge: `--judge provider:model` in the CLI, or `judge` in `bench.start`.
  - **Scoring:** the judge, a third agent, scores each attempt at a rubric task from 0 to 10, with a reason.
  - **Separate from the verdict:** the score is saved apart from the checks with the judge's identity, and it never changes pass or fail. Reports show it beside the verdict.
  - **Starter tasks:** seven have rubrics, the five Review tasks and the two pages.

### Fixed

- **Codex can review projects under Ask.** Codex reads files only through commands, which Ask refuses, so it failed every starter Review task.
  - A small project's files (up to 40 files and 64 KB of text) now come with the Review prompt, numbered by line.
  - In a live rerun, Codex and Claude Code each passed all 5 Review tasks.
## 0.2.9 - 2026-10-03

### Added

- **Import benchmark tasks:** `npm run bench -- import <source> --format exercism|jsonl --out <suite>`.
  - **Exercism JavaScript exercises:** one or a folder of them. Their Jest-style tests run through a small built-in shim.
  - **JSON Lines, "prompt plus tests":** one task per line.
  - **Container only:** imported tasks are marked for container isolation, so their tests run only in Docker.

## 0.2.8 - 2026-10-03

### Added

- **Benchmark reports you can share.** A finished job saves as a standalone HTML page or as Markdown, from the Benchmarks panel or with `npm run bench -- report <job-id> --format html|md --out <file>`.
  - **Contents:** each agent's pass rate and pass@k, time and tokens; each task's result per agent; and every check's evidence.
  - **Safe to share:** no room link or token, and local paths are replaced.

## 0.2.7 - 2026-10-03

### Added

- **20 validated starter benchmark tasks,** up from 3. Each reference solution passes and an empty attempt fails.
  - **Prompt (8):** exact-answer reasoning and extraction.
  - **Build (7):** small modules and a page, graded by hidden tests that cover edge cases and invalid input.
  - **Review (5):** two planted bugs each, one of them a path-traversal security bug.
  - The full list is in the [benchmark guide](docs/benchmarks.md).

## 0.2.6 - 2026-10-03

### Added

- **Container isolation for benchmark tasks you don't trust.** A task with `isolation: container`, or every task with `AVA_VERIFIER_BACKEND=container`, runs its hidden tests in Docker, never on the host.
  - **The container:** no network, a read-only root with a small writable `/tmp`, no capabilities or privilege escalation, limits on processes, memory and CPU, a non-root user, and the attempt mounted read-only.
  - **The image:** `node:24-alpine`, pinned by digest. AvA never downloads it.
  - **Records:** results and validation receipts name the backend and the image.
  - **Without Docker's Linux engine or the image:** such tasks are refused before any agent starts, with what's missing.

## 0.2.5 - 2026-10-03

### Added

- **Agents run in Windows job objects.** Each agent, and everything it starts, is held from its first instruction. A launcher waits until AvA has placed it in the agent's job before it starts the agent.
  - **Lineage:** AvA also follows what Windows starts outside the job. Seen live with Codex: it runs commands in PowerShell 7 from the Microsoft Store, whose processes Windows keeps out of other jobs.
  - **Build cleanup** stops background processes an agent left running, even after their parent has exited.
  - **Closing an agent** stops everything left in its job, except the app servers its Build runs kept.
  - **Activation** says whether the agent is contained.
  - **Off switch:** `AVA_JOB_OBJECTS=off`. If the job helper can't start, agents start uncontained, with a note.

## 0.2.4 - 2026-10-03

### Added

- **Live Build benchmarks, with a verifier guard.** Tasks whose hidden tests run the agent's code now run live, on a Node that can deny network access (Node 26 can).
  - **What runs under it:** the tests, and the code they import.
  - **Allowed:** reading the attempt's files, and writing a throwaway temp folder.
  - **Refused:** processes, worker threads, add-ons and network access; writing outside the temp folder; and reading outside the attempt.
  - **Recorded:** each refusal as the check's reason, and whether each check ran guarded.
  - **Not a sandbox:** it guards against accidents, not hostile code, so validate only task bundles you trust.
  - **Off switch:** `AVA_VERIFIER_GUARD=off` turns it off, which blocks live program verifiers again.
- **Validate again:** existing validations are from the previous checker version, so validate tasks again before running them.

## 0.2.3 - 2026-10-03

### Changed

- **MCP SDK 1.32.0** (from 1.31.0). Its changes affect web-based transports and add options that stay off unless set; AvA uses the local stdio transport.
- **Development:** jsdom 30 for the tests (development needs Node 24.15 or newer), and `scripts/upkeep.ts`, a monthly dependency and CLI check with an optional live activation per provider.

## 0.2.2 - 2026-10-03

### Changed

- **A service that can't start says why, in seconds.** The plugin now answers the host's startup handshake straight away and starts AvA's background service on its own. If the service fails, the next `/ava` command reports its reason, for example which file couldn't be secured, as soon as the service exits. Before, the host waited and then reported a 30-second timeout with no reason. Once the cause is fixed, the next command starts the service; the host needn't be restarted.
- **`/ava doctor` checks the data folder:** that it takes writes, and that secrets written there can be restricted to your account. When the service can't start, `/ava doctor` still answers with the reason and that check.

## 0.2.1 - 2026-10-03

### Fixed

- **The service starts with a data folder on a second drive.** Securing `server.json` and the Gateway key no longer tries to take ownership the account already has. Below a drive root other than the system drive, Windows gives the owner Modify rights without the right to change ownership, so every start failed with "Could not restrict the private file to your Windows account" and `/ava` timed out in both hosts. The error now also names the file and Windows' reason.

## [0.2.0](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.2.0) - 2026-10-03

The first stable release and the starting point for future releases. Earlier 0.1.x tags are development history.

### Included

- Plugins for the **Codex and Claude Code hosts**, sharing one local service, conversation pool and browser room.
- Two independently configured agents from **Codex CLI, Claude Code, Grok Build, Antigravity or Vercel AI Gateway**. Either host can use any supported combination.
- **Prompt**, **Debate** and **Build** modes, including code review, separate project copies, app previews and change comparisons.
- A shared **prompt library** with six editable starters, Markdown import/export, and attached-file management in all three modes.
- Selected Debate opener, alternating turns, pause/resume, queued operator messages and private 1:1 lines.
- Validated benchmark task bundles, deterministic checks, repeated runs, durable results, a scoreboard, pass@k, filters and JSON/CSV exports. Three starter tasks cover Prompt, Build and Review.
- Resizable panes, searchable threads, replay, exports and usage statistics. Resources displays agent capacity and memory, with a configurable activation limit and Stop all.
- Authenticated loopback, owner-only Windows secret permissions, inherited MCP-server isolation, idempotent commands and explicit recovery for uncertain work.
- **Ask** refuses shell, interpreter and process-control requests, including commands that also name a valid workspace. Scoped file tools remain available in Build. **Bypass** is explicitly unrestricted.
- Setup diagnostics with `/ava doctor`, Windows / Node 24 CI, automated browser checks, and source packaging for both hosts.

### Known limits

- Windows only; Node.js 24 or newer is required. Installation builds the plugins from source.
- AvA has no common operating-system sandbox. Provider-side permissions can operate outside its tool gate.
- Live benchmark tasks with program verifiers are blocked pending execution isolation. The expanded task suite, rubric judging and format importers remain planned.
- Interrupted or uncertain work is not automatically retried. Some Gateway models may fail activation through the Codex adapter.

See the [release notes](docs/release-v0.2.0.md) and [validation record](docs/validation.md) for the tested scope and retained failures.
