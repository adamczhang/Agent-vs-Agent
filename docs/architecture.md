# Architecture

How Agent vs Agent is built, and why. What has been verified is in [the release notes](release-v0.1.0.md); how to use it is in [the user guide](user-guide.md).

The executable implementation is in `src/`, the browser interface in `ui/`, and the Codex plugin in `.codex-plugin/`, `hooks/`, and `skills/`. The Claude Code wrapper is in `wrappers/claude/`. The agents are reached through [ACPX](https://www.npmjs.com/package/acpx) and the Agent Client Protocol (ACP).

## Host wrappers

One core (`dist/`, `node_modules/`, the MCP server, the background service, the room UI, and the data folder) has two thin wrappers. `scripts/package.ts` builds both into one local marketplace: `plugins/agent-vs-agent` for Codex and `plugins/agent-vs-agent-claude` for Claude Code. The Claude Code folder hard-links the core files.

They are separate folders because Claude Code auto-loads `hooks/hooks.json` and `.mcp.json` from a plugin root and would pick up the Codex versions.

- **Codex:** a `UserPromptSubmit` hook validates a typed `/ava …` and tells Codex to call `ava_command` with the chat's thread ID.
- **Claude Code:** the same `/ava` commands, from a plugin skill named `ava` (`skills/ava/SKILL.md`). A plugin skill answers to its bare name unless another command claims it, and its full name `/agent-vs-agent:ava` always works.
  - The skill passes `/ava $ARGUMENTS` to `ava_command` with thread `claude-${CLAUDE_SESSION_ID}`, so each Claude Code conversation has its own pair, as each Codex chat does, and resuming it brings the pair back. The operating skill passes the same thread to the read-only tools. A call with no thread (an older wrapper) falls back to `session-<parent PID>`.
  - `allowed-tools` pre-approves only that tool, only during that turn. `disable-model-invocation` keeps Claude from running the skill itself.
  - Menus read `/ava …` in both hosts. The server still supports `AVA_COMMAND_NAME` for a host that needs another name, but none sets it.

**One conversation pool.** `src/paths.ts` `dataRootFor()` resolves the data folder in this order:
1. `AVA_DATA_DIR`;
2. `package.json` `config.dataDir`, if a build sets one: `scripts/package.ts` copies it into each plugin's runtime `package.json`;
3. otherwise `AgentVsAgent` in the home folder when packaged (`%USERPROFILE%\AgentVsAgent`), or `.ava-data` in a development checkout.

Not AppData: packaged Windows apps such as the Claude desktop app redirect AppData writes into private storage, which would split the history between hosts. Tools run from a checkout that act on the installed plugins' data (`npm run gateway-key`, the history import, the live test scripts) use `installedDataRoot()`, the folder a packaged plugin would use.

`npm run serve` (`--standalone`) is the exception: without `AVA_DATA_DIR` it uses `.ava-serve` in the checkout, so a development server never opens the shared pool.

Every host therefore resolves the same folder. `ensureService` finds or starts the single owner there: whichever plugin starts it, the others connect to it, and the owner lock keeps it to one. Pairs stay per chat (Codex thread ID, or `session-<ppid>` in Claude Code); runs, History, search, and Stats are pool-wide. The folder is outside AppData because MSIX apps (the Claude desktop app) redirect AppData writes into private storage. `scripts/shared-pool-check.ts` runs both packaged plugins against one folder.

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
- `copyProject` copies the working tree into `<workspace>/<folder>` for each seat. A git source contributes `git ls-files -co --exclude-standard` (uncommitted work in, ignored output out); otherwise everything except generated folders, capped at 20,000 files and 500 MB. `startProject` makes an empty folder instead. Either way the folder gets a baseline commit.
- `folder` is derived from the request ID, so a retried start finds the same run (`previousStart`) and copies nothing twice. The file count is recorded in a `build_copied` event, outside the config.
- The workspace is the agent's session folder (`participantWorkspace`, also used by `NativeFactory.open`), so the folder is right there for the agent with no new session. Anything a Build session's 1:1 lines set up (a cloned repository) sits beside it.

**Access (policy: auto-approve everything in the agent's workspace).**
- `ActivationManager.workspaceAccess` (set by the service) returns the seat's workspace while that pair's active run is a running Build run, or while a 1:1 request sent with `tools` is answering. `NativeParticipant` reads it at each permission request.
- `direct.send` accepts `tools` only in a Build session: a thread with no runs yet, or whose first run is a build.
- `buildPermission` allows a request when every path in it lies inside the workspace. Paths are ACP `locations`, `rawInput` fields with a path-like name, and any absolute path under any key, at any depth and inside arrays (relative ones resolve against the workspace; URLs aren't paths). Command text isn't read for paths: commands run in the workspace.
- It also refuses a write into a CLI's own settings folder in the workspace (`.claude`, `.codex`, `.gemini`, `.grok`), which would change that agent's permissions from its next start, and a request to leave the sandbox. That is found by the setting's name (Codex's `sandbox_permissions: require_escalated`, `with_escalated_permissions: true`), never by words in file content. Web tools stay with the internet switch.
- Codex is switched to its `workspace-write` mode for Build runs and tool 1:1 lines (`setBuildAccess`), and back to read-only before anything else. `CODEX_CONFIG.sandbox_workspace_write.network_access` follows the internet switch (set at launch, like `web_search`).

**The app (`src/preview.ts`).**
- The build prompt asks each agent to end with `APP: <page relative to its working directory>` or `APP: http://localhost:<port>/` for a server it left running. `appTarget` reads the last such line. It accepts only a path that exists inside the workspace, or a loopback URL with a port.
- `build.preview {runId, seat}` returns the server URL, or a static preview: the named page (or `pageIn` the folder: `index.html`, else `dist/`, `build/`, `public/` and so on), served by `Previews`.
- **Previews.** One `http` server per run and seat, on its own 127.0.0.1 port (so its own origin), unref'd, at most 8 (least recently used closed).
  - The link `/__ava/open?key=<32 random bytes>&path=<page>` sets an `HttpOnly; SameSite=Strict` cookie and redirects. Every other request needs that cookie and the exact `Host`, so other sites and DNS rebinding get 403.
  - Requests are GET/HEAD only. Paths resolve inside the served folder, and so does their real path (no junction escapes). `.git` is hidden in any letter case, as are the Windows names that reach a file another way (a trailing dot or space, an alternate data stream after `:`). `appTarget` also checks the named page's real path. Two opens of the same preview at once share one server. Responses carry `nosniff`, `Cross-Origin-Resource-Policy: same-site` and `frame-ancestors http://127.0.0.1:*`.
  - The room's CSP allows `frame-src http://127.0.0.1:* http://localhost:*` for the Results panel. (CSP has no form for an IPv6 address, so a server an agent names as `http://[::1]:<port>/` opens in a new tab only.) Its iframes use `sandbox` with `allow-same-origin`, which is safe because they are a different origin from the room.
- `build.changes {runId, seat}` diffs the folder against its first commit through a temporary `GIT_INDEX_FILE` (`git add -A` into it, then `git diff --cached`). New files show and the agent's own index is untouched. The result has per-file status and line counts, plus a patch capped at 400 KB (no patch beyond 2,000 files).

**Leftover processes.** `ConversationController.cleanup` runs `stopLeftovers` once both agents have reported and before the run ends (and fire-and-forget after any other ending).
- **Leftovers:** live processes in that seat's recorded process tree (`Store.seatProcesses` plus `survivors`) that started after the run did. The agent itself started earlier.
- **Kept server:** if the agent named a server, the processes listening on its port (`Get-NetTCPConnection`; `lsof` elsewhere) are kept. So are their leftover ancestors and fresh descendants, recorded as a `build_server` event. A server started during the run counts even outside the tree.
- **Stopped:** everything else is stopped by tree (`taskkill /T /F`, topmost PIDs only) and recorded as `build_cleanup`. Both outcomes are written to the agent's screen.
- **Later:** `pair.clear` and `history.clear` stop the kept servers, checking that each PID still has the start time recorded.

**Clear history** (`history.clear`) refuses while any run is active, a 1:1 reply is pending, or an agent is restarting. While it runs, every RPC that changes state is refused (`CLEARING`), and its transaction checks again that no run started.
- It stops kept servers and closes previews, then gives the room's pair fresh sessions.
- `Store.clearHistory` empties runs, messages, turns, deliveries, events, phases, 1:1 messages, thread names, and attachments (and their files). Pairs, rooms, presets, the process ledger and the command (idempotency) records stay.
- Last, it removes every workspace and session-state folder (`acpx/`) that no pair's current session uses. The CLIs' own session histories (in their own homes) are theirs, and AvA doesn't touch them.

**Verified live** on all five providers: Review (`scripts/live-build.ts`) and apps (`scripts/live-build-app.ts`).

## Activation in the room, permissions, and new threads

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
- **Codex** (and the Gateway, which runs on it): the generated launcher (`<data>/wrappers/codex-child.cmd`, `CODEX_PATH`) starts the installed Codex with `--disable plugins --disable apps --disable remote_plugin --disable hooks`. Without an installed Codex, `participantEnvironment` refuses rather than let the adapter fall back to a copy.
- **Claude Code:** `CLAUDE_CODE_EXECUTABLE` names the installed binary or `.js` entry; the SDK runs a `.js` path with Node.
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

**Key.** `gatewayKey`: `AI_GATEWAY_API_KEY` from the environment, else `<data>/secrets/ai-gateway.json`. The file is written with mode 0600, which Windows ignores: there it is protected only by the data folder's own permissions, so keep that folder somewhere only you can read. Menus and RPCs see only `gatewayKeyStatus` (source, last four characters, budget).
- The menu's **Gateway key** page can create one: `vercel ai-gateway api-keys create --name agent-vs-agent --limit <25|100> --refresh-period monthly --non-interactive` (fixed arguments, run through the user's Vercel CLI login). It reads the key from the output.
- `src/gateway-key.ts` (`npm run gateway-key -- …`, shipped as `dist/src/gateway-key.js`) stores, creates, checks or forgets the key from a terminal. It checks against `/v1/credits`, which uses no model.
- The Vercel CLI's own login token is refused by the Gateway (checked: 401), so a key is required.
- **Auth route:** `auth` must be `api`. A Gateway 401 becomes `GATEWAY_AUTH` with what to do.

## Context and usage ring

Each active agent's pane header has a ring (`ui/usage-ring.tsx`), after Claude's usage ring next to its model picker. Claude fills its ring with plan usage and shows the context window in the popover. The CLIs don't pass plan limits through ACP, and context is what changes during a run, so AvA's ring fills with **context**.

- **Source:** ACPX turns each ACP `usage_update` into a status event with `used` and `size` (tokens in use, the model's window), plus `cost` when the agent reports one. `NativeParticipant` keeps the latest as its usage report instead of logging it as an activity line. After each turn it adds the session's totals from `getStatus().usage` (cumulative input, output and cached tokens, and cost).
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

## Ownership

`server.ts --mcp` is a small client of one background owner, not an independent controller. A transactional SQLite owner record prevents competing processes from opening the run store as active owners. An owner record names its PID and start time (in `service.lock` and the claim's token in `owner.sqlite`), and a live PID counts as the owner only if its start time matches: Windows reuses PIDs, often right after a reboot, and a PID check alone would then block every new service. Records from older versions have no start time and are judged by PID. A dead process does not authorize resubmission of its turns: startup quarantines unfinished runs and invalidates old readiness receipts. The service keeps an active pair lease during pause, cancellation, and uncertainty.

`activation.ts` owns native connections and generation fences. An activation has an end-to-end deadline, including model selection and the live nonce challenge. A late response cannot replace newer settings. `providers.ts` binds inspected installed argv, uses public ACPX runtime APIs, separates activity from final output, and checks that native conversation identity stays stable.

Codex app-server initializes plugins before session configuration arrives. The adapter's `CODEX_CONFIG` alone did not prevent inherited plugin startup in the live test. AvA therefore uses `CODEX_PATH` to select a generated local launcher for the installed compatible Codex binary, supplying process-level feature-disable flags. A participant marker also blocks the AvA hook and server entrypoint when inherited. This changes child startup only, leaving host settings and existing credentials in place. The final live census showed no recursive AvA child.

## Conversation contract

`controller.ts` uses an injected monotonic clock. A queued human message is admitted into one frozen pair of inputs, so the faster opening cannot leak into the slower opening. Future broadcasts are excluded until their own admission. After paired replies, a single-seat phase alternates between the agents. Only a completed, valid response envelope becomes a public message. A malformed answer gets at most one repair and consumes the same request budget.

Each admission creates a **phase** (paired for an admitted broadcast, single otherwise; a format repair joins its original turn's phase). `Store.commitReply` completes the phase and sets the next seat in the same transaction as the reply, so a crash cannot separate a reply from the scheduling decision it completes. `test/crash.test.ts` kills a real controller in a child process at ten write points and checks restart invariants. The database schema is versioned with `PRAGMA user_version` (v2 phases, v3 process ledger) and migrated in place by `Store.migrate()`.

The run store persists commands, request reservations, turns, delivery acknowledgements, final messages, and sequenced version-1 events. Repeated start, broadcast, control, and reset request IDs preserve the original result. The browser retains an unacknowledged command across reloads, including its original method: a lost start response cannot accidentally become a duplicate broadcast.

Pause drains an admitted phase, including a bounded format repair. Stop and deadline expiry revoke public-commit authority immediately and request cancellation. If cancellation fails to settle, the pair remains quarantined. No elapsed-time catch-up loop is used after a delayed timer.

## Recovery

A quarantined run (`needs_attention`) keeps its pair lease until an operator releases it with `run.reconcile` (the room's **Release pair** button, `/ava reconcile`, or the `ava_reconcile` MCP tool). Release first closes this service's own sessions for the pair. It then checks the **process ledger**: every ACPX-spawned provider PID, recorded with its owner and spawn time. `src/census.ts` counts a recorded PID as alive only if its start time matches the record, and it includes live descendants, including orphans of a dead adapter. Any survivor refuses the release and names the process; nothing is killed automatically. On success, one transaction abandons unconfirmed turns (never resent), stops the run with reason `reconciled`, frees the lease, and moves both slots to a new generation that needs fresh activation. Automatic crash recovery is not implemented.

Text menus and MCP menus share one snapshot. The service's current menu for a chat's pair and seat is the one the user last saw, whichever entrypoint showed it. The text client resolves typed choices through `menu.current`, and the MCP tool still names an explicit menu ID.

## Presentation

The room is a React interface served over protected loopback HTTP and opened in the host's browser panel (or any browser on the machine). It has two activity panes and a final-message room. Observation polls sequenced events without submitting provider work; activity retention is bounded to 500 groups and one million characters. Shared messages retain their saved IDs so replay does not duplicate them. React renders provider text without interpreting HTML.

The RPC endpoint answers a refusal AvA explains with 409 and its code, a malformed request with 400 (`INVALID_REQUEST`), and a failure of AvA itself with 500 (`INTERNAL`). The room shows **Reconnecting** only when AvA can't be reached; a thread that is gone (after Clear history, say) gives way to the room's current one.

An MCP Apps view (the room inside the host's own UI) is not implemented; the browser room works in both hosts.

## Participant isolation and clearing context

**The two agents stay isolated; there is no shared-context mode.** Each turn, an agent receives its seat, the shared topic, the remaining time, **its own** private instructions and stop condition, and unseen room messages (human broadcasts and the partner's final public replies; `src/controller.ts` `prompt()`, `src/store.ts` `admit()`). It never receives the partner's private instructions, stop condition, provider or model, or exposed activity (thinking, tools, drafts). The operator sees everything.

**Clear Session** (`pair.clear`, in the room's More menu; `pair.reset` is an alias) stops any running conversation (and refuses one that needs attention), then reconfigures and reactivates both seats. That gives them new native sessions, so neither remembers earlier turns; each makes one access check. It is idempotent per request ID.

## Codex hosting

Typed `/ava` commands go through the prompt hook to the `ava_command` MCP tool. The hook validates them with a strict grammar and passes on only the normalized command and the chat ID. The MCP server runs outside the chat's sandbox, and Codex lets the user approve its tools once ("always"). (A shell route would need a sandbox escalation on every command.)

The packaged plugin's `.mcp.json` uses a relative path with `cwd: "."` and an explicit `env_vars` list. Codex does not expand `${PLUGIN_ROOT}` there (it does for hooks). Observed in the throwaway-profile test: when the Codex app-server session that launched the MCP server ends, the "detached" AvA service ends with it, abruptly and with no graceful shutdown. It stays up for the whole session. In the desktop app that session is long-lived, but quitting Codex presumably stops AvA and any running conversation the same way (not yet observed in the desktop app). On the next start the stale lock and rendezvous files are recognized as dead, and an interrupted run is quarantined for release, as with any crash. Data lives in the shared data folder (see Host wrappers) and survives upgrades and removal.

## Known limits

Known and accepted in 0.1.x, deliberately or for later. Fixes are planned in the [roadmap](roadmap.md).

- **Build commands aren't confined.** The Build gate checks the paths a tool request names, not what a command does: a command runs in the agent's copy but can read and write anywhere the user can. Only Codex runs commands in its own sandbox. For the other agents the internet switch governs web tools, not a command's network access (`curl`, `git clone`). Under **bypass** everything is allowed.
- **Claude Code's own settings come first.** Allow rules or a permissive `defaultMode` in the user's Claude Code settings approve tools before AvA's gate is asked, and ACPX can't turn those settings off for one session. The agent's screen says so once.
- **Leftover processes are found by process tree and start time.** A process that left the tree (started through a service or re-parented by a launcher) isn't found or stopped. A server listening on the port an agent named is kept even if something outside its tree started it during the run.
- **The Build copy is synchronous.** Copying a large project (up to 20,000 files or 500 MB) holds the service until it finishes; other requests wait.
- **Codex agents inherit your own MCP servers.** Agents start with plugins, apps and hooks off, but MCP servers configured in your Codex `config.toml` (say `node_repl`) still start with them.
- **Windows file permissions.** Files AvA writes with mode 0600 (`server.json`, the Gateway key) are protected on Windows only by the data folder's own permissions.
- **CLI versions.** Codex and Claude Code must meet the adapters' minimum versions; AvA refuses an older one with the update command rather than fall back. Moving to a newer adapter can raise the minimum.
- **Gateway models.** Model and effort are fixed when the agent starts. Some models answer only in their reasoning through the Codex agent and fail activation (seen: Kimi K2.6, K2.7 Code). Codex's warning about a model it has no metadata for is shown as a status line.
- **No automatic crash recovery.** A run interrupted by a crash needs the user to release it (see Recovery); nothing is resent.

## Future games

Keep the current native provider adapters. Add a scenario boundary before a proposed reply is committed to the room. A separate CAMEL Python worker can receive opaque seat IDs and typed actions and return public events, private observations, verdicts, and a terminal result. The controller must persist and validate that decision before routing anything to the peer. Do not forward CAMEL's raw state or let the two CLIs determine authoritative scores. The pinned reference is CAMEL 0.2.91a7; a production worker dependency still needs its own compatibility pilot.

## Status (0.1.1)

Everything above is implemented, covered by the offline suite (`npm test`), and verified live on all five providers with `scripts/live-validate.ts` (see the release notes). Not implemented: automatic crash recovery, an MCP Apps view, and testing on macOS or Linux.
