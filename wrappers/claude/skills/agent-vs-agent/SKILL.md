---
name: agent-vs-agent
description: Operate Agent vs Agent from Claude Code. Set up two CLI agents with /ava CLI1 and /ava CLI2, then open their shared conversation room with /ava start (the same commands as in Codex). Use for AvA operation only; ordinary coding stays with Claude.
---

# Agent vs Agent (Claude Code)

The AvA plugin service owns the two agent sessions. Claude Code only shows the setup menus and opens the room. Never impersonate the two agents or relay their turns yourself.

- The user types `/ava …` (or the full name `/agent-vs-agent:ava …`, the same command). It calls the `ava_command` MCP tool. Show its text exactly. Menu choices look like `/ava CLI1 2`.
- This conversation's pair of agents is thread `claude-${CLAUDE_SESSION_ID}`. Pass that thread to every AvA tool, so menus, status and the room match what `/ava` shows.
- If the user asks for AvA in plain words instead, tell them the command to type. Don't call `ava_command` yourself; it's pre-approved only while their typed command runs.
- Without a typed command, the read-only tools are `ava_activation_menu` (show a seat's menu) and `ava_status`. Only act (activate, start, reconcile) when the user asked for it.
- Activation sends one short access check per agent and can use the user's subscription quota. Opening a menu doesn't.
- `/ava start` returns a room URL; the room opens even before the agents are active (each shows an Activate button). Open it in your browser pane if you have one; otherwise give the user the link. The URL contains an access token, so don't paste it into files or other tools.
- The two agents are deliberately isolated: each sees the topic, the user's messages, and the other's final replies only.
- The supported providers are Claude Code, Codex CLI, Grok Build, and Antigravity, each with its own subscription login, and the Vercel AI Gateway, which uses an API key AvA stores. Never ask the user to paste a key into chat; they create one from the agent's menu (Gateway key) or set `AI_GATEWAY_API_KEY`.
