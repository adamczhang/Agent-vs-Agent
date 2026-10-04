# Agent vs Agent v0.4.3

**Released 2026-10-03.** Debate becomes a formal, judged debate, the room gets faster to set up, and an update now takes effect without restarting every host. It includes 0.4.0 and 0.4.1, which weren't released on their own.

## Install

This is a **source release** for Windows with Node.js 24 or newer. To install AvA into the Codex host, the Claude Code host, or both, follow [Quick install](../README.md#quick-install).

## What's new since v0.3.5

| Area | Change |
| --- | --- |
| Formal debates | Each agent argues an assigned side (Agent 1 for the motion, Agent 2 against, unless swapped), after a private brief through its own 1:1 line. Speeches follow a format: an opening case, rebuttals, a closing. They must be backed by evidence, with no invented facts. Debates run for a set number of rounds (7 by default), with a time limit per speech (2 minutes by default). A speech that runs over is forfeited. |
| The judge | When a debate completes, a fresh session of the strongest Claude Code or Codex model at its highest effort scores each side 1 to 5 on three counts: factual accuracy and evidence, challenging the opposition's strongest points, and a cohesive stance. It then names a winner. It doesn't see the briefs or which CLI argued which side, and can search the web to check facts. The ballot stays with the thread. |
| Debate prompts | One template for every debate prompt: the motion, each agent's side, private brief and internet, the rounds and the speech time. A **Debate builder** guides you through it, and ten formal motions come built in. |
| History | Each debate is its own thread, with its ballot and result in the list. Delete a thread with the button that appears when you point at it. Threads from every mode share one history, each labeled with its mode. **Close thread** ends a thread and keeps both agents' settings. |
| Setup | **Quick activate** reuses an agent's last settings, or picks the CLI's strongest model at high effort, with Ask permissions and internet off. Models show their name and version (Opus 5.5). Speed reads Default or Fast, and the CLI can change at any time. |
| Updates | The room shows its version. A newer plugin replaces an older AvA service once nothing is running in it, so an update takes effect without restarting every host. |
| Cursor (preview) | Cursor's agent runs isolated from your own Cursor settings. On a Cursor Free plan it refuses agent requests, and activation says so. |

Every change is in the [changelog](../CHANGELOG.md).

## Validation

The release passed **274 offline tests**, **9 Chromium scenarios** and smoke tests of both packaged plugins.

Live checks ran on the development machine, each with its own request ceiling:
- **Why debates stopped early** (22 requests at most): on the old setup, the agents agreed and ended a debate after 5 replies.
  - **The fix:** with sides assigned and the debate ending only after its rounds, a policy debate, a negotiation and an interrogation ran all their rounds, with no agent asking to stop.
- **Formal debates with judges** (40 requests):
  - **Smartphones in schools,** Codex for and Claude Code against: judged by Claude Code (Opus 5.5, max effort) in 6 minutes, 15/15 to 12/15. It flagged 4 misleading or out-of-date claims, with reasons.
  - **The fall of Rome,** Claude Code for and Codex against: judged by Codex (its strongest model, max effort) in 5 minutes, 13/15 to 15/15. It flagged 3 claims.
  - **Both debates** ran all 7 rounds. Every brief was answered READY before the debate started.
- **Updating an installed plugin:** a 0.4.1 plugin replaced a running older service in 4.5 seconds, packaged builds on both sides. 0.4.1 then ran in both hosts.

These are functional acceptance checks, not a model ranking.

## Limits

- **The judge is one model's opinion.** It sees no identities, but a judge may still favor a style. Judge again with the other CLI to compare.
- **Speech time is wall-clock time,** so a slow network or a long web search counts against the debater.
- **A speech cut off at its limit** is cancelled like Stop. A CLI that doesn't confirm the cancellation leaves the debate needing attention, as with any stop.
- **The Prompt and Build builders** are simple forms for now.
- **Services from before 0.4.1** can't be asked to step aside. Close the hosts (or use Stop all, then end the old service) the first time you update from one.
- **Windows and source installation only.**

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

1. Back up the data folder and stop active AvA work.
2. Rebuild the marketplace, then update the plugin in each host.
3. Reload the hosts. From 0.4.1 on, the new service takes over once nothing is running.

The Codex prompt hook hasn't changed, so it stays trusted.

- **Your prompt library:** it gets the ten formal debates. Built-in debate prompts you never edited are replaced; edited ones, and your own, stay.
- **Data folder:** unchanged. Public builds default to `%USERPROFILE%\AgentVsAgent`; the database schema hasn't changed since v0.3.5.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
