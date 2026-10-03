# Validated benchmarks

The starter suite has one Prompt task (invoice arithmetic), one Build task (a tip calculator) and one Review task (two planted shop bugs). Each task lives in its own folder under `benchmarks/starter/`.

## Task format and validation

`task.yaml` declares an ID, integer version, mode (`prompt`, `build` or `review`), prompt, time limit in minutes, and deterministic checks. `fixture/` holds the starting project; `solution/` holds the reference solution, with `answer.txt` for Prompt and Review. `tests/` contains hidden verifier scripts.

Run `npm run bench -- validate benchmarks/starter --data <validation-data-folder>`. The optional data folder defaults to AvA's configured pool; use a temporary folder for development. Validation runs the reference solution and a do-nothing attempt in separate temporary folders. Every oracle check must pass, and at least one check must reject the empty attempt. A content fingerprint covers the complete task bundle, so editing a prompt, fixture, verifier or solution invalidates its saved validation.

Checks are `equals`, `contains`, `regex` (optional `flags`), `number: { value: 42, tolerance: 0.01 }`, `json_path: { path: "$.items[0].total", equals: 42 }`, `file_exists`, and `run: node tests/verify.mjs` (or `.js`). JSON paths support object properties and numeric array indexes; comparisons preserve JSON types. Each check records its pass/fail, duration, explanatory detail and, for commands, exit status.

File paths must remain relative, task files cannot be links, and a bundle is limited to 1,000 files and 16 MiB. Regex checks run in bounded workers so a pathological pattern cannot block the service. Node verifier commands have a timeout, a 256 MiB JavaScript heap limit and bounded output, and receive a minimal environment without provider keys. They run local code: use task bundles and verifier scripts you trust. These bounds do not confine filesystem or network access, native allocations, or a process that deliberately escapes its tree. Validation receipts also record the checker version.

The Review starter checks that both planted source locations are reported. It does not grade the quality of the explanation. Build checks exercise the exported function and invalid inputs, plus the presence of the requested page inputs.
