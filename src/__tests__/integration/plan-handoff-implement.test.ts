import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createApp } from "../../server/app.js";
import { RelayConfig } from "../../core/storage.js";
import { ProbeOrchestrator } from "../../prober/probe-orchestrator.js";
import express from "express";
import { Run, Handoff } from "../../core/types.js";

// Mock subprocess-runner to simulate process execution without calling real providers
vi.mock("../../core/subprocess-runner.js", () => {
  return {
    spawnSubprocess: vi.fn(
      (options: {
        onStdout?: (chunk: string) => void;
        onExit?: (code: number, signal: string | null) => void;
      }) => {
        // Simulate process execution asynchronously
        setTimeout(() => {
          if (options.onStdout) {
            options.onStdout('{"result": "Simulated output from provider"}\n');
          }
          if (options.onExit) {
            options.onExit(0, null);
          }
        }, 50);
        return { pid: Math.floor(Math.random() * 10000), kill: vi.fn() };
      },
    ),
  };
});

// Mock adapters/discovery.js to avoid actual provider version checks
vi.mock("../../adapters/discovery.js", () => ({
  getProviderVersion: vi.fn().mockResolvedValue("1.0.0"),
}));

describe("Integration: Plan -> Handoff -> Implement", () => {
  let tmpDir: string;
  let app: express.Express;

  const mockConfig: RelayConfig = {
    probeInterval: 60,
    maxConcurrentRuns: 5,
    defaultPort: 3000,
    classificationConfidenceThreshold: 0.8,
    debugMode: false,
    affinityRankings: {
      plan: ["claude"],
      implement: ["codex"],
      review: ["codex"],
      research: ["gemini"],
      custom: [],
    },
    envAllowlist: ["PATH"],
  };

  const mockOrchestrator = {
    getAllSnapshots: vi.fn().mockReturnValue(new Map()),
    probeNow: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as ProbeOrchestrator;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-integration-test-"));
    // Pre-create necessary directories
    await fs.mkdir(path.join(tmpDir, ".relay", "runs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, ".relay", "handoffs"), { recursive: true });

    app = createApp(mockConfig, mockOrchestrator, tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("executes the full lifecycle: plan -> handoff -> implement", async () => {
    // 1. Create a "plan" run
    const planRes = await request(app)
      .post("/api/runs")
      .send({ task: "Create a plan for a new feature", provider: "claude", role: "plan" });

    expect(planRes.status).toBe(201);
    const planRun = planRes.body as Run;
    const planRunId = planRun.run_id;
    expect(planRunId).toBeDefined();

    // Wait for the simulated process to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify plan run succeeded
    const planCheckRes = await request(app).get(`/api/runs/${planRunId}`);
    expect(planCheckRes.status).toBe(200);
    const planCheckRun = planCheckRes.body as Run;
    expect(planCheckRun.status).toBe("succeeded");

    // 2. Create a handoff from that run
    const handoffRes = await request(app).post("/api/handoffs").send({
      source_run_id: planRunId,
      target_provider: "codex",
      title: "Implement the feature",
      objective: "Follow the plan",
    });

    expect(handoffRes.status).toBe(201);
    const handoff = handoffRes.body as Handoff;
    const handoffId = handoff.handoff_id;
    expect(handoffId).toBeDefined();

    // 3. Dispatch an "implement" run using the handoff context
    const implementRes = await request(app).post("/api/runs").send({
      task: "Implement based on handoff",
      provider: "codex",
      role: "implement",
      parentRunId: planRunId,
      handoffId: handoffId,
    });

    expect(implementRes.status).toBe(201);
    const implementRun = implementRes.body as Run;
    const implementRunId = implementRun.run_id;
    expect(implementRunId).toBeDefined();

    // Wait for the simulated process to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Verify the child run is linked correctly and executed
    const implementCheckRes = await request(app).get(`/api/runs/${implementRunId}`);
    expect(implementCheckRes.status).toBe(200);
    const implementCheckRun = implementCheckRes.body as Run;
    expect(implementCheckRun.status).toBe("succeeded");
    expect(implementCheckRun.parent_run_id).toBe(planRunId);
    expect(implementCheckRun.handoff_id).toBe(handoffId);
  });
});
