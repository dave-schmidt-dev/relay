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
