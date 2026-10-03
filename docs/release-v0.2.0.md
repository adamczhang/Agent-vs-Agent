# Agent vs Agent v0.2.0

**First stable release — 2026-10-03.** This is the baseline for future releases. Earlier 0.1.x tags are development history; their release pages have been retired.

## Install

This is a **source release** for Windows with Node.js 24 or newer. Follow [Quick install](../README.md#quick-install) to build the local marketplace and install AvA into the Codex host, the Claude Code host, or both.

The host opens and controls the room. Its two participating agents are configured independently: Codex CLI, Claude Code, Grok Build, Antigravity, or a Vercel AI Gateway model through the Codex adapter. Codex and Claude Code can be hosts, participating agents, or both.

## Included

| Area | Capability |
| --- | --- |
| Prompt | Independent answers to the same prompt and attachments |
| Debate | Selected opener, alternating turns, pause/resume and queued constraints |
| Build and Review | Separate project copies, file tools, app previews and change comparisons |
| Saved prompts | Six editable starters, Markdown import/export and reference-file management |
| Benchmarks | Task validation, deterministic grading, fresh-session repeats, saved evidence, scoreboard and exports |
| Room controls | Private messages, search, replay, usage statistics, resizable panes and Resources |
| Permissions | Ask-mode refusal of shell/process execution, explicit Bypass, and per-agent web-tool control |

The benchmark starter suite contains one Prompt, one Build and one Review task. The full feature record is in the [changelog](../CHANGELOG.md).

## Validation

The release baseline passed **215 offline tests** and **7 Chromium scenarios**. Installed-plugin acceptance used **99 participant requests** across all five providers. Live batches took **13 minutes 51 seconds**; the complete acceptance window, from first mock to final offline confirmation, took **34 minutes 48 seconds**.

Initial reasoning, output-format and timing failures are retained in the [validation record](validation.md), together with fixes and retests. These are functional acceptance checks, not a model ranking. The README screenshot uses a recorded Grok Build debate from that acceptance run.

The [Windows / Node 24 workflow](https://github.com/adamczhang/Agent-vs-Agent/actions/workflows/ci.yml) checks source installation, types, tests, browser scenarios, packaging and both plugin wrappers. Check the run associated with the release commit for hosted status.

## Limits

- **No common operating-system sandbox.** Ask rejects execution requests sent to AvA, but provider-side permissions remain a separate boundary. Bypass trusts execution with the user's privileges.
- **Live program verifiers are blocked.** Deterministic answer and file checks work; running generated programs requires the planned execution isolation.
- **No automatic resend or crash recovery.** Interrupted work can require manual release after process cleanup.
- **Windows and source installation only.** Prebuilt bundles, additional operating systems and an embedded MCP Apps room remain planned.
- Gateway compatibility varies by model. The activation check must succeed before an agent can participate.

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

Back up the data folder, stop active AvA work, rebuild the marketplace and update the plugin in each host. Reload the hosts to load the new core. Public builds default to `%USERPROFILE%\AgentVsAgent`; preserve `AVA_DATA_DIR` or your package data setting if an existing installation uses another folder. Installation and removal do not erase that pool.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
