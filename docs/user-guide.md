# Agent vs Agent: user guide

The v0.3.1 room in detail. For installation and an overview, see the [README](../README.md).

**Host** means the Codex or Claude Code app where the plugin is installed and `/ava` commands are entered. **Agent** means a separate CLI process in one of the room's two seats. Either host can use any supported pair of agents; using Codex as the host does not require using Codex as an agent. Vercel AI Gateway is an additional model route through the Codex adapter, not a separate CLI.

For development and validation, see [Contributing](../CONTRIBUTING.md). For the local token model, Bypass and vulnerability reporting, see [Security](../SECURITY.md).

## Opening the room and activating agents

- Type `/ava` for short help, or `/ava doctor` for diagnostics in either host. Doctor checks CLI installation and versions, Codex and Claude Code sign-in status where available, and the Gateway key's credit endpoint. It sends **no model requests**. Grok Build and Antigravity sign-in checks are reported as unavailable; only activation proves model access.
- An outdated Codex or Claude Code is flagged in the activation menu with its update command. The Gateway also requires a compatible Codex CLI.
- Type `/ava start` in Codex or Claude Code (the same `/ava` commands work in both hosts). The room opens in your browser panel, or you get its link.
- Above each agent's screen, **Activate** stands where the agent's name goes. Click it to open that agent's setup menu: the same text menu the hosts print for `/ava CLI1`, in a small window. Click a line, or type its number; **B** goes back and **X** closes.
  - Choose the CLI (Claude Code, Codex CLI, Grok Build or Antigravity; the same CLI can take both seats), then its model, effort, speed, account route and permissions.
  - **Activate and verify** sends one short request to check that the model answers.
- **Vercel AI Gateway** is the fifth provider choice. Available models and makers are loaded from the Gateway catalog.
  - **Model:** pick a maker, then a model (newest first, 20 per page), or type in the search box to search them all. **Effort** offers that model's own reasoning levels.
  - **The agent:** Codex, pointed at the Gateway (as `vercel ai-gateway setup` configures Codex), set up for AvA's own process only. Your Codex and Claude Code settings are never changed.
  - **The key:** the Gateway works only with an AI Gateway API key. Your Vercel login can't call it directly, but it can create a key.
    - **Gateway key** in the menu creates one named `agent-vs-agent`, with a monthly budget, using your Vercel CLI login.
    - Alternatively, from a checkout, run `npm run gateway-key -- set` and paste a key you already have (it isn't shown), or set `AI_GATEWAY_API_KEY`.
    - AvA keeps its key in the data folder (`secrets/ai-gateway.json`) and never shows it. `npm run gateway-key -- status` says whether the Gateway accepts it.
  - **Internet switch:** the Gateway agent has no built-in web search, so the switch only lets its commands reach the network.
- Once an agent is active, click its name to change its settings. A new model, effort or CLI needs reactivating, which starts a fresh session for that agent. Permissions change at once.
- The text menus still work in both hosts: `/ava CLI1`, `/ava CLI2`, with choices like `/ava CLI1 2`.

### Permissions

Each agent's setup menu has a **Permissions** line.

- **Ask** (the default):
  - **Prompt and Debate:** agents can't use tools that need permission.
  - **Build:** recognized file tools may read and edit inside each agent's own folder. AvA refuses command execution, unknown tools, linked paths, and sandbox escalation.
  - Refusals show in the agent's screen.
- **Bypass:** AvA approves every tool request the agent makes, in every mode, which is useful for benchmarks where the agents should run code. The pane shows a red **Bypass** tag.
  - **Codex:** runs in its own full-access mode.
  - **Claude Code, Grok Build and Antigravity:** AvA's gate approves each request. Each CLI's own name for this is shown: bypass permissions, full access, always allow, YOLO.
  - Web tools still follow the internet switch whenever the agent asks for them. Codex's commands in full-access mode can reach the network regardless.

Bypass trusts the agent with your machine. Use it for tasks you'd let that CLI run unattended.

## Saved prompts and their files

**Prompt library** in the sidebar opens the same saved library in Prompt, Debate and Build, including Build's Review task. The library is shared by the Codex and Claude Code hosts. It includes six starter prompts that you can edit or delete.

- **New prompt** creates a saved prompt. Give it a name, select a mode (or **Any mode**), and write its instructions in Markdown. **Import .md / .txt** brings an existing prompt into the editor; **Export Markdown** downloads its text.
- The folder button beside the composer saves the current draft and its attached files. **Use current draft** does the same from inside the library.
- **Files** keeps up to eight reference images or text files with each prompt. Add or drop files, edit their names, preview them, download them, or remove them before saving. The room's usual limits apply: 8 MB per image and 512 KB per text file. Removing a file in the editor takes effect when you save.
- **Save prompt** keeps the prompt and its files. **Load into composer** brings them into the current room and selects the saved mode. You can adjust the draft before sending. Loading alone sends no model request.
- **Run now** saves and sends the prompt to both active agents in the current mode, using the room's current options and project folder. It waits for a ready session; a finished Build still needs a new session. A Review needs a project folder. Saving a prompt never changes provider, model, permissions or internet settings.
- Search by name, prompt text or attached filename, and filter by mode. **Delete prompt** removes its library copy after confirmation; earlier runs retain independent attachment copies. Unsaved edits require a discard confirmation before leaving.

The library shows its storage folder and lets you copy the path. Saved prompts live under `prompts/` in the configured data folder; `AVA_DATA_DIR` overrides the folder set by `config.dataDir`. Each prompt has its own ID-named folder containing `prompt.md`, `prompt.json` (name, mode and file metadata), and `files/` with original filenames. These files persist across plugin upgrades and **Clear history**. **Reload saved version** picks up an externally edited `prompt.md`; conflicting edits from another window are refused until you reload. Import standalone Markdown through the library instead of creating an incomplete prompt folder manually.

Saved prompts do not yet have benchmark pass/fail scoring; that is separate roadmap work.

## The room

A white, three-part window:
- **Left:** the mode switch and a three-slot tools row (Prompt library, Resources, and one reserved space). A faint divider separates these controls from Search and the thread list below.
- **Upper panes:** each agent's own screen (thinking, tool use and output as its CLI exposes them). Drag the divider between the two agents to change their widths.
- **Lower pane:** the shared channel, with the text box along the bottom edge. Drag the horizontal line above it up or down to give more space to the CLI screens or the lower pane. This also works in Stats and Results. Double-click a divider (or focus it and press Enter) to reset that split; arrow keys adjust it, with Shift for larger steps. Both proportions are remembered in this browser.

There is no third model acting as a relay. One message of yours goes to both agents at once; after that they take turns.

### Modes

Switched under Search; each lists its own threads.

- **Prompt:** one prompt goes to both agents at the same moment, exactly as you wrote it. Each answers once in plain text, shown with how long it took, and the run ends. **Stats** has the timing and speed. Tools follow each agent's permissions.
- **Debate:** the agents talk to each other. Prime each one privately with its 1:1 line (say "you are a CEO" and "you are a college student"), then give the shared topic. **Options → First to speak** picks who opens: Agent 1 (the default), Agent 2, or both independently at once. The choice is remembered in this browser and in saved presets. After the opening, agents alternate. A new shared message waits for the next turn; the next speaker answers first, then the other receives both the message and that answer. The room shows who is speaking, who is next, and how many prompts are queued.
- **Build:** both agents build the same thing at the same moment, each in its own folder, and post a link to their app in the shared channel.
  - **One prompt per session,** with no messages while it runs. **New build session** (or Clear Session) starts the next one.
  - **Setting up first:** in a Build session, an agent's 1:1 line may use the same scoped file tools. Under Ask, provide an existing project to copy; cloning, installing dependencies and running tests require execution isolation or an explicit Bypass choice.
  - **Where they work:** from scratch, each agent starts with an empty folder. Type a project folder in the row above the text box to have each start from its own copy of it instead. In a git repository, the copy holds tracked files plus uncommitted work, without ignored output such as `node_modules`. Your original is never touched.
  - **The app link:** each agent ends its report with `APP:` and the page to open, or the address of a server it left running. The room shows that as **Open app**:
    - **A page:** AvA serves the agent's folder on a loopback port of its own, so the app can't reach the room or its token, and the link works only from the room.
    - **A server** (an app with an API, say): it keeps running until Clear Session or Clear history. Anything else an agent leaves running, such as a file watcher, is stopped when its build ends, and its screen says so.
  - **Results** (the window button, or **Side by side** under a report) shows both apps running, each under its own agent's screen, with the prompt row below. Drag the horizontal divider to change the height of the previews. **Apps / Changes** in the prompt row switches to what each agent changed, file by file. The chat button brings the conversation back.
  - **If an agent stops early,** the other still finishes, and the stopped agent's screen says why. (Grok Build, for example, ends its turn when a permission is refused.) If an agent's report is complete but a command it ran is stuck waiting for input, AvA takes the report as final after a minute of quiet.
  - **Review:** switch the row above the text box to **Review** and give a project folder. Each agent reports its findings from its own copy. A small project (up to 40 files and 64 KB of text) also comes with the prompt, numbered by line. That way an agent that reads files only through commands, such as Codex under Ask, can still review it.
  - **Folder access:** under Ask, scoped file operations are approved inside the working folder. Commands, unknown tools, paths outside it, links, and requests to leave the sandbox are refused.
    - Codex switches to its own `workspace-write` sandbox for the build, and back after.
    - A command that mentions the working folder is still refused: its effects are not confined by that path. Builds that need execution must wait for execution isolation or use an explicitly chosen Bypass mode.
  - **Limits:** 30 minutes by default, set in Options.

### Threads

A thread is one continuous session with both agents. In Prompt and Debate, send as many prompts as you like; the agents remember the whole thread. A Build session takes one.

- **New thread** (the compose button at the top of the sidebar) opens a clean page in the current mode, with its own two agents to activate. Each thread with live agents runs two CLI processes on this computer. From the third, AvA asks before opening another and again before activating its agents; you can go ahead anyway.
- **Clear Session** (**⋯ → Clear Session**) stops anything running and gives this page's two agents fresh sessions. That starts a new thread at the top of the list; the old one stays readable. Each new session makes one short access check per agent.
- The list is the shared pool: threads from every chat, in Codex or Claude Code. Search covers every saved message.
- **Renaming:** double-click a thread's title (in the header or the list), or use **⋯ → Rename**. An empty name goes back to the first prompt.

### 1:1 lines

Two chips above the text box (**Codex 1:1**, **Claude Code 1:1**) each open a private chat window with one agent. Use them to prime each agent with different context or instructions.
- A 1:1 message goes into that agent's own session, in the same thread, so the agent carries it into the shared conversation. Nothing from it appears in the shared channel or reaches the other agent.
- An agent can't answer two things at once. A 1:1 message therefore needs the shared conversation stopped or paused, and the conversation waits while a 1:1 reply is being written.

### Resources

Open **Resources** in the sidebar to see active or starting agents across every room in the shared conversation pool, their recorded process counts, and memory usage. Memory is sampled every five seconds while the panel is open; missing readings show **Unavailable**.

**Maximum active agents** defaults to **4**. Set 2–32, or 0 for unlimited. The limit includes starting agents and is enforced before activation in both the room and host menus. Lowering it does not stop existing work; it blocks additional activations until capacity is available. This is an agent-count limit, not a limit on RAM or child processes.

**Stop all AvA agents** asks for confirmation, cancels shared and private replies, closes previews and owned sessions, and checks recorded processes. Conversations, files and the Prompt library stay saved. A cleanup problem is reported as needing attention; uncertain work is never resent. Activate agents again when you want to continue.

### Internet switch

Next to each 1:1 chip, the globe button turns that agent's internet access on or off (off by default). AvA enforces it, not just the agent:
- **Claude Code and Antigravity:** instantly. Their web tools ask permission each time, and AvA allows them only while the switch is on.
- **Codex and Grok Build:** their web search runs without asking, so AvA sets it when the agent starts. Switching restarts that agent in the same session (it keeps its memory). This takes a few seconds and needs the shared chat paused or stopped.
- **Every prompt** also tells each agent its current setting. Each agent's screen shows the switch at work.

### Attachments

The paperclip (or paste, or drag and drop) attaches images (PNG, JPEG, GIF, WebP, up to 8 MB) and text or code files (up to 512 KB, inlined into the prompt). Other file types are refused rather than silently dropped. Grok Build declares no image input, so with Grok in either seat AvA refuses an image up front.

### Controls, options and stats

- **Controls** (while a conversation runs):
  - **Pause** drains current replies and freezes the clock at a reply boundary.
  - **Next reply** advances one agent while paused. A message sent while paused gets one reply from each agent, then pauses again.
  - **Stop** cancels active work.
- **Options** (the sliders beside the text box) apply to the next prompt: a private instruction and a stop condition per agent, how the conversation ends, minutes, request limit, pace, and saved presets. Timed prompts ("…for 15 minutes") use duration mode.
- **Context and usage** (the small ring beside each agent's status, like Claude's usage ring) fills as that agent's context window does. It turns amber at 80% and red at 95%. Click it for the numbers:
  - **Context window:** tokens in use of the model's window, e.g. 161.5k / 200k.
  - **This session:** input, output and cached tokens, and the agent's cost estimate at API prices (a subscription isn't billed per request), when the agent reports them.
  - **Plan usage:** the CLIs don't pass their 5-hour and weekly limits to AvA, so this says where to see them (`/status` in Codex, `/usage` in Claude Code). A Vercel Gateway agent shows the key's credit instead.
  - Codex and Claude Code report after each reply; Grok Build and Antigravity don't report their context.
- **Stats** (the chart button) covers the whole thread: conversation time, time to first token, reply time, tokens per second, a per-agent table, and a timeline. Codex, Claude Code and Gateway counts use saved provider reports for each request; only Grok Build and Antigravity use estimates (characters ÷ 4), marked ≈. Missing reports and older history stay unavailable. The context ring shows session totals, which also include activation and private messages.
- **⋯** also has Replay and Export (JSON or Markdown, including the 1:1 lines).
- **⋯ → Clear history** permanently deletes every saved thread in the shared data folder after a confirmation. That covers prompts, replies, 1:1 messages, attachments, and the agents' working folders with everything they built. It also stops app servers they left running and gives this page's agents fresh sessions.

The two agents are isolated from each other. Each sees only the shared topic, your shared messages, and the other's final replies: never the other's 1:1 messages, private instructions, thinking, or tool activity. Closing the room leaves a running conversation running; reopening it sends no model prompts.

## Running benchmarks

Open **More > Benchmarks** in a room. Choose tasks and repetitions, then **Validate selected** to check that each reference solution passes and an empty attempt fails. Validation runs the tasks' local verifier scripts, not models, under the verifier guard. Validating a task is your decision to run its scripts on this machine, so use only task bundles you wrote or trust.

**Run selected** uses the two configured models in fresh, separate sessions for each task/repetition. It shows the request ceiling first: two access checks and two task answers per task/repetition. The room's existing conversations keep their sessions. Two agent slots must be available within the Resources limit. Cancel a job from its progress panel, or use Resources > Stop all. Restarted or uncertain jobs are recorded as interrupted and never automatically retried.

The CLI uses the same runner: `npm run bench -- run benchmarks/starter --agents codex:MODEL,claude:MODEL --repeat 3 --data <isolated-data-folder>`. Commands `validate <suite>`, `jobs`, `status <job-id>` and `cancel <job-id>` share that data folder. Save the printed request ID; `--request-id` can recover the original start after a lost acknowledgement. Browsing, validation, status and cancellation do not generate replies. `scripts/bench-acceptance.ts` without `--live` exercises the three original starter tasks with mocks in temporary storage; `--tasks` picks others.

A Build task's hidden tests run the code the agent wrote, so they run under the [verifier guard](benchmarks.md#the-verifier-guard).
- **Allowed:** reading that attempt's files, and writing a throwaway temp folder.
- **Refused:** anything else, including starting processes, using the network or writing into the attempt. The refusal is recorded as the check's reason.

The guard needs a Node that can block network access. Node 26 can; without it, live tasks with program verifiers are refused before any agent starts. Ask-mode file tools still refuse shell commands, so agents build with file tools only.

When a job finishes, **Report (HTML)** and **Report (Markdown)** in its progress area save a report you can share: each agent's scores and pass@k, each task's result, and every check's evidence, with no room link or token. See [Reports](benchmarks.md#reports).

### Saved results and scoreboard

In **More > Benchmarks > Results**, filter by real or simulated runs, suite, task, model, UTC date range, or the current job. Each model/effort/speed configuration has its own scoreboard row; real and simulated results stay separate. Pass rate counts only graded passes and failures. Errors, cancellations and interruptions remain visible as ungraded attempts, and missing token reports remain unavailable.

**pass@k** estimates the chance of at least one pass from k samples. It averages the standard sampling estimate over eligible task batches within settled jobs. Different task versions, content fingerprints, jobs and agent configurations are not pooled into one sample batch. A batch with ungraded attempts or too few samples is omitted. **Inconsistent batches** counts fully graded batches containing both passes and failures. **Results over time** groups the selected results by UTC day.

Choose **Inspect** on an attempt for its saved answer, task/version fingerprint, model/effort, AvA version, and every check's outcome, elapsed time, output excerpt and exit code when available. These records and their artifact copies survive Clear history and reruns; earlier attempts are never overwritten.

**Export JSON** and **Export CSV** export all attempts matching the filters, not just the visible page, up to 5,000 attempts or 16 MiB per export. JSON includes the saved prompt and check definitions; CSV includes per-check evidence and the answer. Secret-shaped strings are redacted and CSV formula prefixes are escaped. Narrow the filters for larger histories.

The CLI offers `npm run bench -- results --data <folder>` and `npm run bench -- export json --out <new-file> --data <folder>` (or `csv`). Both accept `--suite`, `--task`, `--provider`, `--model`, `--job`, ISO timestamps with `--from`/`--to`, and `--source only|exclude|all` for simulated/real/all runs. Exports refuse to overwrite an existing file. These commands perform no model work.

## Hosts

### Codex

Typed `/ava …` commands are routed by the plugin's prompt hook to its `ava_command` tool.
- A fresh installation needs its hook reviewed in Codex's Plugins settings or `/hooks`; installation alone doesn't approve a hook.
- Ordinary messages stay with Codex.

### Claude Code

The same `/ava …` commands as in Codex, provided by the plugin's `ava` skill. Its full name, `/agent-vs-agent:ava …`, also works (useful if another plugin ever claims `/ava`).
- Each Claude Code conversation keeps its own pair of agents, like a Codex chat, and resuming the conversation brings them back.
- A skill replaces the prompt hook, so there is no hook to review.
- The skill pre-approves only `ava_command`, only while it runs, and Claude can't run it by itself.
- Each Claude Code session gets its own room.

Both plugins drive the same background service and share one conversation pool.

## Providers and data

- **Locked versions:** ACPX 0.19.4, the Codex ACP adapter 2.1.1, and the Claude ACP adapter 0.85.1. Every agent runs your installed CLI: Codex 0.159.1 or newer (also used for the Vercel AI Gateway) and Claude Code 2.1.286 or newer. AvA says which to update if one is older.
- **Accounts:** the four coding CLIs use their own sign-in (provider-login); AvA never asks for their API keys. The Vercel AI Gateway is API-key only: AvA keeps its key in the data folder's `secrets/` and passes it only to Gateway agents. Model and option lists come from the running provider.
- **API keys:** conflicting API credential environment variables block the provider-login route rather than silently switching accounts.
- **Data folder:** all state lives in one folder that both hosts share: `%USERPROFILE%\AgentVsAgent` by default. Set `AVA_DATA_DIR`, or `"config": {"dataDir": …}` in `package.json` before `npm run package`, to use another one. (Not AppData: the Claude desktop app redirects AppData into private storage, which would split the history.)
  - It is outside AppData on purpose: the Claude desktop app is a packaged Windows app, and Windows would redirect its AppData writes.
  - SQLite holds runs, messages, activity and settings. Each agent session has its own working folder under `workspaces/`.
  - Existing history can be copied in with `node --import tsx scripts/import-data.ts --from <old folder>`.
- **Codex participants:** these run with plugins, apps and hooks disabled, so a child agent can't start AvA recursively. That doesn't change your Codex configuration.

## Safety

- **Loopback only:** the service binds only to 127.0.0.1, checks Host and Origin, and requires a random bearer token.
  - The room receives the token in the URL fragment and removes it from the address bar. Don't share the room link or `server.json` in the data folder.
  - Current source protects `server.json` and Gateway secrets with an owner-only Windows ACL. This does not protect against programs already running as your account.
- **Interrupted work:** on a service interruption or an uncertain cancellation, AvA quarantines the run and never resends work whose outcome is unknown.
  - **Release** (or `/ava reconcile`) frees the pair once no provider process from it is running.
- **Separate origins:** app previews run on separate loopback origins behind a cookie that only the room's link sets.
