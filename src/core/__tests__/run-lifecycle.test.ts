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
  it("creates a queued run with valid UUID and ISO timestamps", () => {
    const run = createRun(minimalParams());
    expect(run.status).toBe("queued");
    expect(run.run_id).toMatch(UUID_RE);
    expect(run.started_at).toBeNull();
    expect(run.ended_at).toBeNull();
    expect(run.pid).toBeNull();
    expect(run.exit_code).toBeNull();
    expect(run.exit_reason).toBeNull();
  });

  it("sets optional relational fields", () => {
    const run = createRun(minimalParams());
    expect(run.parent_run_id).toBeNull();
    expect(run.handoff_id).toBeNull();

    const parent = createRun(minimalParams());
    const child = createRun(
      minimalParams({ parent_run_id: parent.run_id, handoff_id: "handoff-1" }),
    );
    expect(child.parent_run_id).toBe(parent.run_id);
    expect(child.handoff_id).toBe("handoff-1");
  });

  it("copies required fields and generates unique IDs", () => {
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

    const b = createRun(minimalParams());
    expect(run.run_id).not.toBe(b.run_id);
  });
});

// ---------------------------------------------------------------------------
// transitionRun — valid transitions
// ---------------------------------------------------------------------------

describe("transitionRun — valid transitions", () => {
  it("queued → running sets started_at, pid, optional pid=null", () => {
    const run = createRun(minimalParams());
    const updated = transitionRun(run, "running", { pid: 12345 });
    expect(updated.status).toBe("running");
    expect(updated.started_at).toMatch(ISO_RE);
    expect(updated.pid).toBe(12345);
    expect(updated.ended_at).toBeNull();

    const noPid = transitionRun(createRun(minimalParams()), "running");
    expect(noPid.pid).toBeNull();
  });

  it("running → succeeded sets ended_at, exit_code=0", () => {
    const queued = createRun(minimalParams());
    const running = transitionRun(queued, "running", { pid: 1 });
    const succeeded = transitionRun(running, "succeeded");
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.ended_at).toMatch(ISO_RE);
    expect(succeeded.exit_code).toBe(0);
    expect(succeeded.exit_reason).toBeNull();
  });

  it("running → failed/canceled sets ended_at, exit codes, and reasons", () => {
    const r1 = transitionRun(
      transitionRun(createRun(minimalParams()), "running", { pid: 2 }),
      "failed",
      {
        exit_code: 1,
        exit_reason: "rate_limited",
      },
    );
    expect(r1.status).toBe("failed");
    expect(r1.ended_at).toMatch(ISO_RE);
    expect(r1.exit_code).toBe(1);
    expect(r1.exit_reason).toBe("rate_limited");

    const r2 = transitionRun(
      transitionRun(createRun(minimalParams()), "running", { pid: 3 }),
      "canceled",
    );
    expect(r2.status).toBe("canceled");
    expect(r2.ended_at).toMatch(ISO_RE);
    expect(r2.exit_reason).toBe("canceled");

    const r3 = transitionRun(
      transitionRun(createRun(minimalParams()), "running", { pid: 4 }),
      "canceled",
      {
        exit_reason: "user_abort",
      },
    );
    expect(r3.exit_reason).toBe("user_abort");
  });

  it("queued → canceled and immutability", () => {
    const run = createRun(minimalParams());
    const canceled = transitionRun(run, "canceled");
    expect(canceled.status).toBe("canceled");
    // ended_at must remain null — run never started
    expect(canceled.ended_at).toBeNull();
    expect(canceled.exit_reason).toBe("canceled");

    // Returns a new object (immutable)
    const updated = transitionRun(run, "running");
    expect(updated).not.toBe(run);
    expect(run.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// transitionRun — invalid transitions
// ---------------------------------------------------------------------------

describe("transitionRun — invalid transitions", () => {
  it("terminal states cannot transition", () => {
    const running = transitionRun(createRun(minimalParams()), "running");
    const succeeded = transitionRun(running, "succeeded");
    expect(() => transitionRun(succeeded, "running")).toThrow(/succeeded → running/);
    expect(() => transitionRun(succeeded, "failed")).toThrow(/succeeded → failed/);

    const failed = transitionRun(transitionRun(createRun(minimalParams()), "running"), "failed", {
      exit_code: 1,
    });
    expect(() => transitionRun(failed, "queued" as never)).toThrow(/failed → queued/);

    const canceled = transitionRun(createRun(minimalParams()), "canceled");
    expect(() => transitionRun(canceled, "running")).toThrow(/canceled → running/);
  });

  it("cannot skip states", () => {
    const queued = createRun(minimalParams());
    expect(() => transitionRun(queued, "succeeded")).toThrow(/queued → succeeded/);
    expect(() => transitionRun(queued, "failed")).toThrow(/queued → failed/);

    const running = transitionRun(createRun(minimalParams()), "running");
    expect(() => transitionRun(running, "queued" as never)).toThrow(/running → queued/);
  });
});

// ---------------------------------------------------------------------------
// createEventFactory / createEvent
// ---------------------------------------------------------------------------

describe("createEventFactory", () => {
  it("incrementing sequence and custom initial", () => {
    const makeEvent = createEventFactory();
    const e1 = makeEvent("run-1", "stdout", "line 1");
    const e2 = makeEvent("run-1", "stderr", "line 2");
    const e3 = makeEvent("run-1", "status_change", { status: "running" });
    expect(e1.sequence_no).toBe(0);
    expect(e2.sequence_no).toBe(1);
    expect(e3.sequence_no).toBe(2);

    const makeCustom = createEventFactory(10);
    expect(makeCustom("run-1", "stdout", "hello").sequence_no).toBe(10);
  });

  it("event structure: UUID, run_id, kind, payload, ISO timestamp", () => {
    const makeEvent = createEventFactory();
    const e = makeEvent("run-abc", "artifact", { path: "/tmp/out.md" });
    expect(e.event_id).toMatch(UUID_RE);
    expect(e.run_id).toBe("run-abc");
    expect(e.kind).toBe("artifact");
    expect(e.payload).toEqual({ path: "/tmp/out.md" });
    expect(e.ts).toMatch(ISO_RE);
  });

  it("independent factories and unique IDs", () => {
    const makeA = createEventFactory();
    const makeB = createEventFactory();
    makeA("r", "stdout", "1");
    makeA("r", "stdout", "2");
    const bFirst = makeB("r", "stdout", "b1");
    expect(bFirst.sequence_no).toBe(0);

    const e1 = makeA("run-1", "stdout", "a");
    const e2 = makeA("run-1", "stdout", "b");
    expect(e1.event_id).not.toBe(e2.event_id);
  });
});

// ---------------------------------------------------------------------------
// createAction
// ---------------------------------------------------------------------------

describe("createAction", () => {
  it("produces valid action with all fields", () => {
    const action = createAction("run_launched", "run-1", { provider: "claude" });
    expect(action.action_id).toMatch(UUID_RE);
    expect(action.kind).toBe("run_launched");
    expect(action.run_id).toBe("run-1");
    expect(action.detail).toEqual({ provider: "claude" });
    expect(action.ts).toMatch(ISO_RE);
  });

  it("defaults and unique IDs", () => {
    const noRunId = createAction("export_created");
    expect(noRunId.run_id).toBeNull();

    const noDetail = createAction("usage_adjusted");
    expect(noDetail.detail).toEqual({});

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
