# Agent vs Agent v0.3.1

**Released 2026-10-03.** This is the first release since the v0.2.0 baseline. Installs start reliably, benchmark code runs confined, and benchmark results are worth sharing.

## Install

This is a **source release** for Windows with Node.js 24 or newer. To install AvA into the Codex host, the Claude Code host, or both, follow [Quick install](../README.md#quick-install). Live Build benchmarks that run on your machine need a Node release that can deny network access (`--allow-net`), such as Node 26. Imported tasks need Docker Desktop.

## What's new since v0.2.0

| Area | Change |
| --- | --- |
| Starting up | Starts with a data folder on a second drive (0.2.1). A service that can't start reports why within seconds, and `/ava doctor` checks the data folder (0.2.2). The host connects before the engine loads (0.3.1). |
| Verifier guard | A Build task's hidden tests, and the code they test, run under Node's permission model. They can read only that attempt's files, and can't start processes or use the network (0.2.4). |
| Process containment | Each agent runs in a Windows job object, and processes that start outside the job, such as Store apps, are tracked by their parent. Cleanup and Stop all find everything an agent started (0.2.5). |
| Container verifiers | Imported or untrusted tasks run their tests in Docker, with no network and the attempt mounted read-only (0.2.6). |
| Starter suite | 20 validated tasks: 8 Prompt, 7 Build and 5 Review (0.2.7). |
| Reports | A finished benchmark job saves as a standalone HTML page or as Markdown, safe to share (0.2.8). |
| Importers | Exercism JavaScript exercises and JSON Lines tasks with tests, container-isolated (0.2.9). |
| Rubric scores | An optional judge agent scores attempts from 0 to 10, kept separate from pass or fail (0.3.0). |
| Review | A small project's files come with the Review prompt, so Codex can review under Ask (0.3.0). |

Every change is in the [changelog](../CHANGELOG.md).

## Validation

The release passed **236 offline tests**, **7 Chromium scenarios** and smoke tests of both packaged plugins. The smoke tests launch each plugin the way its host does, on a data folder where the account holds only Modify rights.

Live checks ran on the development machine, each with its own request ceiling:
- **Activation in job objects:** all five providers passed. The same run stopped an answer mid-reply, cleaned up a Bypass Build that had left background processes running, and checked that Stop all left nothing running. The Gateway agent failed one activation, because its model gave no usable reply, and passed on retest.
- **Build benchmarks:** the tip calculator passed on Codex and Claude Code, both under the verifier guard (4 requests) and in containers (4 requests).
- **Full starter suite** (80 requests):
  - Claude Code passed 20 of 20.
  - Codex passed 15 of 20. It failed every Review task, because Ask refused the commands it reads files with.
  - After the Review fix, a rerun of the 5 Review tasks passed 5 of 5 on both agents (31 requests). A Gateway judge scored all 10 attempts.
- **Installed:** 0.3.1 installed in both hosts. Each connects in about a quarter of a second, and `/ava doctor` answers.

These are functional acceptance checks, not a model ranking.

The [Windows / Node 24 workflow](https://github.com/adamczhang/Agent-vs-Agent/actions/workflows/ci.yml) checks source installation, types, tests, browser scenarios, packaging and both plugin wrappers. On the hosted runner, Docker runs Windows containers, so the container tests skip. If the runner's Node lacks network control, the guard tests check the fallback instead.

## Limits

- **No common operating-system sandbox for agents.** Ask rejects execution requests sent to AvA, but provider-side permissions remain a separate boundary. Bypass trusts execution with your privileges.
- **The verifier guard is not a sandbox.** Node describes its permission model as a guard against accidents. Validate only task bundles you trust; untrusted ones belong in a container.
- **Live Build benchmarks on the host need `--allow-net`.** On a Node without it, they stay blocked. Container tasks need Docker Desktop running Linux containers, and the pinned verifier image, downloaded once.
- **Rubric judges** are named from the CLI or `bench.start`, not yet from the Benchmarks panel.
- **No automatic resend or crash recovery.** Interrupted work can require manual release after process cleanup.
- **Windows and source installation only.**

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

1. Back up the data folder and stop active AvA work.
2. Rebuild the marketplace, then update the plugin in each host.
3. Reload the hosts to load the new core.

The Codex prompt hook hasn't changed since v0.2.0, so it stays trusted.

- **Existing validations:** benchmark validations from before 0.2.4 used an older checker. Validate those tasks again before running them.
- **Data folder:** public builds default to `%USERPROFILE%\AgentVsAgent`. If an existing installation uses another folder, keep `AVA_DATA_DIR` or your package data setting. Installing and removing AvA don't erase that pool.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
