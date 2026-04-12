# Relay Task Backlog

This backlog is authoritative for v1 implementation planning. Every task maps to one or more requirements in `SPEC.md`.

Status key: todo | in_progress | done | blocked

## Phase 0: Bootstrap And Provider Validation

Exit criteria:

1. Repo is clean, tooling works, all three CLIs are documented.
2. Golden files exist for each provider's task output format AND usage probe output.

- [ ] TASK-001: Create clean repo with src/ structure, pnpm, TypeScript, vitest, eslint, prettier
  - spec: Quality And Process Requirements
  - test: src/core/__tests__/smoke.test.ts (project builds and lints)
  - status: todo

- [ ] TASK-002: Create README.md, HISTORY.md, LICENSE (MIT)
  - spec: Quality And Process Requirements
  - test: verify files exist and contain required sections
  - status: todo

- [ ] TASK-003: Validate Claude CLI behavior — document task flags, output format, exit codes, rate-limit patterns, AND probe `/usage` output format
  - spec: REQ-004, REQ-013, REQ-014
  - test: src/adapters/__tests__/claude-golden.test.ts (parse golden file samples for both task output and usage probe output)
  - status: todo
  - deliverable: golden files in fixtures/claude/ (task output + usage probe raw captures)

- [ ] TASK-004: Validate Codex CLI behavior — document task flags, JSONL format, exit codes, rate-limit patterns, AND probe `/status` output format
  - spec: REQ-004, REQ-013, REQ-014
  - test: src/adapters/__tests__/codex-golden.test.ts
  - status: todo
  - deliverable: golden files in fixtures/codex/ (task output + usage probe raw captures)

- [ ] TASK-005: Validate Gemini CLI behavior — document task flags, output format, exit codes, rate-limit patterns, AND probe `/stats` output format. Also test direct Node.js quota probe path.
  - spec: REQ-004, REQ-013, REQ-014
  - test: src/adapters/__tests__/gemini-golden.test.ts
  - status: todo
  - deliverable: golden files in fixtures/gemini/ (task output + usage probe raw captures + direct probe samples)

## Phase 1: Core Engine

Exit criteria:

1. Runs can be launched, streamed, completed, canceled, and persisted for all three providers.
2. Usage prober returns real usage data from all three provider CLIs.
3. Usage-aware router suggests the correct provider based on task type and remaining capacity.
4. `.relay/` storage layout is stable.

- [ ] TASK-006: Implement .relay/ directory initialization and config loading
  - spec: REQ-012
  - test: src/core/__tests__/storage-init.test.ts
  - status: todo

- [ ] TASK-007: Implement run lifecycle state machine (queued → running → succeeded/failed/canceled)
  - spec: REQ-005
  - test: src/core/__tests__/run-lifecycle.test.ts
  - status: todo

- [ ] TASK-008: Implement shared subprocess runner with pipe stdio, env allowlist, and process group management
  - spec: REQ-004, REQ-005, REQ-011
  - test: src/core/__tests__/subprocess-runner.test.ts
  - status: todo

- [ ] TASK-009: Implement Claude adapter (command template, output parser, exit code map, rate-limit detection)
  - spec: REQ-004, REQ-013
  - test: src/adapters/__tests__/claude-adapter.test.ts
  - status: todo

- [ ] TASK-010: Implement Codex adapter
  - spec: REQ-004, REQ-013
  - test: src/adapters/__tests__/codex-adapter.test.ts
  - status: todo

- [ ] TASK-011: Implement Gemini adapter
  - spec: REQ-004, REQ-013
  - test: src/adapters/__tests__/gemini-adapter.test.ts
  - status: todo

- [ ] TASK-012: Implement provider discovery (executable exists on PATH, no --help calls)
  - spec: REQ-013
  - test: src/adapters/__tests__/provider-discovery.test.ts
  - status: todo

- [ ] TASK-013: Implement run persistence (run.json, events.jsonl, stdout.log, stderr.log, prompt.md, final.md)
  - spec: REQ-009
  - test: src/core/__tests__/run-persistence.test.ts
  - status: todo

- [ ] TASK-014: Implement ANSI stripping and text normalization pipeline (port from ai_monitor parsing.py)
  - spec: REQ-014
  - test: src/prober/__tests__/ansi-strip.test.ts (test against raw PTY captures from golden files)
  - status: todo
  - source: ai_monitor/parsing.py strip_ansi(), compact_whitespace()

- [ ] TASK-014a: Implement PTY spawn and lifecycle management with node-pty
  - spec: REQ-014
  - test: src/prober/__tests__/pty-lifecycle.test.ts
  - status: todo
  - note: This is an EVENT-DRIVEN REWRITE, not a line-for-line port. Python uses raw fd + select.select(); node-pty uses onData callbacks. Implement as a ProbeTransaction state machine with timers.
  - source: ai_monitor/pty_session.py (architecture reference, not translation target)

- [ ] TASK-014a2: Implement ProbeTransaction state machine (idle detection, capture completion, timeout)
  - spec: REQ-014
  - test: src/prober/__tests__/probe-transaction.test.ts
  - status: todo
  - note: Timer-based idle detection (startupWait, idleTimeout, resendCommandEvery, settleAfterStop). Handle UTF-8 multibyte splits across onData boundaries.

- [ ] TASK-014a3: Implement auto-response injection and trust prompt handling
  - spec: REQ-014
  - test: src/prober/__tests__/auto-response.test.ts
  - status: todo
  - note: Pattern-match interactive gates ("Do you trust this folder?") and inject responses. Use fake PTY fixture binary for testing without real CLIs.

- [ ] TASK-014b: Implement Claude usage probe parser (extract session/weekly/Opus quotas and reset times)
  - spec: REQ-001, REQ-014
  - test: src/prober/__tests__/claude-probe.test.ts (test against golden probe captures)
  - status: todo
  - source: ai_monitor/parsing.py Claude extraction logic

- [ ] TASK-014c: Implement Codex usage probe parser (extract credits, 5h limit, weekly limit, reset text)
  - spec: REQ-001, REQ-014
  - test: src/prober/__tests__/codex-probe.test.ts
  - status: todo
  - source: ai_monitor/parsing.py Codex extraction logic

- [ ] TASK-014d: Implement Gemini usage probe — PTY /stats as default, internal Node.js module probe behind experimental flag
  - spec: REQ-001, REQ-014
  - test: src/prober/__tests__/gemini-probe.test.ts
  - status: todo
  - note: Internal probe paths (dist/src/config/settings.js) do not exist in Gemini 0.37.1 bundled installs. PTY /stats is the safe default.
  - source: ai_monitor/providers.py (Gemini probe technique — use PTY path, not internal)

- [ ] TASK-014e: Implement usage probe orchestrator (interval scheduling, snapshot caching, stale detection with stale_since timestamp, staleness expiration at 30min, error recovery, probe-task mutual exclusion)
  - spec: REQ-001, REQ-014
  - test: src/prober/__tests__/probe-orchestrator.test.ts
  - status: todo
  - note: Snapshots persist to ~/.relay/usage/ (global, not project-local). Do not probe a provider while it has an active task run.
  - source: ai_monitor/__main__.py concurrent fetching, cache merge strategy

- [ ] TASK-015: Implement task classifier (local heuristic keyword/pattern matching)
  - spec: REQ-003
  - test: src/core/__tests__/task-classifier.test.ts
  - status: todo

- [ ] TASK-016: Implement usage-aware provider router with per-adapter scoreFor() and proportional capacity weighting
  - spec: REQ-002
  - test: src/core/__tests__/provider-router.test.ts (test routing decisions against synthetic usage snapshots — verify proportional distribution, not threshold cliff)
  - status: todo
  - note: Each adapter implements scoreFor(taskType, snapshot) → { eligible, effectiveRemaining, blockingQuota, reason }. Router sorts by affinityRank * capacityWeight (linear). Excludes exhausted and stale-expired providers.

- [ ] TASK-017: Implement cancellation (SIGTERM → SIGKILL escalation, process group cleanup)
  - spec: REQ-005
  - test: src/core/__tests__/cancellation.test.ts
  - status: todo

- [ ] TASK-018: Implement orphan detection on startup (scan running runs, check PIDs, mark dead as failed)
  - spec: REQ-005
  - test: src/core/__tests__/orphan-cleanup.test.ts
  - status: todo

- [ ] TASK-019: Implement secret redaction (env allowlist, output pattern scanning, API key format matching)
  - spec: REQ-011
  - test: src/core/__tests__/redaction.test.ts
  - status: todo

## Phase 2: Context Assembly And Handoffs

Exit criteria:

1. Operator can create a handoff from a completed run with snapshotted context.
2. Each adapter can generate a target prompt from a handoff packet.
3. Child runs link to parent runs via handoff.

- [ ] TASK-020: Implement handoff data model and persistence (handoff.json + artifacts/)
  - spec: REQ-006
  - test: src/core/__tests__/handoff-persistence.test.ts
  - status: todo

- [ ] TASK-021: Implement file snapshotting for handoff attachments (copy + SHA256)
  - spec: REQ-006
  - test: src/core/__tests__/file-snapshot.test.ts
  - status: todo

- [ ] TASK-022: Implement context pre-population (AGENTS.md + selected excerpts + project files)
  - spec: REQ-006
  - test: src/core/__tests__/context-assembly.test.ts
  - status: todo

- [ ] TASK-023: Implement per-adapter buildHandoffPrompt() for Claude, Codex, and Gemini
  - spec: REQ-006, REQ-013
  - test: src/adapters/__tests__/handoff-prompt-claude.test.ts, codex, gemini
  - status: todo

- [ ] TASK-024: Implement parent-child run linking via handoff_id
  - spec: REQ-006, REQ-009
  - test: src/core/__tests__/run-linking.test.ts
  - status: todo

- [ ] TASK-025: Implement AGENTS.md health check (exists, hash, modified detection)
  - spec: REQ-008
  - test: src/core/__tests__/memory-health.test.ts
  - status: todo

## Phase 3: Server And Web UI

Exit criteria:

1. Browser workspace supports the full core workflow: compose, dispatch, watch, review.
2. Usage dashboard is visible and accurate.
3. WebSocket streaming works for active runs.

- [ ] TASK-026: Implement HTTP server with REST API for runs, handoffs, usage, and project state
  - spec: REQ-012
  - test: src/server/__tests__/api-routes.test.ts
  - status: todo

- [ ] TASK-027: Implement WebSocket server for live run output streaming
  - spec: REQ-007, REQ-012
  - test: src/server/__tests__/websocket-streaming.test.ts
  - status: todo

- [ ] TASK-028: Build usage dashboard component (per-provider + per-model bars, percentages, reset countdowns, stale indicators, re-probe button)
  - spec: REQ-001
  - test: manual verification
  - status: todo

- [ ] TASK-029: Build prompt composer component (text editor, file picker, provider suggestion, dispatch button)
  - spec: REQ-004, REQ-002
  - test: manual verification
  - status: todo

- [ ] TASK-030: Build split-pane workspace (source run left, dispatched run right, resizable, collapsible)
  - spec: REQ-007
  - test: manual verification
  - status: todo

- [ ] TASK-031: Build run output renderer (streaming Markdown, scroll, completion indicator)
  - spec: REQ-007
  - test: manual verification
  - status: todo

- [ ] TASK-032: Build context assembly UI (text selection from output, file picker, context preview, size estimate)
  - spec: REQ-006
  - test: manual verification
  - status: todo

- [ ] TASK-033: Build handoff dispatch flow (adapter prompt preview, provider suggestion, confirm, launch)
  - spec: REQ-006, REQ-002
  - test: manual verification
  - status: todo

- [ ] TASK-034: Build run detail view (metadata, raw logs, timeline, linked runs)
  - spec: REQ-009
  - test: manual verification
  - status: todo

- [ ] TASK-035: Build project timeline view (chronological runs + operator actions)
  - spec: REQ-009
  - test: manual verification
  - status: todo

- [ ] TASK-036: Build memory health indicator (AGENTS.md status in header/sidebar)
  - spec: REQ-008
  - test: manual verification
  - status: todo

## Phase 4: Search, Export, And Hardening

Exit criteria:

1. Runs are searchable and filterable.
2. Markdown export works.
3. Integration test covers full plan → handoff → implement flow.

- [ ] TASK-037: Implement run filtering by provider, task type, and status (reads run.json metadata only)
  - spec: REQ-015
  - test: src/core/__tests__/run-filter.test.ts
  - status: todo
  - note: Free-text search deferred to v1.1

- [ ] TASK-039: Implement Markdown workflow export with redaction
  - spec: REQ-010, REQ-011
  - test: src/core/__tests__/export-markdown.test.ts
  - status: todo

- [ ] TASK-040: Add integration test for full plan → handoff → implement flow (fixture-based)
  - spec: REQ-004, REQ-006
  - test: src/__tests__/integration/plan-handoff-implement.test.ts
  - status: todo

- [ ] TASK-041: Add concurrency limit enforcement (max 3 concurrent runs, queue overflow)
  - spec: REQ-005
  - test: src/core/__tests__/concurrency-control.test.ts
  - status: todo

- [ ] TASK-042: Document install, configuration (usage limits), and known limitations in README
  - spec: Quality And Process Requirements
  - test: verify README sections exist
  - status: todo
