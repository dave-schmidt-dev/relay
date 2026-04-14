import { describe, it, expect } from "vitest";
import { filterRuns } from "../run-filter.js";
import { Run } from "../types.js";

describe("filterRuns", () => {
  const createMockRun = (overrides: Partial<Run>): Run => ({
    run_id: "test-run-id",
    project_root: "/test/project",
    provider: "claude",
    role: "implement",
    status: "succeeded",
    command: ["claude", "do", "something"],
    cwd: "/test/project",
    pid: null,
    parent_run_id: null,
    handoff_id: null,
    prompt_path: "/test/prompt.txt",
    final_output_path: "/test/output.txt",
    provider_version: "1.0.0",
    started_at: "2024-01-01T00:00:00Z",
    ended_at: "2024-01-01T00:01:00Z",
    exit_code: 0,
    exit_reason: null,
    memory_hash: "hash",
    estimated_tokens: 100,
    ...overrides,
  });

  const runs: Run[] = [
    createMockRun({
      run_id: "1",
      provider: "claude",
      role: "plan",
      status: "succeeded",
      project_root: "/project/a",
    }),
    createMockRun({
      run_id: "2",
      provider: "codex",
      role: "implement",
      status: "failed",
      project_root: "/project/a",
    }),
    createMockRun({
      run_id: "3",
      provider: "gemini",
      role: "review",
      status: "running",
      project_root: "/project/b",
    }),
    createMockRun({
      run_id: "4",
      provider: "claude",
      role: "implement",
      status: "queued",
      project_root: "/project/a",
    }),
  ];

  it("returns all runs when no criteria are provided", () => {
    const result = filterRuns(runs, {});
    expect(result).toHaveLength(4);
  });

  it("filters by project_root", () => {
    const result = filterRuns(runs, { project_root: "/project/a" });
    expect(result).toHaveLength(3);
    expect(result.map((r: Run) => r.run_id)).toEqual(["1", "2", "4"]);
  });

  it("filters by single provider", () => {
    const result = filterRuns(runs, { provider: "claude" });
    expect(result).toHaveLength(2);
    expect(result.map((r: Run) => r.run_id)).toEqual(["1", "4"]);
  });

  it("filters by multiple providers", () => {
    const result = filterRuns(runs, { provider: ["claude", "codex"] });
    expect(result).toHaveLength(3);
    expect(result.map((r: Run) => r.run_id)).toEqual(["1", "2", "4"]);
  });

  it("filters by single role", () => {
    const result = filterRuns(runs, { role: "implement" });
    expect(result).toHaveLength(2);
    expect(result.map((r: Run) => r.run_id)).toEqual(["2", "4"]);
  });

  it("filters by multiple roles", () => {
    const result = filterRuns(runs, { role: ["plan", "review"] });
    expect(result).toHaveLength(2);
    expect(result.map((r: Run) => r.run_id)).toEqual(["1", "3"]);
  });

  it("filters by single status", () => {
    const result = filterRuns(runs, { status: "succeeded" });
    expect(result).toHaveLength(1);
    expect(result[0]?.run_id).toBe("1");
  });

  it("filters by multiple statuses", () => {
    const result = filterRuns(runs, { status: ["failed", "running"] });
    expect(result).toHaveLength(2);
    expect(result.map((r: Run) => r.run_id)).toEqual(["2", "3"]);
  });

  it("filters by multiple criteria (AND logic)", () => {
    const result = filterRuns(runs, {
      project_root: "/project/a",
      provider: "claude",
      role: "implement",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.run_id).toBe("4");
  });

  it("returns empty array when no runs match criteria", () => {
    const result = filterRuns(runs, {
      provider: "gemini",
      status: "succeeded",
    });
    expect(result).toHaveLength(0);
  });
});
