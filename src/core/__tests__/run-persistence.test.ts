import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  persistNewRun,
  updateRunMetadata,
  appendEvent,
  appendStdout,
  appendStderr,
  writeFinalOutput,
  loadRun,
  listRunIds,
} from "../run-persistence.js";
import { createRun, createEventFactory } from "../run-lifecycle.js";
import type { Run } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return createRun({
    project_root: "/tmp/fake",
    provider: "claude",
    role: "implement",
    command: ["claude", "--dangerously-skip-permissions"],
    cwd: "/tmp/fake",
    prompt_path: "/tmp/fake/.relay/runs/prompt.md",
    final_output_path: "/tmp/fake/.relay/runs/final.md",
    provider_version: "1.2.3",
    memory_hash: "deadbeef",
    estimated_tokens: 500,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-persist-test-"));
  // Pre-create the .relay/runs/ tree so tests match real initProjectStorage behaviour
  await fs.mkdir(path.join(tmpDir, ".relay", "runs"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// persistNewRun
// ---------------------------------------------------------------------------

describe("persistNewRun", () => {
  it("creates directory and all required files (run.json, events.jsonl, stdout.log, stderr.log, prompt.md)", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# My prompt\nDo the thing.");

    const stat = await fs.stat(path.join(tmpDir, ".relay", "runs", run.run_id));
    expect(stat.isDirectory()).toBe(true);

    const jsonStat = await fs.stat(path.join(tmpDir, ".relay", "runs", run.run_id, "run.json"));
    expect(jsonStat.isFile()).toBe(true);

    const eventsContent = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "events.jsonl"),
      "utf-8",
    );
    expect(eventsContent).toBe("");

    const stdoutContent = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stdout.log"),
      "utf-8",
    );
    expect(stdoutContent).toBe("");

    const stderrContent = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stderr.log"),
      "utf-8",
    );
    expect(stderrContent).toBe("");

    const promptContent = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "prompt.md"),
      "utf-8",
    );
    expect(promptContent).toBe("# My prompt\nDo the thing.");
  });

  it("returns the correct absolute path to the run directory", async () => {
    const run = makeRun();
    const dir = await persistNewRun(tmpDir, run, "# Prompt");
    expect(dir).toBe(path.join(tmpDir, ".relay", "runs", run.run_id));
  });
});

// ---------------------------------------------------------------------------
// run.json content
// ---------------------------------------------------------------------------

describe("run.json content", () => {
  it("contains valid Run data that round-trips correctly", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");
    const raw = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "run.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Run;
    expect(parsed.run_id).toBe(run.run_id);
    expect(parsed.provider).toBe("claude");
    expect(parsed.status).toBe("queued");
    expect(parsed.role).toBe("implement");
    expect(parsed.estimated_tokens).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// updateRunMetadata
// ---------------------------------------------------------------------------

describe("updateRunMetadata", () => {
  it("overwrites run.json with updated status", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    const updated: Run = {
      ...run,
      status: "running",
      started_at: new Date().toISOString(),
      pid: 42,
    };
    await updateRunMetadata(tmpDir, updated);

    const raw = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "run.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Run;
    expect(parsed.status).toBe("running");
    expect(parsed.pid).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

describe("appendEvent", () => {
  it("appends a single event and multiple events as separate JSONL lines", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");
    const makeEvent = createEventFactory();

    // Single event
    const event = makeEvent(run.run_id, "stdout", "hello");
    await appendEvent(tmpDir, run.run_id, event);
    const afterOne = await fs.readFile(eventsFilePath(run.run_id), "utf-8");
    const linesAfterOne = afterOne.trim().split("\n");
    expect(linesAfterOne).toHaveLength(1);
    expect(JSON.parse(linesAfterOne[0] ?? "")).toMatchObject({
      run_id: run.run_id,
      kind: "stdout",
      payload: "hello",
    });

    // Multiple events
    const e2 = makeEvent(run.run_id, "stderr", "error line");
    const e3 = makeEvent(run.run_id, "status_change", { from: "queued", to: "running" });
    await appendEvent(tmpDir, run.run_id, e2);
    await appendEvent(tmpDir, run.run_id, e3);
    const afterThree = await fs.readFile(eventsFilePath(run.run_id), "utf-8");
    const linesAfterThree = afterThree.trim().split("\n");
    expect(linesAfterThree).toHaveLength(3);
    const parsed = linesAfterThree.map((l) => JSON.parse(l) as unknown);
    expect(parsed[0]).toMatchObject({ kind: "stdout" });
    expect(parsed[1]).toMatchObject({ kind: "stderr" });
    expect(parsed[2]).toMatchObject({ kind: "status_change" });
  });
});

// ---------------------------------------------------------------------------
// appendStdout / appendStderr
// ---------------------------------------------------------------------------

describe("appendStdout and appendStderr", () => {
  it("appends text to stdout.log and stderr.log independently across multiple calls", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    await appendStdout(tmpDir, run.run_id, "chunk one\n");
    await appendStdout(tmpDir, run.run_id, "chunk two\n");
    const stdout = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stdout.log"),
      "utf-8",
    );
    expect(stdout).toBe("chunk one\nchunk two\n");

    await appendStderr(tmpDir, run.run_id, "warn: something\n");
    await appendStderr(tmpDir, run.run_id, "error: bad thing\n");
    const stderr = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stderr.log"),
      "utf-8",
    );
    expect(stderr).toBe("warn: something\nerror: bad thing\n");
  });
});

// ---------------------------------------------------------------------------
// writeFinalOutput
// ---------------------------------------------------------------------------

describe("writeFinalOutput", () => {
  it("creates final.md with the provided content", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");
    await writeFinalOutput(tmpDir, run.run_id, "## Final answer\nDone.");

    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "final.md"),
      "utf-8",
    );
    expect(content).toBe("## Final answer\nDone.");
  });
});

// ---------------------------------------------------------------------------
// loadRun
// ---------------------------------------------------------------------------

describe("loadRun", () => {
  it("round-trip: reads back the persisted run and reflects updates after updateRunMetadata", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");
    const loaded = await loadRun(tmpDir, run.run_id);
    expect(loaded.run_id).toBe(run.run_id);
    expect(loaded.provider).toBe(run.provider);
    expect(loaded.status).toBe(run.status);
    expect(loaded.memory_hash).toBe(run.memory_hash);
    expect(loaded.estimated_tokens).toBe(run.estimated_tokens);
    expect(loaded.pid).toBeNull();
    expect(loaded.parent_run_id).toBeNull();
    expect(loaded.handoff_id).toBeNull();

    const updated: Run = {
      ...run,
      status: "succeeded",
      ended_at: new Date().toISOString(),
      exit_code: 0,
    };
    await updateRunMetadata(tmpDir, updated);
    const reloaded = await loadRun(tmpDir, run.run_id);
    expect(reloaded.status).toBe("succeeded");
    expect(reloaded.exit_code).toBe(0);
  });

  it("throws when run does not exist", async () => {
    await expect(loadRun(tmpDir, "nonexistent-run-id")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listRunIds
// ---------------------------------------------------------------------------

describe("listRunIds", () => {
  it("returns empty array when no runs exist and returns all IDs after persisting multiple runs", async () => {
    expect(await listRunIds(tmpDir)).toEqual([]);

    const run1 = makeRun();
    const run2 = makeRun();
    const run3 = makeRun();
    await persistNewRun(tmpDir, run1, "prompt 1");
    await persistNewRun(tmpDir, run2, "prompt 2");
    await persistNewRun(tmpDir, run3, "prompt 3");

    const ids = await listRunIds(tmpDir);
    expect(ids.sort()).toEqual([run1.run_id, run2.run_id, run3.run_id].sort());
  });

  it("returns empty array when .relay/runs/ does not exist", async () => {
    // Fresh tmpDir without .relay/runs/ pre-created
    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-bare-"));
    try {
      expect(await listRunIds(bareDir)).toEqual([]);
    } finally {
      await fs.rm(bareDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Internal path helper (test-local)
// ---------------------------------------------------------------------------

function eventsFilePath(runId: string): string {
  return path.join(tmpDir, ".relay", "runs", runId, "events.jsonl");
}
