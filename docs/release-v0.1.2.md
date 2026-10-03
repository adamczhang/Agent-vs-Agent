# Agent vs Agent 0.1.2

The Phase 1 polish release from the [roadmap](roadmap.md), dated 2026-10-02. Both host plugins use the same core and conversation pool.

## Changes

- Windows / Node 24 GitHub Actions for installation, typechecking, tests, packaging and both plugin smoke tests.
- Synthetic migration fixture: every offline test runs in a clean checkout.
- Codex and Claude Code agents exclude inherited MCP servers, while using the installed CLIs and subscription sign-ins.
- Build preparation runs off the service thread. Windows secret files get owner-only ACLs. Chat-scoped tools require a conversation identity.
- Stats uses saved per-request token reports for Codex, Claude Code and Gateway agents; Grok Build and Antigravity retain labeled estimates.
- `/ava` help and `/ava doctor` in both hosts, including version, supported sign-in and Gateway credit checks without model requests.
- Contributor and security guides, issue and PR templates, and refreshed user documentation.
- Updated banner, listing logo and composer icon using the owner's supplied artwork, plus clearer README text.
- Acceptance fixes: a timed Debate ends normally when expiration races a paced wake, and token counts stay correct when an adapter's field named cumulative contains the latest request rather than an increasing total.

## Acceptance

The owner revised the timed acceptance target from 15 minutes to **5 minutes** on 2026-10-02. An early stop, quota limit or manual cancellation is not a pass.

Tests run against the installed 0.1.2 cores and wrappers with temporary conversation pools. The real shared history is not used for test conversations. No hook trust or persistent permission approvals are changed by the test harness.

| Check | Result |
| --- | --- |
| Typecheck, build and offline suite on Node 24.21.0 | 137 passed, zero failures or skipped tests |
| Essential paths through the installed Codex wrapper | 23 checks passed, 19 participant requests |
| Essential paths through the installed Claude Code wrapper | 23 checks passed, 19 participant requests |
| Actual host slash-command routing | `/ava`, `/ava doctor`, `/ava CLI1` and `/ava start` passed in both hosts, including chat identity; no participant requests |
| Full timed Debate | Completed the uninterrupted 5 minutes with `duration_reached`; 11 debate requests plus 2 activations |
| Grok Build and Antigravity subscription activation/Prompt | Passed, 4 requests per provider |
| Vercel AI Gateway activation/Prompt | Passed with `openai/gpt-5.6-luna`, 4 API requests |
| Shared service and pool across packaged wrappers | 6 checks passed in a temporary pool |

The essential paths cover attachment-backed Prompt, private messaging, Debate, token Stats, rename/export, Clear Session, Build previews and changes, Review, original-project preservation and Clear history. No screenshots or desktop mouse/keyboard automation are claimed: actual host commands were exercised through Codex app-server and Claude Code's print interface; previews were fetched over HTTP.

Mock timing and live Stats checks found the two defects listed above; both were fixed with regression tests before the successful acceptance runs. A Claude host-check comparison initially rejected a harmless trailing space in `/ava `; the verifier now uses the product's command normalizer. Failed attempts were retained as evidence, and no uncertain work was resent.

The [hosted Windows / Node 24 CI passed](https://github.com/adamczhang/Agent-vs-Agent/actions/runs/37092660252), including dependency installation, typecheck, tests, packaging and both smoke tests. A follow-up commit on `main` corrects GitHub Actions environment setup; the published `v0.1.2` tag is unchanged and the application code is identical. The tagged workflow retains the original validation error; use `main` for the corrected CI configuration.

## Upgrade

Build from source and update both host plugins as described in the README. Restart or reload the host after updating so it uses the new plugin code and artwork. If Codex asks to review the hook, that review is a user action. Conversation data stays outside the plugin installation.

This is a Windows release. Build commands outside Codex's sandbox still have the user's account access, and Bypass trusts the agent with that access. Claude Code's own permission settings can approve tools before AvA is asked. See [Security](../SECURITY.md) and the [known limits](architecture.md#known-limits).

© 2026 Adam Zhang. The banner and icon artwork remain excluded from the MIT license.
