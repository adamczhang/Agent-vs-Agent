# Agent vs Agent v0.4.5

**Released 2026-10-04.** Build mode becomes two dedicated kinds, app builds and bug hunts, each with its own builder, built-in prompts, and a thread of its own per run. Bug hunts can plant bugs and score what each agent finds, in a local repository or one on GitHub. Every mode also gets harder built-in prompts.

## Install

This is a **source release** for Windows with Node.js 24 or newer. To install AvA into the Codex host, the Claude Code host, or both, follow [Quick install](../README.md#quick-install).

## What's new since v0.4.4

| Area | Change |
| --- | --- |
| Build mode | Two kinds, **App build** and **Bug hunt**, chosen above the message box. Each build or hunt is its own thread: the same agents in fresh sessions, each with a new copy, and the earlier run keeps its copies and results. No Clear Session between builds. |
| Scored bug hunts | A hunt can plant bugs in both copies before the agents start, pinned to one commit, with folders such as tests left out. The agents report each bug on a `BUG:` line. A result card shows which planted bugs each found, its time and the winner, and the thread list shows it too. Planted files keep their copy time, so nothing points at them. |
| Hunts from GitHub | A hunt's repository can be a public git repository's address. AvA fetches the one commit it needs (no history, only the files the copies take) into a cache in its data folder, so later runs download nothing. A hunt can take a slice of a large repository. The agents never clone it: a clone's history would show the planted bugs. |
| Expert hunts | A hunt can plant decoys (correct code made to look wrong; reporting one counts against the agent) and count only each agent's first BUG lines, for hunts that don't say how many bugs they have. |
| The Build builder | A form for each kind. For a hunt: the repository with **Check** (its commit, what a copy holds, and whether each planted bug applies), the commit, a slice, folders to leave out, the bugs and decoys. Loading a saved Build prompt fills in its kind, folder and hunt. |
| Codex in hunts | Under Ask, Codex may read and search with read-only commands in a bug hunt. It reads code only through commands, so before this it couldn't open a repository too large to include in the prompt. |
| Built-in prompts | Build: five app builds, three hard app builds (chess, a spreadsheet, a regex engine, each exposing a function you can check in the browser's console), and five scored hunts in CLI-MODE (1, 3 and 5 bugs, then two expert hunts). Prompt: five hard challenges. Debate: five hard, technical motions, two of them closed book. 45 built-ins in all. |

Every change is in the [changelog](../CHANGELOG.md).

## Validation

The release passed **317 offline tests**, **10 Chromium scenarios** and smoke tests of both packaged plugins.

**Live checks**, Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort as Quick activate sets them up (Ask, internet off unless a debate turns it on):
- **App build:** both built the Pomodoro timer in 5.1 minutes, each in its own thread, with working pages.
- **Bug hunts:** in the three CLI-MODE hunts, both found every planted bug (9 seconds to 4.4 minutes). In the two expert hunts, each missed one bug per hunt (3 of 4, and 5 of 6), and neither reported a decoy. From GitHub, the first fetch of CLI-MODE took 2.1 seconds and later runs found it in the cache.
- **Hard challenges:** two rounds of calibration. Both answered every problem correctly; the five built in took them 0.5 to 6.8 minutes.
- **Hard app builds:** chess and the regex engine, built under Ask, so neither agent could run its code. Each app was checked in a headless browser with cases it wasn't given. Both chess apps passed all 7 perft checks; both regex engines passed all 28 cases, with no RegExp.
- **Hard debates:** two of the five over 7 rounds each, judged by the strongest model of each CLI at max effort. The judges questioned more claims (4 and 7) and gave lower evidence scores than on the general motions.

These are functional acceptance checks, not a model ranking.

## Limits

- **The hard challenges and app builds separate the strongest agents on time, not correctness.** They got every one exactly right. Only the expert bug hunts made them miss.
- **The judge may favor its own CLI.** In three of the four judged debates so far, the winner was the judge's own CLI, although the judge sees only the speeches. Judge again with the other CLI to compare.
- **Hunts on the web need a public repository** and internet access when a hunt first runs (or is checked). AvA never uses your saved git credentials.
- **App builds aren't scored automatically.** You compare the apps, or check a hard build's function in the console.
- **Windows and source installation only.**

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

1. Back up the data folder and stop active AvA work.
2. Rebuild the marketplace, then update the plugin in each host.
3. Reload the hosts. The new service takes over once nothing is running in the old one.

The Codex prompt hook hasn't changed, so it stays trusted.

- **Your prompt library:** it gets the new Build prompts and the hard prompts of every mode once. Prompts you deleted don't come back, and edited ones stay as they are.
- **Data folder:** the database schema hasn't changed since v0.3.5. Hunts on the web are cached in `repos/`, one small repository per address; deleting that folder only means the next hunt fetches again.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
