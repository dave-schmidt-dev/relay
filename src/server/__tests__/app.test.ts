import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import { RelayConfig } from "../../core/storage.js";
import { ProbeOrchestrator } from "../../prober/probe-orchestrator.js";
import request from "supertest";

// Mock core modules to avoid filesystem side effects
vi.mock("../../core/run-persistence.js", () => ({
  listRunIds: vi.fn().mockResolvedValue(["run-1"]),
  loadRun: vi.fn(),
  persistNewRun: vi.fn(),
  updateRunMetadata: vi.fn(),
  appendStdout: vi.fn(),
  appendStderr: vi.fn(),
  writeFinalOutput: vi.fn(),
}));

vi.mock("../../core/memory-health.js", () => ({
  checkMemoryHealth: vi.fn().mockResolvedValue({ currentHash: "hash-1" }),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("mock content"),
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("Express App", () => {
  const mockConfig: RelayConfig = {
    probeInterval: 60,
    maxConcurrentRuns: 5,
    defaultPort: 3000,
    classificationConfidenceThreshold: 0.8,
    debugMode: false,
    affinityRankings: {
      plan: [],
      implement: [],
      review: [],
      research: [],
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

  const projectRoot = "/mock/root";
  const app = createApp(mockConfig, mockOrchestrator, projectRoot);

  it("GET /api/project/state returns config and memory health", async () => {
    const res = await request(app).get("/api/project/state");
    expect(res.status).toBe(200);
    const body = res.body as { config: RelayConfig; memoryHealth: { currentHash: string } };
    expect(body.config).toEqual(mockConfig);
    expect(body.memoryHealth).toEqual({ currentHash: "hash-1" });
  });

  it("GET /api/runs returns list of run IDs", async () => {
    const res = await request(app).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["run-1"]);
  });

  it("GET /api/usage returns usage snapshots", async () => {
    const res = await request(app).get("/api/usage");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("POST /api/usage/probe triggers probes", async () => {
    const probeSpy = vi.spyOn(mockOrchestrator, "probeNow");
    const res = await request(app).post("/api/usage/probe");
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean };
    expect(body.success).toBe(true);
    expect(probeSpy).toHaveBeenCalled();
  });

  it("POST /api/handoffs handles snake_case payload from UI", async () => {
    // This test ensures Finding 1 is resolved
    const handoffPayload = {
      source_run_id: "run-123",
      target_provider: "claude",
      title: "Test Handoff",
      objective: "Testing handoff dispatch",
      requested_outcome: "A successful test",
      context_items: [],
    };

    const res = await request(app).post("/api/handoffs").send(handoffPayload);

    expect(res.status).toBe(201);
  });
});
