# Agent vs Agent roadmap

The plan from **0.2.1** (2026-10-03). Shipped features are in the [changelog](../CHANGELOG.md); what was tested is in the [unreleased source notes](release-unreleased.md) and release notes ([v0.4.6](release-v0.4.6.md), [v0.2.0](release-v0.2.0.md)) and the [validation record](validation.md). Earlier plans remain in Git history.

Work one item at a time, starting with `next`. An item is done when its "Done when" holds and it is committed. Gates: `offline` means no provider requests; `live` needs a bounded request plan; `user` needs the owner's decision or action. Statuses: `next`, `todo`, `in progress`, `done`, `blocked: <why>`.

## Where things stand

- **Local development resumed (2026-10-04):** The owner selected the latest local commit, `11649e6`, as the baseline. Work continues locally on `codex/local-dev-11649e6`. The owner approved the five Phase K improvements on 2026-10-05, including J6’s speed/quality decision (K4).
  - **Baseline verified:** typecheck, build and all 332 offline tests passed, with no skipped tests.
- **Latest published release:** [v0.4.6](release-v0.4.6.md), released 2026-10-04. Crosscurrent and Phase K are documented as [unreleased source](release-unreleased.md). The owner requested a GitHub source snapshot on 2026-10-05, explicitly without a release or tag.
- **Phases A to C are done:** reliable installs, confined benchmark execution, and benchmarks worth sharing.
- **Shipped:**
  - Prompt, Debate, and Build and Review, with private 1:1 lines, history, replay, stats and previews.
  - Validated benchmark tasks, deterministic checks, saved attempts, a scoreboard and exports.
  - A prompt library with builders, Settings and Stop all.
  - Ask-mode refusal of command execution.
- **Toolchain:** ACPX 0.19.4, codex-acp 2.1.1 and claude-agent-acp 0.85.1 are the latest releases, and AvA uses them. Codex 0.160 and Claude Code 2.1.287 pass; Claude Code 2.1.288 is out.
- **Current local verification:** 391 offline tests and 19 browser scenarios passed for Phase K. Published-release checks remain recorded in their release notes; the source snapshot receives separate clean-export and hosted CI checks.
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
| H3 | Publish 0.3.1 (with the 0.3.2 to 0.3.5 fixes) | user | done |
| H4 | Service start failures reach the host with their reason (0.2.2) | offline | done |
| H5 | Test the plugin the way the hosts run it | offline | done |
| H6 | Upkeep: dependency and CLI updates on a schedule | offline + live | done |
| H7 | A light MCP handshake: the host connects before the engine loads (0.3.1) | offline | done |
| H8 | Install 0.3.1 in both hosts and confirm they connect | user | done |

- **H3 Publish 0.3.1.**
  - The owner ended local-only development on 2026-10-03 to publish this release.
  - **2026-10-03:**
    - v0.3.1 was pushed with its tag and release page. Its CI run failed one test, the H1 test for a folder where the account holds only Modify rights.
    - **Why:** the hosted runner runs elevated, so new files belong to the Administrators group. Replacing that owner in the same write as the permissions needs WRITE_OWNER, which Modify lacks.
    - **Fix (0.3.2):** the permissions are written first, then the owner. A forced check in a Modify-only folder reproduced the error with the old single write and passed with the new order.
    - **v0.3.2's CI run:** the tests and browser scenarios passed. The Codex smoke test then failed: the service, started from the freshly packaged copy, was neither ready nor stopped after the 15 s wait.
    - **Most likely cause:** since H7, the service is the first process to read the engine's files, cold. Here that takes about 5 s, against about 0.4 s warm, and a hosted VM with antivirus scanning is slower.
    - **Fix (0.3.3):** the wait is now 45 s (Codex allows a tool call 60 s), and the smoke test prints the failure detail and the end of the service log.
    - **Held:** v0.3.3 is committed and exported locally, with its tag, but not pushed. The owner chose to hold it (2026-10-03). H3 is done once a pushed release passes CI.
    - **0.3.4:** fixes for all 15 findings of a code review of the work since v0.2.0, plus a suite that was loaded twice per start. Published as v0.3.4, which includes 0.3.3; v0.3.3 itself was never released. Checks: 242 offline tests, 7 browser scenarios and both smoke tests. A live run used 8 requests: both agents passed a Review task, and a Gateway judge scored each attempt in a fresh session.
    - **v0.3.4's CI run:** the Codex smoke test failed again, this time with an empty service log after 45 s.
    - **Diagnosis:** a diagnostic run on a temporary branch showed that securing one secret in the Codex host's environment took 22.6 s on the runner. The smoke test gives each plugin a fresh LOCALAPPDATA, so Windows PowerShell has no module cache. Each cmdlet then scans every installed module, and the runner has many.
    - **Fix (0.3.5):** secrets and process start times use .NET calls, no cmdlets, so PowerShell loads no module. The browser tests' two benchmark scenarios also get 90 s; one took 32 s on CI.
    - **Done 2026-10-03:**
      - **Before release:** v0.3.5 passed CI on a temporary branch. The service started in about 1.3 s in both smoke tests.
      - **Release:** pushed with its tag and release page, and CI passed on the release commit.
      - **Installed:** both hosts run 0.3.5.
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

## Phase E — room feedback (owner, 2026-10-03; 0.4.0)

From the owner's notes while setting agents up and running debates in the room.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| E1 | Change an agent's CLI at any time, before or after activation | offline | done |
| E2 | Speed reads Fast or Normal | offline | done |
| E3 | Every default choice reads "Default" | offline | done |
| E4 | The setup window closes after a successful activation | offline | done |
| E5 | The context-window ring fills in from the activation check | offline + live | done |
| E6 | Debate asks for concise, plain-text turns (no word limit) | offline | done |
| E7 | Debate gives your prompt to both agents at the start; Agent 1 still speaks first | offline + live | done |
| E8 | Close thread: stop its run, close its agents, keep it in history, and open the next thread with the same agent settings | offline | done |
| E9 | One thread history across modes, each thread labeled with its mode. Switching mode opens that mode's own screen; a thread stays active until it is closed | offline | done |
| E10 | Prompt library tabs for Prompt, Debate and Build prompts | offline | done |

- **E1:** once a CLI was picked, the agent's header showed only Activate. Changing the CLI meant finding the "Provider" line inside the menu.
- **E5:** the owner decided to keep the one-request model check (it proves the model answers), and to show the usage it reports at once.
  - **Checked live (4 requests):** Codex and Claude Code report their context window with the activation check itself, so the ring fills in as soon as activation finishes. Grok Build and Antigravity report nothing, and their ring now says so plainly instead of "not reported yet".
- **E6:** the owner decided on no artificial word limit, only clear wording asking for concise replies.
- **E7:** today Agent 2 first sees the prompt with Agent 1's opening, so a long opening or an early stop leaves Agent 2 without it. The owner chose to send it to both up front: Agent 2 acknowledges (hidden; one extra short request) and replies only after Agent 1's opening.
  - **Done:** the briefing runs in parallel with the opening, in a phase of its own ("briefing") that doesn't count as speaking. A failed briefing isn't fatal.
  - **Live (6 requests):** Codex opened while Claude Code was briefed (reply READY, not posted). Claude Code's first posted reply answered the opening, and every reply was short and conversational.
- **E8:** a new session kept the old thread's two agents running, against the 4-agent limit, and forgot both agents' settings.
  - **Done:** Close thread, in the thread header and the More menu, stops the conversation, closes both agents and any app servers they kept, and leaves the thread in history. Both agents keep their settings (CLI, model, effort, speed, permissions, internet), and Activate both starts them again with one short check each. It shares its steps with Clear Session, which also reactivates at once.
- **E9:** switching between Prompt, Build and Debate went to completely separate thread lists. The owner asked for one history, with each thread's mode clearly labeled. Switching to Build after activating in Debate should open a clear Build screen, and switching back finds the Debate thread still active unless it was closed.
  - **Done:** a room keeps one pair of agents per mode. The first pair serves the mode of its current thread, or else the first mode used. A further mode's pair is created on first use, named room-mode:<room>:<mode>, with the agent settings last verified in the room, ready for Activate both. Each pair records its mode in its own data, so no schema change was needed and the installed version still opens the shared data folder. The thread list shows every mode, each thread labeled.
- **E10:** the three modes need different prompts, so the library gets a tab for each.
  - **Done:** each saved prompt already had a mode. The library's mode dropdown became tabs (Prompt, Debate, Build, All) that open on the current mode, and prompts saved for any mode show in every tab.

### Activation follow-ups (owner, 2026-10-03; 0.4.1)

From the owner's second pass at activation. They saw "Provider / model default" and Speed On/Off because the room still ran the 0.3.1 service: a newly installed plugin connected to the service already running, and each host's heartbeat kept that service from ever idling out.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| E11 | Speed reads Default or Fast | offline | done |
| E12 | Models show their name and version (Opus 5.5, not opus) | offline | done |
| E13 | Quick activate: an agent's last settings, or the strongest model at high effort with Ask and internet off | offline | done |
| E14 | The version in the room, and a newer plugin replaces an older idle service | offline | done |

- **E12:** the name comes from the CLI's own model list. It's kept with the settings when a model is chosen and confirmed at activation.
- **E13:** settings are remembered per agent and per CLI when an agent activates or its internet or permissions change, in the shared data (no schema change); benchmark sessions are left out.
  - **CLI:** the one chosen for the agent, else the one it last used. The first time, that's Claude Code for Agent 1 and Codex for Agent 2.
  - **Model:** "strongest" is the first full model the CLI lists (CLIs list best first), skipping fast and light variants. For Antigravity, it's its Pro model at High.
  - **Gateway models** are chosen once by hand.
- **E14:** a plugin newer than the running service asks it to step aside (`service.retire`). The service agrees only when no conversation, 1:1 reply, activation, preparation or benchmark is running, then closes its idle agents and exits, and the plugin starts its own. Services from before 0.4.1 can't be asked.

## Phase G — Debate mode (owner, 2026-10-03; 0.4.0)

The owner is going through the modes one at a time, Debate first. In their tests the agents agreed and stopped after a few turns. Three causes:

- **How a debate ended.** By default a debate ended as soon as either agent asked to stop. Every turn also told both agents to ask once the discussion "reached a useful conclusion".
- **Same starting point.** Both agents are assistants trained to be agreeable. Without assigned sides they start from the same view and converge in a turn or two.
- **The starter prompts.** The Vikings starter asked them to "finish with your strongest point of agreement".

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| G1 | A debate runs for a set number of rounds (8 by default) instead of ending when one agent asks to. Each turn shows its round, and the last is a closing statement | offline | done |
| G2 | The debate prompt template: the topic both agents see, each agent's private (1:1) context and internet on or off, and the rounds. The library editor and the room's Options use the same fields | offline | done |
| G3 | Built-in debate prompts that hold up for every round, checked live | offline + live | done |
| G4 | Install 0.4.0 (Phase E plus G1–G3) in both hosts, so the owner can try Debate there | user | done (as 0.4.1) |
| G5 | A rounds chip beside the message box: the next debate's length at a glance, changed in one click | offline | done |
| G6 | Formal debates: assigned sides, a private brief through each agent's 1:1 line before the start, speeches (opening, rebuttals, closing) built on evidence; 7 rounds by default | offline | done |
| G7 | An independent judge: the strongest Claude Code or Codex model at max effort scores each side 1 to 5 on evidence, clash and a cohesive stance, and names a winner | offline + live | done |
| G8 | Ten formal motions replace the built-in debates | offline + live | done |
| G9 | A time limit per speech (2 minutes by default): a speech that runs over is forfeited and the debate goes on | offline | done |
| G10 | The prompt builder: a guided Debate form (with hints that disappear as you type), simple Prompt and Build forms, saving to the library and editing saved prompts | offline | done |
| G11 | Each debate is its own thread, kept with its ballot; the thread list shows the result | offline | done |
| G12 | Delete one thread from history (a button shown on hover) | offline | done |
| G13 | Publish v0.4.3 (0.4.0 to 0.4.3) | user | done |
| G14 | Install 0.4.3 in both hosts (the running 0.4.1 service steps aside for it once idle) | user | done |
| G15 | Harder debates: technical motions where easy talking points lose, two of them closed book (internet off), judged as before | live | done |
| G16 | Three ballots: each debater scores the debate in its own session (nothing new starts), beside the blind judge; the side most ballots name wins, and the judge breaks a tie | offline + live | done |
| G17 | Blind judging: the judge reads the speeches in one typography, with no model names or self-identification; debaters are asked to stay anonymous; a live probe measures whether authorship still shows | offline + live | done |
| G18 | Publish v0.4.6 (Gamer mode, blind judging and three ballots) and install it in both hosts | user | done |

- **G1:** the agents still answer with stop_requested, but with rounds only a stop condition the operator wrote ends the debate early. An hour is the time limit's backstop, and the request limit is two per round plus the briefing.
- **G2:** the template lives in `debate.json` beside `prompt.md`, so versions before it still read a debate prompt (as its topic alone). Internet is chosen per agent, so one agent can have the web and the other not. It's applied through each agent's own switch when the debate starts, because Codex and Grok Build restart to change it.
- **G3:** ten built-in debates, each giving every agent a side to keep or a role with private facts:
  - **Arguments:** six, on policy, software design, sports, history, science and a prediction.
  - **Role plays:** three with a decision in the last round (negotiation, interrogation, investor pitch).
  - **A light one:** is a hot dog a sandwich?
  - **Older libraries** get them once. Their two old debate starters are replaced only if unedited.
- **G3 live, Codex vs Claude Code (about 73 requests, ceiling 87):**
  - **Baseline,** the old Vikings starter with the old ending: Codex switched sides on its second turn, said "That split works" and asked to stop. 5 replies, 48 seconds.
  - **Ban cars downtown** (internet on): all 8 rounds. Each held its side, cited Ghent from the web, and closed on the other's concession.
  - **Negotiate a used car:** all 10 rounds, from $17,500 down to a deal at $16,000, the buyer's secret ceiling, stated in the last turn.
  - **The museum interrogation:** all 10 rounds. The suspect kept the lie until the evidence broke it, and the detective gave a verdict at the end.
  - **No agent asked to stop** in a template debate. Replies averaged 46 to 119 words.
  - **Evidence:** pilot-evidence/stage-d/g3-debate-starters-live.json.
- **G6–G8 live, Codex and Claude Code debating 7 rounds each (40 requests):**
  - **Smartphones in schools,** Codex for and Claude Code against: judged by Claude Code (Opus 5.5, max effort) in 6 minutes, 15/15 to 12/15, with 4 claims questioned.
  - **The fall of Rome,** Claude Code for and Codex against: judged by Codex (its strongest model, max effort) in 5 minutes, 13/15 to 15/15, with 3 claims questioned.
  - **The run:** briefs were answered READY in under half a minute, and speeches averaged about 530 words.
  - **Evidence:** pilot-evidence/stage-d/g7-formal-debate-judge-live.json.
- **G14:** both hosts run 0.4.3. The idle 0.4.1 service stepped aside on the first 0.4.3 call (the handover's first real use), and the library holds the ten formal debates. Codex couldn't move its old 0.4.1 folder aside while its open sessions use it; it loads 0.4.3 and drops the old folder after a restart.
- **G18 (2026-10-04; owner: "commit all and publish when done", then "Publish and install"):**
  - **Published:** v0.4.6 on GitHub (public main 12a8e92, the tag and the release).
  - **Installed:** both hosts run 0.4.6. Both packaged plugins passed their smoke tests (26 and 23 checks), both installed copies match `release/marketplace`, and Codex's hook (unchanged) is enabled and trusted.
  - **Windows CI failed one new test:** the simulator's 9x9 Go game lost on three illegal answers. The simulator reads only the position, with no history, so a random move can repeat an earlier position (ko) and be refused, and it could pick a refused move again.
  - **The fix:** the simulator never plays a move again in the position it was refused in, and a Go player passes on its last try. In 15 simulated games, all 4 refusals were ko repeats and no game was lost on them; the test passed 40 runs in a row. It went to public main as a snapshot (4ed8c79, on top of the release commit), with no new tag, and Windows CI passed.
- **G16 (owner, 2026-10-04: "each of the agents should review and then the judge should review and then that's the three scores"):** the owner preferred this to a neutral third judge or a panel of judges, so no new sessions start.
  - **How it works:** when a judged debate ends, each debater scores it in its own session through its 1:1 line, beside the blind judge. The side most ballots name wins, and the judge breaks a tie.
  - **Live (2026-10-04, 28 requests, the ceiling):** two hard debates of 3 rounds each, Claude Code (Opus 5.5) against Codex (6.1 Sol). Every ballot came back and parsed, and each debate took 8.6 minutes plus its ballots.
    - **The replication crisis:** Claude Code argued for, Codex against, and Claude Code judged. The judge chose Claude Code 13 to 12. Claude Code's own ballot chose itself; Codex's conceded. The result: Claude Code, 3 of 3.
    - **Nominal GDP targeting:** Codex argued for, Claude Code against, and Codex judged. The judge chose Codex 14 to 12. Codex's own ballot conceded, and Claude Code's chose itself, so the debaters outvoted the judge: Claude Code, 2 of 3.
  - **Patterns to watch (two debates are too few to tell):**
    - **The judges:** each picked its own CLI again. That's 5 of the 6 judged debates so far.
    - **The debaters:** Claude Code voted for itself both times and Codex conceded both times, so the models' habits in judging themselves now tip results, in place of the judge's lone say.
  - **Evidence:** `pilot-evidence/stage-d/g16-three-ballots-live.json`.
- **G17 (owner, 2026-10-04: "does the judge actually know the model and CLI of each debater? They should be blinded"):**
  - **What the judge knew:** not who was who.
    - **Its prompt:** labels speeches Proposition and Opposition only.
    - **Its session:** fresh, with no room history, and its only tools are web search.
    - **The debaters:** each is told only its seat ("cli1"), never the other's CLI.
    - **The speeches:** none of the 56 speeches so far named a CLI, vendor or model.
  - **What told them apart:** the speeches reached the judge verbatim, and typography alone separated them perfectly. Per 1,000 words, Codex wrote 13.4 curly quotes and apostrophes and no straight ones; Claude Code wrote 11.1 straight ones and no curly ones. Semicolons were 6.3 against 0.3.
  - **The change:** the judge now reads a blind copy, in one typography, with the debaters' model names and any first-person identity statements removed. Debaters are asked to stay anonymous, the judge not to guess, and the ballot records the blinding. The room keeps the original text.
  - **The probe (live, 2026-10-04, 26 requests over two attempts, ceiling 32 each):** Claude Code and Codex were each asked which side Claude argued, in each judged debate, raw and blind. Each question had its own fresh sessions.
    - **Result:** in the three debates that ran, both named Claude's side correctly every time: 6 of 6 raw and 6 of 6 blind, where guessing would get about half.
    - **How they knew:** by argument habits, not typography. Claude admits what it can't verify ("from memory"), corrects itself openly and names sources in prose. Codex pastes links and writes methodical qualifications.
    - **The fourth debate** didn't run: twice, OpenAI's service briefly answered Codex's readiness check with "model 'gpt-6.1-sol' is not enabled". It cleared within two minutes each time.
  - **Finding:** blinding removes the cheap tells and any explicit identity, but authorship still shows. A judge whose CLI also debated can recognize its own side. Independence needs a judge that isn't one of the debaters (another CLI), or a panel that cancels self-preference (G16).
  - **Evidence:** `pilot-evidence/stage-d/g17-authorship-probe-live.json` and `g17-authorship-probe-attempt1.json`.
- **G15 (2026-10-04, about 38 requests, ceiling 40):** five hard debates, built in alongside the ten:
  - **The motions:** ranked-choice voting, the replication crisis, nominal GDP targeting, the strategic bombing of Germany (closed book) and living standards in the Industrial Revolution (closed book).
  - **What makes them hard:** each is technical, and its briefs ask for exact figures and the strongest counter-mechanisms. The closed-book ones tell both sides the judge will test every figure.
  - **Live:** Claude Code (Opus 5.5) and Codex (6.1 Sol) debated two of them over 7 rounds each, with the strongest model of each CLI judging at max effort.
    - **Ranked-choice voting** (internet on): Claude Code argued for and Codex against, and Codex judged. The Opposition won 15 to 11. The judge questioned 4 claims, among them a study figure the Proposition had misread and then corrected itself. 11.7 minutes; speeches averaged 520 words.
    - **Strategic bombing** (closed book): Codex argued for and Claude Code against, and Claude Code judged. The Opposition won 13 to 11. The judge questioned 7 figures, mostly approximations (it checked the Opposition's fuel, pilot-loss and sortie figures and found them right). 12.1 minutes; speeches averaged 566 words.
  - **Compared with G7's general motions:** more claims questioned (4 and 7, against 4 and 3) and lower evidence scores (3 for the losing side in both debates).
  - **A pattern to watch:** in three of the four judged debates so far (G7 and G15), the winner was the judge's own CLI, although the judge sees only the speeches. Four debates are too few to tell. A panel of both judges would cancel it out (G16).
  - **Evidence:** `pilot-evidence/stage-d/g15-hard-debates-live.json`.
- **G9:** the CLIs can't separate thinking from writing, so the limit covers the whole speech: wall-clock time from the request to the answer. The request is cancelled at the limit; a settled cancel commits a forfeit message in that seat's place.
- **G4:** 0.4.0 is installed in both hosts and verified: both smoke tests, both installed copies match, Codex's hook is trusted, and doctor answers through each. The service on AvA-Data is still 0.3.1, started by a Claude Code session opened at 7:03 PM, and new installs connect to the service already running. Closing that session didn't help: each host's heartbeat kept it from idling out. 0.4.1 (E14) adds the handover for future updates. With the owner's OK, the 0.3.1 service was stopped (Stop all, then its process), and 0.4.1 now serves AvA-Data: doctor shows Cursor, and the library has the ten debates (both old starters were unedited and were upgraded).

## Phase P — Prompt mode (owner, 2026-10-04)

The owner moved on from Debate to Prompt mode.
- **What Prompt mode is for:** prompts that are short to write but intensive to answer, with one exact answer (challenges), and races, where the same kind of question is judged on speed.
- **Runs and threads:** every run is its own thread. A new prompt clears context but keeps the same agents.
- **Debate, aligned:** a judged debate stays in history, the agents stay loaded, and the next debate is a new thread.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| P1 | Resources becomes **Settings** (gear icon), at the right of the tools row | offline | done |
| P2 | Answer keys for challenges and races: each agent's final ANSWER line checked, with a result card (answer, right or wrong, time, winner) | offline | done |
| P3 | Ten built-in challenge and race prompts, every answer computed by program | offline | done |
| P4 | One thread per Prompt run: fresh sessions, same agents | offline | done |
| P5 | New threads without closing the agents: fresh sessions start beside the current ones (Prompt and Debate) | offline | done |
| P6 | The Prompt builder: task, answer form and hidden expected answer; the library editor gets the answer key | offline | done |
| P7 | Live check of the challenges and races with Codex and Claude Code | live | done |
| P8 | Publish v0.4.4 (Prompt challenges and races, fresh threads, the review fixes) and install it in both hosts | user | done |
| P9 | Harder challenges: prompts the strongest models need one to five minutes for, and sometimes miss, each answer still computed by program | live | done |

- **P3:** the logic puzzle was brute-forced to make sure it has exactly one solution, and the code-tracing answer was taken from running the code. The two earlier Prompt starters are retired (set 4) where unedited.
- **P7 (2026-10-04, 40 requests):** Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort, in two rooms of five prompts. Every answer line was read and checked, every prompt was its own thread with fresh sessions, and the agents stayed Ready. Both agents answered all ten correctly, in 5 to 18 seconds each: the challenges work but are far easier than the one to five minutes intended, so P9 makes harder ones. Evidence: `pilot-evidence/stage-d/p7-prompt-challenges-live.json`.
- **P8 (2026-10-04):**
  - **Published:** v0.4.4 on GitHub (public main d887924, the tag and the release), with Windows CI passing.
  - **Installed:** both hosts run it. Both packaged plugins passed their smoke tests, both installed copies match `release/marketplace`, and Codex's hook stays trusted (Codex replaced its 0.4.3 folder this time).
  - **Handover:** the idle 0.4.3 service stepped aside on the first 0.4.4 connection, and 0.4.4 served the shared data folder 2.6 s later.
  - **Still to do:** Claude Code sessions that were open keep their 0.4.3 MCP server, which uses the new service as it is, until they reload.
- **P9 (2026-10-04, 36 + 28 requests):** two rounds of calibration, Claude Code (Opus 5.5) against Codex (6.1 Sol) at high effort, without tools.
  - **Round one:** nine harder problems (seven challenges, two races): blocked lattice paths, a prime-step elimination circle, ten generations of Life, spanning trees, a king's random walk, a code trace, the digits of 3^60. Both agents answered all nine correctly; the challenges took 0.25 to 1.9 minutes and the races 7 to 12 seconds.
  - **Round two:** the same kinds, scaled up. Both answered all seven correctly. Five reached the target: Life at 20 generations (5.8 and 6.1 minutes), a 150-step trace (1.5 and 6.8), the digits of 3^300 (4.7 and 6.8), queens off the diagonals (0.8 and 3.1) and a king's walk on 5 × 5 (0.5 and 1.6). Spanning trees of a 12-point graph and an 80-person circle took under a minute and were dropped.
  - **Built in:** the five, as hard challenges (starter set 5).
  - **Finding:** no agent missed a single answer, at any size. They work exactly and check their own work, so a harder problem takes them longer but doesn't trip them. Separating them on correctness needs problems that call for an insight, not more of the same work.
  - **Evidence:** `pilot-evidence/stage-d/p9-hard-challenges-live.json` and `p9-hard-challenges-round2-live.json`.
- **P5:** before, the next thread closed and reactivated both agents, so they briefly showed as not active. Now each fresh session runs its readiness check beside the current one and takes over in one write. A fresh session that fails leaves the agent as it was.

## Phase Q — codebase review fixes (owner, 2026-10-04)

A review of the whole codebase found 59 issues. They are fixed in batches, most severe first, each with regression tests (`test/review.test.ts`). The owner chose these ahead of P7.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| Q1 | Security and crashes: AvA's git never opens an agent's repository; previews survive odd keys and hide junctions and short names; the APP line is read without quadratic backtracking; `.git` in any case in task paths; imported exercises read only their own files; agents get no other provider's API keys | offline | done |
| Q2 | Process safety: ledger records from before this logon session count for nothing, and proved-gone ones get an exit time; job lineage dates exited PIDs; EPERM means alive; the job helper restarts; launch signals carry a token; the Build gate refuses short 8.3 names | offline | done |
| Q3 | Debate and Prompt correctness: a repair to spare for every speech; the side check with a speech limit; a time backstop that fits the speeches; formal debates always run by rounds; Options minutes and broadcast times; whole-answer matching; a fresh session that half fails is redone; failed or stalled briefings; attachments by ID | offline | done |
| Q4 | Service lifecycle: one busy check for handover and idle exit (judge, discovery, operations); quarantined runs; bounded shutdown that always exits; judge sessions cleaned up and outside the agent limit; guarded deletes; Clear Session locks the pair; an empty lock file; the owner claim outside the write lock; shared model-list lookups | offline | done |
| Q5 | Room: one command client per kind of action, with the options in a start's signature; the stale-room and polling races; a live thread re-read only on change; hidden tabs pause; an expired link stops polling; decoded output cached; the builder's save and the setup menu's Activate take effect once | offline | done |
| Q6 | Performance and robustness: cached thread groupings, per-thread activity, SQL counts, event pages without messages, `synchronous=NORMAL`, lateness checked every 200 ms; async git and deletes; fewer PowerShell and CLI launches; cached suites and MCP lists. Also: a bad candidate fails only its attempt, a suite kept in git loads, an ignored project is copied whole, library deletes and leftovers, percent-encoded paths in reports | offline | done |

- **Q1:** the reviewer reproduced the git attack: a filter in `.git/config.worktree` passed AvA's settings check, and `git add -A` then ran its program on the host. The preview crash was one request with a 64-character key containing `é`. The old APP pattern took 16 s on a 100,000-character line; it now takes milliseconds. `ACPX_AUTH_*` variables are dropped from the service's environment, because ACPX copies them into every agent where an agent's environment can't blank them.
- **Q6:** the events table already had its `(run_id, seq)` index, so no new index was needed; the room's costs were the full-history scans around it. `/ava doctor`'s data-folder check (two PowerShell starts, about a second) stays synchronous: it runs only on request.
- **Phase Q is done.** It ships in v0.4.4.
- **Q2:** the logon session's start is its `winlogon.exe` start time, since Windows Fast Startup keeps the boot time running across a shutdown. Before, an orphan such as `explorer.exe` (its parent `userinit` exits) whose dead parent's PID matched an old record could be tree-killed by Stop all.

## Phase H — Build: app builds and bug hunts (owner, 2026-10-04)

The owner moved on to Build mode: a dedicated mode for two kinds of task, app builds and bug hunts. Each gets its own builder form and built-in prompts, and its runs behave as Prompt and Debate runs do.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| H1 | Each build is its own thread: fresh sessions for the same agents, copies in their new folders, no Clear Session between builds; the two kinds are named **App build** and **Bug hunt** | offline | done |
| H2 | Scored bug hunts: a hunt names its repository (and a commit to copy), leaves folders out of the copies, and plants bugs in them before the baseline; agents report `BUG:` lines, and a result card shows what each found | offline | done |
| H3 | Builders for both kinds: an App build form, and a Bug hunt form with the repository (checked before saving), the commit, folders to leave out and the planted bugs; loading a prompt fills in its kind and folder | offline | done |
| H4 | Built-ins: five app builds, and three bug hunts in CLI-MODE of increasing difficulty (1, 3 and 5 planted bugs) | offline | done |
| H5 | Live check: an app build and the three hunts, with Claude Code and Codex | live | done |
| H6 | Harder hunts: bugs that don't contradict a nearby docstring, no count given, and a few decoys, so the strongest agents miss some | live | done |
| H7 | Portable hunts: a hunt's repository can be a public git address; AvA fetches one commit (no history, only the slice's files) into a cache and copies from it; the built-in hunts use CLI-MODE on GitHub | offline + live | done |
| H8 | Harder app builds: specifications with exact, checkable behavior that the strongest agents get partly wrong | live | done |
| H9 | Publish v0.4.5 (Build: app builds and bug hunts, portable and expert hunts, and the harder prompts of every mode) and install it in both hosts | user | done |
| H10 | Publish the CI fix for v0.4.5 (a test's line endings) as a snapshot on public main, without a new tag | user | done |

- **Harder prompts in every mode (owner, 2026-10-04: "add harder prompts in all modes"):** H6 (hunts), P9 (challenges), H8 (app builds) and G15 (debates), in that order, each calibrated live against Claude Code and Codex at their strongest.

- **H10 (2026-10-04):** the test fix went to public main as a snapshot (dd9f9d2, on top of the v0.4.5 release commit 249468e), with no new tag. Windows CI passed. The v0.4.5 tag and release are unchanged.
- **H9 (2026-10-04):**
  - **Published:** v0.4.5 on GitHub (public main 249468e, the tag and the release).
  - **Windows CI failed one test:** a hunt's copy from a local commit gets CRLF line endings where `core.autocrlf` is on, as on GitHub's runner, and the test expected LF. Only the test was wrong: copies from a local commit follow the user's git settings, as their checkouts do, and planting already handles CRLF. Copies from the web always keep stored line endings.
  - **The fix:** the test now compares text regardless of line endings, and all 317 tests pass with `autocrlf` on and off. It's committed locally; publishing it as a snapshot (no new tag) is H10.
  - **Installed:** both hosts run 0.4.5. Both packaged plugins passed their smoke tests (26 and 23 checks), both installed copies match `release/marketplace`, and Codex's hook (unchanged since 0.4.4) is enabled and trusted.
  - **The service:** no AvA service was running, so the installed 0.4.5 service was started on the shared data folder (1.1 s). Claude Code sessions opened before 0.4.4 keep their 0.4.3 MCP server, which uses the running service, until they reload.
  - **The library:** the shared library's marker still read 3: it hadn't been opened since 0.4.3. It upgrades to set 5 the first time it's opened, bringing the challenges, the Build prompts and the hard prompts.
  - **Also fixed:** the lineage test could leave a background process running if it started late. One from a run at 7:00 AM was found and stopped.
- **H8 (2026-10-04, 8 requests):** three hard app builds, each exposing its exact behavior on `window` so it can be checked from outside: chess (`perft(fen, depth)`), a spreadsheet (`evaluateSheet(cells)`) and a regex engine with no RegExp (`regexFullMatch(pattern, text)`).
  - **Live:** chess and the regex engine, built by Claude Code (Opus 5.5) and Codex (6.1 Sol) at high effort under Ask, so neither could run its code. Each app was then served locally and checked in a headless browser with cases the agents weren't given.
    - **Chess:** both passed all 7 perft checks: the starting position and Kiwipete as given, and five unseen positions (mirrored with colors swapped, and positions 3, 4 and 5 of the standard suite) to depth 3 or 4. Claude Code took 5.5 minutes, Codex 9.6.
    - **Regex:** both passed all 9 given and 19 unseen cases (catastrophic patterns included, slowest 4 ms), with engines of their own and no RegExp. Claude Code took 5.8 minutes, Codex 6.9.
  - **Finding:** the strongest agents got these exactly right without running anything, so like the challenges, they separate on time, not correctness. The spreadsheet wasn't run live.
  - **The check is fair:** a fake app that returns the published perft numbers passes only the three given positions.
  - **Evidence:** `pilot-evidence/stage-d/h8-hard-builds-live.json`.
- **H6 (2026-10-04, 8 requests):**
  - **The scoring:** decoys (correct code made to look wrong; a BUG line on one counts against the agent, and the winner found more bugs, then fell for fewer decoys, then was sooner) and a cap on the BUG lines that count.
  - **Two expert hunts in CLI-MODE**, neither saying how many bugs it has:
    - **Bug hunt 4:** state and queue, 4 bugs and 1 decoy, first 6 BUG lines count.
    - **Bug hunt 5:** the whole plugin, 6 bugs and 2 decoys, first 8 count.
  - **The bugs:** none contradicts a nearby comment. Each needs a caller, a data shape or an invariant kept elsewhere to see. They were checked to apply once at 270a280 and to compile together. One candidate decoy sat five lines from a bug, so it was left out.
  - **Live, Claude Code (Opus 5.5) against Codex (6.1 Sol), high effort, Ask:**
    - **Bug hunt 4:** both found 3 of 4 and missed the same one (`/cli dir` sorted by size). Claude Code took 1.8 minutes with 3 BUG lines; Codex took 5.3 minutes with 6.
    - **Bug hunt 5:** both found 5 of 6 and missed the same one (`acpx.py`'s `-s` control). Claude Code took 6.4 minutes with 5 lines, all hits; Codex took 7.9 minutes with 8.
    - **Neither reported a decoy.** Claude Code won both on time.
  - **Possible real bugs:** Codex's six other BUG lines name code that wasn't planted and may be real bugs in CLI-MODE (recorded in the evidence, not verified).
  - **The builder:** loading a saved Build prompt now puts each section of its text (requirements, how it's judged, what counts as a bug) back in its own field.
  - **Evidence:** `pilot-evidence/stage-d/h6-expert-hunts-live.json`.
- **H7 (owner, 2026-10-04: "how do we make bug hunts portable?"):** the three CLI-MODE hunts named this machine's checkout, at a commit only its local history has.
  - **Who fetches:** AvA fetches the code, never the agents. A clone's history would show every planted bug in a diff, and Ask refuses network commands.
  - **What a hunt names:** a repository on the web (an https address), a full commit hash, and optionally a slice (only these folders) besides the paths left out.
  - **The fetch:** one commit without history or file contents, then the slice's files in one batch, into `<data>/repos/`. Copies come from there.
  - **The built-in hunts:** they now fetch https://github.com/adamczhang/CLI-MODE at 270a280 (public `main`). All nine planted bugs apply there at the same lines as before.
  - **Live, from GitHub:** the default branch took 0.4 s to look up and the first fetch took 2.1 s (1.3 MB packed, 113 files). Fetching again found the cache (0.09 s), and a seeded copy took 1 s. A scripts-only slice is 43 files.
- **H5 (2026-10-04, 16 + 12 requests):** Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort under Ask, as Quick activate sets them up.
  - **Pomodoro build:** both finished in 5.1 minutes, each with a working page and its own thread.
  - **The first hunt batch exposed two faults, both fixed and retested:**
    - **Codex couldn't read the code:** it reads only through commands, which the Ask instructions forbade. A hunt now lets it read and search with read-only commands.
    - **Claude Code went straight to the planted files:** planting had given them the newest times, and its file search lists files newest first. Planted files now keep their copy time. Claude Code's hard hunt went from 31 seconds to 4.4 minutes.
  - **The retest:** both found every planted bug with no stray BUG lines. Easy: 9 s and 30 s. Medium: 15 s and 51 s. Hard: 4.4 and 3.1 minutes; Codex won the hard hunt on time.
  - **Finding:** like the Prompt challenges, the hunts don't yet separate the strongest agents (H6).
  - **Evidence:** `pilot-evidence/stage-d/h5-build-hunts-live.json` and `h5-hunts-retest-live.json`.
- **H4:**
  - **The app builds:** a Pomodoro timer, a Kanban board, a trip expense splitter, Sudoku with a solver, and a pixel art editor. Each runs in the browser as plain files.
  - **The hunts:** each copies CLI-MODE at commit 5fc3198 (read only) and leaves out `checks/` and the agent instructions; 113 files, 2.7 MB.
  - **The planted bugs:** 1 in `names.py`; 3 in `changes.py` and `catalogs.py`; 5 across `operations.py`, `test_gate.py`, `progress.py`, `confirmation.py` and `agent_folder.py`. Each is a one-line slip against a docstring or comment, and each was checked to apply once at that commit.
  - **Starter set 5:** older libraries get these once.
  - **A limit:** the hunts name this machine's checkout, and that commit may exist only in its local history.
- **H2:** no clone step. A hunt's copy is a working-tree (or one-commit) copy without git history, made by the worker at the start, so the history can't give a planted bug away, and each thread keeps its own copy. One BUG line finds at most one planted bug.
- **H1:** a build used to hold its thread, so the next one needed Clear Session (and the agents briefly showed as closed). Now the next build renews both sessions beside the current ones, as P5 does for Prompt runs.

## Phase J — Gamer mode (owner, 2026-10-04)

A fourth, adversarial mode: the two agents play abstract strategy games against each other, starting with chess, checkers and Go. The owner asked for a game selector, a board in place of the conversation pane, and engines of our own, light and built for agent-against-agent play, checked against open-source references.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| J1 | Game engines: chess, checkers (English draughts) and Go (9x9, 13x13, 19x19), each small and complete, with moves in and out as players write them | offline | done |
| J2 | The referee: a Gamer run in the controller. A brief before each game; each turn gives the position in standard notation and the opponent's last move, never the legal moves; its MOVE line is checked before it counts; an illegal move is asked again, up to three times; a time limit per move; resignation; the result | offline | done |
| J3 | The Gamer tab: the fourth mode on the slider, a game selector, the board in place of the conversation, the move list and replay, and the result | offline | done |
| J4 | Live: a game of each with Claude Code and Codex | live | done |
| J5 | The README: a Gamer section with a live screenshot | offline | done |
| J6 | Faster games: visible Quick/Standard/Deep effort and time presets, with Quick the initial Gamer choice (owner approved in K4) | offline | done |
| J7 | Crosscurrent as the fourth game: place a stone and shift its row or column; 3x3, 5x5 and 7x7 boards, agent briefs, referee, board and replay | offline | done |
| J8 | Crosscurrent on 7x7 only, with one shared star that must belong to the winning connected group | offline | done |
| J9 | Test Crosscurrent through the in-app browser, fix any behavior found, and commit the local result | offline | done |
| J10 | Live Crosscurrent in the in-app browser: Codex against Claude Code, bounded requests, temporary data, result and replay verified | live | done |
| J11 | Research Crosscurrent strategic depth: test independent shifts and the four-edge goal, alone and together, then propose an upgrade | offline | done |
| J12 | Make Three Edges the default Crosscurrent ruleset: independent shifts, clear edge progress and versioned replay (owner-requested default) | offline | done |
| J13 | Compare combinations of line control, cooldown, a reserved double shift and star-powered shifts; report results and recommend the next ruleset | offline | done |
| J14 | Make one turn of line cooldown the Crosscurrent default, preserve older replays, and verify referee, browser and live LLM play (owner requested) | live | done |
| J15 | Audit current Crosscurrent for defects, exact tactical defenses, strategic shortcuts and stronger-play behavior | offline | done |

- **J15 (2026-10-05):** tested the current rules with stronger tactical checks and varied objectives, corrected the interpretation of the earlier study, and fixed replay failures. Plan (maintainer evidence), audited results and tactical examples (maintainer evidence), earlier-game audit (maintainer evidence), [runner](../scripts/crosscurrent-depth-study.ts), [production audit](../scripts/crosscurrent-depth-summary.ts) and verification (maintainer evidence).
  - **Method:** 336 new offline games: all ten pairs of five policies on twelve common four-turn openings with colors swapped (240 games), then 32 games from the empty board for each of three stronger policies (96 games). A separate audit revisited 296 earlier cooldown games. All 21,134 recorded moves replay legally through the production engine. Policies have unequal computing budgets and share some evaluation machinery; their scores are evidence about this pool, not a universal depth ranking.
  - **Correction to earlier evidence:** in 285 of the 292 decisive earlier games, the losing decision permitted a win on the next reply despite an alternative that avoided immediate loss. Those alternatives are not proven to save the whole game. Earlier selective search-budget results confounded longer planning with incomplete immediate defense. The new guarded policies had zero avoidable one-reply losses; the former beam-4 policy had 56 in its 96 new games.

  | Comparison | Stronger policy's match points | Paired 95% interval |
  | --- | ---: | ---: |
  | Exact immediate defense + greedy connections vs former 32k search | 77.1% | 64.6–89.6% |
  | Certified three-ply setups vs exact defense + greedy connections | 62.5% | 52.1–75.0% |
  | Wider 128k search + exact defense vs certified three-ply setups | 64.6% | 52.1–77.1% |

  - **What the strategy involves:** the star's distance from the nearest edge sets a minimum material requirement: at least `6 + distance` owned stones in its winning component. Center needs nine; an edge needs six. Moving the star inward while cooling its column can buy a move. The recorded 13-turn live loss had 407 of 813 distinct responses that avoided immediate defeat; `E3 COL D DOWN` is an exact example, and undoing that column would win if cooldown were absent. Another reachable position has 415 distinct defenses, all losing immediately or on the next reply; removing cooldown restores a defense. Across the new games and this earlier example, 69 distinct forcing positions were verified against every production legal reply (23,322 raw replies). The earliest certified setup in the new games is on turn 25.
  - **Shortcuts and draws:** corners count for two sides and the star contributes its own edge contact. A complete outer row linked to the star therefore wins. Legal cooperative examples attain the earliest possible wins, Circle on turn 11 and Diamond on turn 12; neither is a forced opening. The tested edge specialist scored only 10.4% against the other policies, and only 7 of 273 decisive new games won with a full outer line. New games drew 63/336: 41 full boards and 22 simultaneous connections. The stronger self-play policies averaged 38–41 turns, with 5–11 draws per 32 games. Draw pressure merits further study.
  - **Balance is unresolved:** first-player scores in the three self-play samples were 60.9%, 70.3% and 48.4%. The strongest search policy finished 10 first-player wins, 11 second-player wins and 11 draws. These small, policy-dependent samples do not establish perfect-play fairness or chess-level depth.
  - **Found and fixed:** unknown saved versions silently fell back to current rules; invalid recorded moves silently truncated the visible board. Unsupported versions now fail explicitly, and replay errors identify the last valid position, disable unreplayable moves and label the stored result. Classic/unversioned and v2 histories retain their engines. Rules text now explains corner and star edge credit without changing mechanics.
  - **Verified:** typecheck, build, all 374 offline tests and four targeted browser scenarios passed. The tactical kernel agrees with every production legal action at 120 seeded positions; 500 positions pass all eight geometric symmetries and position round-trips. Browser checks include injected malformed moves and unsupported versions, valid older histories, the default game and the existing Gamer flow; the error display (maintainer evidence) was visually inspected. Zero provider calls; temporary test data only, no installation or publication.
  - **Recommendation:** keep the current rules. Use exact tactical defense and broader planning as the research baseline, build a tactical analyzer/puzzle benchmark from the verified cases, and measure stronger self-play and human clarity before adding mechanics. The evidence shows useful forcing tactics and benefits from broader planning, with opening strategy and optimal balance still unknown. J6 remains the separate `next` decision.

- **J14 (2026-10-05):** Three Edges + cooldown is now the default for new Crosscurrent games. Live request plan (maintainer evidence), mock evidence (maintainer evidence), live evidence (maintainer evidence), board (maintainer evidence) and result/indicators (maintainer evidence).
  - **Rule:** the exact row or column shifted last turn cannot shift this turn in either direction. Placement on it and shifts through perpendicular lines remain legal. The next legal shift replaces the resting line, including when it shifts an empty line. The board, one star, three-edge goal and 48-turn limit are unchanged; line control and double-shift powers are not enabled.
  - **Versioning:** new runs save `three-edges-cooldown-v3`; `three-edges-v2` retains unrestricted independent shifts, and Classic/unversioned games retain their original engine. Agents receive the resting line in every position, under a distinct v3 header. The parser rejects missing, duplicate, malformed or inconsistent cooldown state. Rejected moves do not place a stone or change the resting line.
  - **Room:** the resting line has a dashed outline and a label beside the edge indicators. Replay restores that position's marker; a new game starts with none. Older rulesets omit the cooldown display and keep their own briefs, legal moves and replay.
  - **Offline/browser:** typecheck, build and all 367 offline tests passed. Forty seeded full games agree with the independently tested J13 cooldown prototype, including every legal move and final outcome. Four browser scenarios passed: the new default with narrow/mobile layouts and reload, Classic history, v2 history, and the existing Gamer flow. The referee fixture rejects both directions on a resting column, accepts a perpendicular repair, then allows the old column again. The bounded harness completed a 44-turn simulated game before live activation.
  - **Live:** Codex `gpt-6-astra` (6 Astra, low) as Circle against Claude Code `default` (low), using subscription logins, Ask and internet off. Codex won after 13 accepted turns in 137.7 seconds, with the star at D2 and Circle reaching top/left/right. All 17 requests completed: two activations, two briefings and 13 moves, within the ceiling of 148. There were no illegal answers, cooldown violations or provider/service failures.
  - **Live replay and cleanup:** verified COL D resting after the first move, ROW 7 after the second, and COL A at the finish; reopened history after reload with matching board, result and edge indicators. The complete live move sequence also agrees with the J13 prototype. Both agents stopped with zero surviving owned processes and no cleanup errors; the browser tab and test server closed. Temporary data only, no shared-pool writes, profile/hook changes, installation or publication. One live game verifies this flow, not model rankings or opening balance. J6 remains the separate `next` decision.

- **J13 (2026-10-05):** tested 12 combinations in an isolated prototype against the current Three Edges baseline (`c61e871`). The engine, UI and current default are unchanged. Primary plan (maintainer evidence), follow-up plan (maintainer evidence), audited results and recommendation (maintainer evidence), [runner](../scripts/crosscurrent-combo-study.ts) and [audit](../scripts/crosscurrent-combo-summary.ts).
  - **Rules varied:** control requires at least one own stone and no fewer own than enemy stones on the selected line, counted after placement and ignoring the star; cooldown blocks the exact row or column shifted last turn, in either direction. The power is either absent, one two-cell shift per player per game, or repeatable two-cell shifts on a line containing the star. The powers are alternatives. All combinations retain 7x7, one star, the three-edge goal, one placement per turn, both-player checks, draws and the 48-turn bound. The larger "place OR shift" redesign is outside this comparison.
  - **Method:** 3,856 offline games: 2,320 involving search/greedy players and 1,536 random games. The primary comparison used 24 shared four-turn openings with player colors swapped (48 games per combination), plus a greedy/search comparison, equal-agent play from the empty board, branching measurements and exhaustive analysis of 32 shared two-turn endgames under each of 12 variants. Common openings are legal under every combination. Search caps are 8,192 and 32,768 unique full-state evaluations; state keys retain cooldown and unused-power rights, even when boards match.
  - **All 12 primary results:** cells are the higher-budget player's match points (win 1, draw 0.5, loss 0), not a depth score. Each row adds the named rules; the column selects the power.

  | Added rules | Ordinary shifts | One double shift each | Double shifts through the star |
  | --- | ---: | ---: | ---: |
  | Neither control nor cooldown | 66.7% (baseline) | 66.7% | 58.3% |
  | Control | 69.8% | 72.9% | 53.1% |
  | Cooldown | 68.8% | 75.0% | 80.2% |
  | Control + cooldown | 80.2% | 83.3% | 72.9% |

  - **Validation:** selected the three highest primary scores plus baseline, then added cooldown alone as an explicit simplicity check. The changed alpha-beta configuration used new seeds, enemy cost 4, beam 6 and no control/reserve evaluation bonuses (64 games each). A second search policy used UCT with heuristic leaves (48 games each). Both search policies remain selective and share geometric evaluation; neither is a perfect-play solver. Four finalists also played UCT against alpha-beta at equal evaluation caps (32 games each). Timings are diagnostic, not matched CPU budgets.

  | Candidate | Primary alpha-beta | Changed alpha-beta | UCT | First / second wins / draws in 96 fresh equal-agent games |
  | --- | ---: | ---: | ---: | ---: |
  | Baseline | 66.7% | 43.8% | 61.5% | 80 / 15 / 1 |
  | Cooldown | 68.8% | 67.2% | 80.2% | 45 / 48 / 3 |
  | Control + cooldown | 80.2% | 75.0% | 86.5% | 62 / 32 / 2 |
  | Control + cooldown + reserved double | 83.3% | 75.8% | 78.1% | 51 / 42 / 3 |
  | Cooldown + star power | 80.2% | 76.6% | 80.2% | 61 / 34 / 1 |

  - **Recommendation for J14:** add **cooldown alone** as the next default candidate: after placing, shift any line except the exact row or column the opponent just shifted. It rests for one turn; perpendicular lines remain available. This is the best practical tradeoff here, not the variant with the largest observed search payoff. It adds one visible marker, retains the existing board/turn/goal, and gave near-even held-out equal-agent outcomes with few draws. Its primary mean game grew from 20.7 to 25.9 total turns. Across the three budget-ladder configurations it drew once in 160 games. More search scored 68.8%, 67.2% and 80.2%; the primary difference from baseline is uncertain, while the two follow-ups favor cooldown under these policies.
  - **Advanced candidate:** control + cooldown + one reserved double shift. It had the largest primary budget response and 51/42/3 held-out self-play, but adds three mechanics and drew 9 of 48 UCT games (18.75%). The simpler control + cooldown had a stronger UCT budget response (86.5%) but more first-player wins in its equal-agent sample. These tradeoffs do not establish that the reserved power adds strategic depth.
  - **Negative results:** control + reserved double without cooldown is unsuitable as the next default on this evidence: the first player won 23/24 initial equal-agent games and 91/96 fresh ones. Star power alone shortened primary games to 18.9 turns and did not give a clear larger-budget advantage. Control + star power without cooldown was close to even between the budget tiers (53.1%). More features were not reliably better.
  - **Uncertainty:** 95% intervals resample opening pairs and are unadjusted across multiple variants; selection and follow-ups are exploratory. Cooldown's primary budget-score difference from baseline was +2.1 points with interval -18.8 to +22.9. Its equal-agent first-player match score was 48.4% (interval 38.5–57.8%), not proof of game-theoretic fairness. The late panel is conditioned on control+cooldown survival with reserves unused; selective search missed some optimal two-turn decisions in reserve variants. No human or live LLM playtests occurred, so neither human clarity nor LLM strength nor a universal depth ranking is established. The next evidence should test those before another production change.
  - **Verified:** all 2,320 recorded games replayed legally with matching final states and outcomes; all 1,536 random outcomes reproduced; all 384 exact endgame analyses and stored paired intervals were recomputed. Prototype tests cover production-baseline agreement, independent transition/connectivity oracles, post-placement control, cooldown identity, atomic two-cell moves and full-state cache distinctions. Typecheck, build and all 361 offline tests passed. Zero live provider requests, no shared-pool writes, installation or publication. J6 remains the separate `next` decision.

- **J12 (2026-10-05):** implemented the owner's decision to make Three Edges the default, superseding J11's optional-mode proposal. In-app evidence (maintainer evidence) and browser screenshot (maintainer evidence).
  - **Rules and notation:** 7x7, one movable neutral star, one placement followed by an independent one-cell shift of any row or column. A star-containing orthogonal group must reach at least three edges; two opposite edges do not win. Empty-line shifts, both-player checks, simultaneous draws, full-board draws and the 48-placement limit are retained. Moves explicitly name placement and line, such as `E3 ROW 4 RIGHT` and `A1 COL D DOWN`; the agent brief and repair messages explain both parts.
  - **Saved games:** new runs persist `three-edges-v2`. Unversioned saved runs select the Classic engine with its original moves, goal, briefs and position header. Replay never reinterprets their moves under the new rules. New-game setup always returns to Three Edges.
  - **Room:** reached-edge indicators follow the displayed replay position. The independent line is shaded, the new stone is ringed even when outside that line, and winning branches trace all reached edges through the star. The result stays visible when the game ends; browser testing caught and fixed scroll anchoring that could hide it above the sidebar.
  - **Verified:** typecheck, build and all 355 offline tests passed. Three targeted browser scenarios passed: Three Edges with narrow/mobile layouts and reload, unversioned Classic history, and the existing Gamer flow. The production engine agrees with the independent research implementation over 40 seeded games and 2,000 random boards; earlier Classic oracle tests remain intact.
  - **In-app match:** scripted simulated players completed 19 accepted turns. The referee rejected a placement on the star, accepted the repair, and awarded Circle the win only after the third edge. Replay showed A1 staying placed while the first remote shift moved the star to D5, then two reached edges without an early finish. Reload retained the board, goal and result; New game reset the star and progress.
  - **Scope:** local implementation and scripted simulation, with zero live provider requests, no shared conversation-pool writes, and no installation or publication. The test server and browser tab were closed. This verifies game behavior, not a new strategic-depth or LLM-strength claim. J6 remains the separate `next` decision.

- **J11 (2026-10-04):** an isolated research prototype tested the current rules, either proposed change alone, both together, and an exploratory three-edge compromise. The production engine and UI are unchanged. Plan (maintainer evidence), follow-up plan (maintainer evidence), results and proposal (maintainer evidence), [runner](../scripts/crosscurrent-research.ts) and [audit](../scripts/crosscurrent-research-summary.ts).
  - **Method:** 6,232 offline bot games: 5,000 random self-play games and 1,232 games across greedy, 4,096-evaluation and 16,384-evaluation search players. Each rule set's primary budget comparison used 40 common four-move openings with colors swapped (80 games). Search uses one heuristic family, selective beams and a five-ply ceiling; evaluation budgets are not equal wall-clock budgets. No provider requests or human playtests.

  | Rules | Mean placements | Draws / 80 | Higher-budget match points | Paired 95% interval |
  | --- | ---: | ---: | ---: | ---: |
  | Current: shift the placement's line; opposite-edge goal | 39.2 | 20 (25%) | 62.5% | 55.0–70.6% |
  | Any-line shift; opposite-edge goal | 17.6 | 1 (1.25%) | 58.1% | 48.8–67.5% |
  | Placement's line; four-edge goal | 47.7 | 76 (95%) | 52.5% | 50.6–55.0% |
  | Both changes: any-line shift; four-edge goal | 37.6 | 36 (45%) | 56.3% | 48.1–64.4% |
  | Exploratory: any-line shift; three-edge goal | 20.3 | 1 (1.25%) | 60.6% | 51.3–69.4% |

  - Match points count wins as one and draws as half; intervals resample opening pairs. These are results for the tested players, not estimates of optimal play or a ranking of the variants' depth.
  - **Calculation burden:** any-line shifts increase raw opening actions from 192 to 1,344, but distinct resulting boards from 72 to 240. On 24 common positions after 16 placements, distinct next boards averaged 123 versus 875. On 24 identical midgame boards, the combined rules reduced median completed lookahead from four to two plies at 4k evaluations, and five to three at 16k. These are selective-search measurements, with the current game reaching the configured five-ply cap.
  - **Depth checks:** greedy beat random in all 24 calibration games per variant. The middle search tier scored 91.7% against greedy in the current game, 65.6% in the combined game and 62.5% in the three-edge follow-up (48 games each; the last interval includes 50%). Exhaustive two-ply analysis covered 64 shared late-game boards under each of five rule sets. Search missed one optimal decision in the combined panel, confirming that its beam is not a proof solver. These boards were sampled from current-rule survivors, not each variant's expert play.
  - **Robustness and balance:** different openings, a wider beam and a higher enemy-stone cost still produced 41 draws in 80 combined-rule games. The higher-budget player scored 59.4% (95% interval 51.3–66.3%). In 96 additional equal-agent games per variant, the first player scored 57.8% in both current and combined rules; uncertainty and the shared agent policy prevent a fairness claim. The three-edge follow-up has not received this sensitivity or larger balance check.
  - **Research basis:** [Lantz et al., *Depth in Strategic Games* (2017)](https://www.nealen.net/papers/Lantz2017Depth.pdf) motivates a ladder of increasingly effective strategies instead of treating branching alone as depth. [Browne and Maire, *Evolutionary Game Design* (2010)](https://rafal.io/static/papers/evolutionary_game_design_ludi.pdf) motivates measuring self-play completion and duration, then checking appeal with people. These are useful approaches, not universal quality measures. This study does not establish that any variant is deeper than the current game or chess.
  - **Proposal for J12:** make the next candidate **Three Edges**, initially optional with Classic retained. Keep 7x7 and the one movable neutral star. Place one stone, shift any row or column one square with wrapping, and win when the star-containing orthogonal group reaches at least three of the four edges. Connections do not wrap; empty/unchanged-line shifts remain legal; both qualifying or a full board without a qualifier draws. This preserves the larger choice space while avoiding the high observed four-edge draw rate. Its roughly 20-placement games could suit agent matches, but shorter duration is not evidence of greater or lesser depth.
  - **Interface and next evidence:** show each player's four reached-edge indicators with a three-edge target, separate placement from line selection, use explicit notation such as `MOVE: E3 ROW 4 RIGHT`, and persist a ruleset version so old games replay correctly. Before promoting it, compare color-swapped LLM games with Classic under comparable budgets, test an independent search policy, and check whether people can follow remote shifts and star movement. No extra pieces, scoring tiebreaker or relocation rule is proposed.
  - **Verified:** all 1,232 recorded games replayed legally with matching outcomes; all 5,000 random outcomes and 96 matched-position search decisions reproduced. Typecheck, build and all 349 offline tests passed, including the prototype's agreement with the production engine and an independent connectivity oracle. Local research only; J6 remains the separate `next` decision.

- **J10 (2026-10-04):** one real Crosscurrent game started and observed through the Codex in-app browser, on the local build with isolated temporary data. Request plan (maintainer evidence), evidence (maintainer evidence), setup (maintainer evidence) and final board (maintainer evidence).
  - **Players:** Codex `gpt-6-astra` (accepted name `6 Astra`) as Circle; Claude Code `default` (accepted name `Default (recommended)`) as Diamond. Both accepted low effort, used `provider-login`, with Ask permissions and internet off. Move clock: two minutes.
  - **Result:** Codex won on its eleventh move, after 21 moves total, in 246.2 seconds. Its left-to-right group included the star at E5. No illegal answers, provider failures or incomplete requests.
  - **Ceiling:** 25 of 148 requests: two activation checks, two READY briefings and 21 moves. The live harness enforced the ceiling and a single game, and latched on provider/service failure without resending uncertain work.
  - **Browser checks:** the displayed board matched a replay of the displayed moves at moves 20 and 21. Checked the initial board, early star movement, latest position and result after reload. The pane divider was resized by pointer drag. Mock/referee tests (18) and the authenticated browser connection passed before live activation.
  - **Cleanup and scope:** both test agents stopped, with zero remaining owned processes and no cleanup errors. No installed-plugin changes or publication. One game establishes this live flow, not model rankings or opening balance.

- **J9 (2026-10-04):** tested the built room through the Codex in-app browser, using isolated temporary data and scripted simulator participants. No live provider requests, installed-plugin changes or publication.
  - **Found and fixed:** in the narrow app panel (714px), clicking Start scrolled past the board and left it offscreen. New runs now reset the whole Gamer pane's scroll, and responsive boards fit its height as well as its width. An automated browser regression checks both conditions.
  - **In-app behavior:** two games with players swapped each completed after 11 legal moves. Each intentionally tried placing on the star; the referee refused it and accepted the repair. Circle won with the star in its connected group, mapped to the correct agent in each game.
  - **Replay:** checked the star at D4 initially, E4 after the first move, G4 after the fifth, A4 after the seventh (wrapping), and C4 at the finish. Reload retained the result, and a fresh game reset the board.
  - **Verified:** typecheck, build, all 343 offline tests and both Gamer browser scenarios passed. The app's narrow-panel check also passed after the fix. Evidence (maintainer evidence) and screenshot (maintainer evidence).

- **J8 (owner, 2026-10-04):** Crosscurrent now uses 7x7 only and one shared neutral star, initially at D4. This replaces J7's smaller-board options and win condition.
  - **Rules:** the star moves and wraps with its row or column, belongs to neither player and cannot be replaced or captured. A winning connected group must contain the star and touch two opposite borders. Both players are checked after the shift. A game lasts at most 48 placements.
  - **Room and agents:** the board shows a gold star; the rules panel reports its coordinate; text positions use `*`. The size picker is removed and older setup preferences normalize to 7x7. Go retains its own size preference.
  - **Verified:** typecheck, build and all 343 offline tests passed. An independent component oracle agrees on 59,049 small graph fixtures; 36 seeded 7x7 games preserve exactly one star and end within 48 moves. Both Gamer browser scenarios passed, including a complete Crosscurrent game, old setup preferences, result history, replay, and a 390px viewport.
  - **Local only:** no live provider game, installation or publication in this step. Opening balance remains unmeasured.

- **J7 (owner, 2026-10-04):** reviewed Gamer and added Crosscurrent as its fourth game, with 5x5 the default and 3x3/7x7 alternatives under the same rules.
  - **Rules:** place in an empty square, shift that row or column one square with wrapping, then check both players' orthogonal connections between opposite borders. Connections do not wrap. A move can give the opponent a win; both players connecting, or a full board without a connection, is a draw.
  - **Integration:** agent briefings and compact position text, `MOVE: A1 RIGHT` notation, validated moves and repairs, saved results, simulated players, circles/diamonds, shifted-line and winning-path highlights, and replay.
  - **Review fixes:** the simulator keeps complete refused moves including their directions; next-game setup previews the selected board; Go and Crosscurrent keep separate sizes; starting a game resets the sidebar scroll so its players stay visible.
  - **Verified:** typecheck, build, all 342 offline tests and all 12 browser scenarios passed. The connection result agrees with an independent component checker on all 19,683 possible 3x3 boards. Simulated games finish on all three sizes; browser checks cover setup, persistence, completion, replay and a 390px viewport. Gamer checks were rerun after the final UI refinements.
  - **Limits:** no live provider game was run for J7. Opening balance and strength differences between board sizes are not established. This is a local, unreleased change; J6's default-effort decision remains separate.

- **J4 (2026-10-04, 237 requests of a 612 ceiling):** one game of each at once, Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort under Ask with internet off, as Quick activate sets them up.
  - **Chess** (Claude Code White): Codex won in 54 moves, when White resigned against a pawn about to queen. 26 minutes.
  - **Checkers** (Codex Black, first): a draw by threefold repetition after 36 moves each. 28 minutes.
  - **Go 9x9** (Claude Code Black): Claude Code won when White resigned at move 43. 13 minutes.
  - **No illegal answer** in 223 moves, without a list of legal moves. Every brief was answered READY within 7 seconds.
  - **Time:** on average Claude Code took 8 to 22 seconds a move and Codex 20 to 26; the longest took 88. The referee's own check took 9 ms a turn in chess at move 59 and under 1 ms in checkers and Go, so the time is all the agents' thinking. Lower effort or a faster model is what would speed a game up.
  - **Context:** turns stayed the same size (124 to 157 characters in chess, 130 to 156 in checkers, 245 to 252 in Go). Each agent's context grew only by its own replies and reasoning: in chess, Claude Code's from 35k to 68k tokens over 54 moves, Codex's from 22k to 45k.
- **J3 (2026-10-04):** the Gamer tab.
  - **The view:** in Gamer mode the board (SVG: slate squares for chess and checkers, wood for Go, the last move in the room's blue) takes the conversation pane's place. Beside it: the players (side, illegal answers, who is thinking, the winner), the moves with replay, and the setup (the game, Go's board size, who moves first, the time per move). A finished game offers **New game** in place of its moves.
  - **Elsewhere:** the slider has four modes, the sidebar has no builder in Gamer, the thread list counts games and shows the result, and the header shows the move.
  - **The simulator** plays a random legal move in each turn's position, read back with each engine's `fromPosition`, and answers the brief READY.
- **J2 (2026-10-04):** a Gamer run (mode `game`) uses the same turn engine as a debate. Whoever moves first opens, then the agents alternate.
  - **The brief (owner, 2026-10-04):** before the game, each agent gets the rules, the standard notation, a sample turn, the answer form and the limits through its 1:1 line, and replies READY. A failed brief refuses the start.
  - **The prompt:** each turn is three lines: the move number, the side and the opponent's last move; the position in standard notation (FEN in chess, PDN FEN in checkers, a grid with the side to play in Go); and the answer form. No move history and no legal moves (owner, 2026-10-04): an agent must know the rules, and a turn doesn't grow as the game goes on. The agents never see each other's replies, only the moves.
  - **The referee:** it judges the agent's last MOVE line. A legal move is recorded as the game writes it (Qh4#, 22x15x8, D4), so a game's moves are its committed messages and replay to its position.
  - **Illegal answers:** an illegal answer, or none, is asked again with the reason, through the same repair turn a debate uses. Three in a row lose.
  - **Losing otherwise:** a move past its time limit (5 minutes by default) loses on time, and MOVE: resign resigns.
  - **The end:** the result (winner or draw, the reason, and Go's score) is saved on the run, which ends as game_over. The thread list shows it.
  - **Threads:** each game is its own thread, with fresh sessions.
- **J1 (2026-10-04):** `src/games/`, with no dependencies, shared by the service and the room.
  - **Chess:** every rule a move must pass (castling, en passant, promotion, check, mate, stalemate, threefold repetition, the fifty-move rule, insufficient material), with moves in standard algebraic notation (UCI accepted). It matches the standard perft counts on five positions (the start, Kiwipete and positions 3 to 5), as open-source generators such as chess.js are checked.
  - **Checkers:** English draughts with the standard 1-32 numbering, compulsory and chained captures, crowning that ends a move, and the 40-move and repetition draws. It matches the published perft counts from the start (7, 49, 302, 1469, 7361).
  - **Go:** no-suicide Tromp-Taylor rules, positional superko, two passes to end, area scoring with 7.5 komi.
  - **References:** chess.js (BSD-2) and chessboard.js (MIT) for chess; draughtsboard for checkers; the Tromp-Taylor rules for Go. Nothing is copied: each engine is our own, a few hundred lines.

## Phase K — understandable and repeatable comparisons (owner, 2026-10-05)

The owner approved all five recommendations after J15. Work locally, with one commit per completed step. Provider request ceiling for implementation and automated testing: **0**; use disposable simulated pools. The user's approval also resolves J6's decision about visible speed/quality presets.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| K1 | Completed-game Crosscurrent analysis beside replay: proven tactical mistakes, alternatives, forcing sequences, local computation | offline | done |
| K2 | Twenty verified Crosscurrent puzzles, deterministic grading, agent accuracy/time/illegal-move results | offline | done |
| K3 | Persisted game/debate series, side swaps, frozen settings, cancellation, uncertainty and reports | offline | done |
| K4 | Quick, Standard and Deep presets with visible actual effort and time limits (J6) | offline | done |
| K5 | Separate judge and participant ballots, visible disagreement, independent reversed-order judging check | offline | done |
| K6 | Prepare unreleased source notes and portable regression fixtures for GitHub publication, without a new version or tag | offline | done |

- **K6 (2026-10-05):** refreshed the unreleased notes, current rules and comparison-tool guide, fixed release-note navigation, and separated the released v0.4.6 install from development `main`. Public tests use board-only fixtures instead of omitted private evidence. Exported Markdown removes links into the excluded evidence tree. A clean public checkout passed typecheck, build, 391 offline tests, all 19 browser scenarios, and both staged-plugin smoke suites (Codex 23 checks; Claude Code 26). The snapshot leaves package/manifests, release tags, installed profiles and the normal conversation pool unchanged.

- **Phase K verification:** typecheck, build, all **391 offline tests** and **19 browser scenarios** passed. The full browser run had one obsolete blinding-text assertion; its corrected scenario and all five feature flows passed the targeted rerun. Final visual review separated saved series results from new-series settings, with that scenario rerun successfully. Verification and limits (maintainer evidence). Six screenshots were inspected, including the puzzle panel at 390px. All provider behavior in these checks is simulated; zero live requests, shared-pool writes, installation or publication.

- **K5:** the ballot distinguishes the independent assessment, participant self-reviews and panel outcome, flags disagreements, and exposes each participant’s explanation. An explicit four-request presentation-order check uses two fresh sessions of the recorded judge/configuration: the same blinded speeches grouped in opposite orders, with original round/speaking-order markers preserved. Its separate saved diagnostic can agree or disagree, includes sampling-variation limits, keeps earlier checks, and never changes the original votes. Cancellation, Stop all, restart interruption, concurrent rejudging/deletion guards and idempotent UI start are covered. Blinding text now accurately says identities are withheld rather than claiming recognition is impossible.

- **K4 / J6:** Quick requests low effort with 60 seconds, Standard medium with 120 seconds, and Deep high with 300 seconds. Model-specific catalog previews show actual selectable effort and disclose fallback or unsupported controls. Presets are available in Gamer, Prompt/Build/Debate options, puzzle comparisons and series; custom clocks return to custom effort settings. Starting applies the chosen effort in fresh sessions, preserves model/speed/internet/permissions, and records the profile and accepted configuration. Gamer starts with Quick for new preferences; earlier custom preferences remain explicit. No running request is reconfigured.

- **K3:** match series support all four games and formal debates, 1–10 paired trials, fresh sessions, alternating colors or debate stances/opening order, frozen accepted agent/judge settings and a fingerprint of the executed rules/protocol. Every activation, brief, move, review and judge request counts against a saved ceiling. Cancellation and Stop all propagate through preparation, play and judging; restart marks uncertain series interrupted. Complete pairs alone contribute to scores, with a conservative 95% range and explicit small-sample limits. Results retain transcripts, replay links, all three debate ballots and JSON/Markdown exports. The runner reuses benchmark-owned session cleanup and the existing referee/controller.

- **K2:** twenty distinct, reachable positions curated reproducibly from J15: five wins, defenses, cooldown defenses and short forcing sequences each. Any legal move satisfying the goal passes exhaustive tactical checks. The Puzzles panel supports human practice, solution reveal and paired agent comparisons with fresh isolated sessions, frozen model settings, explicit request ceilings, time limits, cancellation, saved results and JSON export. Accuracy, answer time, illegal moves and provider failures stay separate. A service restart marks uncertain jobs interrupted without resending. The room’s sessions and the real shared pool are unchanged by tests.

- **K1:** completed cooldown games offer **Analyze game**. A cancellable browser worker checks every immediate winning move and defense, proves short forcing sequences, and separates already-forced losses from avoidable ones. Findings jump to replay positions; alternatives open an editable variation with undo and legal-move errors. The saved game stays intact, and long-term positional strength is explicitly unassessed. Production tactics are checked against all legal actions at 60 seeded positions and the J15 proof cases; a browser scenario exercises the recorded mistake, variation, invalid reply and return to replay.

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

- **F3 scope** (accepted by the owner 2026-10-03, with live checks on the owner's Cursor plan):
  - Cursor's agent through ACPX's registry entry (`cursor-agent acp`). Version 2026.09.28 is installed on this machine, as a `.cmd` and `.ps1` shim in `%LOCALAPPDATA%\cursor-agent`. Gemini CLI and Copilot aren't installed.
  - It passes the adapter checklist: activation through the login route, Ask refusing commands, cancellation, usage reporting, and isolation from the owner's own Cursor settings. Its process tree also stays inside AvA's job objects, shim included.
  - Live checks would use the owner's Cursor plan, which isn't among the four pre-approved subscriptions, so they need the owner's OK.
  - **Status: in progress. The live checks are blocked by the Cursor plan.**
    - **Built and tested offline:**
      - **Launch:** AvA starts Cursor's bundled Node and entry file (newest version) instead of its `.cmd` shim, so it needs no shell and runs inside AvA's job objects.
      - **Isolation:** AvA's Cursor agents get their own settings folder (`CURSOR_CONFIG_DIR`). Nothing runs without asking (the default allow list lets `ls` run), web searches ask, and commits aren't attributed to the agent. The sign-in is kept.
      - **Doctor:** `/ava doctor` shows Cursor's version, sign-in and plan.
      - **Plan refusal:** an activation that Cursor refuses for its plan says so.
    - **Live, 2026-10-03:**
      - Through AvA, discovery found 43 models and Cursor's mode and model settings, and Cursor's own sessions stayed in AvA's folder.
      - Every prompt (8 in all, including the default Auto model) came back "Upgrade your plan to continue". The account is on Cursor's Free plan. The probe's file write never happened.
    - **To finish:** a Cursor plan that includes agent requests (or another signed-in account). Then the checklist runs live: activation, Ask refusing commands, a Build's scoped edits, web searches following the internet switch, cancellation, usage reports and job containment.

## Standing decisions

- **One core, thin wrappers:**
  - the Codex prompt hook and the Claude Code `/ava` skill only route commands;
  - the logic and the room live in the shared core.
- **The four CLIs use their own subscription logins;** only the Vercel AI Gateway uses an API key.
- **Work whose outcome is unknown is never resent.**
- **The benchmark verdict is deterministic.** Model-graded scores are kept separate.
- **Isolation for untrusted work is a container,** through Docker, opt-in (X2). Trusted tasks use Node's permission guard (X1).
