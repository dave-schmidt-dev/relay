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
  it("creates the run directory", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# Prompt");
    const stat = await fs.stat(path.join(tmpDir, ".relay", "runs", run.run_id));
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns the absolute path to the run directory", async () => {
    const run = makeRun();
    const dir = await persistNewRun(tmpDir, run, "# Prompt");
    expect(dir).toBe(path.join(tmpDir, ".relay", "runs", run.run_id));
  });

  it("writes run.json", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# Prompt");
    const stat = await fs.stat(path.join(tmpDir, ".relay", "runs", run.run_id, "run.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("writes empty events.jsonl", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# Prompt");
    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "events.jsonl"),
      "utf-8",
    );
    expect(content).toBe("");
  });

  it("writes empty stdout.log", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# Prompt");
    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stdout.log"),
      "utf-8",
    );
    expect(content).toBe("");
  });

  it("writes empty stderr.log", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# Prompt");
    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stderr.log"),
      "utf-8",
    );
    expect(content).toBe("");
  });

  it("writes prompt.md with the provided content", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "# My prompt\nDo the thing.");
    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "prompt.md"),
      "utf-8",
    );
    expect(content).toBe("# My prompt\nDo the thing.");
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
  it("appends a single event as a JSONL line", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    const makeEvent = createEventFactory();
    const event = makeEvent(run.run_id, "stdout", "hello");
    await appendEvent(tmpDir, run.run_id, event);

    const content = await fs.readFile(eventsFilePath(run.run_id), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = lines.map((l) => JSON.parse(l) as unknown);
    expect(parsed[0]).toMatchObject({ run_id: run.run_id, kind: "stdout", payload: "hello" });
  });

  it("appends multiple events as separate JSONL lines", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    const makeEvent = createEventFactory();
    const e1 = makeEvent(run.run_id, "stdout", "line one");
    const e2 = makeEvent(run.run_id, "stderr", "error line");
    const e3 = makeEvent(run.run_id, "status_change", { from: "queued", to: "running" });

    await appendEvent(tmpDir, run.run_id, e1);
    await appendEvent(tmpDir, run.run_id, e2);
    await appendEvent(tmpDir, run.run_id, e3);

    const content = await fs.readFile(eventsFilePath(run.run_id), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as unknown);
    expect(parsed[0]).toMatchObject({ kind: "stdout" });
    expect(parsed[1]).toMatchObject({ kind: "stderr" });
    expect(parsed[2]).toMatchObject({ kind: "status_change" });
  });
});

// ---------------------------------------------------------------------------
// appendStdout / appendStderr
// ---------------------------------------------------------------------------

describe("appendStdout", () => {
  it("appends text to stdout.log across multiple calls", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    await appendStdout(tmpDir, run.run_id, "chunk one\n");
    await appendStdout(tmpDir, run.run_id, "chunk two\n");

    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stdout.log"),
      "utf-8",
    );
    expect(content).toBe("chunk one\nchunk two\n");
  });
});

describe("appendStderr", () => {
  it("appends text to stderr.log across multiple calls", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");

    await appendStderr(tmpDir, run.run_id, "warn: something\n");
    await appendStderr(tmpDir, run.run_id, "error: bad thing\n");

    const content = await fs.readFile(
      path.join(tmpDir, ".relay", "runs", run.run_id, "stderr.log"),
      "utf-8",
    );
    expect(content).toBe("warn: something\nerror: bad thing\n");
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
  it("reads back the persisted run with matching fields", async () => {
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
  });

  it("reflects updated metadata after updateRunMetadata", async () => {
    const run = makeRun();
    await persistNewRun(tmpDir, run, "");
    const updated: Run = {
      ...run,
      status: "succeeded",
      ended_at: new Date().toISOString(),
      exit_code: 0,
    };
    await updateRunMetadata(tmpDir, updated);

    const loaded = await loadRun(tmpDir, run.run_id);
    expect(loaded.status).toBe("succeeded");
    expect(loaded.exit_code).toBe(0);
  });

  it("throws when run does not exist", async () => {
    await expect(loadRun(tmpDir, "nonexistent-run-id")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listRunIds
// ---------------------------------------------------------------------------

describe("listRunIds", () => {
  it("returns empty array when no runs exist", async () => {
    const ids = await listRunIds(tmpDir);
    expect(ids).toEqual([]);
  });

  it("returns all run IDs after persisting multiple runs", async () => {
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
      const ids = await listRunIds(bareDir);
      expect(ids).toEqual([]);
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
