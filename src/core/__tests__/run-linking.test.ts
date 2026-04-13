import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { persistNewRun, loadRun } from "../run-persistence.js";
import { createRun } from "../run-lifecycle.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-run-linking-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Run Linking", () => {
  it("persists and loads parent_run_id and handoff_id correctly", async () => {
    const parentRunId = "parent-run-123";
    const handoffId = "handoff-456";

    const run = createRun({
      project_root: tmpDir,
      provider: "claude",
      role: "implement",
      command: ["claude"],
      cwd: tmpDir,
      prompt_path: "/prompt.md",
      final_output_path: "/final.md",
      provider_version: "1.0",
      memory_hash: "abcd",
      estimated_tokens: 100,
      parent_run_id: parentRunId,
      handoff_id: handoffId,
    });

    await persistNewRun(tmpDir, run, "Test prompt");

    const loadedRun = await loadRun(tmpDir, run.run_id);

    expect(loadedRun.parent_run_id).toBe(parentRunId);
    expect(loadedRun.handoff_id).toBe(handoffId);
  });
});
