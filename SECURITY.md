# Security policy

Report a vulnerability privately to Adam Zhang at [adam.dadvibes@gmail.com](mailto:adam.dadvibes@gmail.com). Include the AvA version, host, affected mode and minimal reproduction. Do not publish a room link, bearer token, account credential or private conversation. Ordinary bugs can use the issue template. This document describes current source; the [changelog](CHANGELOG.md) identifies released behavior.

## Local service and secrets

AvA listens on `127.0.0.1`, checks Host and Origin, and authenticates RPCs with a random bearer token. The room receives the token in its URL fragment and removes it from the address bar. The token is also in `server.json` so local wrappers can connect. Anyone who obtains it can control that service; the room link is a credential, not a share link.

On Windows, current source writes `server.json`, the Gateway key and its `secrets/` directory with an explicit ACL granting only the current account access, with inheritance disabled. Existing Gateway-key permissions are repaired at service startup. New secret bytes are written only after protection succeeds. Other platforms use 0600 files and 0700 directories. These permissions do not protect against malicious code already running as the same user or an administrator.

The database, transcripts, attachments and generated projects live in the configured data folder. They are not encrypted by AvA. Keep that folder private and back it up before changing installations. The Gateway key is passed only to Gateway agent processes. Subscription CLIs use their own sign-ins; setting API credential environment variables can conflict with that route.

## What the agent permissions mean

**Ask** is AvA's tool gate. Prompt and Debate refuse tools except supported web tools when Internet is enabled. Build approves only recognized file operations with complete, explicit paths inside the workspace. Linked paths, CLI settings folders, outside paths and sandbox escalation are refused. Shells, scripts, interpreters, package managers, process control and unknown tool shapes are refused even when they also name a valid workspace path. A working directory is not an operating-system sandbox, so command text is never evidence of confinement.

This closes the automatic approval defect that allowed `Get-Process node | Stop-Process -Force` during a live Build. Regression tests pass that command and variants as inert strings to the gate; they never execute them. Command-dependent builds need real execution isolation before Ask can safely approve them. The gate controls only permission requests that providers send to AvA; provider-side permissions remain a separate boundary.

**Bypass** approves every tool request in every mode and gives Codex full access. It trusts the provider, prompt, project and any instructions the agent encounters with the user's account permissions. Claude Code's own allow rules or default permission mode can approve tools before AvA's gate is asked; AvA displays a notice about this limitation. Do not use untrusted projects or benchmark verifiers as if the Build copy were a sandbox.

Codex participants start with plugins, apps and hooks disabled and inherited MCP servers disabled. Claude participants use strict MCP configuration to exclude inherited servers. This reduces accidental integrations; it is not a security boundary against arbitrary code running under the same account. Host hook trust is controlled by the user and is never approved by AvA. Chat-scoped MCP tools require a chat identity, so missing identity cannot silently select a shared pair.

## Isolation and recovery

Each agent receives shared room messages and its own private instructions and 1:1 messages. The other agent's private text and activity are not forwarded. The operator can see both agents. Build copies are separate; previews use separate loopback origins and an access cookie.

After an uncertain outcome, work is not automatically retried. A quarantined pair stays leased until the operator requests release and a process census finds no recorded survivor. Census tracks process trees and start times.
- **While the service runs on Windows:** each agent's job object and its lineage also find processes that left the tree.
- **After a crash:** the census is the check, and a process that escaped its tree can evade it. See the [known limits](docs/architecture.md#known-limits) before using Bypass or running unfamiliar code.

Use a current release and review the release notes before upgrading. No independent security audit or guarantee of containment is claimed.
