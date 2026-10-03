# Agent vs Agent

[![Windows CI](https://github.com/adamczhang/Agent-vs-Agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/adamczhang/Agent-vs-Agent/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/adamczhang/Agent-vs-Agent)](https://github.com/adamczhang/Agent-vs-Agent/releases/latest) [![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Quick install

Requires **Windows**, **Node.js 24+**, **Git**, and **Codex or Claude Code** as the plugin host. Install and sign in to the CLI agents you want to use; see [supported agents](#supported-agents).

```powershell
git clone --branch v0.2.0 --depth 1 https://github.com/adamczhang/Agent-vs-Agent.git
cd Agent-vs-Agent
npm ci
npm run package
```

Install the built plugin into either host, or both:

**Codex host**

```powershell
codex plugin marketplace add .\release\marketplace
codex plugin add agent-vs-agent@ava
```

In Codex's **Plugins** settings, review and trust AvA's prompt hook to enable typed `/ava` commands.

**Claude Code host**

```powershell
claude plugin marketplace add .\release\marketplace
claude plugin install agent-vs-agent@ava
```

Type **`/ava start`** in your host, click **Activate** above each agent pane, choose the agents and models, and send a prompt. Each activation makes one short model request. Use **`/ava doctor`** to check setup without model requests.

## Welcome to Agent vs Agent

<img src="docs/images/banner.jpg" alt="Agent vs Agent" width="100%">

**Two agents, one prompt, your machine.** Compare independent answers, let agents challenge each other's ideas, or watch them build and review the same project. Save useful prompts and files, then reuse them across models and modes.

| Role | What it means | Choices |
| --- | --- | --- |
| **Host app** | Where you install the AvA plugin and type `/ava` commands. It opens the room in a browser. | Codex or Claude Code |
| **CLI agent** | A separate CLI process doing the work in one of the room's two seats. | Codex CLI, Claude Code, Grok Build or Antigravity |
| **Gateway agent** | A model reached through Vercel AI Gateway, using the Codex CLI adapter. | Models listed by the Gateway |

Codex and Claude Code can serve either role. **Your host does not determine your agents**: either host can run any two supported agents, including the same CLI twice. Both hosts share your local conversation pool and prompt library.

![Full desktop layout of AvA showing two Grok Build agents debating how to keep a Mars greenhouse running without internet](docs/images/room.png)

*Recorded live test: two Grok Build agents discuss a Mars greenhouse, then respond to an added offline-operation constraint.*

## Modes and tools

| Feature | What it does |
| --- | --- |
| **Prompt** | Sends the same prompt and attachments to both agents for independent answers. |
| **Debate** | Alternates replies after a selected opener. Pause, add a constraint, and resume. |
| **Build** | Gives each agent its own project copy. Compare app previews, changes or code-review findings. |
| **Prompt library** | Saves Markdown prompts and attached files; includes six editable starters. Available in every mode. |
| **Benchmarks** | Validates tasks, runs repeated attempts, and saves deterministic checks, a scoreboard and JSON/CSV exports. Includes three starter tasks. |
| **Resources** | Shows active agents and memory, sets an activation limit, and stops all AvA agents. |

The room also includes private 1:1 messages, resizable panes, searchable history, replay and usage statistics. See the [user guide](docs/user-guide.md) and [benchmark guide](docs/benchmarks.md).

## Supported agents

| Agent | Requirement |
| --- | --- |
| Codex CLI | Version **0.159.1+**, signed in |
| Claude Code | Version **2.1.286+**, signed in |
| Grok Build | CLI installed and signed in |
| Antigravity | CLI installed and signed in |
| Vercel AI Gateway | Codex CLI **0.159.1+** and an AI Gateway API key |

The four CLIs use their own subscription logins. For the Gateway, use **Gateway key** in the agent menu, `npm run gateway-key -- set`, or `AI_GATEWAY_API_KEY`. Available models and settings come from each provider.

## Permissions and data

- **Ask** is the default. Build permits recognized file operations inside each agent's workspace; shell commands and process control are refused. **Bypass** trusts tool execution with your account's permissions. Provider-side permissions remain a separate boundary; AvA is not an operating-system sandbox.
- **Internet** is off by default. Supported web tools follow the switch; it is not a network firewall for unrestricted commands.
- **Live benchmarks with program verifiers are blocked** until execution isolation is available. Answer and file checks remain usable. See [benchmark limits](docs/user-guide.md#running-benchmarks).
- **Local data:** `%USERPROFILE%\AgentVsAgent`, shared by both hosts. Override with `AVA_DATA_DIR`. Saved prompts and files live together under `prompts/`; clearing conversation history preserves the prompt library and benchmark results.
- **Local access:** the room uses authenticated loopback. Its link is a credential; do not share it. Interrupted work is never automatically resent.

Read the [security policy](SECURITY.md) and [known limits](docs/architecture.md#known-limits) before using Bypass.

## Documentation and development

[User guide](docs/user-guide.md) · [Benchmarks](docs/benchmarks.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [v0.2.0 release notes](docs/release-v0.2.0.md)

```powershell
npm run typecheck
npm test             # builds first; no provider requests
npm run dev:sim       # room with simulated agents
```

## License

[MIT](LICENSE) © 2026 Adam Zhang. Banner and icon artwork are excluded from the MIT license.

Independent project; not affiliated with OpenAI, Anthropic, xAI, Google or Vercel. Product names belong to their respective owners.
