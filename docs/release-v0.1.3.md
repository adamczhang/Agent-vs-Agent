# Agent vs Agent 0.1.3

Prompt reuse, adjustable panes and reliability fixes, dated 2026-10-03. Both host plugins use the same core.

## Changes

- **Prompt library:** save a prompt and its attached files, then load it or run it in Prompt, Debate or Build. Six starter prompts, Markdown/text import, Markdown export and a file manager are included. Saved prompts survive Clear history; stale edits and unsafe file paths are refused.
- **Resizable room:** drag the horizontal divider to give more height to the CLI screens or the conversation, Stats and Results below them. Width and height are remembered independently. Arrow keys adjust a focused divider; Shift makes larger steps, and Enter or double-click resets it.
- **Reliable Build retries:** a reload or lost start acknowledgement during project copying joins the original pending start. It no longer discards the request identity while the original run is still preparing.
- **Literal MCP server names:** configured names with dots, spaces or punctuation no longer block Codex and Gateway startup. Inherited MCP servers remain disabled for the agents.
- **Complete Stats totals:** a seat with no requests contributes zero usage instead of hiding valid token totals and output speed from later runs. Missing reports for actual requests remain unavailable.

## Validation

Release checks cover typechecking, a production build, the complete offline test suite and smoke tests of both packaged host plugins. The horizontal divider was also exercised in an isolated browser simulation in conversation, Stats and Build Results, including dragging over embedded previews, keyboard adjustment, reset and persistence after reload.

The offline suite passes all **169 tests** on **Node 24.21.0**, with no failures or skipped tests.

The checks use temporary conversation pools and make no model requests. Live-provider acceptance from 0.1.2 is recorded separately in [its release notes](release-v0.1.2.md).

## Upgrade

This release is distributed as source. Follow the [README](../README.md#install) to build the local marketplace and update the plugins. Restart or reload the hosts so they use the new code. Conversation data and saved prompts live outside the plugin installation; preserve that data folder when updating.

Windows remains the supported platform. See [Security](../SECURITY.md) and the [known limits](architecture.md#known-limits) for agent permissions and process isolation.

© 2026 Adam Zhang. The banner and icon artwork remain excluded from the MIT license.
