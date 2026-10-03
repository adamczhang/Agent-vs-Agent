<p align="center">
  <img src="docs/images/banner.jpg" alt="Agent vs Agent" width="100%">
</p>

<p align="center">
  <b>Two AI coding agents, side by side, on your own machine.</b><br>
  Give them one prompt and watch them answer, debate each other, or build the same app.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/adamczhang/Agent-vs-Agent/releases"><img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-informational.svg"></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078d4.svg">
  <img alt="Node.js 24 or newer" src="https://img.shields.io/badge/node-%E2%89%A524-339933.svg">
</p>

---

**Agent vs Agent** (AvA) is a plugin for **Codex** and **Claude Code**. It runs two coding agents in one controlled room. Pick any two of **Codex**, **Claude Code**, **Grok Build**, **Antigravity** and the **Vercel AI Gateway** (250+ models from OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Kimi, GLM and more), or the same one twice. The CLIs run as themselves, signed in with your own accounts, and no third model relays their turns.

<p align="center">
  <img src="docs/images/room.png" alt="The Agent vs Agent room: Codex and Claude Code debating tabs versus spaces, each agent's own screen on top and the shared conversation below" width="100%">
</p>

## Three modes

| Mode | What happens |
| --- | --- |
| **Prompt** | Both agents get your prompt at the same moment and answer once. Compare the answers, timing and speed. |
| **Debate** | The agents talk to each other about your topic. Prime each one privately first with its 1:1 line. |
| **Build** | Both build the same app, each in its own folder, and post a link to it. Open the two apps side by side, or compare their changes. Or have both review a project and rank what they find. |

## Requirements

- **Windows** with **Node.js 24** or newer.
- At least one agent, installed and signed in:

| Agent | Needs |
| --- | --- |
| Codex | Codex CLI **0.159.1 or newer** (`npm install -g @openai/codex@latest`), signed in |
| Claude Code | Claude Code **2.1.286 or newer** (`claude update`), signed in |
| Grok Build | The Grok CLI, signed in |
| Antigravity | Antigravity, signed in |
| Vercel AI Gateway | An AI Gateway API key (it runs on your installed Codex CLI) |

AvA uses your installed CLIs and their own sign-ins. It never asks for the CLIs' API keys.

## Install

AvA installs from source for now.

```powershell
git clone https://github.com/adamczhang/Agent-vs-Agent.git
cd Agent-vs-Agent
npm ci
npm run package
```

That builds a local marketplace in `release\marketplace` (about 76 MB). Install it into one host or both:

- **Claude Code:**
  ```powershell
  claude plugin marketplace add .\release\marketplace
  claude plugin install agent-vs-agent@ava
  ```
- **Codex:**
  ```powershell
  codex plugin marketplace add .\release\marketplace
  codex plugin add agent-vs-agent@ava
  ```
  Then open Codex's **Plugins** settings and review and trust AvA's prompt hook (it routes typed `/ava` commands).

## Use

1. Type `/agent-vs-agent:ava start` in Claude Code, or `/ava start` in Codex. The room opens in your browser panel.
2. Click **Activate** above each agent's screen and choose its CLI, model, effort and permissions. Each activation makes one short access check.
3. Pick a mode and send a prompt.

**Vercel AI Gateway:** there are three ways to give AvA a key:
- create one from the agent's menu (**Gateway key**), using your Vercel CLI login;
- store one from a terminal with `npm run gateway-key -- set` (the key is never shown);
- set `AI_GATEWAY_API_KEY`.

The menu lists the Gateway's models by maker, with a search box.

## Good to know

- **Isolated agents.** Each agent sees the shared prompt and the other's final replies, never the other's private messages, thinking or tool use.
- **Permissions per agent.** **Ask** (the default) allows no tools in Prompt and Debate, and in Build only inside the agent's own folder. **Bypass** approves every tool request, for benchmarks where the agents should run code.
- **Internet per agent.** Off by default, and enforced by AvA, not just requested.
- **Context at a glance.** A ring beside each agent fills with its context window. Click it for the token count, session usage, and where to see your plan limits.
- **Local only.** The room runs on 127.0.0.1 behind a random token. Don't share its link.
- **Your data** lives in `%USERPROFILE%\AgentVsAgent`, shared by both hosts.
  - To use another folder, set `AVA_DATA_DIR`, or `config.dataDir` in `package.json` before packaging.
  - **⋯ → Clear history** deletes it.
- **Resources.** Each thread with live agents runs two CLI processes; AvA warns from the third.

Known limits are listed in [the architecture notes](docs/architecture.md#known-limits). The biggest: in Build mode an agent's commands run in its own folder but aren't sandboxed (except Codex's).

## Documentation

- [User guide](docs/user-guide.md): the room, modes, permissions, hosts and data.
- [Architecture](docs/architecture.md): how it's built, and its known limits.
- [Changelog](CHANGELOG.md) · [Release notes for 0.1.0](docs/release-v0.1.0.md)

## Development

```powershell
npm ci
npm run typecheck
npm test            # builds first; offline, no provider calls
```

- `npm run dev:sim` opens a room with simulated agents, at no quota cost.
- `node --import tsx scripts/live-validate.ts` runs the live test suites on every installed CLI. They use your provider quota, and Gateway credit for Vercel.

## License and credits

[MIT](LICENSE) © 2026 Adam Zhang · [adam.dadvibes@gmail.com](mailto:adam.dadvibes@gmail.com) · [x.com/dad__vibes](https://x.com/dad__vibes)

The banner and icon artwork is not covered by the MIT license. Agent vs Agent is an independent project, not affiliated with OpenAI, Anthropic, xAI, Google or Vercel; their product names are trademarks of their owners.
