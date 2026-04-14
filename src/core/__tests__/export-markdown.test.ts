import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exportRunToMarkdown } from "../export-markdown.js";
import { persistNewRun, writeFinalOutput } from "../run-persistence.js";
import { saveHandoff } from "../handoff-persistence.js";
import type { Run, Handoff } from "../types.js";

describe("exportRunToMarkdown", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "relay-export-test-"));
    await fs.mkdir(path.join(projectRoot, ".relay", "exports"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("exports a single run to markdown with redaction", async () => {
    const runId = "run-123";
    const run: Run = {
      run_id: runId,
      project_root: projectRoot,
      provider: "claude",
      role: "implement",
      status: "succeeded",
      command: ["claude", "do", "stuff"],
      cwd: projectRoot,
      pid: null,
      parent_run_id: null,
      handoff_id: null,
      prompt_path: path.join(projectRoot, ".relay", "runs", runId, "prompt.md"),
      final_output_path: path.join(projectRoot, ".relay", "runs", runId, "final.md"),
      provider_version: "1.0.0",
      started_at: "2024-01-01T00:00:00Z",
      ended_at: "2024-01-01T00:01:00Z",
      exit_code: 0,
      exit_reason: null,
      memory_hash: "abc",
      estimated_tokens: 1500,
    };

    const promptContent = "Here is a secret: sk-ant-api03-123456789012345678901234567890";
    await persistNewRun(projectRoot, run, promptContent);
    await writeFinalOutput(
      projectRoot,
      runId,
      "Final output with secret: sk-proj-123456789012345678901234567890",
    );

    const exportId = "export-abc";
    const exportPath = await exportRunToMarkdown(projectRoot, runId, exportId);

    expect(exportPath).toBe(path.join(projectRoot, ".relay", "exports", `${exportId}.md`));

    const content = await fs.readFile(exportPath, "utf-8");

    // Check included fields
    expect(content).toContain("# Relay Run Export");
    expect(content).toContain(`## Run: ${runId}`);
    expect(content).toContain("**Provider:** claude");
    expect(content).toContain("**Role:** implement");
    expect(content).toContain("**Estimated Tokens:** 1500");

    // Check redaction
    expect(content).not.toContain("sk-ant-api03-123456789012345678901234567890");
    expect(content).toContain("[REDACTED]");
    expect(content).not.toContain("sk-proj-123456789012345678901234567890");
  });

  it("exports a run and its handoff chain", async () => {
    const run1: Run = {
      run_id: "run-1",
      project_root: projectRoot,
      provider: "claude",
      role: "plan",
      status: "succeeded",
      command: ["claude"],
      cwd: projectRoot,
      pid: null,
      parent_run_id: null,
      handoff_id: null,
      prompt_path: path.join(projectRoot, ".relay", "runs", "run-1", "prompt.md"),
      final_output_path: path.join(projectRoot, ".relay", "runs", "run-1", "final.md"),
      provider_version: "1.0",
      started_at: "2024-01-01T00:00:00Z",
      ended_at: "2024-01-01T00:01:00Z",
      exit_code: 0,
      exit_reason: null,
      memory_hash: "abc",
      estimated_tokens: 100,
    };

    const handoff: Handoff = {
      handoff_id: "handoff-1",
      source_run_id: "run-1",
      target_provider: "codex",
      title: "Implement plan",
      objective: "Do it",
      requested_outcome: "Code",
      context_items: [],
      template_prompt: "Template",
      final_prompt: "Final prompt",
      created_at: "2024-01-01T00:01:30Z",
    };

    const run2: Run = {
      run_id: "run-2",
      project_root: projectRoot,
      provider: "codex",
      role: "implement",
      status: "succeeded",
      command: ["codex"],
      cwd: projectRoot,
      pid: null,
      parent_run_id: "run-1",
      handoff_id: "handoff-1",
      prompt_path: path.join(projectRoot, ".relay", "runs", "run-2", "prompt.md"),
      final_output_path: path.join(projectRoot, ".relay", "runs", "run-2", "final.md"),
      provider_version: "1.0",
      started_at: "2024-01-01T00:02:00Z",
      ended_at: "2024-01-01T00:03:00Z",
      exit_code: 0,
      exit_reason: null,
      memory_hash: "abc",
      estimated_tokens: 200,
    };

    await persistNewRun(projectRoot, run1, "Prompt 1");
    await writeFinalOutput(projectRoot, "run-1", "Output 1");
    await saveHandoff(projectRoot, handoff);
    await persistNewRun(projectRoot, run2, "Prompt 2");
    await writeFinalOutput(projectRoot, "run-2", "Output 2");

    const exportId = "export-chain";
    const exportPath = await exportRunToMarkdown(projectRoot, "run-2", exportId);

    const content = await fs.readFile(exportPath, "utf-8");

    // Should include both runs and the handoff
    expect(content).toContain("run-1");
    expect(content).toContain("run-2");
    expect(content).toContain("handoff-1");
    expect(content).toContain("Prompt 1");
    expect(content).toContain("Output 1");
    expect(content).toContain("Prompt 2");
    expect(content).toContain("Output 2");
  });
});
