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
