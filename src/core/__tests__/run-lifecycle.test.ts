import { describe, it, expect } from "vitest";
import { createRun, transitionRun, createEventFactory, createAction } from "../run-lifecycle.js";
import type { CreateRunParams } from "../run-lifecycle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/;

function minimalParams(overrides: Partial<CreateRunParams> = {}): CreateRunParams {
  return {
    project_root: "/projects/relay",
    provider: "claude",
    role: "implement",
    command: ["claude", "--dangerously-skip-permissions"],
    cwd: "/projects/relay",
    prompt_path: "/projects/relay/.relay/runs/prompt.md",
    final_output_path: "/projects/relay/.relay/runs/final.md",
    provider_version: "1.0.0",
    memory_hash: "abc123",
    estimated_tokens: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createRun
// ---------------------------------------------------------------------------

describe("createRun", () => {
  it("produces a run in queued status", () => {
    const run = createRun(minimalParams());
    expect(run.status).toBe("queued");
  });

  it("generates a valid UUID for run_id", () => {
    const run = createRun(minimalParams());
    expect(run.run_id).toMatch(UUID_RE);
  });

  it("sets all timestamp and pid fields to null", () => {
    const run = createRun(minimalParams());
    expect(run.started_at).toBeNull();
    expect(run.ended_at).toBeNull();
    expect(run.pid).toBeNull();
    expect(run.exit_code).toBeNull();
    expect(run.exit_reason).toBeNull();
  });

  it("sets optional relational fields to null when not provided", () => {
    const run = createRun(minimalParams());
    expect(run.parent_run_id).toBeNull();
    expect(run.handoff_id).toBeNull();
  });

  it("accepts optional parent_run_id and handoff_id", () => {
    const parent = createRun(minimalParams());
    const child = createRun(
      minimalParams({ parent_run_id: parent.run_id, handoff_id: "handoff-1" }),
    );
    expect(child.parent_run_id).toBe(parent.run_id);
    expect(child.handoff_id).toBe("handoff-1");
  });

  it("copies all required fields from params", () => {
    const params = minimalParams();
    const run = createRun(params);
    expect(run.project_root).toBe(params.project_root);
    expect(run.provider).toBe(params.provider);
    expect(run.role).toBe(params.role);
    expect(run.command).toEqual(params.command);
    expect(run.cwd).toBe(params.cwd);
    expect(run.prompt_path).toBe(params.prompt_path);
    expect(run.final_output_path).toBe(params.final_output_path);
    expect(run.provider_version).toBe(params.provider_version);
    expect(run.memory_hash).toBe(params.memory_hash);
    expect(run.estimated_tokens).toBe(params.estimated_tokens);
  });

  it("generates unique IDs for each call", () => {
    const a = createRun(minimalParams());
    const b = createRun(minimalParams());
    expect(a.run_id).not.toBe(b.run_id);
  });
});

// ---------------------------------------------------------------------------
// transitionRun — valid transitions
// ---------------------------------------------------------------------------

describe("transitionRun — valid transitions", () => {
  it("queued → running sets started_at and pid", () => {
    const run = createRun(minimalParams());
    const updated = transitionRun(run, "running", { pid: 12345 });
    expect(updated.status).toBe("running");
    expect(updated.started_at).toMatch(ISO_RE);
    expect(updated.pid).toBe(12345);
    expect(updated.ended_at).toBeNull();
  });

  it("queued → running without pid leaves pid null", () => {
    const run = createRun(minimalParams());
    const updated = transitionRun(run, "running");
    expect(updated.pid).toBeNull();
  });

  it("running → succeeded sets ended_at and exit_code = 0", () => {
    const queued = createRun(minimalParams());
    const running = transitionRun(queued, "running", { pid: 1 });
    const succeeded = transitionRun(running, "succeeded");
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.ended_at).toMatch(ISO_RE);
    expect(succeeded.exit_code).toBe(0);
    expect(succeeded.exit_reason).toBeNull();
  });

  it("running → failed sets ended_at, exit_code, and exit_reason", () => {
    const queued = createRun(minimalParams());
    const running = transitionRun(queued, "running", { pid: 2 });
    const failed = transitionRun(running, "failed", { exit_code: 1, exit_reason: "rate_limited" });
    expect(failed.status).toBe("failed");
    expect(failed.ended_at).toMatch(ISO_RE);
    expect(failed.exit_code).toBe(1);
    expect(failed.exit_reason).toBe("rate_limited");
  });

  it("running → canceled sets ended_at and default exit_reason", () => {
    const queued = createRun(minimalParams());
    const running = transitionRun(queued, "running", { pid: 3 });
    const canceled = transitionRun(running, "canceled");
    expect(canceled.status).toBe("canceled");
    expect(canceled.ended_at).toMatch(ISO_RE);
    expect(canceled.exit_reason).toBe("canceled");
  });

  it("running → canceled respects custom exit_reason", () => {
    const queued = createRun(minimalParams());
    const running = transitionRun(queued, "running", { pid: 4 });
    const canceled = transitionRun(running, "canceled", { exit_reason: "user_abort" });
    expect(canceled.exit_reason).toBe("user_abort");
  });

  it("queued → canceled (direct cancel before start)", () => {
    const run = createRun(minimalParams());
    const canceled = transitionRun(run, "canceled");
    expect(canceled.status).toBe("canceled");
    // ended_at must remain null — run never started
    expect(canceled.ended_at).toBeNull();
    expect(canceled.exit_reason).toBe("canceled");
  });

  it("transitionRun returns a new object (immutable)", () => {
    const run = createRun(minimalParams());
    const updated = transitionRun(run, "running");
    expect(updated).not.toBe(run);
    expect(run.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// transitionRun — invalid transitions
// ---------------------------------------------------------------------------

describe("transitionRun — invalid transitions", () => {
  it("succeeded → running throws", () => {
    const run = createRun(minimalParams());
    const running = transitionRun(run, "running");
    const succeeded = transitionRun(running, "succeeded");
    expect(() => transitionRun(succeeded, "running")).toThrow(/succeeded → running/);
  });

  it("succeeded → failed throws", () => {
    const run = createRun(minimalParams());
    const running = transitionRun(run, "running");
    const succeeded = transitionRun(running, "succeeded");
    expect(() => transitionRun(succeeded, "failed")).toThrow(/succeeded → failed/);
  });

  it("failed → queued throws", () => {
    const run = createRun(minimalParams());
    const running = transitionRun(run, "running");
    const failed = transitionRun(running, "failed", { exit_code: 1 });
    expect(() => transitionRun(failed, "queued" as never)).toThrow(/failed → queued/);
  });

  it("canceled → running throws", () => {
    const run = createRun(minimalParams());
    const canceled = transitionRun(run, "canceled");
    expect(() => transitionRun(canceled, "running")).toThrow(/canceled → running/);
  });

  it("queued → succeeded throws (skip running)", () => {
    const run = createRun(minimalParams());
    expect(() => transitionRun(run, "succeeded")).toThrow(/queued → succeeded/);
  });

  it("queued → failed throws (skip running)", () => {
    const run = createRun(minimalParams());
    expect(() => transitionRun(run, "failed")).toThrow(/queued → failed/);
  });

  it("running → queued throws", () => {
    const run = createRun(minimalParams());
    const running = transitionRun(run, "running");
    expect(() => transitionRun(running, "queued" as never)).toThrow(/running → queued/);
  });
});

// ---------------------------------------------------------------------------
// createEventFactory / createEvent
// ---------------------------------------------------------------------------

describe("createEventFactory", () => {
  it("produces events with incrementing sequence_no starting at 0", () => {
    const makeEvent = createEventFactory();
    const e1 = makeEvent("run-1", "stdout", "line 1");
    const e2 = makeEvent("run-1", "stderr", "line 2");
    const e3 = makeEvent("run-1", "status_change", { status: "running" });
    expect(e1.sequence_no).toBe(0);
    expect(e2.sequence_no).toBe(1);
    expect(e3.sequence_no).toBe(2);
  });

  it("accepts a custom initial sequence", () => {
    const makeEvent = createEventFactory(10);
    const e = makeEvent("run-1", "stdout", "hello");
    expect(e.sequence_no).toBe(10);
  });

  it("produces events with valid UUID event_id", () => {
    const makeEvent = createEventFactory();
    const e = makeEvent("run-1", "stdout", "hello");
    expect(e.event_id).toMatch(UUID_RE);
  });

  it("sets run_id, kind, and payload correctly", () => {
    const makeEvent = createEventFactory();
    const e = makeEvent("run-abc", "artifact", { path: "/tmp/out.md" });
    expect(e.run_id).toBe("run-abc");
    expect(e.kind).toBe("artifact");
    expect(e.payload).toEqual({ path: "/tmp/out.md" });
  });

  it("timestamps are ISO format", () => {
    const makeEvent = createEventFactory();
    const e = makeEvent("run-1", "stdout", "hello");
    expect(e.ts).toMatch(ISO_RE);
  });

  it("two factories have independent counters", () => {
    const makeA = createEventFactory();
    const makeB = createEventFactory();
    makeA("r", "stdout", "1");
    makeA("r", "stdout", "2");
    const bFirst = makeB("r", "stdout", "b1");
    expect(bFirst.sequence_no).toBe(0);
  });

  it("generates unique event_ids across calls", () => {
    const makeEvent = createEventFactory();
    const e1 = makeEvent("run-1", "stdout", "a");
    const e2 = makeEvent("run-1", "stdout", "b");
    expect(e1.event_id).not.toBe(e2.event_id);
  });
});

// ---------------------------------------------------------------------------
// createAction
// ---------------------------------------------------------------------------

describe("createAction", () => {
  it("produces a valid action with generated UUID", () => {
    const action = createAction("run_launched", "run-1", { provider: "claude" });
    expect(action.action_id).toMatch(UUID_RE);
    expect(action.kind).toBe("run_launched");
    expect(action.run_id).toBe("run-1");
    expect(action.detail).toEqual({ provider: "claude" });
  });

  it("timestamp is ISO format", () => {
    const action = createAction("note_added");
    expect(action.ts).toMatch(ISO_RE);
  });

  it("run_id defaults to null", () => {
    const action = createAction("export_created");
    expect(action.run_id).toBeNull();
  });

  it("detail defaults to empty object", () => {
    const action = createAction("usage_adjusted");
    expect(action.detail).toEqual({});
  });

  it("generates unique action_ids", () => {
    const a = createAction("run_canceled", "run-1");
    const b = createAction("run_canceled", "run-1");
    expect(a.action_id).not.toBe(b.action_id);
  });

  it("accepts all ActionKind values", () => {
    const kinds = [
      "run_launched",
      "run_canceled",
      "handoff_created",
      "export_created",
      "usage_adjusted",
      "note_added",
    ] as const;
    for (const kind of kinds) {
      const action = createAction(kind);
      expect(action.kind).toBe(kind);
    }
  });
});
