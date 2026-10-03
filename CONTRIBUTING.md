# Contributing to Agent vs Agent

The first stable baseline is **v0.2.0**. Start with the [roadmap](docs/roadmap.md) and [architecture](docs/architecture.md). Keep a change focused on one roadmap item or one reproducible problem. Windows is the supported platform; use Node.js 24 or newer and Git. No provider account is needed for the offline tests.

## Set up and verify

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

`npm test` builds first and runs the full offline suite, including a synthetic schema-v1 migration fixture. Tests create temporary data folders. A skipped test is a regression; a clean checkout should run them all. CI repeats the checks on Windows with Node 24, packages the plugins, and smoke-tests both wrappers without model requests.

For an interactive room with simulated agents, run `npm run dev:sim`. It uses isolated simulator data and prints the path of a private file containing the room link. Keep that link out of issues and screenshots. Stop the simulator with Ctrl+C.

Run the browser regressions with `npx playwright install chromium --only-shell`, then `npm run test:browser`. They use one headless Chromium worker, fresh temporary data and scripted agents, with no model requests. They cover pane sizing, saved prompts/files, Build previews, Debate turns, Resources, benchmark execution and results. Preview security is covered separately by the server tests. Screenshots and the JSON report are in `test-results/`; network traces and videos are disabled to keep room credentials out of artifacts.

For other development commands, set a temporary data folder first:

```powershell
$env:AVA_DATA_DIR = Join-Path $env:TEMP ('ava-dev-' + [guid]::NewGuid())
npm run serve
```

Do not use or delete the real conversation pool. A development checkout can have `config.dataDir` set to that pool; an explicit `AVA_DATA_DIR` overrides it. Provider installations, account credentials and host plugin trust are not test fixtures.

## Check the packages

The default `release/marketplace` can be used by an installed Claude Code plugin. Build into a fresh staging directory during development:

```powershell
$stage = Join-Path $env:TEMP ('ava-marketplace-' + [guid]::NewGuid())
npm run package -- --out $stage
node --import tsx scripts/package-smoke.ts "$stage/plugins/agent-vs-agent"
node --import tsx scripts/package-smoke.ts "$stage/plugins/agent-vs-agent-claude"
```

Smoke checks use temporary data and no model requests. They verify packaging, routing, help, doctor, identity requirements and idle exit.
- **Launch:** each plugin's MCP server starts exactly as its `.mcp.json` declares. Codex gets only its `env_vars` allow-list and the declared folder; Claude Code gets the whole environment.
- **Data folder:** the server starts in a folder where the account holds Modify rights but not the right to take ownership, as on a second drive.
- **Failures:** a broken data folder must reach the host with its reason within seconds.
- **Elevation:** an elevated account can take ownership anyway, so run them as a standard user to reproduce the second-drive case.

Doctor may run local version/login-status commands; the smoke environment has no Gateway key. Host integration experiments must use temporary `CODEX_HOME` or `CLAUDE_CONFIG_DIR` profiles. Never approve hooks, change trust or update someone's installed plugin as part of a test.

## Live suites and quota

Mock first. State the provider, model, request ceiling and evidence destination before running anything live. Subscription CLIs use `provider-login`; the Gateway uses an AI Gateway key and spends credit. Confirm a long run with the owner and stop at the first real failure. An uncertain or interrupted request must never be resent.

| Script | Scope | Expected requests |
| --- | --- | --- |
| `scripts/live-isolation.ts` | One Codex and one Claude response, with process censuses | Hard ceiling: 2 |
| `scripts/live-acceptance.ts --provider <provider>` | Room features | About 16 |
| `scripts/live-build.ts --provider <provider>` | Review of planted bugs | About 4 |
| `scripts/live-build-app.ts --provider <provider>` | Static and server apps | About 14 |
| `scripts/live-permissions.ts --provider <provider>` | Ask and Bypass | About 4 |

The approximate counts are planning figures, not enforced ceilings. Activation, reactivation and a repaired answer consume requests too. Review the selected script before setting a ceiling. Run one suite/provider at a time; the historical `live-validate.ts` matrix runs providers in parallel and continues after failures, so it does not implement this stop-on-failure policy. Do not use that broad runner for routine validation.

Pass `--out pilot-evidence/stage-d/<new-name>.json` to suites that support it. The isolation check writes `pilot-evidence/stage-d/p4-isolation.json`; preserve any existing result before another run. Never rerun `npm run pilot:*`: those commands overwrite historical evidence. Redact credentials, bearer tokens, room URLs, private prompt content and personal paths before sharing evidence. Never run `vercel ai-gateway setup`; it rewrites the user's Codex configuration.

## Keep dependencies and CLIs current

Do this monthly, and whenever an agent adapter (ACPX, codex-acp or claude-agent-acp) releases:

1. **Report:** run `node --import tsx scripts/upkeep.ts`. It sends no model request and lists:
   - outdated packages;
   - the adapters' latest releases, and the Codex and Claude Code minimums those releases would require;
   - the installed CLIs.
2. **Update:** read the release notes of anything you update. Pin exact versions: `npm install --save-exact <package>@<version>`, with `--save-dev` for development tools.
3. **Minimums:** raise `MINIMUM` in `src/clis.ts` only when an adapter requires it; `test/clis.test.ts` keeps it equal to the installed adapters' own requirements. A higher minimum is a user-facing change, so add it to the changelog with the update command.
4. **Offline checks:** run them all, plus the browser tests, a staging package and both smoke tests.
5. **Live check:** run `node --import tsx scripts/upkeep.ts --live`. It makes one activation per provider, with a ceiling of 5 model requests (one on the Gateway key), and stops at the first failure. Each agent is stopped after its check. The report goes to `test-results/upkeep/`.
6. **Version:** if the plugin's runtime dependencies changed, bump the patch version and record the update in the changelog.

Development tools can require a newer Node.js than AvA itself: jsdom 30 (used by the tests) needs Node 24.15 or newer.

## Propose a change

Describe the trigger, the previous behavior and the resulting behavior, then list the checks actually run. Include a regression test for a behavioral fix. Keep unrelated edits out of the commit. Update the user guide and changelog for user-facing changes; record limits that remain. Open a focused pull request against the public repository's `main` branch.

## Maintainer release and export

The maintainer checkout keeps private development history. Each completed roadmap step gets one local commit, `<ID>: <title>`, using the existing author identity. Release attribution is Adam Zhang; omit tool co-author trailers and generated-by notices.

The maintainer-only `scripts/export-release.ts` exports product files from **committed HEAD** to `public`, removes private evidence and machine-specific data settings, scans for private paths and secrets, and makes an annotated version tag. This script is deliberately absent from the public source checkout.

1. Complete the roadmap acceptance gate. A quota limit or early stop is not a passing timed test.
2. For a new release, bump `package.json`, the lockfile root entries, and both plugin manifests. Update the changelog and release notes, verify offline, and commit.
3. Run `node --import tsx scripts/export-release.ts` in the maintainer checkout. Inspect the exported diff and validate a clean checkout of `public`, including both package smoke tests.
4. With the owner's explicit authorization, push **only** `git push origin public:main` and the new version tag to the public repository, then verify the GitHub CI run and create the release page.

Never push private `main`. The exporter replaces the tip when re-exporting the same version: do not use that to rewrite an already published release or move its tag. Check hosted CI on the newly pushed commit; local tests are not a substitute for that result. Installation into real host profiles is a separate owner-approved action, and changes to the Codex hook require the owner's trust review. After an installation, `node --import tsx scripts/verify-installed.ts` confirms, read-only, that both hosts' installed copies match the build in `release/marketplace` file for file.

The banner and icon are excluded from the MIT license. The owner confirmed permission to retain them on 2026-10-02; that confirmation does not grant additional reuse rights to contributors.
