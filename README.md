# Relay

Usage-aware AI workbench that distributes work across Claude, Codex, and Gemini CLI subscriptions for balanced depletion.

## What It Does

Relay is a browser-based workspace that tracks your AI subscription usage in real-time and suggests the best provider for each task. Instead of burning through Claude and leaving Codex and Gemini idle, Relay distributes planning, implementation, review, and research tasks across all three providers based on remaining capacity.

## Core Workflow

1. Open a project in Relay (`relay serve --project .`)
2. See your usage dashboard — Claude at 60%, Codex at 10%, Gemini at 5%
3. Compose a planning task — Relay suggests a provider based on task type + remaining usage
4. Review the plan output, select context, dispatch subtasks to other providers
5. Watch results side-by-side in a split-pane workspace
6. End each week with all subscriptions near zero

## Key Features

- **Usage probing**: Real-time usage data from provider CLIs via PTY sessions (ported from [ai_monitor](https://github.com/dave-schmidt-dev/ai_monitor))
- **Smart routing**: Proportional capacity-weighted routing with per-task-type provider affinity
- **Context handoff**: Select excerpts, attach files, preview generated prompts before dispatch
- **Split-pane workspace**: Watch source and dispatched runs side by side
- **Audit trail**: Every run, handoff, and operator action is persisted locally
- **Markdown export**: Workflow summaries readable in Obsidian

## Supported Providers

| Provider | Strengths | CLI |
|----------|-----------|-----|
| Claude (Opus 4.6) | Planning, orchestration | `claude -p` |
| Codex (GPT-5.4) | Implementation, review | `codex exec` |
| Gemini (3.1 Pro) | Research, summarization, large context | `gemini -p` |

## Status

**Phase 3 complete.** Core engine, context assembly, server API, and browser workspace are implemented. Phase 4 hardening, export, and filtering remain.

### What's Built

- **Storage**: `.relay/` directory initialization, config loading, run persistence
- **Run lifecycle**: State machine (queued → running → succeeded/failed/canceled), subprocess runner with pipe stdio and env allowlist
- **Provider adapters**: Claude, Codex, Gemini — command templates, output parsers, exit code maps, rate-limit detection, handoff prompt generation
- **Usage probing**: ANSI stripping, persistent PTY sessions via node-pty, per-provider parsers (Claude `/usage`, Codex `/status`, Gemini `/stats`), probe orchestrator with caching and stale detection
- **Routing**: Task classifier (keyword/pattern heuristics), usage-aware provider router with affinity rankings and capacity weighting
- **Context Assembly & Handoffs**: File snapshotting, context pre-population, AGENTS.md memory health checks, handoff persistence, and provider-specific prompt formatting
- **Server & Workspace**: REST API, WebSocket run streaming, split-pane source/dispatch workspace, raw/rendered output toggle, handoff preview, project file browser
- **Safety**: Secret redaction (API key patterns, blocked file attachments), cancellation (SIGTERM → SIGKILL), orphan detection on startup

### Test Coverage

296 tests across 34 test files. All pass in about 10-11 seconds.

## Installation

Relay requires a macOS Apple Silicon environment due to its native `node-pty` dependency for usage probing.

**Prerequisites:**
- macOS (Apple Silicon)
- Node.js 22 LTS
- [pnpm](https://pnpm.io/installation) (v10+)
- Xcode CLI tools (`xcode-select --install`) for `node-pty` native compilation
- At least one of: `claude`, `codex`, `gemini` CLIs installed and authenticated

**Setup:**
```bash
git clone https://github.com/dave-schmidt-dev/relay.git
cd relay
pnpm install

# Verify the build and tests
pnpm test        # Run the test suite
pnpm lint        # Run ESLint
pnpm typecheck   # Run TypeScript type checking
pnpm build:web   # Build the production SPA
```

## Configuration

Relay's configuration is managed at the project level in `.relay/config.json`, which is initialized when you run Relay in a project directory for the first time.

- **Provider Affinity**: You can configure default provider rankings per task type (`plan`, `implement`, `review`, `research`).
- **Probe Interval**: The interval at which Relay probes provider CLIs for usage data (default is 120 seconds).
- **Environment Allowlist**: By default, Relay restricts the environment variables passed to provider subprocesses to protect secrets. You can configure which variables are inherited.
- **Gemini Probe Method**: Gemini `/stats` PTY is the default usage probe. An internal Node.js module probe is available behind an experimental `probe_method=internal` flag.

## Known Limitations

Relay v1 is tailored for a specific solo-operator workflow:

- **CLI Execution Only**: Relay does not make direct API calls. All execution routes through existing CLI subscriptions (`claude`, `codex`, `gemini`). Other providers (e.g., Cursor, Copilot) are not supported.
- **Headless Execution**: Provider subprocesses are launched in headless pipe mode. There is no mid-run interaction, so prompts requiring interactive confirmations will fail or timeout. PTY is strictly used for background usage probing.
- **Single User & Local Storage**: No multi-user collaboration, cloud sync, or hosted deployment. Storage is entirely file-based (project data in `.relay/`, global usage data in `~/.relay/usage/`).
- **Dynamic Quotas**: Relay does not attempt to deduce token usage between probes. Usage data updates exclusively via the background probing engine.
- **No Autonomous Git**: Relay does not perform autonomous git operations.

## Architecture

- **Backend**: TypeScript on Node.js 22 LTS
- **Frontend**: React 19 + Vite SPA with shadcn/ui (Phase 3)
- **Task execution**: Pipe-based headless subprocess (`child_process.spawn`)
- **Usage probing**: PTY sessions via `node-pty`
- **Storage**: File-based (runs/handoffs project-local under `.relay/`, usage data global under `~/.relay/usage/`)

## Project Layout

```
src/
  core/           # Storage, run lifecycle, persistence, routing, classification, redaction
  adapters/       # Claude, Codex, Gemini adapters + provider discovery
  prober/         # ANSI stripping, PTY sessions, probe parsers, orchestrator
  server/         # HTTP + WebSocket server (Phase 3)
  web/            # React SPA (Phase 3)
fixtures/         # Golden files for CLI output contracts
```

## License

MIT
