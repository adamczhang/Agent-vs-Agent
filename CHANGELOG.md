# Changelog

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
