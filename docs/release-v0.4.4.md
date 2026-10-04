# Agent vs Agent v0.4.4

**Released 2026-10-04.** Prompt mode gets challenges and races with answer keys. Every Prompt run and formal debate is a clean thread of its own, without restarting the agents. This release also fixes the issues found in a review of the whole codebase, including two security problems and a crash. Update soon if you use Build mode or previews.

## Install

This is a **source release** for Windows with Node.js 24 or newer. To install AvA into the Codex host, the Claude Code host, or both, follow [Quick install](../README.md#quick-install).

## What's new since v0.4.3

| Area | Change |
| --- | --- |
| Challenges and races | A Prompt prompt can carry an answer key that the agents never see. Each agent ends with an `ANSWER:` line. When both have answered, a result card shows each answer, whether it's right, and its time. The winner is the right answer, or the faster one when both are right. A challenge is judged on correctness; a race is the same kind of question, judged on speed. |
| Built-in prompts | Ten challenges and races replace the two earlier Prompt starters (unedited copies are removed). They cover counting, logic, code tracing, probability, shortest paths and dates, and every answer was computed by program. The **Prompt builder** sets up your own: the task, the answer's form, and the hidden expected answer. |
| Fresh threads | Each Prompt run, and each formal debate after the first, is its own thread with clean context and the same agents. Each fresh session starts beside the current one and takes over once it's ready, so the agents never show as closed. |
| Settings | Resources is now **Settings**, with a gear icon, at the right of the sidebar's tools row. |
| Security | Build's Changes view could be made to run a program on your computer by an agent that could only write files in its copy. A single malformed preview request could crash the service. Agents received other providers' API keys from your environment. Stop all could, after a restart, force-close an unrelated program. All are fixed. |
| Reliability | Formal debates reach their closings and get judged (one reformatted reply used to end them early). Answer checking is exact. A newer install no longer interrupts a judge. Shutdown can't hang, and a lock file left by a crash no longer blocks the next start. Room retries can't send a command twice. |
| Speed | The room no longer rescans the whole history several times a second. Build's Changes view and deleting threads no longer freeze AvA. Far fewer helper processes start. |

Every change is in the [changelog](../CHANGELOG.md).

## Validation

The release passed **299 offline tests**, **9 Chromium scenarios** and smoke tests of both packaged plugins. The review fixes come with regression tests, and each security test reproduces the attack before checking it no longer works.

**Live check (40 requests, the ceiling):** the ten built-in challenges and races ran on Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort as Quick activate sets them up, in two rooms of five prompts.
- **Every answer was read and checked:** both agents answered all ten correctly. Claude Code won eight on time, Codex two.
- **Every prompt was its own thread,** with fresh sessions from the second prompt on, and the agents stayed Ready throughout.
- **The challenges are easier than intended:** each answer took 5 to 18 seconds, not the one to five minutes they were designed for. Harder challenges are planned.

These are functional acceptance checks, not a model ranking.

## Limits

- **The built-in challenges don't separate the strongest models yet.** Both answered every one correctly within seconds. Write harder ones with the Prompt builder for now.
- **Answer keys compare exactly.** A number must be the first number in the answer line (after any `=`), with nothing offered as an alternative. A text answer must start with the expected words. Agents are told the exact form.
- **The judge is one model's opinion.** Judge again with the other CLI to compare.
- **Speech time is wall-clock time,** so a slow network or a long web search counts against a debater.
- **Windows and source installation only.**

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

1. Back up the data folder and stop active AvA work.
2. Rebuild the marketplace, then update the plugin in each host.
3. Reload the hosts. The new service takes over once nothing is running in the old one.

The Codex prompt hook hasn't changed, so it stays trusted.

- **Your prompt library:** it gets the ten challenges and races. The two earlier Prompt starters are removed if you never edited them; edited ones, and your own, stay.
- **Data folder:** the database schema hasn't changed since v0.3.5. Build runs now keep a record of each copy's starting point in `baselines/`, removed with the thread. Changes in Build copies made before this version still show; they're read from the copy's own files. Process records from earlier sign-ins are cleared at the first start.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
