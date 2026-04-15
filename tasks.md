# Relay Task Backlog

This backlog is authoritative for v1 implementation planning. Every task maps to one or more requirements in `SPEC.md`.

Status key: todo | in_progress | done | blocked

## Planning Principle

Accurate code is the bare minimum, not the end goal.

The goal of this project is reliable, auditable, maintainable workflow software that works end to end under real use, survives validation, and can be safely extended or handed off between providers. "It compiles" or "the feature appears to work once" is not sufficient for completion.

When implementing any remaining task, optimize for:

- spec fidelity, not just plausible behavior
- integrated workflow correctness, not isolated component correctness
- regression resistance through tests and validation
- documentation and task state that stay aligned with reality
- work that another provider or future session can pick up without guesswork

## Completion Contract For All Remaining Work

All unfinished tasks and phases inherit this definition of done. A task is not complete, a phase is not complete, and no commit should be made on the basis of that work unless all applicable items below are satisfied.

Required validation commands:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build:web`

Required completion rules:

- All required validation commands must exit `0`.
- `pnpm build:web` must be clean enough to trust as a gate; warnings that indicate broken styling or broken build output count as failures and must be fixed before completion.
- New or changed behavior must have tests added or updated in the same task when the behavior is testable. Manual verification is a supplement, not a substitute, for automated coverage.
- API, WebSocket, and UI contract changes must be updated consistently across server, client, tests, and docs in the same task.
- Import-time side effects that break tests or make modules unsafe to import are not acceptable.
- `tasks.md` and `HISTORY.md` must be updated at phase boundaries and whenever completion status materially changes.
- Do not mark a task `done`, do not claim completion, and do not commit solely on feature appearance if any gate above is still failing.

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

## Phase 3: Server And Web UI (DONE)

Exit criteria: MET

1. Browser workspace supports the full core workflow: compose, dispatch, watch, review.
2. Usage dashboard is visible and accurate.
3. WebSocket streaming works for active runs.
4. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build:web` all pass for the integrated Phase 3 implementation.
5. Phase 3 behavior is covered by automated tests where practical, including server route coverage and WebSocket streaming coverage. Manual browser verification does not replace these tests.

Phase 3 specific gate:

- `src/server/__tests__/api-routes.test.ts` exists and covers the REST API behavior.
- `src/server/__tests__/websocket-streaming.test.ts` exists and covers live run output subscription/streaming behavior.
- UI work is complete with intended styling and without known broken-build warnings.

- [x] TASK-025a: Setup Vite + React frontend environment (Vite, React, Tailwind, dependencies)
  - status: done

- [x] TASK-026: Implement HTTP server with REST API for runs, handoffs, usage, and project state
  - spec: REQ-012
  - test: src/server/__tests__/api-routes.test.ts
  - status: done

- [x] TASK-027: Implement WebSocket server for live run output streaming
  - spec: REQ-007, REQ-012
  - test: src/server/__tests__/websocket-streaming.test.ts
  - status: done

- [x] TASK-028: Build usage dashboard component
  - spec: REQ-001
  - test: manual verification
  - status: done

- [x] TASK-029: Build prompt composer component
  - spec: REQ-004, REQ-002
  - test: manual verification
  - status: done

- [x] TASK-030: Build split-pane workspace
  - spec: REQ-007
  - test: manual verification
  - status: done

- [x] TASK-031: Build run output renderer (streaming Markdown)
  - spec: REQ-007
  - test: manual verification
  - status: done

- [x] TASK-032: Build context assembly UI
  - spec: REQ-006
  - test: manual verification
  - status: done

- [x] TASK-033: Build handoff dispatch flow
  - spec: REQ-006, REQ-002
  - test: manual verification
  - status: done

- [x] TASK-034: Build run detail view
  - spec: REQ-009
  - test: manual verification
  - status: done

- [x] TASK-035: Build project timeline view
  - spec: REQ-009
  - test: manual verification
  - status: done

- [x] TASK-036: Build memory health indicator
  - spec: REQ-008
  - test: manual verification
  - status: done

## Phase 4: Search, Export, And Hardening (DONE)

Exit criteria: MET

1. Runs are filterable by metadata.
2. Markdown export works.
3. Integration test covers full plan → handoff → implement flow.
4. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build:web` all pass after hardening work is integrated.
5. Hardening tasks include regression coverage for the behavior they introduce or modify.
6. Manual verification in the browser confirms the UI is integrated and real-time capable.

Phase 4 specific gate:

- Filtering, export, concurrency, and integration behavior must land with automated tests in the paths listed on the tasks below.
- Export and hardening work is not complete if it only works in ad hoc manual runs and is not represented in the automated suite.

- [x] TASK-037: Implement run filtering (by provider, task type, status)
  - status: done

- [x] TASK-038: Implement Markdown workflow export with redaction
  - status: done

- [x] TASK-039: Add integration test for full plan → handoff → implement flow
  - status: done

- [x] TASK-040: Add concurrency limit enforcement (max 3 concurrent runs, queue overflow)
  - status: done

- [x] TASK-041: Document install, configuration, and known limitations in README
  - status: done

- [x] TASK-042: Integrate Phase 4 into Web UI (Filtering, Export buttons)
  - status: done

- [x] TASK-043: Implement real-time WebSocket status updates and UI transitions
  - status: done

- [x] TASK-044: Harden Usage Prober and router for production/mock environments
  - status: done

- [x] TASK-045: Final manual verification pass with Playwright (Passed: 2026-04-14)
  - status: done

## Phase 4 Enhancements: GitHub Integration & Robust Prober (DONE)

Exit criteria: MET

1. GitHub CLI (Copilot) integrated as 4th provider.
2. PTY session prober handles stop substrings and exact ai_monitor stages.
3. Usage UI supports compact/expanded views and auto-refresh.
4. All lint errors and Vitest regressions resolved.

- [x] TASK-046: Integrate GitHub CLI (Copilot) into core types, router, and UI
  - status: done

- [x] TASK-047: Port robust PTY noise handling and multi-stage probes from ai_monitor
  - status: done

- [x] TASK-048: Upgrade UsageDashboard with Collapsed/Expanded modes and real-time polling
  - status: done

- [x] TASK-049: Implement stopSubstrings and warmup sequences in PTYSession
  - status: done

- [x] TASK-050: Fix linting and Vitest failures across prober and web hooks
  - status: done
