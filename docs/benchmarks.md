# Validated benchmarks

The starter suite has 20 validated tasks, each in its own folder under `benchmarks/starter/`:

| Mode | Tasks | Graded by |
| --- | --- | --- |
| Prompt (8) | invoice total, flour grams, overlapping meetings, order details as JSON, date arithmetic, error lines in a log, sorting names, a race's finishing order | the exact answer, a number, or values at JSON paths |
| Build (7) | tip calculator, slugify, Roman numerals, a CSV parser, word frequency, a temperature-converter page, a todo list | hidden tests run on the agent's code, and required files |
| Review (5) | shop discount, pagination, access checks, uploads (a path-traversal bug), statistics | naming each planted bug's file and line |

Each Build task's tests exercise normal cases, edge cases and invalid input. A Review task's answer key checks that each planted location is reported; it does not grade the explanation (a rubric score can, below). A Review task's project is small, so its files come with the prompt, numbered by line.

## Task format and validation

`task.yaml` declares an ID, integer version, mode (`prompt`, `build` or `review`), prompt, time limit in minutes, and deterministic checks. `fixture/` holds the starting project; `solution/` holds the reference solution, with `answer.txt` for Prompt and Review. `tests/` contains hidden verifier scripts.

Run `npm run bench -- validate benchmarks/starter --data <validation-data-folder>`. The optional data folder defaults to AvA's configured pool; use a temporary folder for development. Validation runs the reference solution and a do-nothing attempt in separate temporary folders. Every oracle check must pass, and at least one check must reject the empty attempt. A content fingerprint covers the complete task bundle, so editing a prompt, fixture, verifier or solution invalidates its saved validation.

Checks are `equals`, `contains`, `regex` (optional `flags`), `number: { value: 42, tolerance: 0.01 }`, `json_path: { path: "$.items[0].total", equals: 42 }`, `file_exists`, and `run: node tests/verify.mjs` (or `.js`). JSON paths support object properties and numeric array indexes; comparisons preserve JSON types. Each check records its pass/fail, duration, explanatory detail and, for commands, exit status.

File paths must remain relative, task files cannot be links, and a bundle is limited to 1,000 files and 16 MiB. Regex checks run in bounded workers so a pathological pattern cannot block the service. Node verifier commands have a timeout, a 256 MiB JavaScript heap limit and bounded output, and receive a minimal environment without provider keys. Validation receipts also record the checker version.

## The verifier guard

Verifiers, and the candidate code they import, run under Node's permission model:
- **Allowed:** reading the attempt folder, which holds the candidate's files and the hidden `tests/`; writing a throwaway folder, which is also the verifier's temp folder.
- **Refused:** reading or writing anywhere else (including writing into the attempt), child processes, worker threads, native add-ons, WASI and all network access (connections, listening and DNS). A refusal fails the check, and its detail starts with "Blocked by the verifier guard". So tasks must test code in-process, without servers or downloads.
- **Limits:** Node describes its permission model as a guard against accidents, not a sandbox against hostile code. Validating a task is your decision to run its verifier on this machine: validate only bundles you wrote or trust. Mark untrusted and imported bundles for container isolation (below).
- **Availability:** the guard needs a Node that can deny network access (`--allow-net`; Node 26 can). Without one, or with `AVA_VERIFIER_GUARD=off`, verifiers run without it during validation and mock runs, and live tasks with `run:` checks are refused before any agent starts. Results record whether each check ran guarded.

## Container isolation

A task with `isolation: container` in its `task.yaml` runs its `run:` checks in Docker, for validation and for every attempt, never on the host. Use it for bundles you didn't write. `AVA_VERIFIER_BACKEND=container` does the same for every task.

The container:
- has no network, and a read-only root filesystem with a 64 MB writable `/tmp`;
- has no capabilities and no privilege escalation;
- is limited to 128 processes, 512 MB of memory and one CPU;
- runs as a non-root user, with only the attempt folder mounted read-only at `/work`, its working directory;
- uses `node:24-alpine`, pinned by digest (`src/containers.ts`).

Each result records the backend (`container`) and the image digest. Validation receipts do too.

**Requirements:**
- Docker's Linux engine (Docker Desktop on Windows) must be running.
- The image must be present. AvA never downloads it; download it once with `docker pull node:24-alpine@<digest>`, where `<digest>` is the one in `src/containers.ts`.
- Without either, such tasks are refused before any agent starts, and the Benchmarks list says what's missing.

## Reports

A finished job can be saved as a report to share: a standalone HTML page (inline styles, no scripts, light and dark) or Markdown. Use **Report (HTML)** or **Report (Markdown)** in the Benchmarks panel, or the CLI:

`npm run bench -- report <job-id> --format html|md --out <new-file>`

A report holds:
- **Each agent:** passes out of graded attempts, the pass rate, pass@k for each number of repeats, the average time, and tokens when reported.
- **Each task:** the result for each agent and repeat.
- **Every attempt's evidence:** each check's result, backend, exit code and detail, and the answer for Prompt and Review tasks.

It carries no room link or token. Tokens and Gateway keys are redacted (image digests stay), and the data folder and home folder in check details become `<data>` and `~`.

## Importing tasks

`npm run bench -- import <source> --format exercism|jsonl --out <new-suite-folder>` writes AvA tasks into a new suite folder. Then validate it (`npm run bench -- validate <suite>`) and pick it in the Benchmarks panel or with `--suite`.

- **Exercism (JavaScript track):** one exercise folder, or a folder of them (such as a track's `exercises/practice`). From `.meta/config.json`:
  - the instructions in `.docs/` become the prompt;
  - the stub becomes the starting file;
  - the example (`.meta/proof.ci.js`) becomes the reference solution;
  - the Jest-style tests run through a small built-in shim (`describe`, `test`, `xtest`, `expect` and the common matchers), with every `xtest` run too.
- **JSON Lines, prompt plus tests:** one task per line, `{"id", "title", "prompt", "file", "solution", "tests"}`. `tests` is an ES module that imports `'../<file>'` and throws on failure.

Imported tasks are Build tasks marked `isolation: container`, so their tests run only in Docker (see Container isolation). Container tasks in Terminal-Bench's format, and repository-repair sets in SWE-bench's, are planned.

## Rubric scores

A task can carry a `rubric`: what a reviewer should value beyond the checks, such as how well a finding is explained. Name a judge when starting a job (`--judge provider:model` in the CLI, or `judge` in `bench.start`). That third agent scores each attempt at a rubric task from 0 to 10, with a short reason.
- **What the judge sees:** the task, the rubric and the attempt's answer, plus its source files for Build tasks (never the hidden tests). Each judgment has a fresh session, so no earlier attempt, or the other agent's answer, is in the judge's context.
- **What's saved:** the score, the reason and the judge's identity, apart from the checks. A score never changes pass or fail.
- **When the judge fails:** the attempt keeps a null score, with the reason.
- **Cost:** two requests for each judged attempt: the fresh session's access check, and the judgment. The request ceiling counts them.

Seven starter tasks have rubrics: the five Review tasks and the two pages.
