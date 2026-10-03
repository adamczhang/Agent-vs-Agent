# Agent vs Agent roadmap

**v0.2.0 is the first stable starting point.** Shipped features are in the [changelog](../CHANGELOG.md); acceptance coverage and remaining limits are in the [release notes](release-v0.2.0.md). Earlier development steps remain in Git history.

Work one item at a time, starting with `next`. An item is done when its acceptance criteria hold and it is committed. Gates: `offline` means no provider requests; `live` requires a bounded request plan; `user` requires the owner's decision or action. Stop at a user gate unless the current request already authorizes it.

## Shipped in v0.2.0

| Area | Completed scope |
| --- | --- |
| Hosts and agents | Codex and Claude Code plugins; four subscription CLIs and Vercel AI Gateway |
| Room | Prompt, Debate, Build/Review, private messages, attachments, history, replay, stats and previews |
| U1–U4 | Debate turn controls, browser regressions, Resources and sidebar tools |
| S1 | Ask-mode refusal of command execution and unknown tool shapes; scoped file operations only |
| B1–B2 | Validated task bundles and deterministic checks, with three starter tasks |
| B3–B4 | Durable benchmark runner, per-attempt evidence, scoreboard and exports |
| B6 | Shared prompt library and file manager in all three modes |
| L1 | Installed-plugin acceptance across all five providers, with initial failures and retests retained |

## Next benchmark work

| ID | Item | Gate | Status |
| --- | --- | --- | --- |
| B5 | Expand to about 20 validated tasks across Prompt, Build and Review | offline + live | next |
| B7 | Optional model-graded rubric score, separate from deterministic pass/fail | offline + live | todo |
| B8 | Import common benchmark formats | offline | todo |

- **B5:** include exact-answer reasoning and extraction, small apps with hidden tests, and reviews with planted bugs. Reference solutions must pass and empty attempts must fail. Live execution of program verifiers remains blocked until F1; expand and validate those tasks offline first.
- **B7:** save the judge's identity and rubric score separately. A judge must never change the deterministic verdict.
- **B8:** start with prompt-plus-tests and project-plus-tests bundles. Container tasks depend on F1; repository repair datasets follow later.

The implemented task schema and check syntax are documented in [Benchmarks](benchmarks.md).

## Future work

| ID | Item | Dependency or acceptance boundary |
| --- | --- | --- |
| F1 | Sandboxed agent work | Confine filesystem, network and process execution before enabling untrusted benchmark programs |
| F2 | Tournaments and leaderboards | Build on saved benchmark results; Debate judging depends on B7 |
| F3 | More ACP agents | Validate each adapter's activation, permissions, cancellation and reporting |
| F4 | macOS and Linux | Add platform coverage for service lifecycle, process tracking, packaging and CI |
| F5 | Usage and cost | Extend reported token data with per-suite usage and Gateway spend |
| F6 | Prebuilt distribution or marketplace listing | Review dependency redistribution terms first |
| F7 | Games and scenarios | A separate referee owns state and validates actions before messages are forwarded |
| F8 | Room embedded inside the host | Add an MCP Apps view alongside the existing browser room |

Version targets will be assigned when scope is accepted. Planned work is not part of the v0.2.0 feature set.
