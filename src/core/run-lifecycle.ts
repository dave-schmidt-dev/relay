import type {
  Run,
  RunStatus,
  Event,
  EventKind,
  OperatorAction,
  ActionKind,
  Provider,
  TaskRole,
} from "./types.js";

/**
 * Parameters required to create a new run.
 * All fields except those with defaults must be supplied by the caller.
 */
export interface CreateRunParams {
  project_root: string;
  provider: Provider;
  role: TaskRole;
  command: string[];
  cwd: string;
  prompt_path: string;
  final_output_path: string;
  provider_version: string;
  memory_hash: string;
  estimated_tokens: number;
  parent_run_id?: string | null;
  handoff_id?: string | null;
}

/**
 * Optional details that may accompany a status transition.
 * Fields are applied selectively depending on the target status.
 */
export interface TransitionDetails {
  /** PID of the launched process (queued → running). */
  pid?: number | undefined;
  /** Exit code from the process (running → succeeded | failed). */
  exit_code?: number | undefined;
  /** Human-readable reason for an abnormal exit (running → failed | canceled). */
  exit_reason?: string | undefined;
}

/**
 * Valid state transitions, keyed by current status.
 * Each value is the set of statuses that may follow.
 */
const VALID_TRANSITIONS: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  queued: new Set<RunStatus>(["running", "canceled"]),
  running: new Set<RunStatus>(["succeeded", "failed", "canceled"]),
  succeeded: new Set<RunStatus>([]),
  failed: new Set<RunStatus>([]),
  canceled: new Set<RunStatus>([]),
};

/**
 * Creates a new run in "queued" status with a generated UUID.
 * All timestamp and pid fields are initialised to null.
 *
 * @param params - Required fields for the new run.
 * @returns A fully-populated Run in queued state.
 */
export function createRun(params: CreateRunParams): Run {
  return {
    run_id: crypto.randomUUID(),
    project_root: params.project_root,
    provider: params.provider,
    role: params.role,
    status: "queued",
    command: params.command,
    cwd: params.cwd,
    pid: null,
    parent_run_id: params.parent_run_id ?? null,
    handoff_id: params.handoff_id ?? null,
    prompt_path: params.prompt_path,
    final_output_path: params.final_output_path,
    provider_version: params.provider_version,
    started_at: null,
    ended_at: null,
    exit_code: null,
    exit_reason: null,
    memory_hash: params.memory_hash,
    estimated_tokens: params.estimated_tokens,
  };
}

/**
 * Validates and applies a status transition, returning an updated Run.
 * Throws if the transition is not permitted by the state machine.
 *
 * Transition side-effects:
 * - queued → running: sets started_at, applies pid from details
 * - running → succeeded: sets ended_at, exit_code = 0
 * - running → failed: sets ended_at, exit_code and exit_reason from details
 * - running → canceled: sets ended_at, exit_reason = details.exit_reason ?? "canceled"
 * - queued → canceled: sets exit_reason = "canceled"
 *
 * @param run - The current run.
 * @param newStatus - The target status.
 * @param details - Optional side-effect data (pid, exit_code, exit_reason).
 * @returns A new Run object with the transition applied.
 * @throws If the transition is invalid.
 */
export function transitionRun(run: Run, newStatus: RunStatus, details?: TransitionDetails): Run {
  const allowed = VALID_TRANSITIONS[run.status];
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid status transition: ${run.status} → ${newStatus}`);
  }

  const now = new Date().toISOString();

  // NOTE: "queued" is excluded from reachable transitions — the guard above
  // throws before we get here. Cast to Exclude so the switch is exhaustive.
  const target = newStatus as Exclude<RunStatus, "queued">;

  // Apply side-effects for each valid transition
  switch (target) {
    case "running":
      return {
        ...run,
        status: "running",
        started_at: now,
        pid: details?.pid ?? null,
      };

    case "succeeded":
      return {
        ...run,
        status: "succeeded",
        ended_at: now,
        exit_code: 0,
      };

    case "failed":
      return {
        ...run,
        status: "failed",
        ended_at: now,
        exit_code: details?.exit_code ?? null,
        exit_reason: details?.exit_reason ?? null,
      };

    case "canceled":
      return {
        ...run,
        status: "canceled",
        // Only set ended_at if the run was actually started
        ended_at: run.started_at !== null ? now : null,
        exit_reason: details?.exit_reason ?? "canceled",
      };

    default: {
      // Exhaustiveness check — TypeScript narrows target to never here
      const _exhaustive: never = target;
      throw new Error(`Unhandled status: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Creates an event factory with its own sequence counter.
 * Each call to the returned function increments the counter and produces an Event.
 *
 * @param initialSequence - Starting sequence number (defaults to 0).
 * @returns A factory function: (runId, kind, payload) → Event.
 *
 * @example
 * const makeEvent = createEventFactory();
 * const e1 = makeEvent("run-uuid", "stdout", "hello");
 * const e2 = makeEvent("run-uuid", "stderr", "warning");
 */
export function createEventFactory(
  initialSequence = 0,
): (runId: string, kind: EventKind, payload: string | Record<string, unknown>) => Event {
  let sequence = initialSequence;

  return function createEvent(
    runId: string,
    kind: EventKind,
    payload: string | Record<string, unknown>,
  ): Event {
    return {
      event_id: crypto.randomUUID(),
      run_id: runId,
      sequence_no: sequence++,
      ts: new Date().toISOString(),
      kind,
      payload,
    };
  };
}

/**
 * Creates an OperatorAction with a generated UUID and current timestamp.
 *
 * @param kind - The category of action being recorded.
 * @param runId - UUID of the run this action relates to, or null.
 * @param detail - Arbitrary structured detail for the action (defaults to {}).
 * @returns A fully-populated OperatorAction.
 */
export function createAction(
  kind: ActionKind,
  runId: string | null = null,
  detail: Record<string, unknown> = {},
): OperatorAction {
  return {
    action_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    kind,
    run_id: runId,
    detail,
  };
}
