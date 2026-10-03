# Agent vs Agent roadmap

The plan from **0.2.1** (2026-10-03). Shipped features are in the [changelog](../CHANGELOG.md); what was tested is in the release notes ([v0.3.1](release-v0.3.1.md), [v0.2.0](release-v0.2.0.md)) and the [validation record](validation.md). Earlier plans remain in Git history.

Work one item at a time, starting with `next`. An item is done when its "Done when" holds and it is committed. Gates: `offline` means no provider requests; `live` needs a bounded request plan; `user` needs the owner's decision or action. Statuses: `next`, `todo`, `in progress`, `done`, `blocked: <why>`.

## Where things stand

- **Published:** v0.3.1 (2026-10-03), the first release after the v0.2.0 baseline. Its [release notes](release-v0.3.1.md) record what was tested.
- **Phases A to C are done:** reliable installs, confined benchmark execution, and benchmarks worth sharing. Both hosts run 0.3.1 (H8).
- **Shipped:**
  - Prompt, Debate, and Build and Review, with private 1:1 lines, history, replay, stats and previews.
  - Validated benchmark tasks, deterministic checks, saved attempts, a scoreboard and exports.
  - A prompt library, Resources and Stop all.
  - Ask-mode refusal of command execution.
- **Toolchain:** ACPX 0.19.4, codex-acp 2.1.1 and claude-agent-acp 0.85.1 are the latest releases, and AvA uses them. Codex 0.160 and Claude Code 2.1.287 pass; Claude Code 2.1.288 is out.
- **Tests:** 236 offline tests, 7 browser scenarios and smoke tests of both plugins. The v0.2.0 acceptance run used 99 live requests across all five providers.
- **Benchmarks:** 20 validated starter tasks. In the full live run, Claude Code passed 20 of 20. Codex passed all 20 once the Review tasks came with their files.

### What changed the plan

1. **Testing never ran the plugin the way users do.** The 0.2.1 crash went unnoticed through two releases. Tests used temporary folders inside the user profile, where the account has full rights, and a failed service start reached the hosts only as a 30-second timeout. Phase A closes that gap.
2. **Benchmarks are the headline, but they're half-blocked.** Prompt tasks run live. Build tasks need the candidate program and its hidden tests to run, and that stays blocked until execution is confined. Isolation (Phase B) now comes before expanding the suite (Phase C).
3. **Confining a verifier is now cheap.** Node's permission model blocks file, child-process, worker and network access unless they're granted (`--permission`, with `--allow-net` in current Node releases such as Node 26). It's a guard against accidents, not against hostile code. That's enough for trusted task bundles. Imported or untrusted tasks still need a container.
4. **More agents cost less than planned.** ACPX 0.19.4's registry already starts more ACP agents, among them Cursor's agent, Gemini CLI, GitHub Copilot, Kimi Code and Factory Droid.
5. **Host parity is a rule.** Features go into the shared core and the browser room, so Codex and Claude Code get the same commands and capabilities. Extensions for one host only, such as Claude Code mods, aren't planned.

## Phase A — reliable installs (0.2.x)

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| H1 | Start with a data folder on a second drive (secret permissions no longer take ownership) | offline | done |
| H2 | Install 0.2.1 in both hosts and confirm the service starts on the shared data folder | user | done |
| H3 | Publish 0.3.1 | user | in progress |
| H4 | Service start failures reach the host with their reason (0.2.2) | offline | done |
| H5 | Test the plugin the way the hosts run it | offline | done |
| H6 | Upkeep: dependency and CLI updates on a schedule | offline + live | done |
| H7 | A light MCP handshake: the host connects before the engine loads (0.3.1) | offline | done |
| H8 | Install 0.3.1 in both hosts and confirm they connect | user | done |

- **H3 Publish 0.3.1.**
  - The owner ended local-only development on 2026-10-03 to publish this release.
  - Export the public commit, tag `v0.3.1`, and push with the owner's go-ahead.
  - Update the README's clone tag, and create the GitHub release page.
  - *Done when* the release is public and CI passes on it.
- **H4 Visible start failures.**
  - The MCP server completes the host's handshake first, then starts the service.
  - It stops waiting as soon as the service process exits.
  - Tool calls, and `/ava doctor`, return the service's own error (for example, which file couldn't be secured and why), instead of the host reporting a timeout.
  - `/ava doctor` also checks the data folder: writable, and able to secure secrets.
  - *Done when* a deliberately broken data folder produces that message in both hosts within a few seconds.
- **H5 Tests that run like the hosts.**
  - Smoke tests (and CI, when pushing resumes) also use a data folder where the owner holds only Modify rights, outside the user profile.
  - A launch check starts each packaged MCP server the way its host does (Codex with its environment allow-list, Claude Code with the full environment) and asserts the handshake well inside the hosts' 30-second limit.
  - A check confirms that the installed copies match the build.
  - *Done when* the 0.2.0 bug fails these checks and 0.2.1 passes them.
  - **Done 2026-10-03.** Both builds were made from their own commits, and the new smoke tests compared:
    - 0.2.0 fails "the MCP server starts" for both hosts, with the original `PRIVATE_FILE` error in its log.
    - 0.2.1 passes the host-style launch and the Modify-only folder, and fails only H4's later broken-folder check.
    - 0.2.2 passes everything.
  - `scripts/verify-installed.ts` matched both installed 0.2.2 copies to the build.
- **H6 Upkeep.**
  - Each month, or when an adapter releases: `npm outdated` and the adapters' release notes, then smoke tests and one activation per provider.
  - Raise CLI minimums only when an adapter requires it.
  - Pending now: MCP SDK 1.32 and jsdom 30 (development only).
  - *Done when* the first pass is recorded and the update steps are in `CONTRIBUTING.md`.
  - **First pass, 2026-10-03 (0.2.3):**
    - Updated: MCP SDK 1.31.0 to 1.32.0, and jsdom 26 to 30.
    - The adapters (ACPX 0.19.4, codex-acp 2.1.1, claude-agent-acp 0.85.1) are current, and their latest releases leave the minimums at Codex 0.159.1 and Claude Code 2.1.286.
    - Installed: Codex 0.160.0, Claude Code 2.1.287 (2.1.288 available), Grok Build 1.0.46, Antigravity 3.14.7.
    - Checks: 220 offline tests, 7 browser scenarios, and both smoke tests passed.
    - Live: one activation each passed (Codex 6.1 s, Claude Code 7.1 s, Grok Build 13.2 s, Antigravity 21.1 s, Gateway 5.6 s). The first live run stopped at the Gateway because the script left checked agents running against the 4-agent limit; it now stops each agent after its check.
    - Next pass: early November 2026, or at the next adapter release.
- **H7 Light MCP handshake.**
  - **Found 2026-10-03:** Claude Code reported the installed 0.2.2 MCP server timing out (30 s) while a live benchmark was running.
  - **Cause:** the MCP process loaded the whole engine (549 files, including ACPX) before it could answer. A fresh install answered in 6.4 s, because its files are read slowly the first time, and under load it ran out of time.
  - **Fix:** the engine and the room load only in the background service. The MCP process loads 252 files, all of them its own and the MCP SDK's.
  - **Test:** a test fails if the MCP process loads an engine, room or provider module before its handshake.
- **H8 Install 0.3.1.**
  - Package to `release/`, run both smoke tests, update both hosts, then run `verify-installed.ts` and `verify-host-hook.ts`.
  - Touches the owner's Claude Code and Codex profiles, so it waits for their go-ahead.
  - *Done when* both installed copies match the build and each host's `/ava doctor` answers.
  - **Done 2026-10-03:**
    - Both release builds passed their smoke tests, and both hosts updated from 0.2.2 to 0.3.1. Each installed copy matches the build, and the Codex prompt hook is still trusted.
    - Launched as its host launches it, each installed copy completed the handshake in about 0.24 s. `/ava doctor` answered on the shared data folder, and the shared service now runs 0.3.1.

## Phase B — confined benchmark execution (0.3.0)

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| X1 | Run Node verifiers under Node's permission model (0.2.4) | offline + live | done |
| X2 | Choose the isolation backend for untrusted work | user | done |
| X3 | Start agents inside a Windows job object (0.2.5) | offline + live | done |
| X4 | Container backend for untrusted verifiers (0.2.6) | offline + live | done |

- **X1 Verifier guard.**
  - Run `run:` checks with `node --permission`, with read access only to the attempt copy and the verifier, write access only to a scratch folder, and no child processes, workers, add-ons or network.
  - Where the installed Node lacks `--allow-net`, live program verifiers stay blocked.
  - Only bundles marked trusted are allowed: the shipped suite, and tasks the user writes.
  - The docs describe this as a guard against accidents, not a sandbox.
  - *Done when* verifiers that try to read or write outside, spawn a process or open a connection fail with a recorded permission error, and the starter Build task passes live on two providers.
  - **Done 2026-10-03.**
    - **Refusals:** tests cover eight refusals, each recorded as "Blocked by the verifier guard": reading outside, writing into the attempt, writing outside, a child process, a worker, a connection, fetch and listening.
    - **Allowed paths:** importing and reading the attempt, and writing the temp folder.
    - **Trust:** a task bundle is trusted when you validate it in your pool; validation runs its verifier.
    - **Live:** `tip-calculator` passed on Codex (gpt-6-astra) and Claude Code (default model), with both verifiers guarded, in 4 participant requests.
- **X2 Isolation decision** (owner), with a recommendation. The options:
  - **Containers** through Docker Desktop or WSL2: the strongest option, but an extra install. Recommended as the opt-in backend for imported and untrusted tasks.
  - **A dedicated low-privilege Windows account:** native, and works on Windows Home, but complex to set up and maintain.
  - **Job objects only:** contain processes, not files or network.
  - **Decided 2026-10-03 (owner): containers, through Docker**, as an opt-in backend.
    - **How it works:** AvA uses Docker Desktop's Linux engine, which runs on WSL2 and works on Windows Home. It detects the `docker` command and a running engine. Without them, untrusted tasks are refused with how to enable them. Trusted (validated) tasks keep the X1 guard.
    - **Not chosen:**
      - WSL2 on its own: it sees the Windows drives and shares the network by default, so it isn't isolation without a setup of its own.
      - A dedicated Windows account: it needs administrator rights to create, and it's hard to keep working.
      - Job objects alone: X3 adds them for process control, but they confine neither files nor network.
    - **Starting design for X4:** `docker run --rm --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 512m --cpus 1 --user node -v <attempt>:/work:ro -w /work node@<pinned digest> node tests/<verifier>`.
      - **Image:** pinned by digest, and downloaded once with the user's OK.
      - **Records:** each result names the backend and the image digest.
    - **On the development machine:** the Docker Desktop 29.8 command is installed. Its engine only runs while Docker Desktop is open, and WSL2 is present.
- **X3 Job-object launcher.**
  - Start each agent suspended, attach it to a job, then resume it, as concluded in the [job-object evaluation](windows-job-objects.md).
  - Leftover processes are then always found and stopped, and a memory limit becomes enforceable.
  - Previewed app servers are kept deliberately.
  - *Done when* every provider passes activation, cancellation and Build cleanup with it on, and it becomes the default.
  - **Done 2026-10-03, on by default.**
    - **Launch:** instead of a suspended start, ACPX starts a launcher that waits until AvA has assigned it to the job.
    - **What testing found:** Codex runs commands in PowerShell 7 from the Microsoft Store. Windows starts Store apps outside the caller's job and won't add them to another. So the job helper also keeps each job's lineage: a 100 ms process snapshot, with start times.
    - **Live (`scripts/live-jobs.ts`):** all five providers passed activation in jobs, a run stopped mid-answer, a Bypass Build whose detached background processes the cleanup stopped, and Stop all leaving nothing running. The Gateway's first attempt failed one activation (its model gave no usable reply) and passed on retest.
    - **Memory limit:** possible now (the helper takes one), but not yet a setting.
- **X4 Container verifiers.**
  - Run untrusted verifiers, and later Terminal-Bench-style tasks, in a container with no network and only the attempt mounted.
  - It's optional: AvA detects whether the backend exists, and blocks untrusted tasks without it.
  - *Done when* an imported task runs confined and the validation receipt names the backend.
  - **Done 2026-10-03.**
    - **Opt-in:** a task opts in with `isolation: container`; B8's importers will set it.
    - **Real-engine test:** a verifier passes in the container, while the network, writing the attempt and a fork bomb are contained. A container copy of the tip calculator validates there, with a receipt that names `container` and the image digest.
    - **Live:** both agents' builds (Codex gpt-6-astra, Claude Code) passed their hidden tests in containers, in under a second each, using 4 requests.

## Phase C — benchmarks worth sharing (0.3.x)

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| B5 | About 20 validated tasks across Prompt, Build and Review (0.2.7; Review fix 0.3.0) | offline + live | done |
| B9 | Suite reports you can share (0.2.8) | offline | done |
| B7 | Optional model-graded rubric score (0.3.0) | offline + live | done |
| B8 | Import common benchmark formats (0.2.9: Exercism and JSON Lines) | offline | done |

- **B5 Starter suite.**
  - Exact-answer reasoning and extraction, small apps with hidden tests (after X1), and reviews with planted bugs.
  - Each task's reference solution passes and an empty attempt fails.
  - *Done when* the suite validates and one full live run on two providers is recorded.
  - **Done 2026-10-03:**
    - **Full live run** (80 requests): Claude Code passed 20 of 20. Codex (gpt-6-astra) passed 15: it failed every Review task because it could read the project only through commands, which Ask refuses.
    - **Review fix (0.3.0):** a small project's files (up to 40 files and 64 KB) now come with the Review prompt, numbered by line. In the live rerun of the 5 Review tasks, Codex and Claude Code both passed 5 of 5.
- **B9 Reports.**
  - A standalone HTML and Markdown report of a suite run: pass or fail per task and agent, pass@k, duration and tokens, with the evidence for each check.
  - Shareable without the room or any token.
- **B7 Rubric score.**
  - A third agent grades against a rubric. The judge's identity and score are saved separately.
  - The score never changes the deterministic verdict.
  - **Done 2026-10-03:**
    - **Opt-in:** a task opts in with a `rubric:`, and a run names a judge: `--judge provider:model` in the CLI, or `judge` in `bench.start` (not yet in the Benchmarks panel).
    - **Scoring:** the judge scores each attempt from 0 to 10 with a reason. Reports show the score beside the verdict.
    - **Live:** a Gateway judge (openai/gpt-5.6-luna) scored all 10 Review attempts, using 31 requests in all.
- **B8 Importers.**
  - Prompt-plus-tests (HumanEval or MBPP style) and project-plus-tests (Exercism or Aider style) first.
  - Container tasks after X4; repository-repair datasets (SWE-bench style) later.
  - **Done 2026-10-03 for the first two:**
    - **Exercism JavaScript exercises:** Jest-style tests through a built-in shim.
    - **JSON Lines prompt-plus-tests:** one task per line.
    - **Imported tasks** are container-isolated. Tests validate an imported exercise inside Docker.
    - **Still planned:** Terminal-Bench-style container tasks and SWE-bench-style repositories.

## Phase D — reach (later; versions assigned when scope is accepted)

| ID | Item | Dependency or boundary |
| --- | --- | --- |
| F3 | More agents from ACPX's registry: Cursor's agent first, then Gemini CLI, Copilot and others on demand | Each passes the adapter checklist: activation, permissions, cancellation, usage reporting, and isolation from the user's own configuration |
| F2 | Tournaments and leaderboards across many models | Saved results (done); Debate judging needs B7 |
| F5 | Usage and cost per run and suite, including Gateway spend | Usage data already reported |
| F6 | Prebuilt download or marketplace listing | Review the dependencies' redistribution terms first |
| F4 | macOS and Linux | Service lifecycle, process tracking, packaging and CI per platform |
| F8 | The room inside the host | Only through a mechanism both hosts support (for example MCP Apps), per host parity |
| F7 | Games and scenarios | A separate referee owns the state and validates actions before messages are forwarded |

- **F3 proposed scope** (awaiting the owner's acceptance):
  - Cursor's agent through ACPX's registry entry (`cursor-agent acp`). Version 2026.09.28 is installed on this machine, as a `.cmd` and `.ps1` shim in `%LOCALAPPDATA%\cursor-agent`. Gemini CLI and Copilot aren't installed.
  - It passes the adapter checklist: activation through the login route, Ask refusing commands, cancellation, usage reporting, and isolation from the owner's own Cursor settings. Its process tree also stays inside AvA's job objects, shim included.
  - Live checks would use the owner's Cursor plan, which isn't among the four pre-approved subscriptions, so they need the owner's OK.

## Standing decisions

- **One core, thin wrappers:**
  - the Codex prompt hook and the Claude Code `/ava` skill only route commands;
  - the logic and the room live in the shared core.
- **The four CLIs use their own subscription logins;** only the Vercel AI Gateway uses an API key.
- **Work whose outcome is unknown is never resent.**
- **The benchmark verdict is deterministic.** Model-graded scores are kept separate.
- **Isolation for untrusted work is a container,** through Docker, opt-in (X2). Trusted tasks use Node's permission guard (X1).
