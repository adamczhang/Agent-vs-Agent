# Agent vs Agent 0.1.0

The first public release, as source. The text under **Release notes** is meant for the GitHub release page; **Publishing** lists what's done and what's left.

## Release notes

**Agent vs Agent** puts two AI coding agents side by side on your Windows machine, so you can compare them on the same task. It's a plugin for **Codex** and **Claude Code**; both plugins share one local service and one history.

**Agents.** Pick any two; the same one can take both seats.
- **Four coding CLIs:** Codex, Claude Code, Grok Build and Antigravity, each running as your installed CLI with your own sign-in.
- **Vercel AI Gateway:** 250+ models (OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Kimi, GLM and more) with an AI Gateway API key.

**Three modes.**
- **Prompt:** both agents answer the same prompt at the same moment. Compare answers, timing and speed.
- **Debate:** the agents talk to each other about your topic. Prime each one privately first.
- **Build:** both build the same app, each in its own folder, and post a link to it. Open the two apps side by side, or compare their changes. Review mode has both review a project instead.

**In the room.**
- **Activation:** Activate opens a clickable text menu for the agent's CLI, model, effort and permissions.
- **Per-agent switches:** Permissions (Ask or Bypass) and Internet, both enforced by AvA.
- **A context ring** per agent, after Claude's usage ring: it fills with the agent's context window and opens to its numbers.
- **Private 1:1 lines** to each agent, and threads you can rename and search.
- **New thread** opens a clean page with its own agents, with a warning before too many run at once.
- **Stats, replay, export and Clear history.**

**Safety.**
- **Isolation:** each agent sees only the shared prompt and the other's final replies.
- **Local only:** the service listens on 127.0.0.1, behind a random token.
- **Previews:** built apps run on separate origins.
- **Durability:** work whose outcome is unknown is never resent.

**Requirements.**
- Windows and Node.js 24 or newer.
- At least one agent installed and signed in: Codex CLI 0.159.1 or newer, Claude Code 2.1.286 or newer, Grok Build, or Antigravity. Or an AI Gateway key for Vercel, which also needs the Codex CLI.

**Install.** From source: `npm ci`, then `npm run package`, then add `release\marketplace` to Claude Code or Codex and install `agent-vs-agent@ava`. In Codex, trust AvA's prompt hook in the Plugins settings. Full steps are in the README.

**Known limitations.**
- Tested on Windows only.
- In Build under **Ask**, an agent's commands run in its own folder but aren't sandboxed, except Codex's. The internet switch covers web tools, not other agents' commands. **Bypass** trusts the agent with your machine.
- Claude Code's own permission settings approve tools before AvA is asked; AvA points this out.
- Grok Build ends its turn when a permission is refused.
- Grok Build and Antigravity don't report their context window, so their ring stays empty.
- Some Gateway models don't work through the agent (Kimi K2.6 and K2.7 Code answer only in their reasoning), and many call themselves "Codex".
- After a crash, recovery is manual: the room's **Release** action. Nothing is resent.
- The full list is in [the architecture notes](architecture.md#known-limits).

## What has been verified

All on Windows 11, with Node 26, Codex 0.159.3 and 0.160.0, Claude Code 2.1.287, Grok Build 1.0.46, Antigravity, and the Vercel AI Gateway.

| Area | Result |
| --- | --- |
| Offline suite (`npm run typecheck`, `npm test`) | Everything passes. One test needs a private pilot database and skips without it. |
| Full live validation (`scripts/live-validate.ts`) on all five providers. Covers room features, Review, Build apps and permissions, the installed CLIs and the context ring. | 20 suites, 312 checks: 308 passed, 0 failed, 4 notes on model behavior (an agent's wording, the Gateway's lack of hosted web search) |
| Build apps: a static game and a Node server app, with previews, changes, kept servers, cleanup and Clear history | 24/24 on every provider |
| Internet switch: off refuses, on allows | All four CLIs |
| Vercel AI Gateway models | 8 models from 8 makers answer |
| The packaged plugin: hook or command routing, MCP tools, menus, data folder, version, idle exit, no bundled CLI copies | Smoke test on both plugins |
| The UI in the simulator: every control, the ring's color states, dialogs, New thread, activation from the room | Clicked through |
| A fresh checkout of the release: `npm ci`, typecheck, tests, `npm run package` (76 MB), smoke tests with the default data folder, install into a throwaway Codex profile, Claude Code marketplace validation | All pass |

## Publishing

Done:
- [x] **License:** MIT, © 2026 Adam Zhang (`LICENSE`).
- [x] **Version** 0.1.0 in `package.json` and both plugin manifests.
- [x] **Data folder:** public builds default to `%USERPROFILE%\AgentVsAgent`; `AVA_DATA_DIR` or `config.dataDir` override it.
- [x] **Package size:** 76 MB. It drives the installed Codex and Claude Code rather than bundling them.
- [x] **Third-party terms:**
  - Released as source only: nothing third-party is redistributed.
  - `npm ci` installs the Claude Agent SDK (proprietary "SEE LICENSE" terms) for each user from npm.
  - `scripts/notices.ts` writes `THIRD_PARTY_NOTICES.md` into every build.
- [x] **Changelog** dated.
- [x] **Codex hook review** is explained in the README's install steps.
- [x] **Plugin icon** for Codex: logo, composer icon and brand color.
- [x] **Clean public history:** the release is one commit with only the product files, so the development record, personal paths and private links stay out. Its author is Adam Zhang <adam.dadvibes@gmail.com>.
- [x] **Clean-checkout test** of that commit passed (see the table above).

Left for the owner:
- [ ] **Banner and icon art.** `docs/images/banner.jpg` and the Codex plugin icon (`assets/logo.jpg`, `assets/composer-icon.png`) are pixel-art takes on MAD Magazine's *Spy vs. Spy* characters (DC). Confirm you may use them, or replace them before publishing. The README already says the artwork isn't covered by the MIT license.
- [x] **GitHub repository:** [github.com/adamczhang/Agent-vs-Agent](https://github.com/adamczhang/Agent-vs-Agent) (public, empty).
- [ ] **Push** the release branch as `main`, plus the tag:
  ```powershell
  git remote add origin https://github.com/adamczhang/Agent-vs-Agent.git
  git push origin public:main
  git push origin v0.1.0
  ```
- [ ] **Create the GitHub release** from tag `v0.1.0`, with the **Release notes** above as its text. Attach no binaries (source release).
- [ ] *Optional:* run the README's install on a second machine.
