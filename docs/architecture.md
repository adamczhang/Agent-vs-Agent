# Architecture

How Agent vs Agent v0.4.4 is built. Verified scope is in the [v0.4.4 release notes](release-v0.4.4.md) (and the [v0.3.1 notes](release-v0.3.1.md) for benchmarks), and the v0.2.0 baseline's in its [validation record](validation.md); usage is in the [user guide](user-guide.md).

The executable implementation is in `src/`, the browser interface in `ui/`, and the Codex plugin in `.codex-plugin/`, `hooks/`, and `skills/`. The Claude Code wrapper is in `wrappers/claude/`. The agents are reached through [ACPX](https://www.npmjs.com/package/acpx) and the Agent Client Protocol (ACP).

## Host wrappers

One core (`dist/`, `node_modules/`, the MCP server, the background service, the room UI, and the data folder) has two thin wrappers. `scripts/package.ts` builds both into one local marketplace: `plugins/agent-vs-agent` for Codex and `plugins/agent-vs-agent-claude` for Claude Code. The Claude Code folder hard-links the core files.

They are separate folders because Claude Code auto-loads `hooks/hooks.json` and `.mcp.json` from a plugin root and would pick up the Codex versions.

- **Codex:** a `UserPromptSubmit` hook validates a typed `/ava …` and tells Codex to call `ava_command` with the chat's thread ID.
- **Claude Code:** the same `/ava` commands, from a plugin skill named `ava` (`skills/ava/SKILL.md`). A plugin skill answers to its bare name unless another command claims it, and its full name `/agent-vs-agent:ava` always works.
  - The skill passes `/ava $ARGUMENTS` to `ava_command` with thread `claude-${CLAUDE_SESSION_ID}`, so each Claude Code conversation has its own pair, as each Codex chat does, and resuming it brings the pair back. The operating skill passes the same thread to the read-only tools. A call without a chat identity is refused; both wrappers supply it.
  - `allowed-tools` pre-approves only that tool, only during that turn. `disable-model-invocation` keeps Claude from running the skill itself.
  - Menus read `/ava …` in both hosts. The server still supports `AVA_COMMAND_NAME` for a host that needs another name, but none sets it.

**One conversation pool.** `src/paths.ts` `dataRootFor()` resolves the data folder in this order:
1. `AVA_DATA_DIR`;
2. `package.json` `config.dataDir`, if a build sets one: `scripts/package.ts` copies it into each plugin's runtime `package.json`;
3. otherwise `AgentVsAgent` in the home folder when packaged (`%USERPROFILE%\AgentVsAgent`), or `.ava-data` in a development checkout.

Not AppData: packaged Windows apps such as the Claude desktop app redirect AppData writes into private storage, which would split the history between hosts. Tools run from a checkout that act on the installed plugins' data (`npm run gateway-key`, the history import, the live test scripts) use `installedDataRoot()`, the folder a packaged plugin would use.

`npm run serve` (`--standalone`) is the exception: without `AVA_DATA_DIR` it uses `.ava-serve` in the checkout, so a development server never opens the shared pool.

Every host therefore resolves the same folder. `ensureService` finds or starts the single owner there: whichever plugin starts it, the others connect to it, and the owner lock keeps it to one. The MCP server answers the host's handshake without waiting for it, and starts it in the background. The MCP process never loads the engine or the room, which load only in the service, so the handshake costs about 250 module files rather than about 550. A service that fails to start writes one `{"status":"failed",…}` line with its reason to `service.log` and exits. The `ensureService` call that started it reads that line as soon as the process exits, so the tool call that needed the service reports the reason, and `/ava doctor` adds a data-folder check that needs no service. Pairs stay per chat (Codex thread ID, or `claude-<session ID>` in Claude Code); runs, History, search, and Stats are pool-wide. The folder is outside AppData because MSIX apps (the Claude desktop app) redirect AppData writes into private storage. `scripts/shared-pool-check.ts` runs both packaged plugins against one folder.

## Threads and 1:1 lines

**Thread.** A thread is every run (prompt) that used the same two native sessions.
- **ID:** `store.threadKey(pairId, sessions)`, a hash, so session IDs stay internal and no schema change is needed.
- **Continuing:** a new prompt after a run ends continues the thread. `run.start` no longer demands fresh sessions (the old `RESET_REQUIRED`).
- **Clear Session:** `pair.clear` gives both agents fresh sessions, which starts a new thread.
- **Older data:** it reset sessions before every run, so it shows one thread per run.
- **Calls:** `threads.list` (pool-wide, plus the room's own fresh, still-empty session), `thread.get` (runs, messages with times, 1:1 lines) and `thread.stats` (`combineStats`: runs back to back on one axis; processes counted once, since the runs share sessions).

**1:1 line.** The user and one agent, inside that agent's session (`direct.send`, table `direct_messages`, schema v6).
- **Prompt:** plain text, framed as a private operator message. The agent is asked not to quote it in the shared room.
- **Privacy:** room prompts are built only from room messages, so neither the message nor its reply reaches the room or the other agent.
- **No overlap:** a seat never has two requests at once. `direct.send` requires no active run, or a paused run with nothing in flight, and one 1:1 request per seat. `run.start`, `run.broadcast`, resume and step refuse with `DIRECT_BUSY` while a 1:1 reply is pending.
- **Ending a session:** Clear Session and reset cancel pending 1:1 requests. A service restart marks them `interrupted`; they are never resent.
- **Retries:** sends are idempotent by request ID (`once`).

## Modes, attachments, and thread names

**Mode.** `RunConfig.mode` is set per run, and a thread's mode is its first run's.
- **Debate** (internal value `conversation`, the default; absent on older runs) works as before. `opening` may name one seat to answer the opening prompt alone: `conversationConfig` then sets `lead` to the other seat, and `Store.admit` gives that seat the topic plus the opening as undelivered inputs.
- **Prompt** (internal value `benchmark`; formerly shown as Benchmark) sends the user's text exactly as written (plus inlined text files) to both seats in one paired phase. Each answer is the agent's raw final text, with no envelope or repair. After the phase the controller halts with `benchmark_done` (status `completed`). `maxRequests` is 2 and the default limit is 60 minutes; "…for N minutes" in a benchmark prompt is part of the task, not a time limit.

**Attachments** (schema v7: `attachments` table, `messages.attachments` column, bytes in `<data>/attachments/<id>`).
- **Upload:** `attachment.add` stores a file first, after a type and size check (images up to 8 MB; text files up to 512 KB with no NUL bytes; anything else is refused). `run.start` and `run.broadcast` then reference it by ID, so retries never resend the bytes.
- **Delivery:** for each turn, the controller collects the attachments of that seat's input messages. Images go as ACPX `attachments` (ACP image content); text files are inlined, after the prompt in a benchmark and inside the message JSON in a conversation.
- **Limits:** the HTTP body cap is 12.5 MB for uploads.

**Thread names** (`thread_titles`, `thread.rename`) override the default name (the first prompt); an empty name clears it.

## Saved prompt library

`prompt-library.ts` stores shared prompts in `<data>/prompts/<id>/`: `prompt.md`, `prompt.json`, and `files/` with original filenames. The library is independent of the history database and its attachments. Six starter prompts are seeded once; edits and deletions survive restarts. Both host wrappers use the same library because they share the data root.

Authenticated room RPCs expose `prompt.list`, `prompt.get`, `prompt.file`, `prompt.save`, `prompt.delete`, and `prompt.prepare`. Save, delete and prepare use the service's durable command receipts. Loading creates separate history attachments before using the existing run-start path. Library edits or deletion cannot modify an already prepared message. Clear history deletes the history copies, not the library.

Complete saves are staged in a sibling directory before replacing the active directory. A `.previous-<id>` directory bridges the two renames and is recovered on startup after a crash. Content revisions detect stale editors, including external text edits. Plain filenames, unique file names/IDs, byte limits, and refusal of linked paths keep file operations within the library. Imported Markdown is plain prompt text, never executable metadata. `ui/prompt-manager.tsx` supplies the common editor in all three modes, including Build's Review task.

## Benchmark runner and results

`bench-runner.ts` owns durable jobs and immutable attempt rows in schema v9 (`bench_jobs`, `bench_attempts`). The room and compiled `bench-cli.ts` use the same authenticated service API. Starts carry durable request IDs; a restart marks unsettled jobs interrupted without resubmission. Every task/repetition owns a fresh pair. Before hidden checks are copied into an independent artifact directory, the runner closes its agents and verifies that its recorded processes have stopped. Cancellation, Stop all, activation limits and history-clear guards share the service's existing controls.

A task's exact files and validation digest are captured before starting. Attempt records include the task prompt and check definitions, task version/digest, suite, provider/model/effort/speed, AvA version, simulation marker, answer, check evidence, times and available token reports. Program-verifier tasks run live only under the verifier guard (`bench-checks.ts`): Node's permission model lets the verifier, and the generated code it imports, read the attempt folder and write a throwaway temp folder, with no processes, workers, add-ons or network. On a Node without network control (`--allow-net`), or with `AVA_VERIFIER_GUARD=off`, they are refused before activation. Mock acceptance uses only authored fixtures and never opens provider sessions.

`bench-results.ts` exposes filtered cursor pages, scoreboard rows, UTC daily trends, and JSON/CSV exports. Summary queries select metadata without loading all answers into memory. Agent configuration and simulation source identify score rows. Graded pass rate excludes infrastructure outcomes, which are counted separately. pass@k uses `1 - C(n-c,k)/C(n,k)` per task/version/digest/job/AvA-version batch, averaged across eligible settled, fully graded batches; batches with insufficient samples or any ungraded result do not contribute. Exports are bounded to 5,000 attempts/16 MiB, redact credential-shaped values, and escape CSV formula prefixes.

Benchmark rows and independent artifact copies are intentionally outside conversation-history clearing. `ui/benchmark-results.tsx` renders the shared Results tab, filters and per-check evidence. Neither result queries nor exports perform agent work.

## Build mode

`RunConfig.mode='build'` with `build={kind:'build'|'review',source,folder}`. It runs like Prompt: one paired phase, raw-text answers, and the controller halts with `build_done`. A Build session holds one prompt: `run.start` refuses a second run in a thread whose first run was a build (`ONE_BUILD`), and `run.broadcast` refuses any Prompt or Build run (`ONE_PROMPT`).

**Independent answers (Prompt and Build).** Each agent's answer stands alone.
- **Settled failure:** a turn the provider itself ended (stop reason cancelled, or an empty answer) is recorded as that agent's result, with a note in its screen. It doesn't halt the run. Grok Build does this when a permission is refused.
- **End of the run:** it ends `completed` with `agent_unfinished` when an agent didn't answer.
- **Errors:** other failures (provider errors, unsettled cancellation) still stop the run for attention.
- **No ACPX turn timeout:** ACPX's own turn timeout is raised to an hour (`startTurn timeoutMs`), because AvA times turns itself.
- **Build watchdog:** a build turn whose output already ends with its `APP:` line, after 60 s with no activity, is cancelled, and the streamed report is committed. This covers a command left waiting for input that keeps the turn open.

**Folders (`src/workspace.ts`).**
- `checkProject` accepts only an absolute, existing folder that is not a drive root and not AvA's data. A review needs one; a build may start without (`source=''`).
- `prepareProject` runs enumeration, copying and baseline git commands in a worker, keeping the service responsive and refusing conflicting pair/history changes until it finishes. `copyProject` copies the working tree into `<workspace>/<folder>` for each seat. A git source contributes `git ls-files -co --exclude-standard` (uncommitted work in, ignored output out); otherwise everything except generated folders, capped at 20,000 files and 500 MB. `startProject` makes an empty folder instead. Either way the folder gets a baseline commit.
- `folder` is derived from the request ID. Identical in-flight starts share their preparation promise; conflicting inputs or a different start on the same pair are refused. Once started, retries find the persisted run (`previousStart`) and copy nothing twice. The file count is recorded in a `build_copied` event, outside the config.
- The workspace is the agent's session folder (`participantWorkspace`, also used by `NativeFactory.open`), so the folder is right there for the agent with no new session. Anything a Build session's 1:1 lines set up (a cloned repository) sits beside it.

**Access (Ask: explicitly scoped file operations only).**
- `ActivationManager.workspaceAccess` (set by the service) returns the seat's workspace while that pair's active run is a running Build run, or while a 1:1 request sent with `tools` is answering. `NativeParticipant` reads it at each permission request.
- `direct.send` accepts `tools` only in a Build session: a thread with no runs yet, or whose first run is a build.
- `buildPermission` requires a recognized file-operation kind and complete, explicit workspace paths. It refuses shell/process/interpreter requests and executable argument fields regardless of other paths. File URLs are decoded and checked; linked components, hard-linked files, ambiguous Windows paths, missing paths, and unknown tool shapes fail closed. Literal file contents are data, not executable permission metadata.
- It also refuses a write into a CLI's own settings folder in the workspace (`.claude`, `.codex`, `.gemini`, `.grok`), which would change that agent's permissions from its next start, and a request to leave the sandbox. That is found by the setting's name (Codex's `sandbox_permissions: require_escalated`, `with_escalated_permissions: true`), never by words in file content. Web tools stay with the internet switch.
- Codex is switched to its `workspace-write` mode for Build runs and tool 1:1 lines (`setBuildAccess`), and back to read-only before anything else. `CODEX_CONFIG.sandbox_workspace_write.network_access` follows the internet switch (set at launch, like `web_search`).

**The app (`src/preview.ts`).**
- The build prompt asks each agent to end with `APP: <page relative to its working directory>` or `APP: http://localhost:<port>/` for a server it left running. `appTarget` reads the last such line. It accepts only a path that exists inside the workspace, or a loopback URL with a port.
- `build.preview {runId, seat}` returns the server URL, or a static preview: the named page (or `pageIn` the folder: `index.html`, else `dist/`, `build/`, `public/` and so on), served by `Previews`.
- **Previews.** One `http` server per run and seat, on its own 127.0.0.1 port (so its own origin), unref'd, at most 8 (least recently used closed).
  - The link `/__ava/open?key=<32 random bytes>&path=<page>` sets an `HttpOnly; SameSite=Strict` cookie and redirects. Every other request needs that cookie and the exact `Host`, so other sites and DNS rebinding get 403.
  - Requests are GET/HEAD only. Paths resolve inside the served folder, and so does their real path (`realpathSync.native`, checked before a folder is listed or a file read: no junction escapes). `.git` is hidden in any letter case, as are the Windows names that reach a file another way (a trailing dot or space, an alternate data stream after `:`, a short 8.3 name such as `GIT~1`). The key and cookie are compared as bytes, and a request that throws gets a 500 rather than stopping the service. `appTarget` also checks the named page's real path, and reads the reply line by line (only lines up to 2,000 characters), since one pattern over the whole reply backtracked quadratically. Two opens of the same preview at once share one server. Responses carry `nosniff`, `Cross-Origin-Resource-Policy: same-site` and `frame-ancestors http://127.0.0.1:*`.
  - The room's CSP allows `frame-src http://127.0.0.1:* http://localhost:*` for the Results panel. (CSP has no form for an IPv6 address, so a server an agent names as `http://[::1]:<port>/` opens in a new tab only.) Its iframes use `sandbox` with `allow-same-origin`, which is safe because they are a different origin from the room.
- `build.changes {runId, seat}` diffs the folder against its first commit through a temporary `GIT_INDEX_FILE` (`git add -A` into it, then `git diff --cached`). New files show and the agent's own index is untouched.
  - **AvA never opens the copy's repository (Q1).** The agent can rewrite its copy's `.git`: settings, worktree settings (`extensions.worktreeConfig`) or a filter that names a program, applied through `.gitattributes`. So when the copy is made, the worker also clones its first commit into a bare repository of AvA's own, outside the workspace (`<data>/baselines/<pair>/<seat>/<generation>/<folder>.git`, removed with the thread). Each diff runs in a scratch repository (AvA's settings, no templates) whose `objects/info/alternates` borrows those objects, with the copy as its work tree only and no inherited `GIT_*` variables. A copy made before that record existed borrows its own object store as data instead, with its HEAD read from the ref files as text. The agent's own commits, or a deleted `.git`, don't move the baseline. The result has per-file status and line counts, plus a patch capped at 400 KB (no patch beyond 2,000 files).

**Leftover processes.** `ConversationController.cleanup` runs `stopLeftovers` once both agents have reported and before the run ends (and fire-and-forget after any other ending).
- **Leftovers:** live processes that started after the run did, in that seat's recorded process tree (`Store.seatProcesses` plus `survivors`) or among its job's members (see Process containment). The agent itself started earlier.
- **Kept server:** if the agent named a server, the processes listening on its port (`Get-NetTCPConnection`; `lsof` elsewhere) are kept. So are their leftover ancestors and fresh descendants, recorded as a `build_server` event. A server started during the run counts even outside the tree.
- **Stopped:** everything else is stopped by tree (`taskkill /T /F`, topmost PIDs only) and recorded as `build_cleanup`. Both outcomes are written to the agent's screen.
- **Later:** `pair.clear` and `history.clear` stop the kept servers, checking that each PID still has the start time recorded.

**Clear history** (`history.clear`) refuses while any run is active, a 1:1 reply is pending, or an agent is restarting. While it runs, every RPC that changes state is refused (`CLEARING`), and its transaction checks again that no run started.
- It stops kept servers and closes previews, then gives the room's pair fresh sessions.
- `Store.clearHistory` empties runs, messages, turns, deliveries, events, phases, 1:1 messages, thread names, and attachments (and their files). Pairs, rooms, presets, the process ledger and the command (idempotency) records stay.
- Last, it removes every workspace and session-state folder (`acpx/`) that no pair's current session uses. The CLIs' own session histories (in their own homes) are theirs, and AvA doesn't touch them.

**Verified live** on all five providers: Review (`scripts/live-build.ts`) and apps (`scripts/live-build-app.ts`).

## Activation in the room, permissions, and new threads

**Diagnostics.** Bare `/ava` returns help without creating a pair. `/ava doctor` checks installed versions and documented login-status commands, and reads Gateway credit without a model call. Unknown versions or unsupported sign-in checks stay unknown. The activation menu flags missing or outdated required CLIs before discovery. An in-flight HTTP request keeps the service busy so a slow diagnostic cannot trigger idle shutdown.

**Activation.** The room opens whether or not its agents are active; `room.prepare` and `room.open` only bind the opening to the slot generations (`STALE_TICKET`).
- Each agent pane shows **Activate** in place of its name until the agent is ready, then the name itself opens setup.
- Setup is the same menu the hosts print for `/ava CLI1` (`menu.show` / `menu.choose`, `src/menus.ts`), shown as text in `ui/agent-setup.tsx`. Each numbered line is a button, typed numbers work, and B goes back. Closing the window cancels nothing.

**Permissions** (`Slot.permissions`, `slot.permissions`, and the menu's Permissions line) are read live and keep the session.
- **ask** (default): the gate (`toolPermission`) allows web tools per the internet switch, and a Build workspace's own paths. It refuses the rest (deny-all) and says so in the agent's screen.
- **bypass:** the gate approves every non-web request in every mode. Web tools still follow the switch whenever the agent asks.
  - **Codex:** decides in its own sandbox, so `setBuildAccess` sets its mode before each request: `agent-full-access` under bypass, `workspace-write` for Build work, `read-only` otherwise. A change applies at once when the agent is idle.
  - **1:1 lines:** under bypass, the 1:1 prompt says the agent may use its tools.

**New threads.** `room.new` creates a pair (thread key `room-<uuid>`) and its room, and the UI opens it in a new tab with `&mode=` in the fragment.
- `pairs.active` lists pairs with live or starting agents.
- From the third such pair, the UI asks before opening another page and again before an activation. The user may go ahead.

## The installed CLIs

AvA drives the user's own installed CLIs for every provider. Grok Build and Antigravity are inspected installed executables. Codex and Claude Code run through ACP adapters (`@agentclientprotocol/codex-acp`, `claude-agent-acp`) that would otherwise use their own bundled copies of the CLIs (about 660 MB). `src/clis.ts` finds the installed ones instead.

- **Finding them:** `findOnPath` looks for `codex` or `claude` on PATH. `launchOf` starts a native executable directly. An npm shim (`.cmd`, `.ps1` or a script) is resolved to the package's own entry file, which runs with Node, because a `.cmd` can't start without a shell.
- **Versions:** `installedCli` reads `--version` once per file and requires each adapter's own minimum: Codex 0.159.1 (codex-acp depends on `@openai/codex ^0.159.1`) and Claude Code 2.1.286 (the Agent SDK's `claudeCodeVersion`). `test/clis.test.ts` keeps `MINIMUM` equal to those package fields. A missing CLI is `MISSING_PROVIDER` and an old one is `PROVIDER_TOO_OLD`, each with the install or update command.
- **Codex** (and the Gateway, which runs on it): the generated launcher (`<data>/wrappers/codex-child-<signature>.cmd`, `CODEX_PATH`) delegates to a Node launcher that starts the installed CLI with `--disable plugins --disable apps --disable remote_plugin --disable hooks`. MCP discovery uses those same switches; a TOML table overlay disables every remaining disk server by its literal name, and session MCP overrides are removed. Arguments are passed as data to the CLI, so names with dots or shell punctuation cannot change the command. Discovery failure refuses startup. Without an installed Codex, `participantEnvironment` refuses rather than let the adapter fall back to a copy.
- **Claude Code:** `CLAUDE_CODE_EXECUTABLE` names a child `.mjs` launcher that runs the installed CLI with `--strict-mcp-config`. Only the adapter-supplied MCP configuration is loaded; the host profile is unchanged.
- **Packaging:** `scripts/package.ts` removes the adapters' platform packages (`@openai/codex-<platform>`, `@anthropic-ai/claude-agent-sdk-<platform>`) wherever npm placed them, and `package-smoke.ts` checks none ship. The plugin is about 76 MB. `npm run package -- --out <dir>` builds a staging copy, because the Claude desktop app runs the plugin straight from `release/marketplace`.
- **Activation evidence** names the CLI and version used (`Installed codex 0.159.3.`).
## Vercel AI Gateway (fifth provider)

`vercel` is a provider whose agent is the Codex ACP adapter pointed at the Gateway (`src/gateway.ts`); `adapterOf('vercel')` is `codex`.

**Launch** (`participantEnvironment` with `gateway`). The values match what `vercel ai-gateway setup` writes for Codex, applied to AvA's child process only:
- `CODEX_CONFIG` adds `model_provider: vercel`, the model, `model_reasoning_effort`, and `model_providers.vercel` (`https://ai-gateway.vercel.sh/codex/v1`, `env_key: AI_GATEWAY_API_KEY`, `wire_api: responses`). It also sets `MODEL_PROVIDER=vercel` and the key.
- **Model and effort** are fixed at launch: they aren't in Codex's own model list, so `setModel` is skipped. Activation checks that `currentModelId` is the chosen ID.
- **Web search** (OpenAI's hosted tool) stays disabled. The internet switch sets command network access (a launch setting, so switching restarts the agent).
- **Images** follow the model's `vision` tag in the catalog.

**Models.** The public list at `https://ai-gateway.vercel.sh/v1/models` is fetched without a key, cached for an hour, and kept on disk as a fallback.
- `parseModels` keeps language models tagged `tool-use`.
- **Efforts:** named efforts are filtered to the values Codex accepts. A token budget or an on/off switch becomes low, medium and high.
- **Menu:** the menu's model phase has a `context` (`maker`, `page`, `query`): makers by size, then a maker's models newest first, 20 per page, or a search (`menu.search`, up to 40 results; the room shows a search box when `menu.search` is true). B from a maker or a search returns to the makers.

**Key.** `gatewayKey`: `AI_GATEWAY_API_KEY` from the environment, else `<data>/secrets/ai-gateway.json`. Before writing secret bytes, `private-files.ts` gives `secrets/`, the key and `server.json` an explicit current-user-only Windows ACL with inheritance disabled (0700 directories / 0600 files on other platforms). Service startup also secures an existing Gateway key. Failure refuses the write; linked private paths are refused. Menus and RPCs see only `gatewayKeyStatus` (source, last four characters, budget).
- The menu's **Gateway key** page can create one: `vercel ai-gateway api-keys create --name agent-vs-agent --limit <25|100> --refresh-period monthly --non-interactive` (fixed arguments, run through the user's Vercel CLI login). It reads the key from the output.
- `src/gateway-key.ts` (`npm run gateway-key -- …`, shipped as `dist/src/gateway-key.js`) stores, creates, checks or forgets the key from a terminal. It checks against `/v1/credits`, which uses no model.
- The Vercel CLI's own login token is refused by the Gateway (checked: 401), so a key is required.
- **Auth route:** `auth` must be `api`. A Gateway 401 becomes `GATEWAY_AUTH` with what to do.

## Context and usage ring

Each active agent's pane header has a ring (`ui/usage-ring.tsx`), after Claude's usage ring next to its model picker. Claude fills its ring with plan usage and shows the context window in the popover. The CLIs don't pass plan limits through ACP, and context is what changes during a run, so AvA's ring fills with **context**.

- **Source:** ACPX turns each ACP `usage_update` into a status event with `used` and `size` (tokens in use, the model's window), plus `cost` when the agent reports one. `NativeParticipant` keeps the latest as its usage report instead of logging it as an activity line. Session token totals are summed from `getStatus().usage.perRequest`; the field named `cumulative` can contain only the latest turn (verified for both Codex and Claude Code).
- **Stats:** each settled request saves the new entries in the provider's per-request usage map as a `usage_reported` event. This excludes activation, 1:1 messages and earlier prompts without guessing from output length. For runtimes without that map, monotonic before/after totals are a fallback; missing baselines or reset counters stay unknown. Stats sums the saved request reports across runs; only Grok Build and Antigravity use character estimates.
- **Seen live:** Claude Code reported 35.2k of a 1M window, with a cost estimate at API prices. Codex reported 17.1k of 828.4k. Grok Build and Antigravity send no usage updates.
- **Room:** `pairView.usage[seat]` is the live agent's report (`null` before the first, or when the agent isn't the slot's current session). For a Gateway agent it adds the key's credit (`gatewayCredit`: `GET /v1/credits`, read in the background at most once a minute, never on the polling path).
- **Plan limits aren't available:** Claude Code attaches its rate-limit info to `usage_update` `_meta`, which ACPX drops; Codex keeps its limits for `/status`. AvA doesn't read the users' credentials to fetch them, so the popover says where to look.
- **Thresholds:** amber from 80 %, red from 95 %, always with the percentage and a "Getting full" or "Nearly full" note, never color alone. The simulator reports growing usage, so the ring can be checked without quota.
## Internet switch

`Slot.internet` (default off) is set by `slot.internet` and may change while a run holds the pair (`Store.setSlotInternet`). It is enforced in two ways, plus a stated setting:

1. **Permission gate (instant; Claude Code, Antigravity).** `NativeParticipant.request` passes ACPX a per-turn `onPermissionRequest` (`webPermission`), which ACPX asks before its own `deny-all` mode.
   - It allows a request only when it is a web tool and the switch reads on at that moment. Web tools are ACP kind `fetch` (Claude Code's WebSearch and WebFetch) or a web tool name (Antigravity's `search_web`, kind `search`; file searches share that kind, so the name decides).
   - Anything else falls through to deny-all. Each decision shows in the agent's activity.
2. **Launch setting (restart; Codex, Grok Build).** These web searches run without per-call approval (Codex's native tool; Grok's server-side `web_search`), so AvA sets them at process start (`LAUNCH_TIME_WEB`):
   - **Codex:** `CODEX_CONFIG.web_search` is `live` or `disabled`.
   - **Grok:** the global flag `--disable-web-search` goes before `agent stdio`.
   - The participant records `launchedWithInternet`. When the switch differs, `ActivationManager.relaunch` retires the process and starts a new one that resumes the same native session (ACPX `resumeSessionId`, with a fresh session record). It checks the session ID and swaps the process into live runs (`ConversationController.replaceParticipant`).
   - Codex allows one process per session ("thread_active_writer"), so the old one must close first. A failed resume marks the slot failed; nothing is resent.
   - The restart is refused unless the agent is between requests: no 1:1 reply pending, and the run stopped, or paused with nothing in flight.
3. **Stated setting.** Every room prompt, benchmark prompt (one trailing line), and 1:1 prompt states the agent's current setting (`internetNote`).
   - When on, the note says the tools are available now even if they weren't earlier. Agents carry beliefs: Grok kept looking for a web tool it had found missing, and Codex noticed its new tool only once told.
   - When off, the note also says not to try other routes. Grok tried `curl`; AvA refused it, and Grok then cancelled its own turn.

**Images.** `NativeParticipant.imageInput` comes from the agent's declared `promptCapabilities.image`, read from ACPX's session record. Grok Build declares false. `AvAService.attachable` refuses an image for such a pair up front, and `pairView.images` lets the UI warn before upload.

Verified live (`scripts/probe-internet.ts`, `scripts/probe-capabilities.ts`, `scripts/live-acceptance.ts`):
- **Codex:** off said it had no web tool. On, after the resume, it recalled a code word from before the restart and ran a real web search.
- **Claude Code:** off, the gate refused WebSearch ("User refused permission") and it said it had no web access. On, in the same session, the search ran.
- **Antigravity:** off, the gate refused `search_web`. On, it was allowed and completed.
- **Grok Build:** off, it had no web tools. Started on and resumed off, the web tool was gone. Started off and resumed on, it searched once the prompt said the tools were back.

## Process containment

On Windows each agent runs in its own job object (`src/jobs.ts`).

**Launching an agent:**
1. ACPX starts a small launcher in place of the agent: `node <launcher> <signal folder> <token> <agent command…>`, with a random token per launch.
2. The launcher waits.
3. In `onSpawned`, which ACPX awaits, AvA assigns the launcher to the agent's job and writes `<token>-<pid>.ready`. (The token means a signal left for an earlier launcher with the same PID can't start this one early.)
4. Only then does the launcher start the agent, on its own stdio.

So the agent and everything it starts are in the job from their first instruction. The job allows no breakaway.

**The helper** is one long-lived Windows PowerShell process with a compiled C# class. It holds the job handles (a job loses its name with its last handle), and it answers create, assign, list, terminate and close requests, one JSON line each.

**Lineage.** Some programs start outside their parent's job, and Windows won't add them to another job. Seen live: Codex runs commands in PowerShell 7 from the Microsoft Store, and what that starts is outside the agent's job. So about every 100 ms the helper also reads a process snapshot and records each process whose parent is in the job or already in its lineage. Each record has a start time: a child can't be older than its parent, and a PID that comes back with another start time was reused. A recorded PID that exits gets the time it was first seen gone, and only children started before then count: a process that reused the PID, started a child and exited between two sweeps can't pass that child off as the agent's (Q2). A job's members are then the processes in it plus the lineage still running.

**Members** are used in three places:
- **Build cleanup** adds them to the seat's process tree.
- **Closing an agent** stops them after ACPX's own shutdown, except the app servers its Build runs kept (`ParticipantOptions.keep`); with nothing kept, the whole job is terminated.
- **Activation evidence** reports the containment ("Processes contained in a Windows job object.").

**What it doesn't change:**
- The jobs aren't kill-on-close: if the service stops, agents and kept servers behave as before, and the process ledger and census still find survivors.
- If the helper can't start, or `AVA_JOB_OBJECTS=off` is set, agents start uncontained and their evidence says so. A helper that stops after it was running starts again on the next request (up to three times); the jobs it held are lost, so their agents are found through the process ledger.

## Ownership

`server.ts --mcp` is a small client of one background owner, not an independent controller. A transactional SQLite owner record prevents competing processes from opening the run store as active owners. An owner record names its PID and start time (in `service.lock` and the claim's token in `owner.sqlite`), and a live PID counts as the owner only if its start time matches: Windows reuses PIDs, often right after a reboot, and a PID check alone would then block every new service. Records from older versions have no start time and are judged by PID. A PID that can't be signalled (EPERM, an elevated service seen from a normal one) is alive. A dead process does not authorize resubmission of its turns: startup quarantines unfinished runs and invalidates old readiness receipts. The service keeps an active pair lease during pause, cancellation, and uncertainty.

`activation.ts` owns native connections and generation fences. An activation has an end-to-end deadline, including model selection and the live nonce challenge. A late response cannot replace newer settings. `providers.ts` binds inspected installed argv, uses public ACPX runtime APIs, separates activity from final output, and checks that native conversation identity stays stable.

Codex app-server initializes plugins before session configuration arrives. The adapter's `CODEX_CONFIG` alone did not prevent inherited plugin startup in the live test. AvA therefore uses `CODEX_PATH` to select a generated local launcher for the installed compatible Codex binary, supplying process-level feature-disable flags. A participant marker also blocks the AvA hook and server entrypoint when inherited. This changes child startup only, leaving host settings and existing credentials in place. The final live census showed no recursive AvA child.

## Formal debates and the judge

A debate (Debate mode) is a formal debate (G6–G8):

- **Run settings.** `RunConfig.stances` gives each seat its side. `speechMs` limits each speech, and `judge` names the CLI that judges.
  - **Limits (Q3):** a debate with sides always runs by its rounds (a time in the topic or Options doesn't apply, and neither does a room message's "…for N minutes"). Its request cap leaves a format repair for every speech (`rounds × 4`, plus the E7 briefing for an informal debate), since the debate ends on `rounds_done` anyway. Its time limit is a backstop that fits every speech at its longest (`rounds × 2 × (speech or turn limit + pace) + 10 min`, between an hour and a day). The opposite-sides check applies with or without a speech limit.
- **Briefs.** Before the run starts, `run.start` briefs both debaters through their own 1:1 lines (`sendDirect`; see `debate.ts debateBrief`). The brief holds the motion, the side, the format, the judging criteria, the speech time and the private brief from the template. The run starts once both have answered, and a failed brief refuses the start.
- **A fresh thread per debate.** When the pair's thread already holds a prompt and nothing is running, both agents first get fresh sessions (`endThread`), so each debate is its own thread. While a prompt runs, the start is refused as before.
- **Speeches.** Each turn's prompt (`controller.ts`) states the side and the speech the round calls for: an opening, a rebuttal, or the closing in the last round. It includes the rules: evidence, no invented facts, answer the strongest point.
- **Speech time.** It is wall-clock time for the whole request. When it runs out, the request is cancelled, like Stop. A settled cancel commits a forfeit message in that seat's place and the debate continues. A cancel that doesn't settle within the grace leaves the run needing attention, as anywhere.
- **The judge.** When a completed run ends, `engine.ended` starts it. It is a fresh session in its own pair (`debate-judge-…`): outside the agent limit (it isn't counted against anyone else's either), not remembered by Quick activate, internet on, Ask permissions. Once it has scored, its pair and folders are deleted, since its saved session state holds the whole debate; Delete thread and Clear history drop any judge pairs left from their debates.
  - **Its settings:** the CLI's strongest model (`quick.ts strongestModel`) at its highest effort (`maxEffort`: "max" where offered).
  - **Its input:** the motion and the speeches labeled Proposition and Opposition (`judgePrompt`), never the briefs, 1:1 lines or identities.
  - **Its ballot:** `parseBallot` maps the JSON back to seats. The ballot is saved on the run (`Run.judgment`); one that was judging when the service stopped is marked failed at the next start.
  - **On demand:** `debate.judge` judges again, or judges a stopped debate.
- **Starters.** Starter set 3 adds the ten formal motions and retires earlier debate starters still exactly as shipped, matched by fingerprint (`RETIRED_STARTERS`).

## Prompt challenges and fresh threads

- **Answer key.** A Prompt run may carry one (`RunConfig.check`: challenge or race, accepted answers), saved with a library prompt in `check.json` beside `prompt.md` and never sent to the agents.
- **Scoring.** When the run ends, `answer-check.ts` reads each agent's last `ANSWER:` line, with paired Markdown marks removed (from the key too). A numeric key compares by value with the answer's first number after any `=`, decimals and fractions included, and an answer offering alternatives ("or", "and", ±) fails. Anything else compares as text. The time is from the agent's request start (`prompt_started`) to its committed answer. The result is saved on the run (`Run.result`), and the winner is the right answer, or the faster one.
- **Fresh threads.** A Prompt run or a formal debate after an earlier prompt in the same thread first calls `freshThread`. It waits for any 1:1 reply, stops kept app servers, and calls `ActivationManager.renew` for both seats. A seat counts as stale until its renewal succeeds, and a failed debate brief marks both seats stale: the next start renews stale seats even though the thread (keyed by the sessions) now looks empty (Q3).
  - **What renew does:** it opens a new session (next generation) and passes its readiness check while the old session keeps serving. It then swaps the slot's session and generation in one write and closes the old process.
  - **Effect:** the slot never leaves Ready. A failed fresh session leaves the old one in place.
- **Starter set 4.** It adds the ten Prompt challenges and races, and retires the two earlier Prompt starters still exactly as shipped.

## Updates, Quick activate and thread deletion

- **Service handover (E14).** `health` reports the service's version. A plugin newer than the running service asks it to step aside (`service.retire`). The service agrees only when `busyReason()` finds nothing it would cut off, then closes its agents and exits, and the plugin starts its own. The same check holds the daemon's idle exit (Q4): a running conversation (a run needing attention counts only while this service has a request registered for it), a 1:1 reply, a preparation or a closing thread, a benchmark, a judge, a command still running, an agent restarting or activating, Clear history, or a model-list lookup (whose discovery agent would otherwise outlive the service). Shutdown waits at most 15 s for agents to confirm closing, cancels lookups, and the process exits even if a step failed (the ledger finds whatever stayed); an empty or unreadable `service.lock` counts as stale. The owner claim checks whether the recorded owner still runs before taking `owner.sqlite`'s write lock, so two services starting together don't time out on each other. An older plugin uses a newer service as it is. Services from before 0.4.1 can't be asked.
- **Quick activate (E13).** An agent's settings (config, permissions, internet) are remembered in `app_settings` per seat and per CLI when it activates or its internet or permissions change. `slot.quick` reuses them, or picks the strongest model at high effort, with Ask and internet off.
- **Thread deletion.** `thread.delete` removes one thread's runs (messages, turns, deliveries, events, phases), 1:1 messages and title, plus the attachments and session folders only it used. It refuses a current thread whose agents are active.

## Conversation contract

`controller.ts` uses an injected monotonic clock. A queued human message is admitted into one frozen pair of inputs, so the faster opening cannot leak into the slower opening. Future broadcasts are excluded until their own admission. After paired replies, a single-seat phase alternates between the agents. Only a completed, valid response envelope becomes a public message. A malformed answer gets at most one repair and consumes the same request budget.

Each admission creates a **phase** (paired for an admitted broadcast, single otherwise; a format repair joins its original turn's phase). `Store.commitReply` completes the phase and sets the next seat in the same transaction as the reply, so a crash cannot separate a reply from the scheduling decision it completes. `test/crash.test.ts` kills a real controller in a child process at ten write points and checks restart invariants. The database schema is versioned with `PRAGMA user_version` (v2 phases, v3 process ledger) and migrated in place by `Store.migrate()`.

The run store persists commands, request reservations, turns, delivery acknowledgements, final messages, and sequenced version-1 events. Repeated start, broadcast, control, and reset request IDs preserve the original result. The browser retains an unacknowledged command across reloads, including its original method: a lost start response cannot accidentally become a duplicate broadcast.

Pause drains an admitted phase, including a bounded format repair. Stop and deadline expiry revoke public-commit authority immediately and request cancellation. If cancellation fails to settle, the pair remains quarantined. No elapsed-time catch-up loop is used after a delayed timer.

## Recovery

A quarantined run (`needs_attention`) keeps its pair lease until an operator releases it with `run.reconcile` (the room's **Release pair** button, `/ava reconcile`, or the `ava_reconcile` MCP tool). Release first closes this service's own sessions for the pair. It then checks the **process ledger**: every ACPX-spawned provider PID, recorded with its owner and spawn time. `src/census.ts` counts a recorded PID as alive only if its start time matches the record, and it includes live descendants, including orphans of a dead adapter. A record from before the current logon session (the start of its `winlogon.exe`) counts for nothing: no process outlives its session, whether after a restart, a sign-out or a Fast Startup shutdown, which keeps the boot time running. At startup the service drops those records and gives an earlier service's records whose process is gone an exit time, and Stop all does the same for what its census proved gone. A dead record's orphans started before then still count, and later processes that reuse its PID don't (Q2). Any survivor refuses the release and names the process; nothing is killed automatically. On success, one transaction abandons unconfirmed turns (never resent), stops the run with reason `reconciled`, frees the lease, and moves both slots to a new generation that needs fresh activation. Automatic crash recovery is not implemented.

Text menus and MCP menus share one snapshot. The service's current menu for a chat's pair and seat is the one the user last saw, whichever entrypoint showed it. The text client resolves typed choices through `menu.current`, and the MCP tool still names an explicit menu ID.

## Presentation

The room is a React interface served over protected loopback HTTP and opened in the host's browser panel (or any browser on the machine). It has two activity panes and a final-message room. Observation polls sequenced events without submitting provider work; activity retention is bounded to 500 groups and one million characters.
- **Polling (Q5).** One loop, every 400 ms in a visible tab (none in a hidden one; a tab shown again catches up at once, and an expired room link stops it). A refresh asked for during a poll runs once more after it, and answers for a mode or thread left meanwhile are dropped (a generation counter covers A → B → A). A live thread's events are read every tick, but the thread itself only when an event changes it (a message, a status), while a 1:1 reply is pending, when its run ends, or every 2.5 s; events load at most five pages a tick. An output line's decoded reply is worked out when the line changes, not on every render.
- **Retries (Q5).** Sends, run controls and the thread's own commands (Close thread, Clear Session) each keep their own retry record (`CommandClient`), so one can't replace another's request ID. A start's signature holds its options, and Close and Clear include the agents' generations, so a retry with other settings, or after the agents changed, is a new command. The Prompt builder keeps its prompt and request IDs until a save succeeds, and the setup menu takes one click at a time. Shared messages retain their saved IDs so replay does not duplicate them. React renders provider text without interpreting HTML.

**What the room's polling costs (Q6).** The store opens with `synchronous=NORMAL` (in WAL mode a crash of the service loses nothing, and the commits for streamed chunks no longer wait for the disk). Thread groupings are cached until a run is written, a thread's view reads activity for its own runs only (the latest event through the `(run_id, seq)` index), queued messages and reply counts are SQL counts, and the room's event pages leave out the run's messages (`run.get {eventsOnly}`). An agent's output is checked for lateness at most every 200 ms instead of per chunk. Build's Changes view runs git asynchronously, one reading per copy at a time; Delete thread and Clear history remove folders asynchronously. Model lists are shared between concurrent callers, CLI version warnings are read once a minute, Codex's MCP server names once per CLI and `config.toml`, and a benchmark suite is reloaded only when its files' names, sizes or times change.

The RPC endpoint answers a refusal AvA explains with 409 and its code, a malformed request with 400 (`INVALID_REQUEST`), and a failure of AvA itself with 500 (`INTERNAL`). The room shows **Reconnecting** only when AvA can't be reached; a thread that is gone (after Clear history, say) gives way to the room's current one.

An MCP Apps view (the room inside the host's own UI) is not implemented; the browser room works in both hosts.

## Participant isolation and clearing context

**The two agents stay isolated; there is no shared-context mode.** Each turn, an agent receives its seat, the shared topic, the remaining time, **its own** private instructions and stop condition, and unseen room messages (human broadcasts and the partner's final public replies; `src/controller.ts` `prompt()`, `src/store.ts` `admit()`). It never receives the partner's private instructions, stop condition, provider or model, or exposed activity (thinking, tools, drafts). The operator sees everything.

**Clear Session** (`pair.clear`, in the room's More menu; `pair.reset` is an alias) stops any running conversation (and refuses one that needs attention), then reconfigures and reactivates both seats. That gives them new native sessions, so neither remembers earlier turns; each makes one access check. It is idempotent per request ID.

## Codex hosting

Typed `/ava` commands go through the prompt hook to the `ava_command` MCP tool. The hook validates them with a strict grammar and passes on only the normalized command and the chat ID. The MCP server runs outside the chat's sandbox, and Codex lets the user approve its tools once ("always"). (A shell route would need a sandbox escalation on every command.)

The packaged plugin's `.mcp.json` uses a relative path with `cwd: "."` and an explicit `env_vars` list. Codex does not expand `${PLUGIN_ROOT}` there (it does for hooks). Observed in the throwaway-profile test: when the Codex app-server session that launched the MCP server ends, the "detached" AvA service ends with it, abruptly and with no graceful shutdown. It stays up for the whole session. In the desktop app that session is long-lived, but quitting Codex presumably stops AvA and any running conversation the same way (not yet observed in the desktop app). On the next start the stale lock and rendezvous files are recognized as dead, and an interrupted run is quarantined for release, as with any crash. Data lives in the shared data folder (see Host wrappers) and survives upgrades and removal.

### Cursor's agent

Cursor's agent comes from ACPX's registry (`cursor-agent acp`), with three adjustments in `src/cursor.ts`:
- **Launch:** on Windows the registry finds a `.cmd` shim that starts PowerShell. AvA starts the newest installed version's bundled `node.exe` and `index.js` itself, so the agent needs no shell and its launcher can wait inside a job object.
- **Settings:** the agent reads `CURSOR_CONFIG_DIR`. AvA points it at `<data>/providers/cursor`, whose `cli-config.json` AvA keeps at an empty allow list (nothing runs without asking AvA), web searches set to ask, and no commit attribution. The agent's own saved choices there are kept, its ACP sessions are stored there too, and its sign-in, kept elsewhere, still applies.
- **Plan refusal:** Cursor answers a request its plan doesn't cover with "Upgrade your plan to continue". An activation that gets that answer fails with that reason.

## Known limits

The Resources panel enforces a persisted active-agent admission limit and reports sampled process memory (a PowerShell process listing at most every 15 s, while the panel polls every 5 s). Stop all cancels work, closes owned sessions and checks the process ledger while preserving history. Agents run in Windows job objects (see Process containment); production controls set no OS memory or filesystem limit yet.

Known limits in v0.3.1. Planned work is tracked in the [roadmap](roadmap.md).

- **No common command sandbox yet.** Ask refuses execution requests even in Build; a workspace path is not confinement. Codex also has its own sandbox. A provider that approves work internally may not ask AvA, so the gate is not complete process isolation. Under **Bypass**, execution is explicitly trusted with the user's privileges. Benchmark verifiers, and the generated code they import, run under the verifier guard, which Node itself describes as a guard against accidents rather than a sandbox. Untrusted task bundles, including imported ones, run their verifiers in a Docker container instead (opt-in; see the [benchmark guide](benchmarks.md)).
- **Claude Code's own settings come first.** Allow rules or a permissive `defaultMode` in the user's Claude Code settings approve tools before AvA's gate is asked, and ACPX can't turn those settings off for one session. The agent's screen says so once.
- **Process containment covers what agents start, directly or through their lineage.** On Windows each agent runs in a job object, and its lineage covers what starts outside it, such as a Microsoft Store app like PowerShell 7. A process that something else starts on the agent's behalf (a Windows service, a scheduled task, WMI) has no parent among the agent's processes and isn't found. A lineage member started and stopped within one 100 ms sweep can leave a child unattributed. Without the job helper (no Windows PowerShell, or `AVA_JOB_OBJECTS=off`), leftovers are found by process tree and start time only. A server listening on the port an agent named is kept even if something outside its tree started it during the run.
- **CLI versions.** Codex and Claude Code must meet the adapters' minimum versions; AvA refuses an older one with the update command rather than fall back. Moving to a newer adapter can raise the minimum.
- **Gateway models.** Model and effort are fixed when the agent starts. Some models answer only in their reasoning through the Codex agent and fail activation (seen: Kimi K2.6, K2.7 Code). Codex's warning about a model it has no metadata for is shown as a status line.
- **No automatic crash recovery.** A run interrupted by a crash needs the user to release it (see Recovery); nothing is resent.

## Future games

Keep the current native provider adapters. Add a scenario boundary before a proposed reply is committed to the room. A separate CAMEL Python worker can receive opaque seat IDs and typed actions and return public events, private observations, verdicts, and a terminal result. The controller must persist and validate that decision before routing anything to the peer. Do not forward CAMEL's raw state or let the two CLIs determine authoritative scores. The pinned reference is CAMEL 0.2.91a7; a production worker dependency still needs its own compatibility pilot.

## Release scope

The room, two host wrappers, prompt library, Resources and benchmark runner/results shipped in v0.2.0. The [validation record](validation.md) distinguishes its offline, browser and live-provider coverage. v0.3.1 adds the verifier guard, job-object containment, container verifiers, the 20-task starter suite, reports, importers and rubric scores; its [release notes](release-v0.3.1.md) record what was tested. The future-games design above is a proposal. A common execution sandbox for agents, automatic crash recovery, an MCP Apps view, and macOS/Linux support are not implemented.
