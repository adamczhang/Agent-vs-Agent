# Changelog

All notable changes to Agent vs Agent. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## [0.1.3](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.3) - 2026-10-03

- Restored the draggable horizontal divider between the CLI screens and the lower pane, including Stats and Results, with remembered sizing, keyboard adjustment and double-click reset.
- A shared Prompt library in Prompt, Debate and Build, with six starter prompts, Markdown/text import, Markdown export, a prompt editor, and attached-file add/rename/preview/download/remove controls. Save a composer draft, load a saved prompt, or run it with the current agents. Prompt folders persist outside conversation history; stale edits and unsafe file paths are refused.
- Retrying the same start while Build preparation is in progress shares the original result, preserving the browser's saved request identity. Conflicting starts remain blocked.
- Codex and Gateway agents accept literal MCP names containing dots, spaces and other punctuation while keeping every inherited server disabled; names are passed without shell interpretation.
- A seat that made no requests no longer hides token totals or speed from other runs in the same thread. Missing reports for actual requests still remain unavailable.

## [0.1.2](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.2) - 2026-10-02

- Refreshed banner and plugin artwork, with the same new logo used in the listing and composer, plus clearer README wording.
- A paced Debate that reaches its deadline finishes as `duration_reached`, even when its wake or per-turn timer runs before the deadline callback.
- Token reports use the adapters' per-request records, including when their field named cumulative contains only the latest turn; smaller replies no longer make Stats unavailable.
- Windows / Node 24 CI builds and tests both plugins without provider requests.
- Migration tests use a committed synthetic schema-v1 fixture, so a clean checkout runs every test.
- Agent launches exclude inherited MCP servers: Codex disables configured servers before startup, and Claude Code uses strict MCP configuration. The installed host profiles are unchanged.
- Build project preparation runs in a worker so the room stays responsive; conflicting pair changes wait until preparation finishes.
- Windows secret files and the rendezvous token get owner-only ACLs before secret bytes are written. Existing Gateway keys are protected when the service starts.
- Stats uses reported per-request input/output tokens for Codex, Claude Code and Gateway agents. Only Grok Build and Antigravity use labeled estimates; missing historical reports stay unavailable.
- Chat-scoped MCP tools require a chat identity instead of falling back to a pair shared by the host process.
- `/ava` shows help without creating a pair. `/ava doctor` checks CLI installation, version and supported sign-in status plus Gateway credit, with no model requests; activation menus flag required updates. Both hosts support the command. The changed Codex hook requires the user's review when installed.
- Contributor and security guides, issue and pull-request templates, and refreshed usage documentation. The owner confirmed retaining the existing banner and icon; artwork remains excluded from the MIT license.

## [0.1.1](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.1) - 2026-10-02

### Changed

- **One set of `/ava` commands in both hosts.** Claude Code now takes `/ava start`, `/ava CLI1`, `/ava CLI1 2`, `/ava status` and `/ava reconcile`, exactly as Codex does. It comes from a plugin skill; the full name `/agent-vs-agent:ava …` still works, and menus read `Reply: /ava …` in both.
- **Each Claude Code conversation keeps its own agents,** like a Codex chat, instead of one pair per Claude Code process. Resuming a conversation brings its agents back.

### Added

- **A public [roadmap](docs/roadmap.md):** polish toward 0.1.2, then validated benchmarks with a saved pass or fail for every attempt (0.2.0), then larger features.

### Known limitations

- **Codex agents start the MCP servers in your own Codex config** (seen: `node_repl`). Plugins, apps and hooks are already off for agents; turning these off too is planned (roadmap P4).

## [0.1.0](https://github.com/adamczhang/Agent-vs-Agent/releases/tag/v0.1.0) - 2026-10-02

The first public release. Released as source: build it with `npm ci` and `npm run package` (see the README).

### Agents

- **Any two agents** from Codex CLI, Claude Code, Grok Build and Antigravity (the same CLI can take both seats). They run as the user's own installed CLIs through ACPX (Codex 0.159.1 or newer, Claude Code 2.1.286 or newer; AvA says when one needs an update), signed in with the user's own provider login; AvA never asks for their API keys.
- **Vercel AI Gateway** as a fifth choice: 250+ tool-using models from about 30 makers, through the Codex agent pointed at the Gateway (configured per process; the user's own setup is untouched).
  - **Menu:** maker, then model (newest first, paged), with a search box in the room. Each model's own effort levels are offered.
  - **Key:** an AI Gateway API key from the environment, stored with `npm run gateway-key -- set` (shipped as `dist/src/gateway-key.js`), or created from the menu with the user's Vercel login and a monthly budget. It is never shown.
- **Activation from the room:** Activate above each agent's screen opens the same text menu as `/ava CLI1`, with clickable lines. Choose the CLI, model, effort, speed and account route. One short request checks access.
- **Readable agent screens:** a Debate reply streams as its message text, not the JSON envelope the agents answer in.
- **Text menus in the hosts:** `/ava CLI1`, `/ava CLI2` (Codex) and `/agent-vs-agent:ava CLI1` (Claude Code; `/ava` from 0.1.1).
- **Per-agent permissions:**
  - **Ask** (default): no tools in Prompt and Debate; in Build, only inside the agent's own folder, and never into a CLI's own settings folder there (`.claude`, `.codex` and so on).
  - **Bypass:** every tool request approved; Codex runs in full-access mode.
- **Per-agent internet switch,** enforced: a permission gate for Claude Code and Antigravity, and a launch setting with a restart into the same session for Codex and Grok Build.
- **Attachments:** images and text files. An image is refused up front for an agent that can't read images (Grok Build).

### Modes

- **Prompt:** one prompt to both agents at the same moment; one answer each, with timing.
- **Debate:** the agents converse in turns, with a choice of who speaks first, per-agent private instructions and stop conditions, time and request limits, and pace.
- **Build:** both agents build the same thing, from scratch or from a copy of a project, each in its own folder. One prompt per session.
  - **Setup first:** a Build session's 1:1 lines may run commands, to clone a repository first, say.
  - **App links:** each agent ends with an `APP:` line, shown as **Open app**. Static pages are previewed on their own loopback origin; a server the agent leaves running is kept until Clear Session.
  - **Results:** both apps side by side, at the same height as the agent screens, plus each agent's changes against its starting point.
  - **Cleanup:** leftover processes are stopped when the build ends (the CLIs' own helpers are kept).
  - **Watchdog:** a finished report is taken as final if a stuck command keeps the turn open.
- **Review:** both agents review the same project, each in its own copy, and report findings by severity.

### Room

- **Layout:** a clean three-part room: threads on the left; the two agents' screens (thinking, tool use and output, live) in the top half; the shared channel in the bottom half.
- **Threads:**
  - Continuous sessions with both agents.
  - **New thread** opens a clean page with its own two agents, with a warning from the third thread with live agents.
  - **Clear Session** gives this page's agents fresh sessions.
  - Threads can be renamed, and one search covers every thread.
- **1:1 lines:** private chat windows with each agent, in its own session, never shared with the room or the other agent.
- **Controls:** pause, next reply and stop. Presets for options.
- **Stats:** time to first token, reply time, estimated tokens per second, a per-agent table and a timeline.
- **Context and usage ring** beside each agent's status, after Claude's usage ring. It fills with the agent's context window (amber at 80%, red at 95%), and a click shows the window (e.g. 161.5k / 200k), the session's tokens and cost estimate, and where to see plan limits (the Gateway shows its credit).
- **Replay and export** (JSON or Markdown, including 1:1 lines). **Clear history** deletes everything saved, after a confirmation.

### Hosts and data

- **Two plugins, one core:**
  - **Codex:** typed `/ava` commands are routed by a prompt hook with a strict grammar to an MCP tool.
  - **Claude Code:** the namespaced `/agent-vs-agent:ava` command, which pre-approves only its own tool and only while it runs.
- **Plugin icon** for Codex (its logo, composer icon and brand color). Claude Code plugins have no icon field.
- **Shared conversation pool:** one data folder (`%USERPROFILE%\AgentVsAgent` by default; `AVA_DATA_DIR` or `config.dataDir` to change it) and one background service for every host and chat. The service shuts down when idle.
- **Expired room links** say so, and how to reopen the room, when AvA has restarted since the link was opened.
- **Storage:** SQLite (`node:sqlite`) with ordered migrations, and a refusal to open data from a newer version.

### Reliability and safety

- **Durable controller:** each reply and the next turn commit together, and work whose outcome is unknown is never resent.
- **Recovery:** a quarantined run is released by the operator only after a process census shows nothing from it still runs.
- **In Prompt and Build, each agent's answer stands alone:** if one agent's provider ends its turn, the other still finishes.
- **Turn limits:** AvA times turns itself, so a long answer isn't cut off by the agent layer's default timeout.
- **Local service:** loopback only, with Host and Origin checks and a random bearer token passed in the URL fragment and removed from the address bar.
- **Agent isolation:** neither agent sees the other's private messages, instructions, thinking or tools. The Gateway key reaches only Gateway agents.
- **Build copies** are made in a temporary folder and moved into place, so a failed copy leaves nothing behind. Git runs in them with hooks and fsmonitor off, and a copy whose git settings were changed to run programs isn't read.
- **Previews** serve only the agent's folder: no git data, no Windows alias names, no links leading out.
- **One service owner,** checked by PID and start time, so a PID Windows reuses after a reboot can't block the service.
- **Clear history** refuses to run beside other changes, and nothing starts while an agent restarts.

### Known limitations

- Tested on Windows only.
- Stats' token counts are estimates (characters ÷ 4) so every CLI is measured the same way. Codex and Claude Code report their own context and token use, which the context ring shows; Grok Build and Antigravity don't.
- In Build under Ask, a command runs in the agent's folder but isn't confined to it, and only Codex sandboxes its commands. The internet switch governs web tools (and Codex's sandbox), not other agents' commands.
- Bypass trusts the agent with the machine.
- Claude Code's own permission settings (allow rules, default mode) approve tools before AvA is asked; AvA points this out.
- Grok Build ends its turn when a permission is refused.
- Leftover processes are found by process tree; one that left the tree isn't stopped. Copying a large project holds the service until it finishes.
- On Windows, the stored Gateway key is protected only by the data folder's permissions.
- Gateway models: model and effort are fixed when the agent starts; some answer only in their reasoning and fail activation (Kimi K2.6, K2.7 Code); many call themselves "Codex".
- There is no automatic recovery after a crash; release is manual.
- Released as source only: building the plugin installs the Claude Agent SDK library (which AvA's Claude adapter uses) from npm under its own proprietary terms; no prebuilt package is distributed.
- The built plugin is about 76 MB: it uses the installed Codex and Claude Code rather than shipping its own copies.

The full list is in [docs/architecture.md](docs/architecture.md#known-limits).
