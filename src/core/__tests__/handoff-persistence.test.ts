import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { saveHandoff, loadHandoff } from "../handoff-persistence.js";
import type { Handoff } from "../types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-handoff-persist-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Handoff Persistence", () => {
  it("saves and loads a handoff correctly", async () => {
    const handoff: Handoff = {
      handoff_id: "test-handoff-123",
      source_run_id: "run-456",
      target_provider: "claude",
      title: "Test Handoff",
      objective: "Do a thing",
      requested_outcome: "The thing is done",
      context_items: [],
      template_prompt: "Template",
      final_prompt: "Final",
      created_at: new Date().toISOString(),
    };

    await saveHandoff(tmpDir, handoff);

    const loaded = await loadHandoff(tmpDir, "test-handoff-123");
    expect(loaded).toEqual(handoff);
  });

  it("throws when loading non-existent handoff", async () => {
    await expect(loadHandoff(tmpDir, "nonexistent")).rejects.toThrow();
  });
});
