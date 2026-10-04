# Changelog

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
