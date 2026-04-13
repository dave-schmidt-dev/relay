# Relay Task Backlog

This backlog is authoritative for v1 implementation planning. Every task maps to one or more requirements in `SPEC.md`.

Status key: todo | in_progress | done | blocked

## Phase 0: Bootstrap And Provider Validation (DONE)

Exit criteria: MET

- [x] TASK-001: Create clean repo with src/ structure, pnpm, TypeScript, vitest, eslint, prettier
  - status: done

- [x] TASK-002: Create README.md, HISTORY.md, LICENSE (MIT)
  - status: done

- [x] TASK-003: Validate Claude CLI behavior — golden files for task output and /usage probe
  - status: done

- [x] TASK-004: Validate Codex CLI behavior — golden files for task output and /status probe
  - status: done

- [x] TASK-005: Validate Gemini CLI behavior — golden files for task output and /stats probe
  - status: done

## Phase 1: Core Engine (DONE)

Exit criteria: MET

- [x] TASK-006: Implement .relay/ directory initialization and config loading
  - status: done

- [x] TASK-007: Implement run lifecycle state machine (queued → running → succeeded/failed/canceled)
  - status: done

- [x] TASK-008: Implement shared subprocess runner with pipe stdio, env allowlist, and process group management
  - status: done

- [x] TASK-009: Implement Claude adapter (command template, output parser, exit code map, rate-limit detection)
  - status: done

- [x] TASK-010: Implement Codex adapter
  - status: done

- [x] TASK-011: Implement Gemini adapter
  - status: done

- [x] TASK-012: Implement provider discovery (executable exists on PATH, no --help calls)
  - status: done

- [x] TASK-013: Implement run persistence (run.json, events.jsonl, stdout.log, stderr.log, prompt.md, final.md)
  - status: done

- [x] TASK-014: Implement ANSI stripping and text normalization pipeline (port from ai_monitor)
  - status: done

- [x] TASK-014a: Implement persistent PTY session manager (port from ai_monitor pty_session.py)
  - status: done

- [x] TASK-014b: Implement Claude usage probe parser
  - status: done

- [x] TASK-014c: Implement Codex usage probe parser
  - status: done

- [x] TASK-014d: Implement Gemini usage probe — direct Node.js quota probe with PTY /stats fallback
  - status: done

- [x] TASK-014e: Implement usage probe orchestrator (interval scheduling, snapshot caching, stale detection)
  - status: done

- [x] TASK-015: Implement task classifier (local heuristic keyword/pattern matching)
  - status: done

- [x] TASK-016: Implement usage-aware provider router (affinity rankings + probed UsageSnapshot weighting)
  - status: done

- [x] TASK-017: Implement cancellation (SIGTERM → SIGKILL escalation, process group cleanup)
  - status: done

- [x] TASK-018: Implement orphan detection on startup
  - status: done

- [x] TASK-019: Implement secret redaction (env allowlist, output pattern scanning, API key format matching)
  - status: done

## Phase 2: Context Assembly And Handoffs

Exit criteria:

1. Operator can create a handoff from a completed run with snapshotted context.
2. Each adapter can generate a target prompt from a handoff packet.
3. Child runs link to parent runs via handoff.

- [x] TASK-020: Implement handoff data model and persistence (handoff.json + artifacts/)
  - spec: REQ-006
  - test: src/core/__tests__/handoff-persistence.test.ts
  - status: done

- [x] TASK-021: Implement file snapshotting for handoff attachments (copy + SHA256)
  - spec: REQ-006
  - test: src/core/__tests__/file-snapshot.test.ts
  - status: done

- [x] TASK-022: Implement context pre-population (AGENTS.md + selected excerpts + project files)
  - spec: REQ-006
  - test: src/core/__tests__/context-assembly.test.ts
  - status: done

- [x] TASK-023: Implement per-adapter buildHandoffPrompt() for Claude, Codex, and Gemini
  - spec: REQ-006, REQ-013
  - test: src/adapters/__tests__/handoff-prompt-claude.test.ts, codex, gemini
  - status: done

- [x] TASK-024: Implement parent-child run linking via handoff_id
  - spec: REQ-006, REQ-009
  - test: src/core/__tests__/run-linking.test.ts
  - status: done

- [x] TASK-025: Implement AGENTS.md health check (exists, hash, modified detection)
  - spec: REQ-008
  - test: src/core/__tests__/memory-health.test.ts
  - status: done

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

- [ ] TASK-028: Build usage dashboard component
  - spec: REQ-001
  - test: manual verification
  - status: todo

- [ ] TASK-029: Build prompt composer component
  - spec: REQ-004, REQ-002
  - test: manual verification
  - status: todo

- [ ] TASK-030: Build split-pane workspace
  - spec: REQ-007
  - test: manual verification
  - status: todo

- [ ] TASK-031: Build run output renderer (streaming Markdown)
  - spec: REQ-007
  - test: manual verification
  - status: todo

- [ ] TASK-032: Build context assembly UI
  - spec: REQ-006
  - test: manual verification
  - status: todo

- [ ] TASK-033: Build handoff dispatch flow
  - spec: REQ-006, REQ-002
  - test: manual verification
  - status: todo

- [ ] TASK-034: Build run detail view
  - spec: REQ-009
  - test: manual verification
  - status: todo

- [ ] TASK-035: Build project timeline view
  - spec: REQ-009
  - test: manual verification
  - status: todo

- [ ] TASK-036: Build memory health indicator
  - spec: REQ-008
  - test: manual verification
  - status: todo

## Phase 4: Search, Export, And Hardening

Exit criteria:

1. Runs are filterable by metadata.
2. Markdown export works.
3. Integration test covers full plan → handoff → implement flow.

- [ ] TASK-037: Implement run filtering (by provider, task type, status)
  - spec: REQ-015
  - test: src/core/__tests__/run-filter.test.ts
  - status: todo

- [ ] TASK-038: Implement Markdown workflow export with redaction
  - spec: REQ-010, REQ-011
  - test: src/core/__tests__/export-markdown.test.ts
  - status: todo

- [ ] TASK-039: Add integration test for full plan → handoff → implement flow
  - spec: REQ-004, REQ-006
  - test: src/__tests__/integration/plan-handoff-implement.test.ts
  - status: todo

- [ ] TASK-040: Add concurrency limit enforcement (max 3 concurrent runs, queue overflow)
  - spec: REQ-005
  - test: src/core/__tests__/concurrency-control.test.ts
  - status: todo

- [ ] TASK-041: Document install, configuration, and known limitations in README
  - spec: Quality And Process Requirements
  - test: verify README sections exist
  - status: todo
