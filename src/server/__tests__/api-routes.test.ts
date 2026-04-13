import { describe, it, expect, vi } from "vitest";
import { createApp } from "../app.js";
import { RelayConfig } from "../../core/storage.js";
import { ProbeOrchestrator } from "../../prober/probe-orchestrator.js";
import request from "supertest";

// Mock core modules
vi.mock("../../core/run-persistence.js", () => ({
  listRunIds: vi.fn().mockResolvedValue(["run-1"]),
  loadRun: vi.fn().mockImplementation((_root: string, id: string) =>
    Promise.resolve({
      run_id: id,
      status: "running",
      provider: "claude",
      role: "plan",
      memory_hash: "hash-1",
      started_at: new Date().toISOString(),
    }),
  ),
  persistNewRun: vi.fn().mockResolvedValue(undefined),
  updateRunMetadata: vi.fn().mockResolvedValue(undefined),
  appendStdout: vi.fn().mockResolvedValue(undefined),
  appendStderr: vi.fn().mockResolvedValue(undefined),
  writeFinalOutput: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../core/memory-health.js", () => ({
  checkMemoryHealth: vi.fn().mockResolvedValue({ status: "healthy", currentHash: "hash-1" }),
}));

vi.mock("../../core/handoff-persistence.js", () => ({
  loadHandoff: vi.fn().mockImplementation((_root: string, id: string) =>
    Promise.resolve({
      handoff_id: id,
      title: "Test Handoff",
      final_prompt: "Test Prompt",
    }),
  ),
  saveHandoff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../core/context-assembly.js", () => ({
  assembleContext: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../core/subprocess-runner.js", () => ({
  spawnSubprocess: vi.fn().mockReturnValue({ pid: 1234, kill: vi.fn() }),
}));

vi.mock("../../adapters/discovery.js", () => ({
  getProviderVersion: vi.fn().mockResolvedValue("1.0.0"),
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

describe("REST API Routes", () => {
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

  const projectRoot = "/mock/root";
  const app = createApp(mockConfig, mockOrchestrator, projectRoot);

  describe("Project State", () => {
    it("GET /api/project/state returns correct structure", async () => {
      const res = await request(app).get("/api/project/state");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("config");
      expect(res.body).toHaveProperty("memoryHealth");
    });

    it("GET /api/project/files returns project-rooted file entries", async () => {
      const res = await request(app).get("/api/project/files");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("Runs API", () => {
    it("GET /api/runs returns array of IDs", async () => {
      const res = await request(app).get("/api/runs");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("POST /api/runs creates a new run", async () => {
      const res = await request(app)
        .post("/api/runs")
        .send({ task: "Hello world", provider: "claude" });

      expect(res.status).toBe(201);
      const body = res.body as { run_id: string; status: string };
      expect(body).toHaveProperty("run_id");
      expect(body.status).toBe("running");
    });

    it("GET /api/runs/:id returns run details", async () => {
      const res = await request(app).get("/api/runs/run-123");
      expect(res.status).toBe(200);
      const body = res.body as { run_id: string };
      expect(body.run_id).toBe("run-123");
    });

    it("GET /api/runs/:id/logs returns raw stdout and stderr", async () => {
      const res = await request(app).get("/api/runs/run-123/logs");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        stdout: "mock content",
        stderr: "mock content",
      });
    });

    it("POST /api/runs/:id/cancel cancels an active run", async () => {
      // First create a run to make it active in the app's internal map
      const runRes = await request(app)
        .post("/api/runs")
        .send({ task: "Long task", provider: "claude" });

      const runId = (runRes.body as { run_id: string }).run_id;
      const res = await request(app).post(`/api/runs/${runId}/cancel`);
      expect(res.status).toBe(200);
      const body = res.body as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  describe("Handoffs API", () => {
    it("POST /api/handoffs/preview returns prompt preview metadata", async () => {
      const res = await request(app).post("/api/handoffs/preview").send({
        source_run_id: "run-1",
        target_provider: "codex",
        title: "Handoff Title",
        objective: "Goal",
        note_text: "Remember to add tests",
      });

      expect(res.status).toBe(200);
      const body = res.body as {
        final_prompt: string;
        estimated_bytes: number;
        estimated_tokens: number;
        context_items: unknown[];
      };
      expect(body.final_prompt).toBeTypeOf("string");
      expect(body.estimated_bytes).toBeGreaterThan(0);
      expect(body.estimated_tokens).toBeGreaterThan(0);
      expect(Array.isArray(body.context_items)).toBe(true);
    });

    it("POST /api/handoffs creates a handoff", async () => {
      const res = await request(app).post("/api/handoffs").send({
        source_run_id: "run-1",
        target_provider: "codex",
        title: "Handoff Title",
        objective: "Goal",
        note_text: "Remember to add tests",
      });

      expect(res.status).toBe(201);
      const body = res.body as { handoff_id: string };
      expect(body).toHaveProperty("handoff_id");
    });

    it("GET /api/handoffs/:id returns handoff details", async () => {
      const res = await request(app).get("/api/handoffs/handoff-123");
      expect(res.status).toBe(200);
      const body = res.body as { handoff_id: string };
      expect(body.handoff_id).toBe("handoff-123");
    });
  });

  describe("Usage API", () => {
    it("GET /api/usage returns snapshots", async () => {
      const res = await request(app).get("/api/usage");
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe("object");
    });
  });
});
