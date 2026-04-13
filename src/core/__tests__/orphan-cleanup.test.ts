import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { cleanupOrphans } from "../orphan-cleanup.js";
import type { Run } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A PID this large is guaranteed to not exist on any normal system.
const DEAD_PID = 999_999_999;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Run shape with caller-supplied overrides. */
function makeRun(overrides: Partial<Run>): Run {
  return {
    run_id: crypto.randomUUID(),
    project_root: "/tmp/fake",
    provider: "claude",
    role: "implement",
    status: "running",
    command: ["claude", "--dangerously-skip-permissions"],
    cwd: "/tmp/fake",
    pid: DEAD_PID,
    parent_run_id: null,
    handoff_id: null,
    prompt_path: "/tmp/fake/.relay/runs/prompt.md",
    final_output_path: "/tmp/fake/.relay/runs/final.md",
    provider_version: "1.2.3",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    exit_reason: null,
    memory_hash: "deadbeef",
    estimated_tokens: 500,
    ...overrides,
  };
}

/**
 * Write a run.json file directly into the tmp directory tree, bypassing
 * persistNewRun so tests can fabricate arbitrary states without needing
 * a full project setup.
 */
async function writeRunJson(tmpDir: string, run: Run): Promise<void> {
  const runDir = path.join(tmpDir, ".relay", "runs", run.run_id);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(run, null, 2), "utf-8");
}

/** Read run.json back from disk. */
async function readRunJson(tmpDir: string, runId: string): Promise<Run> {
  const raw = await fs.readFile(path.join(tmpDir, ".relay", "runs", runId, "run.json"), "utf-8");
  return JSON.parse(raw) as Run;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-orphan-test-"));
  await fs.mkdir(path.join(tmpDir, ".relay", "runs"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanupOrphans", () => {
  it("returns empty array when no runs exist and when .relay/runs/ does not exist", async () => {
    expect(await cleanupOrphans(tmpDir)).toEqual([]);

    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-bare-"));
    try {
      expect(await cleanupOrphans(bareDir)).toEqual([]);
    } finally {
      await fs.rm(bareDir, { recursive: true, force: true });
    }
  });

  it("detects orphaned run with dead PID, marks it failed with exit_reason 'orphaned', and sets ended_at", async () => {
    const run = makeRun({ pid: DEAD_PID });
    await writeRunJson(tmpDir, run);

    const orphans = await cleanupOrphans(tmpDir);
    expect(orphans).toEqual([run.run_id]);

    const updated = await readRunJson(tmpDir, run.run_id);
    expect(updated.status).toBe("failed");
    expect(updated.exit_reason).toBe("orphaned");
    expect(updated.ended_at).not.toBeNull();
  });

  it("handles a running run with null PID as orphaned", async () => {
    const run = makeRun({ pid: null });
    await writeRunJson(tmpDir, run);

    const orphans = await cleanupOrphans(tmpDir);
    expect(orphans).toEqual([run.run_id]);

    const updated = await readRunJson(tmpDir, run.run_id);
    expect(updated.status).toBe("failed");
    expect(updated.exit_reason).toBe("orphaned");
  });

  it("skips runs in all terminal states (succeeded, failed, canceled, queued)", async () => {
    const succeeded = makeRun({
      status: "succeeded",
      ended_at: new Date().toISOString(),
      exit_code: 0,
    });
    const failed = makeRun({
      status: "failed",
      ended_at: new Date().toISOString(),
      exit_code: 1,
      exit_reason: "rate_limited",
    });
    const canceled = makeRun({
      status: "canceled",
      ended_at: new Date().toISOString(),
      exit_reason: "canceled",
    });
    const queued = makeRun({ status: "queued", pid: null, started_at: null });

    await writeRunJson(tmpDir, succeeded);
    await writeRunJson(tmpDir, failed);
    await writeRunJson(tmpDir, canceled);
    await writeRunJson(tmpDir, queued);

    const orphans = await cleanupOrphans(tmpDir);
    expect(orphans).toEqual([]);

    expect((await readRunJson(tmpDir, succeeded.run_id)).status).toBe("succeeded");
    expect((await readRunJson(tmpDir, failed.run_id)).exit_reason).toBe("rate_limited");
    expect((await readRunJson(tmpDir, canceled.run_id)).status).toBe("canceled");
    expect((await readRunJson(tmpDir, queued.run_id)).status).toBe("queued");
  });

  it("cleans up multiple orphaned runs", async () => {
    const run1 = makeRun({ pid: DEAD_PID });
    const run2 = makeRun({ pid: DEAD_PID });
    const run3 = makeRun({ pid: DEAD_PID });
    await writeRunJson(tmpDir, run1);
    await writeRunJson(tmpDir, run2);
    await writeRunJson(tmpDir, run3);

    const orphans = await cleanupOrphans(tmpDir);
    expect(orphans.sort()).toEqual([run1.run_id, run2.run_id, run3.run_id].sort());

    for (const run of [run1, run2, run3]) {
      const updated = await readRunJson(tmpDir, run.run_id);
      expect(updated.status).toBe("failed");
      expect(updated.exit_reason).toBe("orphaned");
    }
  });

  it("only orphans the dead-PID run when mixed with non-running runs", async () => {
    const orphan = makeRun({ pid: DEAD_PID });
    const succeeded = makeRun({
      status: "succeeded",
      ended_at: new Date().toISOString(),
      exit_code: 0,
    });
    const queued = makeRun({ status: "queued", pid: null, started_at: null });

    await writeRunJson(tmpDir, orphan);
    await writeRunJson(tmpDir, succeeded);
    await writeRunJson(tmpDir, queued);

    const orphans = await cleanupOrphans(tmpDir);
    expect(orphans).toEqual([orphan.run_id]);

    expect((await readRunJson(tmpDir, orphan.run_id)).status).toBe("failed");
    expect((await readRunJson(tmpDir, succeeded.run_id)).status).toBe("succeeded");
    expect((await readRunJson(tmpDir, queued.run_id)).status).toBe("queued");
  });
});
