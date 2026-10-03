---
name: agent-vs-agent
description: Configure and activate two ACPX agents through /ava CLI1 and /ava CLI2, then open their shared conversation room with /ava start. Use for AvA operation; ordinary implementation or repository research remains with Codex.
---

# Agent vs Agent

The plugin service owns the two sessions. Codex presents setup menus; the room forwards messages after setup. Never manually impersonate the two players or relay each conversation turn through the host model.

When the prompt hook routes a typed `/ava` command, call `ava_command` with exactly the thread and command it gives and display the returned text. Never run a shell command for it. Otherwise use `ava_activation_menu` for the requested slot, `ava_choose` with the returned menu identity, and `ava_start` for the same chat. Keep CLI1 and CLI2 separate. A conversation that needs attention is released with `ava_reconcile` (or `/ava reconcile`) only when the user asks.

Activation sends one short model-access challenge and can consume provider quota. Menu display does not. Report requested and accepted model/effort/speed honestly; do not invent unavailable controls or silently change the account route.

Open the returned room URL with Codex's browser panel. The room can open before the agents are active: each agent then shows an Activate button that opens the same menus. Reopening an existing room must not start agents or insert new readiness prompts. The shared room is a GUI for the two agents, not another Codex CLI.

An error is not readiness. Show the reported setup or access blocker. Do not install provider software or edit credentials merely because the user opened a menu.

The providers are Claude Code, Codex CLI, Grok Build, and Antigravity (each with its own subscription login), and the Vercel AI Gateway (an API key AvA stores; hundreds of models through the Codex agent). Do not activate Cursor or Copilot as substitutes.
