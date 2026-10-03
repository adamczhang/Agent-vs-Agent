# Windows job-object evaluation

Evaluated on 2026-10-03 for the Resources work (U3). The production controls enforce a limit on active/starting agent seats and use the existing PID/start-time ledger for cleanup. They do not enforce a memory ceiling or confine file/network access.

## Probe and result

`scripts/evaluate-job-objects.ps1` creates an idle Node process, assigns it to a new Windows job, then lets it create one idle child. It never launches a provider or uses a real conversation pool. Both processes start without a visible window.

The probe passed on this machine: assignment succeeded inside an inherited outer job, the descendant joined the new job, and closing the last job handle stopped both processes. A 256 MiB committed-memory limit was accepted; exhausting that limit was not tested. The checked result is recorded in the private U3 evidence.

Windows documents [process-group management, nested jobs and cleanup on handle close](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). The configured limit follows [the extended limit structure](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information) and its [limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).

## Production decision

Keep job-object enforcement out of provider launches for now. ACPX 0.19.4 calls its before-spawn hook, starts the process through Node, and only then exposes the running child. Attaching a job at that point leaves a window in which descendants can start outside it. The probe prevents that window by holding its own child on standard input; an arbitrary CLI does not obey that handshake.

A production launcher should create the agent suspended, attach it to its job, then resume it. It must preserve ACP stdio, exit/cancellation behavior and nested-job compatibility, and deliberately retain app servers that the user is previewing. Each provider needs an isolated compatibility check before this becomes the default. This is a launcher change, not a switch to flip in the existing hook.

The completed U3 controls remain useful independently: activation capacity is checked before model work; failed cleanup retains ownership; memory reads distinguish unavailable data from zero; Stop all preserves saved conversations and reports any process it cannot prove has stopped.
