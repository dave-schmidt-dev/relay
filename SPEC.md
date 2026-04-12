# Relay

## Product Summary

Relay is a usage-aware AI workbench that distributes planning, implementation, review, and research tasks across multiple AI CLI subscriptions from a single browser-based workspace. It is optimized for a solo operator who wants to use all paid subscriptions to their full capacity each week rather than burning through one provider and leaving others idle.

Relay v1 is a single-process server with a browser frontend:

- A Node.js backend manages provider subprocesses, usage tracking, task routing, and persistence.
- A localhost web app provides a split-pane workspace for composing prompts, dispatching tasks, reviewing streaming output, and monitoring usage across providers.
- Run and handoff data is project-local under `.relay/`. Usage data is global under `~/.relay/usage/` because usage is per-subscription, not per-project.

## MVP Goals

1. Track estimated usage across Claude, Codex, and Gemini subscriptions and display a live usage dashboard.
2. Suggest the best provider for each task based on task type, provider strengths, and remaining usage capacity.
3. Launch provider CLIs from the browser, stream output live, and capture run artifacts.
4. Enable operator-controlled context assembly when dispatching subtasks from one provider's output to another.
5. Persist runs, handoffs, and operator actions in a local audit trail.
6. Export workflow summaries as Markdown.

## Non-Goals For v1

1. No API-based provider calls. All execution uses CLI subscriptions (`claude -p`, `codex exec`, `gemini -p`).
2. No Cursor, Copilot, or Mistral Vibe adapters. Three providers only.
3. No multi-user collaboration, cloud sync, or hosted deployment.
4. No mid-run interaction with provider subprocesses. Runs are fire-and-forget with cancel.
5. No autonomous git operations.
6. No mobile or native desktop shell.
7. No SQLite. File-based storage only.
8. No PTY for task execution. Task runs use pipe-based headless mode only. PTY is used exclusively for usage probing.
9. No free-text search across run content in v1. Filter by provider/status/role only. Full-text search deferred to v1.1.
10. No post-run usage estimation or deduction. Usage data comes exclusively from probes at 120-second intervals. Provider usage windows are dynamic and provider-controlled; guessing consumption between probes is unreliable.

## Target User

David Schmidt, solo operator with Claude Premium Team, Codex Team, and Gemini Student Pro subscriptions. Terminal-heavy workflow. Prefers local artifacts, explicit audit trails, and shared project memory via AGENTS.md. Primary pain point: exhausting Claude while leaving Codex and Gemini underutilized.

## Core User Outcomes

1. See at a glance how much of each subscription is remaining for the current window.
2. Start a planning task and have Relay suggest the best provider based on usage and task type.
3. From a completed plan, select context and dispatch subtasks to other providers without manually assembling prompts.
4. Watch multiple provider runs side by side in a split-pane workspace.
5. Review a unified timeline of what happened across providers for a project.
6. End each week with all three subscriptions near zero remaining rather than one exhausted and two idle.

## End-to-End User Flow

1. Operator runs `relay serve --project /path/to/project`. Backend starts, browser opens.
2. Relay loads project state from `.relay/`, checks AGENTS.md health, and displays the usage dashboard.
3. Operator composes a new task in the prompt editor. Relay classifies the task type and suggests a provider based on type affinity and remaining usage. Operator accepts or overrides.
4. Relay spawns the provider CLI as a headless subprocess, streams output to the left pane via WebSocket.
5. When the run completes, operator selects excerpts from the output, attaches project files, and writes a task description for the next provider.
6. Relay pre-populates context (AGENTS.md, selected excerpts, referenced files). Operator reviews and trims.
7. Relay suggests a target provider (weighted by remaining usage). Operator confirms and dispatches.
8. The subtask runs in the right pane. Relay tracks it as a child run linked to the source.
9. Operator reviews results, dispatches more subtasks, or exports the workflow as Markdown.

## Architecture Overview

### Runtime

- Backend: TypeScript on Node.js 22 LTS
- Frontend: React 19 + Vite (SPA, no SSR)
- UI components: shadcn/ui (dark mode default)
- Task execution: Node.js `child_process.spawn` with pipe stdio
- Usage probing: Node.js PTY sessions via `node-pty` (event-driven rewrite of ai_monitor's POSIX fd/select patterns — NOT a line-for-line port). Requires Xcode CLI tools for native compilation on macOS.
- Live streaming: WebSocket from backend to frontend
- Local storage: file-based under `.relay/`

### Major Components

1. Server (`relay serve`)
   - HTTP server for the SPA and REST API
   - WebSocket server for live run streaming
   - Subprocess manager for provider task runs (pipe-based)
   - Usage prober with persistent PTY sessions for `/status`, `/usage`, `/stats` commands
   - Usage tracker and router
   - Task classifier
2. Web UI (SPA)
   - Usage dashboard
   - Split-pane workspace (source run + dispatched run)
   - Prompt composer with file picker and context assembly
   - Run detail and timeline views
   - Markdown export
3. Provider adapters
   - One adapter per provider (Claude, Codex, Gemini)
   - Each defines: CLI command template, output parsing, capability flags, exit code interpretation, cancellation strategy
   - Each defines: usage probe command, probe output parser, rate-limit detection patterns
4. Usage prober (event-driven rewrite of ai_monitor patterns)
   - Persistent PTY sessions per provider (reused across probe cycles, not spawned fresh each time)
   - Sends provider-specific probe commands: Claude `/usage`, Codex `/status`, Gemini `/stats`
   - ANSI stripping and text normalization pipeline
   - Provider-specific parsers extract usage quotas (per-window and per-model) and reset times
   - Auto-response injection for trust prompts and interactive gates
   - Transient error recovery: retries on empty output, caches last good snapshot on probe failure with `stale_since` timestamp
   - Staleness expiration: after 30 minutes of stale data, provider is excluded from routing
   - Gemini PTY `/stats` is the default probe method. Internal Node.js module probe is behind an experimental `probe_method=internal` flag.
   - Configurable probe interval (default 120 seconds)
   - Probe-task mutual exclusion: do not probe a provider while it has an active task run. Defer to next cycle or probe after task completes.
   - Env allowlist applies to PTY probe sessions (same as task runs)
   - Outputs normalized `UsageSnapshot` per provider
   - Global storage: snapshots persist at `~/.relay/usage/`, not per-project
5. Memory validator
   - Checks AGENTS.md exists, computes content hash, reports health status
   - Does NOT generate or edit vendor mirror files (operator manages symlinks)

### Project Directory Structure

```
src/
  server/         # HTTP, WebSocket, subprocess management
  adapters/       # Claude, Codex, Gemini adapters (task execution + usage probe definitions)
  prober/         # Usage probing engine (PTY sessions, ANSI parsing, snapshot caching)
  core/           # Usage routing, task classification, run lifecycle, storage
  web/            # React SPA (Vite)
```

### Storage Layout

Project-local (under project root):

```
<project-root>/
  AGENTS.md
  .relay/
    config.json
    actions.jsonl         # Operator action audit log (append-only)
    runs/
      <run-id>/
        run.json          # Metadata: provider, role, status, timestamps, exit code, provider version
        events.jsonl      # Normalized events (append-only)
        stdout.log        # Raw stdout capture (redacted before write)
        stderr.log        # Raw stderr capture (redacted before write)
        prompt.md         # Immutable input snapshot
        final.md          # Extracted final output
        artifacts/        # Snapshotted attached files
    handoffs/
      <handoff-id>/
        handoff.json      # Packet metadata and ordered context items
        prompt-preview.md # Generated target prompt (from adapter templating)
        artifacts/        # Snapshotted files (copied from source run or project)
    exports/
      <export-id>.md
    debug/                # Raw PTY captures when debug mode is enabled
```

Global (user-level, shared across all projects):

```
~/.relay/
  usage/
    snapshots.json        # Latest UsageSnapshot per provider (probed from CLIs)
    history.jsonl         # Append-only log of all usage snapshots for trend analysis
```

## Data Model

### Run

- `run_id` UUID
- `project_root` absolute path
- `provider` enum: `claude`, `codex`, `gemini`
- `role` enum: `plan`, `implement`, `review`, `research`, `custom`
- `status` enum: `queued`, `running`, `succeeded`, `failed`, `canceled`
- `command` full argv array
- `cwd` absolute path
- `pid` process ID (while running)
- `parent_run_id` nullable UUID (set when dispatched from another run)
- `handoff_id` nullable UUID
- `prompt_path` path to prompt.md
- `final_output_path` path to final.md
- `provider_version` string (CLI version at launch time)
- `started_at` ISO timestamp
- `ended_at` ISO timestamp
- `exit_code` integer
- `exit_reason` nullable string (e.g., `orphaned`, `rate_limited`, `timeout`)
- `memory_hash` SHA256 of AGENTS.md at launch time
- `estimated_tokens` integer (approximated from output length)

### Event

- `event_id` UUID
- `run_id`
- `sequence_no` integer
- `ts` ISO timestamp
- `kind` enum: `stdout`, `stderr`, `status_change`, `artifact`
- `payload` string or JSON

### Operator Action

Separate from run events. Stored in a project-level `actions.jsonl`.

- `action_id` UUID
- `ts` ISO timestamp
- `kind` enum: `run_launched`, `run_canceled`, `handoff_created`, `export_created`, `usage_adjusted`, `note_added`
- `run_id` nullable UUID
- `detail` JSON

### Handoff

- `handoff_id` UUID
- `source_run_id`
- `target_provider`
- `title` string
- `objective` string
- `requested_outcome` string
- `context_items` ordered array of `{ type: 'memory'|'excerpt'|'file'|'note', content: ... }`:
  - `memory`: `{ hash, content_ref }` — AGENTS.md content stored once per unique hash in `.relay/memory-snapshots/{hash}.md`, referenced by hash (deduped across handoffs)
  - `excerpt`: `{ source_run_id, source_file, byte_start, byte_end, sha256, text }` — selected from raw run output (not rendered HTML)
  - `file`: `{ original_path, snapshot_path, sha256 }` — copied into handoff artifacts. Paths resolved to absolute; symlinks and paths outside project root are rejected.
  - `note`: `{ text }` — operator-written annotation
- `template_prompt` string (raw output of adapter `buildHandoffPrompt()`)
- `final_prompt` string (after operator edits, if allowed; same as template_prompt if read-only)
- `created_at` ISO timestamp

### Usage Snapshot

Probed directly from provider CLIs via PTY sessions. Stored globally at `~/.relay/usage/`.

- `provider` enum
- `probed_at` ISO timestamp
- `source` enum: `probe`, `cached`
- `quotas` array of quota-level usage (providers report different quota structures):
  - `scope_type` enum: `session`, `window`, `weekly`, `model` — what this quota measures
  - `scope_name` string (e.g., `"Current session"`, `"5h window"`, `"Opus"`, `"gemini-2.5-pro"`)
  - `window_label` string (human-readable, e.g., `"5h window"`, `"weekly"`, `"daily"`)
  - `remaining_percent` number (0-100)
  - `remaining_value` nullable number (raw value when available, e.g., credits remaining)
  - `limit_value` nullable number (total limit when available)
  - `unit` nullable string (e.g., `"credits"`, `"messages"`, `"tokens"`)
  - `reset_at` ISO timestamp (parsed from provider-specific formats into operator's local timezone)
  - `reset_text` string (raw reset text from provider, preserved for debugging)
  - `probe_method` enum: `pty`, `internal` — how this datum was obtained
- `rate_limit_reset_at` nullable ISO timestamp (transient rate-limit cooldown, separate from quota reset)
- `exhausted` boolean (true when provider returns rate-limit error or 0% remaining on any blocking quota)
- `error` nullable string (if probe failed, last error message)
- `stale` boolean (true if using cached snapshot due to probe failure)
- `stale_since` nullable ISO timestamp (when the snapshot became stale; null if fresh)

## Functional Requirements

### REQ-001: Usage Probing And Dashboard

Relay must probe actual usage data from provider CLIs and display it prominently.

Acceptance criteria:

1. Relay maintains persistent PTY sessions to each available provider CLI.
2. Relay sends provider-specific probe commands at a configurable interval (default 120 seconds):
   - Claude: `/usage` (extracts session, weekly, and per-model quotas)
   - Codex: `/status` (extracts credits, 5-hour limit, weekly limit)
   - Gemini: direct quota probe via Node.js module loading, with `/stats` PTY fallback
3. Probe output is stripped of ANSI escape codes, normalized, and parsed by provider-specific extractors.
4. Each probe produces a `UsageSnapshot` with per-model usage percentages and reset times.
5. On probe failure (empty output, timeout, auth error), Relay caches the last good snapshot and marks it `stale`.
6. The usage dashboard shows each provider's remaining capacity per model, reset countdowns, and stale indicators.
7. Operator can trigger an immediate re-probe from the dashboard.
8. When a task run hits a rate-limit error during execution, Relay marks the provider `exhausted` and triggers an immediate re-probe.

### REQ-002: Usage-Aware Task Routing

Relay must suggest the best provider for each task based on task type, provider affinity, and real-time remaining usage from probed snapshots.

Acceptance criteria:

1. Relay classifies each prompt into a task type: `plan`, `implement`, `review`, `research`, or `custom`.
2. Each provider has a default affinity ranking per task type (configurable in `.relay/config.json`):
   - `plan`: Claude > Codex > Gemini
   - `implement`: Codex > Claude > Gemini
   - `review`: Codex > Claude > Gemini
   - `research`: Gemini > Claude > Codex
3. Each adapter exposes a `scoreFor(taskType, snapshot)` function returning `{ eligible: boolean, effectiveRemaining: number, blockingQuota: string, reason: string }`. The adapter interprets its own quota structure (Claude's mixed session/weekly/model windows, Codex's credit/5h/weekly windows, Gemini's per-model quotas) and returns a single effective remaining capacity score.
4. The router sorts candidates by `affinityRank * capacityWeight`, where `capacityWeight` is a continuous function of `effectiveRemaining` (linear: 0% → weight 0, 100% → weight 1). This produces proportional distribution, not a cliff at a threshold.
5. When a provider is `exhausted` (0% remaining or rate-limited) or `effectiveRemaining` returns 0, Relay excludes it from suggestions entirely.
6. When a provider's snapshot is stale beyond 30 minutes (`stale_since` expiration), Relay excludes it from routing and shows a warning.
7. The suggested provider is displayed with a one-line reason (e.g., "Codex suggested — Claude Opus at 12% remaining, implementation task").
8. Operator can always override the suggestion.

### REQ-003: Task Classification

Relay must classify prompts into task types using local heuristics.

Acceptance criteria:

1. Classification runs locally without API calls using keyword and pattern matching.
2. Classification produces a task type and a confidence score.
3. If confidence is below a configurable threshold, Relay prompts the operator to confirm the task type.
4. Classification rules are defined in a single file and are operator-editable.
5. Classification latency is under 10ms.

### REQ-004: Provider Execution

Relay must launch Claude, Codex, and Gemini CLI runs from the web UI.

Acceptance criteria:

1. Relay spawns `claude -p`, `codex exec`, and `gemini -p` as headless subprocesses using pipe stdio (no PTY).
2. Each adapter defines the CLI command template, required environment variables, output format, and exit code interpretation.
3. Relay captures stdout and stderr separately and streams both to the frontend via WebSocket.
4. Relay stores provider CLI version with each run record.
5. Runs execute in the project root directory with a controlled environment (env allowlist, not full inheritance).
6. Relay marks runs `failed` on non-zero exit and `canceled` on operator-initiated kill.

### REQ-005: Process Lifecycle And Cancellation

Relay must manage subprocess lifecycle including cancellation and orphan cleanup.

Acceptance criteria:

1. `cancel` sends SIGTERM to the provider process group. If not exited within 10 seconds, sends SIGKILL.
2. When Relay server shuts down (Ctrl-C), all child processes are killed via process group signal.
3. On startup, Relay scans `.relay/runs/` for runs with status `running`, checks if the PID is alive, and marks dead runs as `failed` with `exit_reason: orphaned`.
4. Maximum concurrent runs is configurable (default 3). Additional launches queue until a slot opens.
5. Relay detects rate-limit errors in provider output (pattern matching on stderr/stdout) and updates usage tracking.

### REQ-006: Context Assembly And Dispatch

Relay must support operator-controlled context assembly when dispatching tasks from one run's output to another provider.

Acceptance criteria:

1. Operator can select text excerpts from a completed run's output in the UI.
2. Operator can attach project files via a file picker rooted at the project directory.
3. Relay pre-populates context with: AGENTS.md content, selected excerpts, and referenced project files.
4. Operator can add, remove, or edit context items before dispatch.
5. Relay shows estimated byte/token size of the assembled context before launch.
6. All attached files are snapshotted (copied into `.relay/handoffs/{id}/artifacts/`) at dispatch time with SHA256 hashes.
7. Each adapter implements `buildHandoffPrompt(handoff)` to transform the packet into a provider-specific prompt string.
8. Operator can preview the generated prompt before confirming dispatch.

### REQ-007: Split-Pane Workspace

Relay must provide a split-pane browser workspace for side-by-side provider output.

Acceptance criteria:

1. The workspace shows two resizable panes: source run (left) and dispatched run (right).
2. Both panes render streaming Markdown output.
3. The left pane supports text selection for excerpt extraction from raw output text (not rendered HTML). A raw/rendered view toggle is available. Excerpts are captured from raw text to preserve fidelity and byte-range accuracy.
4. Panes can be collapsed to full-width single view.
5. Active runs show a live streaming indicator.
6. Completed runs show full output with scroll.

### REQ-008: Project Memory Health

Relay must validate AGENTS.md status on project load.

Acceptance criteria:

1. Relay checks whether AGENTS.md exists at project root on startup.
2. Relay computes and stores a SHA256 hash of AGENTS.md content.
3. The UI shows memory status: `healthy` (exists, hash matches last known), `modified` (exists, hash changed), or `missing`.
4. Relay does NOT generate or edit AGENTS.md or vendor mirror files. The operator manages symlinks externally.

### REQ-009: Run Logging And Audit Trail

Relay must persist auditable records for every run and operator action.

Acceptance criteria:

1. Each run stores metadata, raw output, normalized events, prompt snapshot, and final output under `.relay/runs/<run-id>/`.
2. Operator actions (launch, cancel, handoff, export, usage adjustment) are recorded in a project-level `actions.jsonl` file separate from run events.
3. Run data is append-only after completion.
4. The timeline view shows a chronological list of all runs and operator actions for the project.

### REQ-010: Markdown Export

Relay must export workflow summaries as Markdown readable in Obsidian.

Acceptance criteria:

1. Export includes: run IDs, providers, task types, prompts (or excerpts), final outputs, handoff chain, and usage statistics.
2. Export omits raw secret values (applies redaction rules).
3. Export writes to `.relay/exports/<export-id>.md`.
4. Exported Markdown uses standard CommonMark with no custom syntax.

### REQ-011: Secrets And Redaction

Relay must prevent secrets from leaking into logs, handoffs, and exports.

Acceptance criteria:

1. All provider subprocesses (both task runs and PTY probe sessions) are spawned with an env allowlist. Only explicitly listed env vars are inherited.
2. The allowlist includes provider-required vars (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PATH`, `HOME`) and is configurable.
3. Redaction runs as a filter in the output pipeline BEFORE writing to any file (`stdout.log`, `stderr.log`, `events.jsonl`, `prompt-preview.md`). Output is never persisted unredacted.
4. Redaction scans for patterns matching known API key formats and replaces them with `[REDACTED]`.
5. File attachment blocks by default: `.env*`, `*.pem`, `*.key`, `.npmrc`, `*credentials*`, SSH keys. Other paths matching sensitive patterns show a warning. Symlinks and paths resolving outside the project root are rejected.
6. Exports apply all redaction rules before writing.
7. Debug PTY captures (`.relay/debug/`) are also redacted.

### REQ-012: Server Lifecycle

Relay must run as an explicit start/stop server process.

Acceptance criteria:

1. `relay serve --project <path>` starts the backend and opens the browser.
2. `--port <number>` overrides the default port (3000).
3. Ctrl-C shuts down the server and kills all child processes.
4. Runs do not survive server shutdown. If the server dies, runs die with it.
5. On startup, Relay initializes `.relay/` if it does not exist and performs orphan cleanup.

### REQ-013: Provider Adapters

Each provider adapter must encapsulate CLI-specific behavior behind a common interface.

Acceptance criteria:

1. Each adapter defines: command template, env var requirements, output parser, exit code map, rate-limit detection pattern, cancellation method, and `buildHandoffPrompt()` function.
2. Provider availability is determined by checking if the CLI executable exists on PATH. No `--help` or `--version` calls during discovery (these have side effects).
3. Adapter output parsers are tested against golden files (raw CLI output samples stored in the repo).
4. When a provider CLI updates and output format changes, golden file tests fail loudly.

### REQ-014: Usage Probing Engine

Relay must include a built-in usage probing engine ported from the ai_monitor project patterns.

Acceptance criteria:

1. Each provider adapter defines a `ProbeConfig`: the CLI executable, probe command(s), expected output patterns, auto-responses for interactive gates, and idle timeout.
2. PTY sessions are persistent per provider — reused across probe cycles, not spawned fresh each time.
3. ANSI stripping uses a regex pipeline that removes all escape codes, control characters, and normalizes whitespace. No external dependencies for parsing.
4. Provider-specific parsers handle:
   - Claude: session quotas, weekly quotas, per-model (Opus/Sonnet) quotas, reset time formats
   - Codex: credits remaining, 5-hour window limits, weekly limits, reset text
   - Gemini: per-model (Flash/Pro) quotas via PTY `/stats` (default). Internal Node.js module probe is behind an experimental `probe_method=internal` flag.
5. Auto-response injection handles trust prompts ("Do you trust this folder?") and similar blocking gates without operator intervention.
6. Probe retries: on empty output, retry once with a fresh command send before marking failed.
7. Snapshot caching: on probe failure, hold last good snapshot and mark `stale: true`. Never return empty data.
8. Reset time parsing: convert provider-specific formats ("Resets in 2h 14m", "Resets on Apr 18, 9:00AM") into ISO timestamps in the operator's local timezone.
9. Probe sessions are started on server launch and cleaned up on server shutdown. No orphan PTY processes.
10. Debug mode writes raw PTY captures to `.relay/debug/` for troubleshooting probe failures.

### REQ-015: Run Filtering

Relay must support filtering runs by metadata.

Acceptance criteria:

1. Operator can filter runs by provider, task type, and status.
2. Filters read `run.json` metadata only (fast, no content scanning).
3. Filter is project-scoped (single `.relay/` directory).
4. Free-text search across run content is deferred to v1.1.

## Quality And Process Requirements

1. Package manager: `pnpm`
2. Project structure: single `src/` directory with logical subdirectories (not a monorepo)
3. Lint and format: `eslint`, `prettier`, `tsc --noEmit`
4. Dead code detection: `knip` — reports unused exports, files, dependencies, and types
5. Tests: `vitest` for unit and integration tests
6. No Playwright e2e tests in v1. Manual UI testing is sufficient.
7. Minimum supported environment: macOS (Apple Silicon)
8. All tests use `.test.ts` or `.spec.ts` extensions
9. Git hooks via `husky`:
   - **pre-commit**: `eslint`, `prettier --check`, `tsc --noEmit`, `knip` (warnings only — exit 0 on knip findings so pre-declared stubs don't block commits during incremental development)
   - **pre-push**: full `vitest run` (all tests must pass before code reaches remote)
10. CI parity: git hooks run the exact same commands as CI. No subset, no approximation.

## Decision Log

1. Browser workspace wins over CLI-first because the core workflow — reviewing plan output, selecting context, dispatching subtasks, watching side-by-side results — is inherently visual and comparative.
2. CLI companion is deferred to v1.1. All primary work happens in the browser.
3. Usage-aware routing is the primary value proposition. Everything else is infrastructure to support intelligent work distribution.
4. Three providers only: Claude (planning), Codex (implementation/review), Gemini (research/summarization). Secondary providers (Cursor, Copilot, Vibe) deferred.
5. File-based storage over SQLite. Simpler, more transparent. Note: `node-pty` is a native C++ addon required for PTY probing — this is the one native dependency, justified because usage probing is the core differentiator. Requires Xcode CLI tools on macOS.
6. Fire-and-forget runs with cancel. No mid-run interaction. Task execution uses pipe-based subprocess only.
7. PTY is used exclusively for usage probing — persistent sessions that send `/status`/`/usage`/`/stats` commands to provider CLIs. This is a separate subsystem from task execution.
8. Usage probing logic is ported from the ai_monitor project (Python → TypeScript). This provides real usage data from provider CLIs rather than proxy counters.
9. Local heuristic task classification. No API calls for routing decisions.
10. Relay does not manage AGENTS.md or vendor mirror files. Operator manages symlinks externally. Relay only validates health.
11. Server lifecycle is explicit start/stop. No daemon, no launchd, no auto-start. Runs die with the server. PTY probe sessions are cleaned up on shutdown.
12. Env allowlist for subprocess spawning. Principle of least privilege for secret protection.
13. Single `src/` directory structure over monorepo. One developer, one product, no need for cross-package versioning.
14. Usage data is global (`~/.relay/usage/`), not project-local. Usage is per-subscription. This is the one exception to project self-containment — documented explicitly because it is necessary for cross-project routing to work.
15. No post-run usage estimation. Provider usage windows are dynamic and provider-controlled. Probes at 120-second intervals provide ground truth; guessing between probes is unreliable.
16. Gemini PTY `/stats` is the default probe method. Internal module probe is experimental due to version fragility.
17. Redaction happens before persistence, never after. Output flows through the redaction filter before being written to any file.
18. Free-text search across run content deferred to v1.1. v1 filters by run metadata only (provider, status, role).

## Open Questions

1. Should Relay support running the same task on multiple providers simultaneously for comparison? (Useful for evaluating provider quality, but doubles/triples usage.)
2. Should handoff prompts be editable after adapter templating generates them, or is the preview read-only before dispatch? (Must be resolved before implementing adapter prompt templating.)
