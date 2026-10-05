# Unreleased source snapshot

**2026-10-05.** These changes are development source on GitHub `main`, after [v0.4.6](release-v0.4.6.md). This is not a new release: the package version remains 0.4.6, no version tag or GitHub release is created, and installed plugins are not updated.

## Changes since v0.4.6

| Area | Available in this snapshot |
| --- | --- |
| Crosscurrent | A fourth abstract strategy game: 7×7, one shared movable star, and the Three Edges + cooldown rules. Place a stone, then shift any eligible row or column one square with wrapping. The last shifted line rests for one opposing turn. A winning orthogonal group contains the star and reaches at least three edges. |
| Tactical analysis | **Analyze game** on completed cooldown games identifies immediate wins, avoidable losses and proven short forcing sequences. Findings jump to replay positions; alternatives open playable variations. Computation is local and cancellable. |
| Puzzles | **Puzzles** in Gamer offers twenty verified positions: immediate wins, defenses, cooldown defenses and forcing sequences. Human practice and paired agent comparisons accept any move satisfying the goal. Results separate accuracy, answer time, illegal moves and provider failures, with saved history and JSON export. |
| Match series | **Series** runs 1–10 pairs of games or formal debates, using fresh sessions and swapping colors or debate stances and opening order. Requested and accepted settings, request ceilings, transcripts and results are saved. Only completed pairs enter the score; reports include a conservative uncertainty range and JSON/Markdown export. |
| Performance presets | **Quick**, **Standard** and **Deep** request low, medium and high effort with 60-, 120- and 300-second clocks. Previews show the selected model's actual supported effort, including fallbacks. Presets are available across modes, puzzles and series. New Gamer preferences start with Quick; existing custom preferences are retained. |
| Judging transparency | The independent assessment, participant self-reviews and panel result are displayed separately, with disagreements and explanations. **Check presentation order** uses two fresh sessions of the recorded judge, with a ceiling of four requests. It preserves original chronology labels and saves a diagnostic without changing the match's votes. |

Replay now reports malformed recorded moves and unsupported Crosscurrent versions explicitly. It identifies the last valid board and disables unreplayable moves. Saved Classic/unversioned and Three Edges v2 games retain their original rules.

Crosscurrent moves name both placement and line, for example `E3 ROW 4 RIGHT` or `A1 COL D DOWN`. Corners touch two edges, and the star contributes its own edge contacts to both players. Connections do not wrap. Both players qualifying, or a full board without a qualifier, is a draw. A game lasts at most 48 placements.

## Verification and limits

The implementation passed typecheck, build, **391 offline tests** and **19 Chromium scenarios**. Coverage includes legal-move equivalence for the tactical analyzer, all twenty puzzle solutions, fresh sessions, side swaps, request accounting, cancellation, restart interruption, preset application, judging-order checks, older game replays and the existing room workflows. Screenshots were reviewed, including the puzzle panel at 390px.

These feature checks use simulated providers. Earlier live Crosscurrent checks are separate; the new presets and comparison features have no new live model-quality or speed measurements. Tactical analysis proves only the horizon it describes. A single judging-order disagreement can include sampling variation, and agreement does not establish an unbiased judge. Crosscurrent's optimal balance and depth relative to established games remain unresolved.

Public tests include small portable board fixtures; raw maintainer acceptance reports and private development history are excluded. A clean public checkout independently passed typecheck, build, all 391 offline tests and all 19 browser scenarios, followed by staged-package smoke tests: 23 checks for Codex and 26 for Claude Code. Hosted checks are available in [GitHub Actions](https://github.com/adamczhang/Agent-vs-Agent/actions/workflows/ci.yml).

## Development and data compatibility

The [README's Quick install](../README.md#quick-install) remains pinned to released v0.4.6. For this snapshot, use a separate checkout of `main`, install dependencies, and run `npm run dev:sim` for an isolated room with simulated agents. See [Contributing](../CONTRIBUTING.md) for verification and temporary data-folder setup.

This source uses **database schema 11**, adding persistent puzzle jobs and match series to schema 9. Migrations retain existing history, but an older released build refuses a newer schema. Keep development on an isolated `AVA_DATA_DIR`; do not point the snapshot at your normal conversation pool to try it out. No installation or data migration is performed by publishing this source snapshot.

See the [user guide](user-guide.md), [changelog](../CHANGELOG.md) and [architecture](architecture.md) for details.

© 2026 Adam Zhang. Code: MIT. Banner and icon artwork are excluded from the MIT license.
