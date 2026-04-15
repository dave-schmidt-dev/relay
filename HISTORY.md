# Relay History

## 2026-04-12 — Project inception

- Product concept: usage-aware AI workbench distributing work across Claude, Codex, and Gemini CLI subscriptions
- Initial spec drafted with Codex assistance, reviewed twice through warp-tier multi-model review pipeline (Claude Contrarian + Codex GPT-5.4 + Gemini 3.1 Pro + Kimi K2.5)
- Round 1 review (16 min): Caught daemon architecture (replaced with single server), 6 providers (cut to 3), Python test paths (fixed), underspecified handoff packets (now concrete)
- Round 2 review (25 min): Caught UsageSnapshot data model mismatch (models[] → quotas[]), routing step function (replaced with proportional weighting), project-scoped usage (moved to global ~/.relay/usage/), PTY port underscoped (expanded to 4 subtasks)
- Key design decisions:
  - Usage-aware routing is the primary value proposition
  - Real usage data via PTY probing (ported from ai_monitor project)
  - Browser-based split-pane workspace as primary interface
  - CLI companion deferred to v1.1
  - Three providers only: Claude, Codex, Gemini
  - File-based storage, no SQLite
  - Global usage data at ~/.relay/usage/, project data at .relay/
- Prior art: ai_monitor project provides working Python implementation of PTY-based usage probing for all three providers
- Market research: No existing tool does task-aware usage-optimized routing for CLI subscriptions. CLIProxyAPI routes HTTP API requests; Relay routes semantic tasks.
- Repo scaffolded, spec and tasks committed

## 2026-04-12 — Phase 0 complete

- Tooling scaffold: pnpm, TypeScript (ES2024/NodeNext strict), vitest, eslint flat config, prettier, husky hooks, knip
- Golden files for all three provider CLIs: Claude, Codex, Gemini
- Task execution samples (text + JSON/JSONL) and usage probe captures from ai_monitor test fixtures
- 151 tests passing across 4 test files
- Committed as single phase-boundary commit (0ba605f)
- Discovery: Gemini CLI loads GEMINI.md from project root automatically (like CLAUDE.md for Claude). This gives us a persistent context injection point for Gemini-dispatched tasks without bloating -p prompts. Should create project-level GEMINI.md with coding standards.
- Experiment: Testing Gemini Pro (-m pro) as implementation agent and Gemini Flash (-m flash) as review agent, with Opus orchestrating. Goal: distribute subscription credits across providers during development.

## 2026-04-12 — Phase 1 complete

- Core engine implemented: 19 tasks, 47 source files, 8,709 lines added
- Orchestration model: Opus orchestrator dispatched Sonnet subagents for implementation and Haiku subagents for spec review. Per-task cycle: dispatch → implement → spec review → mark complete.
- Gemini experiment result: Tested Gemini Pro (-p -m pro) as implementation agent for TASK-006 (storage init). Generated structurally sound code but needed 3 manual fixes (ESM import style, lint error, ESM mock pattern). Total time ~10 min vs ~3 min for Sonnet subagent. Conclusion: external CLIs as text generators aren't a substitute for tool-using subagents — the value requires tool access (file read/write, test execution).
- Module breakdown:
  - core/: types, run lifecycle state machine, subprocess runner, run persistence, storage init, task classifier, provider router, cancellation, orphan detection, secret redaction
  - adapters/: ProviderAdapter interface, Claude/Codex/Gemini implementations, provider discovery
  - prober/: ANSI stripping (ported from ai_monitor), PTY session manager (node-pty), Claude/Codex/Gemini probe parsers, probe orchestrator
- node-pty added as the one native C++ dependency (usage probing requires PTY sessions)
- Bug: GitHub secret scanner flagged a fake Google API key (AIzaSyD-...) in redaction tests and a real email in Gemini golden fixtures (copied from ai_monitor). Fixed by sanitizing test data.
- Test count observation: 624 tests is high for Phase 1. Golden file tests (151) are over-atomized — checking individual JSON fields as separate cases. Future tasks should brief subagents to write fewer, more meaningful tests. Test refactoring deferred.
- 624 tests passing across 23 test files, all quality gates green
- Committed as phase-boundary commit (f2999ed), cleanup commit (6547cde)

## 2026-04-13 — Phase 2 complete

- Context Assembly And Handoffs implemented: 6 tasks completed.
- Handoff data model and persistence implemented, including file snapshotting with SHA256 hashes and boundary checks.
- Parent-child run linking via `handoff_id` added.
- AGENTS.md memory health check built to track project context drift.
- Context pre-population completed, resolving memory, excerpts, and attached files.
- `buildHandoffPrompt` logic implemented for Claude, Codex, and Gemini adapters using provider-specific formatting.
- Resolved strict TypeScript linting and type-safety errors. All tests passing and quality gates green.

## 2026-04-13 — Phase 3 complete

- Server and Web UI implemented: Full browser-based workspace for multi-provider workflow.
- Split-pane workspace implemented according to REQ-007, supporting Source Run (left) and Dispatched Run/Composer (right) side-by-side.
- Context assembly UI enhanced: Operator can select excerpts from run output (with raw/rendered toggle) and attach project files.
- REST API completed and verified with automated tests in `src/server/__tests__/api-routes.test.ts`.
- WebSocket streaming implemented and verified with automated tests in `src/server/__tests__/websocket-streaming.test.ts`.
- Usage dashboard integrated into workspace sidebar for real-time quota monitoring.
- All validation gates (typecheck, lint, test, build:web) passing.
- 293 tests passing across 34 test files.

## 2026-04-13 — Planning contract tightened for external agents

- Updated `tasks.md` to make the completion contract explicit for all remaining work instead of assuming providers will infer repo standards from phase titles alone.
- Added a global definition of done for unfinished tasks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build:web` must pass before work is considered complete.
- Added phase-specific gating language for Phase 3 and Phase 4, including required automated coverage for API/WebSocket behavior and a rule that manual verification does not replace tests.
- Clarified that broken build warnings, contract mismatches, import-time side effects, and missing documentation updates block completion.
- Added an explicit planning principle: accurate code is the baseline, but the actual target is reliable, spec-faithful, maintainable end-to-end behavior that can survive handoff and future work without hidden assumptions.

## 2026-04-13 — Phase 3 finalized

- Closed the remaining Phase 3 workflow gaps after the initial browser/server pass: handoff preview is now a first-class server/UI flow instead of a documentation claim.
- Added structured handoff preview/build support on the server, including prompt preview generation, prompt size estimates, raw run log retrieval, and project-rooted file browsing.
- Persisted `prompt-preview.md` alongside each handoff so the generated dispatch prompt is auditable on disk.
- Reworked the browser workspace to support full-width source or dispatch views in addition to the split layout, matching the spec's pane-collapse behavior.
- Reworked run output review so excerpts are captured from raw stdout with byte offsets, while still allowing rendered Markdown review of the same run.
- Reworked the dispatch pane so selected excerpts, attached project files, operator notes, and AGENTS.md memory flow through structured handoff context instead of being stuffed into ad hoc prompt text.
- Expanded REST API coverage and kept WebSocket streaming coverage in place; the suite now passes at 296 tests across 34 files.
- Updated README/task state to match the actual shipped Phase 3 state rather than the earlier stale placeholders.

## 2026-04-14 — Phase 4 manual verification and UI integration

- Manually verified Phase 4 features in the web UI using Playwright automation.
- Discovered and fixed gaps in the frontend implementation of Phase 4 features:
  - Added "Filter" UI to the Project Timeline sidebar, enabling multi-select filtering by provider, role, and status.
  - Added "Export Markdown" button to the Run Detail view, connecting the backend export/redaction logic to the UI.
  - Updated `useRelay` hook to support the new filtering and export API calls.
- Enhanced real-time capabilities of the workbench:
  - Implemented `status_change` events in the WebSocket server and `RunEventBus`.
  - Updated the backend to emit status changes whenever a run transitions (e.g., from `running` to `succeeded`).
  - Updated the frontend to react instantly to these status changes, automatically switching from `RunOutput` to `RunDetail` view when a run completes.
  - Added a visual "Live" WebSocket status indicator (connected/connecting/disconnected) to the workbench header.
- Hardened the Usage Prober for production:
  - Fixed a critical bug where `ProbeOrchestrator` was throwing an error in production due to a missing default `PTYSession` factory.
  - Implemented an immediate initial probe in `orchestrator.start()`, ensuring usage snapshots are available right at startup.
  - Improved routing robustness: `getEffectiveRemaining` now defaults to 100% (instead of 0%) if a probe succeeds but the PTY output is too noisy to parse, ensuring workbench availability in constrained or unauthenticated environments.
- All manual verification steps passed: Filter UI works, Launch triggers real-time status updates, and Export Markdown button appears automatically on run completion.
- Project is now fully integrated and verified for v1.0 release.

## 2026-04-14 — Phase 4 Enhancements: GitHub Integration & Prober Hardening

- **GitHub CLI (Copilot) Integration**:
  - Integrated GitHub CLI as the 4th supported provider (`github` → `copilot` binary).
  - Implemented GitHub adapter with usage parsing from startup banners and premium request resets.
  - Added discovery support and handoff prompt building for the GitHub provider.
- **Robust PTY Probing (Exact ai_monitor Alignment)**:
  - Upgraded `PTYSession` to support `stopSubstrings` and flexible idle timeouts, mirroring the reliability of the `ai_monitor` project.
  - Implemented exact multi-stage probe sequences for all providers:
    - **Claude**: Warmup → `/usage` (with 7 stop substrings) → `/status`.
    - **Gemini**: Warmup → `/stats` (with 4 stop substrings).
    - **GitHub**: Warmup (banner) → Second capture (extra stats).
    - **Codex**: Warmup → `/status` (with 4 stop substrings).
  - Added comprehensive auto-responses for interactive prompts (e.g., Claude trust gates, plan usage menus) to prevent prober stalls.
- **Parser Upgrades**:
  - Rewrote usage parsers for Claude, Codex, Gemini, and GitHub for robust PTY noise handling.
  - Gemini parser is now case-insensitive and handles multiple output variants (e.g., "Usage remaining" vs "Session Stats").
  - Claude parser now handles "no-space" labels and "tight" percentages in condensed TUI output.
- **UI & Hook Enhancements**:
  - Upgraded `UsageDashboard` with "Collapsed" (status dots) and "Expanded" (detailed metrics) modes.
  - Updated `useRelay` hook to manage `isProbing` state and 2-minute auto-refresh polling.
  - Added immediate usage refresh on application load to ensure fresh data in the UI.
- **Validation**:
  - All lint errors (including `RegExp#exec`, optional chaining, and void arrow functions) fixed via `eslint --fix`.
  - All tests passing (316 tests), including updated expectations for new robust parsing results.

## 2026-04-14 — Phase 4 complete
...
- Search, Export, and Hardening implemented: 5 tasks completed.
- Implemented metadata-based run filtering by provider, task type, and status in `src/core/run-filter.ts`.
- Implemented Markdown workflow export with automated secret redaction in `src/core/export-markdown.ts`.
- Implemented concurrency control in `src/core/concurrency-control.ts` ensuring a maximum of 3 concurrent runs with queueing support.
- Added comprehensive integration test in `src/__tests__/integration/plan-handoff-implement.test.ts` covering the full Plan → Handoff → Implement workflow.
- Updated documentation in `README.md` to cover Installation (including `node-pty` native requirements), Configuration, and Known Limitations.
- Verified all quality gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` (316 tests passing), and `pnpm build:web` all pass.
- Project is now feature-complete for v1.0.

## 2026-04-13 — Added multi-agent load balancing note
...
- Added `AGENT-LOAD-BALANCING.md` to capture the process needed to spread work across multiple providers without lowering quality.
- Documented the control-plane hierarchy (`~/.agent/AGENTS.md` → `project.md` → `SPEC.md` → `tasks.md` → machine-enforced scripts/hooks).
- Captured recommended global-agent rules, repo-local files, validation-gate structure, definition-of-done template, and trust levels for low/medium/high-risk work.
