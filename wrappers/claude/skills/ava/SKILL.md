---
name: ava
description: Agent vs Agent control command, typed by the user as /ava (CLI1, CLI2, start, status, reconcile). Same commands as in Codex.
argument-hint: "[CLI1|CLI2 [choice] | start | status | reconcile]"
allowed-tools: mcp__plugin_agent-vs-agent_ava__ava_command
disable-model-invocation: true
---
Run this Agent vs Agent control command by calling the MCP tool `ava_command` (server `ava`) with thread `claude-${CLAUDE_SESSION_ID}` and command `/ava $ARGUMENTS`. The thread is this conversation's own pair of agents, as each Codex chat has its own.

Show the returned text exactly as it is. Menus are numbered, and the user answers with commands like `/ava CLI1 2`. If it returns a room URL, open it in your browser pane if you have one; otherwise give the user the link. Don't run shell commands for this, don't forward it to either agent, and don't create or impersonate agents yourself. If the tool reports an error, show it.
