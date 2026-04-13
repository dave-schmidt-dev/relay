/**
 * Provider type — which AI CLI agent is running.
 */
export type Provider = "claude" | "codex" | "gemini";

/**
 * Task role the run is fulfilling.
 */
export type TaskRole = "plan" | "implement" | "review" | "research" | "custom";

/**
 * Lifecycle state of a run.
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

/**
 * Kind of event emitted during a run.
 */
export type EventKind = "stdout" | "stderr" | "status_change" | "artifact";

/**
 * Kind of operator action recorded in the audit log.
 */
export type ActionKind =
  | "run_launched"
  | "run_canceled"
  | "handoff_created"
  | "export_created"
  | "usage_adjusted"
  | "note_added";

/**
 * A single run of an AI agent command, tracked through its full lifecycle.
 */
export interface Run {
  /** UUID identifying this run. */
  run_id: string;
  /** Absolute path to the project root. */
  project_root: string;
  /** AI provider executing this run. */
  provider: Provider;
  /** Role this run is fulfilling in the workflow. */
  role: TaskRole;
  /** Current lifecycle state. */
  status: RunStatus;
  /** Full argv passed to the provider CLI. */
  command: string[];
  /** Working directory for the run process. */
  cwd: string;
  /** OS process ID while the run is active; null otherwise. */
  pid: number | null;
  /** UUID of the run that spawned this one, or null for top-level runs. */
  parent_run_id: string | null;
  /** UUID of the associated handoff, if any. */
  handoff_id: string | null;
  /** Path to the prompt file given to the agent. */
  prompt_path: string;
  /** Path where the agent's final output is written. */
  final_output_path: string;
  /** Version string of the provider binary. */
  provider_version: string;
  /** ISO 8601 timestamp when execution started; null until the run begins. */
  started_at: string | null;
  /** ISO 8601 timestamp when execution ended; null until the run terminates. */
  ended_at: string | null;
  /** Exit code from the provider process; null while running or queued. */
  exit_code: number | null;
  /** Human-readable reason for abnormal exit (e.g. "orphaned", "rate_limited", "timeout"). */
  exit_reason: string | null;
  /** SHA-256 hash of AGENTS.md at launch time, for memory-drift detection. */
  memory_hash: string;
  /** Estimated token consumption for the run. */
  estimated_tokens: number;
}

/**
 * A discrete event emitted during a run (stdout line, status change, artifact, etc.).
 */
export interface Event {
  /** UUID identifying this event. */
  event_id: string;
  /** UUID of the run this event belongs to. */
  run_id: string;
  /** Monotonically increasing position within the run's event stream. */
  sequence_no: number;
  /** ISO 8601 timestamp when the event occurred. */
  ts: string;
  /** Category of event. */
  kind: EventKind;
  /** Raw text for stdout/stderr events; structured data for others. */
  payload: string | Record<string, unknown>;
}

/**
 * An action taken by the operator, recorded in the audit log.
 */
export interface OperatorAction {
  /** UUID identifying this action. */
  action_id: string;
  /** ISO 8601 timestamp when the action was taken. */
  ts: string;
  /** Category of action. */
  kind: ActionKind;
  /** UUID of the run this action relates to, or null for non-run actions. */
  run_id: string | null;
  /** Arbitrary structured detail for the action. */
  detail: Record<string, unknown>;
}
