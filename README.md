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

**Pre-implementation.** Spec and task backlog are complete. See [SPEC.md](SPEC.md) and [tasks.md](tasks.md).

## Prerequisites

- macOS (Apple Silicon)
- Node.js 22 LTS
- Xcode CLI tools (for `node-pty` native compilation)
- At least one of: `claude`, `codex`, `gemini` CLIs installed and authenticated

## Architecture

- **Backend**: TypeScript on Node.js 22 LTS
- **Frontend**: React 19 + Vite SPA with shadcn/ui
- **Task execution**: Pipe-based headless subprocess (`child_process.spawn`)
- **Usage probing**: PTY sessions via `node-pty`
- **Storage**: File-based (runs/handoffs project-local under `.relay/`, usage data global under `~/.relay/usage/`)

## License

MIT
