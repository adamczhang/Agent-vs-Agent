# v0.2.0 validation record

The first stable release uses the implementation accepted on 2026-10-03. Live testing ran against the installed **0.1.4 development build** in both hosts; v0.2.0 adds release metadata, documentation and the recorded screenshot. Release checks cover the final source and packages separately. The live results below are not claimed as a second run on v0.2.0.

The owner authorized operating all five providers, required usage, a test window under 35 minutes, and fixes for observed behavior. Each experiment used a temporary data folder.

## Plan and limits

- Use the actual installed core and MCP wrapper in both hosts, with separate temporary data folders. Preserve the real shared conversation pool and its secrets.
- Four CLIs use their subscription logins: Codex, Claude Code, Grok Build and Antigravity. Vercel AI Gateway uses its existing API key, with the previously working inexpensive `openai/gpt-5.6-luna` model.
- At most 100 AvA participant requests, including activation. This counts submitted agent turns, not each provider's internal API/tool iteration. A shared locked counter covers concurrent batches.
- Stop a batch at its first failed check, inspect its evidence, and use a separately recorded retest only after investigation. Never resend uncertain work.
- Hard live stop: 2026-10-03 15:38:45 UTC. Every live request also receives the common abort signal. Use Ask mode, scoped file tools, and static Build artifacts; retain the live program-verifier sandbox guard.
- Mock the installed-wrapper harness before live use. Finish with offline regressions, process cleanup and installed-file verification.

## Prompt set

The prompts are original acceptance tasks, informed by the broad reasoning families in [BIG-Bench Extra Hard](https://github.com/google-deepmind/bbeh). They are not official benchmark scores. The supplied Mars reference uses [NASA's Perseverance landing report](https://www.nasa.gov/news-release/touchdown-nasas-mars-perseverance-rover-safely-lands-on-red-planet/).

| Scenario | Prompt and check |
| --- | --- |
| Museum artifacts | Four curators exchange colored artifacts through four swaps. Check the exact final JSON mapping: Ada blue, Ben red, Cy jade, Dee gold. |
| Mars cargo | Read an attached manifest, apply a correction, exclude held/removed cargo, and ignore an instruction planted in an untrusted note. Check 75 kg, 8 crates, and landing date 2021-02-18. Save/load it through the prompt library first. |
| Private line | One seat returns a synthetic marker privately. Check its reply and the separation of subsequent public inputs. |
| Greenhouse debate | Discuss monolith versus microservices for a two-person Mars greenhouse team. Agent 2 opens; pause, introduce an offline-operation constraint, resume, and check alternating turns and the request/time limit. |
| Mission status Build | Both agents create a static `index.html` and cyan-circle `badge.svg` using file tools. Check the files, visible mission text and available preview links. Inspect recorded tool activity for shell execution. |
| Installed benchmark runner | Run the validated invoice task on Codex and Claude, then read the scoreboard and export its two graded attempts. Both passed. |
| Permission regression | Pass the incident command as inert data to each installed gate and verify refusal. Never execute the destructive command. |

## Timing and results

- First mock: **15:21:16.288 UTC**.
- Live batches: **15:23:15.538–15:37:06.173 UTC**, or **13 minutes 51 seconds** rounded.
- Final offline tests were confirmed by **15:56:04 UTC**: **34 minutes 48 seconds** from the first mock. Research, installation preparation, and report writing are separate from that acceptance window.
- **99/100** participant requests. **13** live batches: **9 passed, 4 initially failed**. All initial failures are retained; none were rewritten into passes.
- **215 offline tests** and **7 browser scenarios** passed. Final prompt-library checks also passed. Browser scenarios used simulated agents; live provider work used installed modules and installed MCP wrappers.
- No surviving recorded test-agent process was found. Both installed source/UI trees matched the final build across **88 file comparisons**. The 0.1.4 Codex hook remained enabled and trusted; its content and trust settings were not changed.

| Provider | Observations |
| --- | --- |
| Codex | `gpt-6-luna` returned one wrong artifact mapping and one wrong cargo total. These are preserved model-quality failures. A clearly recorded `gpt-6-astra` run passed the full functional flow. The Luna invoice benchmark also passed. |
| Claude Code | Haiku initially wrapped correct JSON in Markdown. Explicit no-fence instructions passed the later cargo task; private messaging, Debate controls and file-only Builds passed. |
| Grok Build | The museum/cargo tasks and private reply passed. Its original Debate reached the 90-second deadline after three committed replies. After the length-guidance fix, the retest completed four replies in 38.5 seconds and both Builds passed. Nonfatal skills/workflows reload notices were also observed. |
| Antigravity | Both prompt tasks and the full functional flow passed. The file audit found completed edits plus contradictory approval-placeholder notifications; the display now identifies those exact notifications as provider warnings, retaining the original text. |
| Vercel AI Gateway | Both prompt tasks and the full functional flow passed through `openai/gpt-5.6-luna`, using the stored key through the installed core. |

## Fixes and boundaries

1. Debate's default word-count guidance now yields to explicit topic/operator length and format requirements. A focused regression pins the generated instructions. The Grok retest completed within its case limit; its context and timing also differed, so the timing change is not presented as an isolated performance measurement.
2. Test prompts and the newly seeded JSON starter explicitly prohibit Markdown fences. Existing saved prompts are preserved. Exact graders remain strict; genuine reasoning errors still fail.
3. Antigravity's exact unmatched-approval report is attributed as a provider warning with the original message preserved. Other tool failures remain unchanged. This attribution and the starter wording refinement were checked offline after live testing ended.
4. The harness now distinguishes wording for deterministic-answer checks from delivery and turn-limit checks. The controls-only Grok retest sent no new private message, so its historical redundant privacy assertion is not additional privacy coverage.

The test suite did not execute generated Node programs, disable the sandbox guard, change Bypass, approve hooks, or write test conversations into the real shared pool. Existing host sessions may need a reload to load the new installed code.

Raw acceptance reports and the machine-specific harness are retained in the maintainer's private development record. Failed batches and retests remain separate; they are not included in the public source because they contain local installation details. This document is the public summary of that evidence.
