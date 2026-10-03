# Agent vs Agent roadmap

The single plan for Agent vs Agent, starting from **0.1.1** (2026-10-02). It replaces the earlier build guide; finished work is in the [changelog](../CHANGELOG.md) and the git history.

**How it's used.** Work goes one item at a time, by ID. Each item has a **gate**:
- `offline`: code, tests and docs only;
- `live`: real agent requests, with a request ceiling stated first;
- `user`: needs the owner's decision or action.

An item is done when its "Done when" holds and the change is committed. Statuses: `next`, `todo`, `in progress`, `done`, `blocked: <why>`.

## Where 0.1.1 stands

- **Agents:** Codex, Claude Code, Grok Build, Antigravity (your installed CLIs, your sign-ins) and the Vercel AI Gateway (250+ models, API key).
- **Modes:**
  - Prompt (one answer each);
  - Debate (turns);
  - Build (apps side by side, or a Review of a project).
- **The room:** in-room activation, permissions and internet per agent, 1:1 lines, threads, search, stats, replay, export, a context ring, Clear history.
- **Hosts:** the same `/ava` commands in Codex and Claude Code. Each Codex chat and each Claude Code conversation keeps its own agents.
- **Verified:**
  - the offline suite;
  - 312 live checks on all five providers (0 failed);
  - the packaging gate on the installed plugins (agents can't start AvA, no sandbox prompts);
  - a clean-checkout build of the public release.
- **Published:** [0.1.0](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.0) and [0.1.1](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.1) on GitHub, as source. Each release is one public commit on top of the last.

## Phase 1 — polish 0.1.1 into a starting point (target 0.1.2)

Make the current version easy to build on: published, tested in CI, no known cheap gaps, and documented for contributors.

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| P1 | Publish 0.1.1, and GitHub release pages for 0.1.0 and 0.1.1 | user | done |
| P2 | Continuous integration on GitHub | offline (+ user to push) | done |
| P3 | No skipped tests | offline | done |
| P4 | Close the agent-isolation gaps found in testing | offline + live | done |
| P5 | Robustness fixes from the known limits | offline | done |
| P6 | First run and diagnostics: `/ava` help and `/ava doctor` | offline | done |
| P7 | Contributor docs, and the artwork decision | offline + user | done |
| P8 | Acceptance on the installed plugins, then tag 0.1.2 | user + live | done |

- **P1 Publish 0.1.1.** Re-run the export (one public commit on top of 0.1.0's), tag `v0.1.1`, and push with the owner's go-ahead. Create GitHub release pages for `v0.1.0` and `v0.1.1` from the changelog. *Done when* both releases are on GitHub, and the README links them. **Done 2026-10-02.**
- **P2 CI.**
  - A GitHub Actions workflow on Windows with Node 24: `npm ci`, typecheck, `npm test`, `npm run package`, and the package smoke test for both plugins. No live requests.
  - A status badge in the README.
  - *Done when* a push to `main` runs green.
  - **Local work 2026-10-02:** added `.github/workflows/ci.yml` and the badge. Typecheck, build, tests (123 passed, one private-fixture skip), and both staged plugin smoke tests passed. The GitHub run awaits an authorized public export/push; it is not yet verified green.
  - **Final P2–P7 validation:** Node 24.21.0 ran all 135 tests with zero failures/skips and both staged plugin smoke checks (16 Codex / 19 Claude). Typecheck, build, documentation links and YAML checks also passed. No push, release tag or real-profile installation was performed.
  - **First hosted attempt 2026-10-02:** GitHub rejected the job-level `runner.temp` expression before a runner started. Actionlint reproduced the error. The isolation directory is now set in a PowerShell step using `RUNNER_TEMP`; the CI-only follow-up preserves the already pushed 0.1.2 tag.
  - **Done 2026-10-02:** [Windows / Node 24 CI passed on public `main`](https://github.com/adamczhang/Agent-vs-Agent/actions/runs/37092660252), including `npm ci`, typecheck, all tests, packaging and both plugin smoke tests. Public commit `8e11d6a` corrects only CI setup relative to the unchanged `v0.1.2` tag; the application code is identical.
- **P3 No skipped tests.** Replace the private pilot database that one migration test needs with a small synthetic schema-v1 fixture committed to `test/fixtures/`. *Done when* `npm test` shows no skipped tests. **Done 2026-10-02:** frozen SQL fixture, service/export and integrity checks; 124 tests passed, zero skipped.
- **P4 Agent isolation.**
  - Codex agents currently start the MCP servers in the user's own Codex config (seen: `node_repl`). Turn those off for agents, as plugins, apps and hooks already are.
  - Check whether Claude Code agents load the user's own MCP servers, and close or document it.
  - *Done when* a process census during a live run shows only the agents' own processes.
  - **Done 2026-10-02:** Codex disables effective disk MCP entries at startup and drops session-supplied MCP overrides; Claude Code uses strict MCP configuration. Offline launcher tests pass. The first live attempt stopped at a configuration error before any model request; after a fix and owner-approved retry, one subscription response and process census passed for each CLI (`pilot-evidence/stage-d/p4-isolation.json`).
- **P5 Robustness.**
  - Copy Build projects off the service's main thread, so a large project doesn't freeze the room.
  - Make `secrets/` and `server.json` owner-only on Windows (file permissions, not just mode 0600).
  - Have Stats use the token counts Codex and Claude Code report, with estimates only for the CLIs that don't report them.
  - Drop the per-process fallback for a call with no chat identity, once no wrapper sends one.
  - *Done when* each change has a test, and the known-limits list shrinks to match.
  - **Done 2026-10-02:** Build preparation uses workers with conflict guards; secret writes and existing Gateway keys get owner-only Windows ACLs; Stats saves per-request reported token deltas; MCP chat-scoped tools require an identity. Typecheck/build, 129 tests (zero skipped), and both staged package smoke tests passed; ACLs were inspected on Windows.
- **P6 First run and diagnostics.**
  - `/ava` with no arguments shows a short help.
  - `/ava doctor` checks each CLI (installed, version against AvA's minimum, signed in where that can be checked) and the Gateway key and credit, with no model requests.
  - The activation menu flags a CLI that needs an update.
  - *Done when* it works in both hosts, with tests.
  - **Done 2026-10-02:** help/doctor routing and diagnostic, credit-error, menu-warning and idle-shutdown tests pass. Staged MCP checks passed for both wrappers (16 Codex / 19 Claude checks); no model requests. The changed Codex hook will need the owner's trust review when installed; no real profile was changed.
- **P7 Docs and artwork.**
  - `CONTRIBUTING.md`: setup, tests, the simulator, the live suites and their quota, the release and export steps.
  - `SECURITY.md`: the local token model, and what Bypass trusts.
  - Issue and pull-request templates, and a user-guide refresh.
  - **User:** confirm the rights to the banner and icon (a *Spy vs. Spy* homage), or replace them.
  - **Done 2026-10-02:** contributor/security guides, issue and PR templates, and user-guide updates added. The owner explicitly confirmed the rights and chose to retain the artwork. It remains excluded from the MIT license; no additional reuse permission is implied.
- **P8 Acceptance on the installed plugins.**
  - **User:** approve a plan with request ceilings.
  - **Authorized 2026-10-02:** finish branding, install, validate and publish 0.1.2; the owner additionally authorized unrestricted subscription usage and inexpensive Gateway calls, then revised the timed test to **5 minutes**. The planned batches are capped at 20 participant requests for each host's essential paths, 18 for the 5-minute Debate, and 4 each for Grok Build, Antigravity and a cheap Gateway model. Host-routing probes have separate logged ceilings. All test data is temporary; failures stop the current batch, and hook trust stays a user action.
  - Then run the essential paths in both hosts, and the **5-minute timed Debate** (owner revised from 15 minutes on 2026-10-02). A quota limit or a manual stop counts as an early exit, not a pass.
  - Record the result in the release notes and tag **0.1.2**.
  - **Done 2026-10-02:** 23 essential checks per installed host wrapper; all four slash-command routes in each real host; Grok Build, Antigravity and cheap Gateway probes; and the uninterrupted 5-minute Debate (11 debate requests plus 2 activations) passed. All 137 offline tests pass on Node 24.21.0. Both installed plugins are 0.1.2, and the public release tag is pushed. See [0.1.2 release notes](release-v0.1.2.md); P2's hosted CI has also passed.

## Phase 2 — validated benchmarks with saved pass/fail (target 0.2.0)

The headline feature: benchmark prompts you can run on any pair (or many agents) where every attempt is saved with an explicit **pass** or **fail**, decided by a check rather than by eye.

### Standard formats, and what they share

| Format | A task is | Pass or fail is decided by |
| --- | --- | --- |
| HumanEval, MBPP | a function prompt | hidden unit tests run on the generated code |
| Aider polyglot (Exercism) | instructions plus a small project | the exercise's own test suite |
| [SWE-bench](https://openai.com/index/introducing-swe-bench-verified/) | `repo`, `base_commit`, `problem_statement` | `FAIL_TO_PASS` tests must pass ("did you fix it?"), and `PASS_TO_PASS` tests must keep passing ("did you break anything?") |
| [Terminal-Bench](https://www.tbench.ai/about) | an instruction, a container with the starting state, a reference `solution.sh` | `run-tests.sh` (pytest) checks the final state; the task counts only if every test passes |
| [Inspect AI](https://inspect.aisi.org.uk/datasets.html) | `Sample(input, target)` | a scorer (exact match, includes, pattern, or model-graded) |
| [promptfoo](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | a prompt and test cases | `assert` entries: equals, contains, regex, javascript, llm-rubric |
| [OpenAI Evals](https://github.com/openai/evals/blob/main/docs/build-eval.md) | JSONL lines with an `input` and an ideal answer | the eval template's match rule |

**The common pattern:**
- a task is an **instruction**, a **starting state**, and a **deterministic verifier**;
- a task counts as **validated** when a reference solution passes the verifier and a do-nothing attempt fails (Terminal-Bench's oracle solution, SWE-bench's fail-to-pass requirement);
- model-graded scoring exists, but as a separate, softer signal.

### The AvA task format

One folder per task, modelled on Terminal-Bench, with Inspect- and promptfoo-style checks for answers:

```text
benchmarks/<suite>/<task-id>/
  task.yaml          # what to ask, and how to judge
  fixture/           # optional starting project (Build and Review)
  tests/             # hidden verifier, copied in after the agent finishes
  solution/          # reference solution (validation only, never shown to agents)
```

```yaml
id: tip-calculator
version: 1
mode: build                  # prompt | build | review
prompt: |
  Build a single-page tip calculator. Export calcTip(bill, percent, people) from tip.js.
time_limit_minutes: 15
checks:                      # all must pass
  - run: node tests/verify.js        # Build: exit code 0 = pass (run in the agent's copy)
  - file_exists: index.html
# Prompt mode uses answer checks instead:
#   - equals: "7319"   - contains: "red"   - regex: "\\b42\\b"   - json_path: {path: "$.total", equals: 12.5}
# Review mode: findings must name each planted bug (answer key).
rubric: optional text for a model-graded score, saved separately, never part of pass/fail
```

### Items

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| B1 | Task format, loader and `bench validate` | offline | next |
| B2 | Checks engine | offline | todo |
| B3 | Runner in the room and from the command line | offline + live | todo |
| B4 | Saved results and a scoreboard | offline | todo |
| B5 | A starter suite of about 20 validated tasks | offline + live | todo |
| B6 | Prompt library and file manager in Prompt, Debate and Build | offline | done |
| B7 | Optional model-graded rubric score | offline + live | todo |
| B8 | Importers for the standard benchmark formats | offline | todo |

- **B1 Task format.** A schema for `task.yaml`, a loader, and `npm run bench -- validate <suite>`. The validator runs the reference solution, which must pass, and an empty attempt, which must fail. A task that doesn't validate can't be run. *Done when* invalid tasks are refused, with the reason.
- **B2 Checks.**
  - Answer checks for Prompt mode: equals, contains, regex, number with tolerance, JSON path.
  - Verifier commands for Build and Review: the hidden `tests/` are copied in after the agent finishes, so they can't be gamed, and run in the agent's copy with a time limit.
  - Every check records its own pass or fail and the evidence (output excerpt, exit code).
- **B3 Runner.**
  - In the room: a **Benchmarks** library under Prompt and Build. Pick a suite and run it on this pair.
  - Headless: `npm run bench -- run <suite> --agents codex:gpt-6-astra,claude:default [--repeat 3]`.
  - Repeats give pass@k and show flaky tasks.
  - The request ceiling is shown before a run starts.
- **B4 Results.**
  - Each attempt is stored with: task id and version, agent, model, effort, AvA version, pass or fail per check and overall, duration, tokens or cost when reported, and evidence.
  - Results export as JSON and CSV. A scoreboard shows pass rate per agent and model, per suite and over time, in the Results panel.
  - Re-running a task version never overwrites earlier attempts.
- **B5 Starter suite.** About 20 tasks across all three modes, each validated:
  - Prompt: exact-answer reasoning and extraction;
  - Build: small apps with hidden tests;
  - Review: planted bugs with an answer key, starting from the existing `buggy-shop` fixture.
- **B6 Prompt library and file manager.** Prioritized by the owner ahead of B1 on 2026-10-03. A shared library available in all three room modes: Prompt, Debate and Build (including Review). Save and edit prompts, preload starter prompts, import/export Markdown or text, and manage each prompt's reference files in the app. Keep each saved prompt and its files together under `<data>/prompts/`, outside conversation history. Load into the composer or run with the room's existing agents and options. *Done when* prompts survive a restart and Clear history, files stay with their prompt, and both agents receive the saved prompt and files in all three modes. This is a reusable prompt library; deterministic benchmark scoring still belongs to B1–B5. The original dataset-import scope is retained as B8.
  - **Done locally 2026-10-03:** shared file-backed library, six starter prompts, editor and file controls, Markdown/text import, Markdown export, save-draft, load and run. Typecheck/build and 169 offline tests passed, including component interactions and both-agent attachment delivery in every mode. Both staged package smoke checks passed (16 Codex / 19 Claude). No real model requests or profile installations. Browser tools were unavailable, so visual layout and installed-host acceptance remain unverified. Evidence: `pilot-evidence/stage-d/b6-prompt-library-*.json`.
- **B7 Rubric score.** An optional model-graded score from a third agent (say a Gateway model), stored as a separate number with the judge's identity. It never changes pass or fail.
- **B8 Importers.** HumanEval/MBPP-style (prompt plus tests), Exercism/Aider-style (instructions plus a test folder), and Terminal-Bench-style (instruction plus tests; needs F1 for container tasks). SWE-bench-style later: a repository at `base_commit` with fail-to-pass and pass-to-pass tests.

## Phase 3 — recommended major features (0.3 and later)

In order of value, as each builds on the last:

1. **F1 Sandboxed agent work.** Run Build and benchmark work for every agent in a sandbox (a container, WSL, or a restricted Windows account), not only Codex's. It's needed before running untrusted benchmark verifiers, and for Terminal-Bench-style tasks.
2. **F2 Tournaments and leaderboards.** Round-robin suites across many models (the Gateway's 250+ make this cheap to set up), with win rates and Elo for Debate (judged by B7) and pass rates for benchmarks.
3. **F3 More agents.** Any ACP agent through a custom-agent setting, with ready entries for Gemini CLI, OpenCode, Qwen Code, and the Cursor and Copilot CLIs when they offer ACP.
4. **F4 macOS and Linux.** The service, process census and packaging on both, with CI on all three platforms.
5. **F5 Usage and cost.** A per-run and per-suite view of the context and token data the agents already report, plus Gateway spend.
6. **F6 Easier install.** A prebuilt download or a marketplace listing, once the Claude Agent SDK's terms have been reviewed.
7. **F7 Games and scenarios.** Structured games with a referee (a separate worker that owns the game state, as sketched in the architecture notes).
8. **F8 Room inside the host.** An MCP Apps view of the room in Codex and Claude Code, beside the browser room.
