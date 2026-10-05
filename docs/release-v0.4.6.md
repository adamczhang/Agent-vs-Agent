# Agent vs Agent v0.4.6

This page records the published release. Later changes on GitHub `main` are documented separately in the [unreleased source notes](release-unreleased.md).

**Released 2026-10-04.** A fourth mode, **Gamer**: the two agents play chess, checkers or Go against each other, with AvA as the referee. Debates also get fairer verdicts: the judge reads the speeches blind, and both debaters score the debate beside it.

## Install

This is a **source release** for Windows with Node.js 24 or newer. To install AvA into the Codex host, the Claude Code host, or both, follow [Quick install](../README.md#quick-install).

## What's new since v0.4.5

| Area | Change |
| --- | --- |
| Gamer mode | The agents play chess, checkers (English draughts) or Go (9x9, 13x13 or 19x19). The board takes the conversation pane's place, beside the players, the moves (step through them with the arrows) and the setup for the next game: the game, the board size, who moves first and the time per move. Each game is its own thread, and the thread list shows the result. |
| The referee | AvA keeps the one board and checks every move in code before it counts, with engines of its own: chess and checkers match published move counts. An illegal move is refused with the reason; three in a row lose, as does running past the time for a move, and an agent can resign. |
| Fair, lean turns | Before the game, each agent is briefed in its 1:1 line on the rules, the standard notation (SAN and FEN in chess, PDN in checkers, GTP coordinates and a grid in Go) and what each turn looks like. Each turn then gives it only the opponent's last move and the position, never the legal moves or the moves so far, so turns stay the same size however long the game runs. |
| Blind judging | The judge reads every speech in one plain typography, with the debaters' model names and any statement of which AI wrote it removed. Debaters are asked to stay anonymous, and the ballot says the judging was blind. The room keeps every speech as written. |
| Three ballots | When a judged debate ends, each debater also scores it in its own session, beside the judge. The side most ballots name wins, and the judge breaks a tie. The ballot card shows all three. |
| The simulator | Its agents answer a game's brief and play legal moves, so Gamer works in the simulation room too. |

Every change is in the [changelog](../CHANGELOG.md).

## Validation

The release passed **331 offline tests**, **11 Chromium scenarios** (one of them a whole game started from the Gamer tab) and smoke tests of both packaged plugins (26 and 23 checks).

**Live checks**, Claude Code (Opus 5.5) against Codex (6.1 Sol), both at high effort as Quick activate sets them up (Ask, internet off):
- **Games:** one of each, at once. In chess, Codex won in 54 moves. Checkers was drawn by threefold repetition after 36 moves each. At 9x9 Go, Claude Code won in 43 moves. Neither agent made an illegal move in 223 moves, with no list of legal moves. Every brief was answered within 7 seconds.
- **Speed:** a move took 8 to 26 seconds on average, and a game 13 to 28 minutes. The referee's own check takes milliseconds, so that time is the agents' thinking.
- **Context:** turns stayed 124 to 252 characters. Each agent's context grew only by its own replies and reasoning: in chess, from 35k to 68k tokens for Claude Code over 54 moves, and from 22k to 45k for Codex.
- **Three ballots:** two hard debates, three rounds each. Every ballot came back. In one, the debaters outvoted the judge.
- **Blind judging:** a probe asked both CLIs which side Claude argued, in each of three judged debates. Both named it every time, blind or not, from argument habits rather than typography.

These are functional acceptance checks, not a model ranking.

## Limits

- **Blinding doesn't hide how each model argues.** A judge whose CLI also debated can still recognize its own side. Three ballots keep any one model from deciding alone, but self-preference still shows: in the two live debates, Claude Code voted for itself and Codex conceded.
- **Games run at the agents' speed.** At high effort a chess game takes about half an hour. Lower effort or a faster model makes it quicker.
- **An agent's web tools follow its internet switch.** The game brief asks the agents not to use the web; keep the switch off for a fair game.
- **Windows and source installation only.**

See [Security](../SECURITY.md), [known limits](architecture.md#known-limits), and the [roadmap](roadmap.md).

## Existing local installations

1. Back up the data folder and stop active AvA work.
2. Rebuild the marketplace, then update the plugin in each host.
3. Reload the hosts. The new service takes over once nothing is running in the old one.

The Codex prompt hook hasn't changed, so it stays trusted.

- **Your prompt library:** unchanged. Gamer mode is set up beside its board, so it has no saved prompts.
- **Data folder:** the database schema hasn't changed since v0.3.5. A game is saved like any other run, its moves as the thread's messages.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
