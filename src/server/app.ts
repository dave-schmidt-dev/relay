import express, { Request, Response } from "express";
import cors from "cors";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { RelayConfig } from "../core/storage.js";
import { ProbeOrchestrator } from "../prober/probe-orchestrator.js";
import { checkMemoryHealth } from "../core/memory-health.js";
import {
  listRunIds,
  loadRun,
  persistNewRun,
  updateRunMetadata,
  appendStdout,
  appendStderr,
  writeFinalOutput,
} from "../core/run-persistence.js";
import { createRun, transitionRun, createAction } from "../core/run-lifecycle.js";
import { classifyTask } from "../core/task-classifier.js";
import { routeTask } from "../core/provider-router.js";
import { cancelProcess } from "../core/cancellation.js";
import { loadHandoff, saveHandoff } from "../core/handoff-persistence.js";
import { assembleContext } from "../core/context-assembly.js";
import { spawnSubprocess, SubprocessHandle } from "../core/subprocess-runner.js";
import { runEventBus } from "./websocket.js";
import { Provider, TaskRole, Handoff, ContextItem, RunStatus } from "../core/types.js";
import { claudeAdapter } from "../adapters/claude-adapter.js";
import { codexAdapter } from "../adapters/codex-adapter.js";
import { geminiAdapter } from "../adapters/gemini-adapter.js";
import { ProviderAdapter } from "../adapters/adapter-types.js";
import { getProviderVersion } from "../adapters/discovery.js";

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

interface RunRequestBody {
  task: string;
  provider?: Provider;
  role?: TaskRole;
  parentRunId?: string;
  handoffId?: string;
}

interface HandoffRequestBody {
  source_run_id?: string;
  target_provider?: Provider;
  title?: string;
  objective?: string;
  requested_outcome?: string;
  include_memory?: boolean;
  context_items?: ContextItem[];
  excerpt_inputs?: {
    source_run_id: string;
    source_file: string;
    byte_start: number;
    byte_end: number;
    text: string;
  }[];
  file_inputs?: { original_path: string }[];
  note_text?: string;
}

interface HandoffPreviewResult {
  context_items: ContextItem[];
  final_prompt: string;
  estimated_bytes: number;
  estimated_tokens: number;
}

function isWithinProjectRoot(projectRoot: string, targetPath: string): boolean {
  const relative = path.relative(projectRoot, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createApp(
  config: RelayConfig,
  orchestrator: ProbeOrchestrator,
  projectRoot: string,
): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Track active subprocess handles for cancellation
  const activeRuns = new Map<string, SubprocessHandle>();
  const cancelledRuns = new Set<string>();

  const recordAction = async (action: ReturnType<typeof createAction>) => {
    const actionsPath = path.join(projectRoot, ".relay", "actions.jsonl");
    await fs.appendFile(actionsPath, JSON.stringify(action) + "\n");
  };

  const materializeContextForPrompt = async (contextItems: ContextItem[]) => {
    return Promise.all(
      contextItems.map(async (item) => {
        let body = "";
        let itemTitle = item.type as string;

        if (item.type === "memory") {
          try {
            const absolutePath = path.resolve(projectRoot, item.content.content_ref);
            if (!isWithinProjectRoot(projectRoot, absolutePath)) {
              throw new Error("Memory path outside project root");
            }
            body = await fs.readFile(absolutePath, "utf-8");
            itemTitle = "AGENTS.md (Memory)";
          } catch {
            body = "Failed to load memory content.";
          }
        } else if (item.type === "excerpt") {
          body = item.content.text;
          itemTitle = `Excerpt from ${item.content.source_file}`;
        } else if (item.type === "file") {
          try {
            const sourcePath = item.content.snapshot_path.startsWith("PENDING_SNAPSHOT-")
              ? item.content.original_path
              : item.content.snapshot_path;
            const absolutePath = path.resolve(projectRoot, sourcePath);
            if (!isWithinProjectRoot(projectRoot, absolutePath)) {
              throw new Error("File path outside project root");
            }
            body = await fs.readFile(absolutePath, "utf-8");
            itemTitle = `File: ${item.content.original_path}`;
          } catch {
            body = `Failed to load file content for ${item.content.original_path}.`;
          }
        } else {
          body = item.content.text;
          itemTitle = "Operator Note";
        }

        return {
          title: itemTitle,
          body,
        };
      }),
    );
  };

  const buildHandoffPreview = async (
    body: HandoffRequestBody,
    handoffId?: string,
  ): Promise<HandoffPreviewResult> => {
    const {
      target_provider,
      title,
      objective,
      requested_outcome,
      include_memory,
      context_items: overrideContextItems,
      excerpt_inputs,
      file_inputs,
      note_text,
    } = body;

    if (!target_provider || !title) {
      throw new Error("Missing required handoff preview fields");
    }

    let contextItems =
      overrideContextItems && overrideContextItems.length > 0
        ? [...overrideContextItems]
        : await assembleContext({
            projectRoot,
            includeMemory: include_memory !== false,
            ...(handoffId ? { handoffId } : {}),
            ...(excerpt_inputs ? { excerpts: excerpt_inputs } : {}),
            ...(file_inputs ? { files: file_inputs } : {}),
          });

    const noteText = note_text?.trim();
    if (noteText) {
      contextItems = [
        ...contextItems,
        {
          type: "note",
          content: { text: noteText },
        },
      ];
    }

    const packet = {
      title,
      objective: requested_outcome
        ? `${objective ?? ""}\n\nRequested outcome: ${requested_outcome}`.trim()
        : (objective ?? ""),
      contextItems: await materializeContextForPrompt(contextItems),
    };
    const finalPrompt = ADAPTERS[target_provider].buildHandoffPrompt(packet);
    const estimatedBytes = Buffer.byteLength(finalPrompt, "utf-8");

    return {
      context_items: contextItems,
      final_prompt: finalPrompt,
      estimated_bytes: estimatedBytes,
      estimated_tokens: Math.max(1, Math.ceil(estimatedBytes / 4)),
    };
  };

  // ---------------------------------------------------------------------------
  // Project State
  // ---------------------------------------------------------------------------

  app.get("/api/project/state", async (_req: Request, res: Response) => {
    try {
      const memoryHealth = await checkMemoryHealth(projectRoot);
      res.json({
        config,
        memoryHealth,
      });
    } catch (err: unknown) {
      console.error("Failed to get project state:", err);
      res.status(500).json({ error: "Failed to get project state" });
    }
  });

  app.get("/api/project/files", async (req: Request, res: Response) => {
    try {
      const { dir = "." } = req.query;
      const targetDir = path.join(projectRoot, typeof dir === "string" ? dir : ".");
      const absTarget = path.resolve(targetDir);
      const absProject = path.resolve(projectRoot);

      if (!isWithinProjectRoot(absProject, absTarget)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const entries = await fs.readdir(absTarget, { withFileTypes: true });
      const files = entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          path: path.relative(absProject, path.join(absTarget, e.name)),
          isDirectory: e.isDirectory(),
        }));

      res.json(files);
    } catch (err: unknown) {
      console.error("Failed to list files:", err);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  app.get("/api/runs", async (_req: Request, res: Response) => {
    try {
      const runIds = await listRunIds(projectRoot);
      res.json(runIds);
    } catch (err: unknown) {
      console.error("Failed to list runs:", err);
      res.status(500).json({ error: "Failed to list runs" });
    }
  });

  app.post("/api/runs", async (req: Request<unknown, unknown, RunRequestBody>, res: Response) => {
    try {
      const {
        task,
        provider: overrideProvider,
        role: overrideRole,
        parentRunId,
        handoffId,
      } = req.body;

      if (!task) {
        return res.status(400).json({ error: "Missing task prompt" });
      }

      // 1. Classification
      const role = overrideRole ?? classifyTask(task).role;

      // 2. Routing
      let provider = overrideProvider;
      if (!provider) {
        const snapshots = orchestrator.getAllSnapshots();
        const suggestion = routeTask(role, snapshots, config.affinityRankings);
        if (!suggestion) {
          return res.status(503).json({ error: "No eligible provider available" });
        }
        provider = suggestion.suggested;
      }

      // 3. Memory hash
      const memoryHealth = await checkMemoryHealth(projectRoot);
      const memoryHash = memoryHealth.currentHash ?? "unknown";

      // 4. Provider Version
      const providerVersion = await getProviderVersion(provider);

      // 5. Create Run
      const adapter = ADAPTERS[provider];
      const run = createRun({
        project_root: projectRoot,
        provider,
        role,
        command: adapter.buildCommand(task),
        cwd: projectRoot,
        prompt_path: path.join(projectRoot, ".relay", "runs", "TEMP", "prompt.md"), // Will be corrected by persistNewRun
        final_output_path: path.join(projectRoot, ".relay", "runs", "TEMP", "final.md"),
        provider_version: providerVersion,
        memory_hash: memoryHash,
        estimated_tokens: 0,
        parent_run_id: parentRunId ?? null,
        handoff_id: handoffId ?? null,
      });

      // Update paths in run object now that we have run_id
      const runDir = path.join(projectRoot, ".relay", "runs", run.run_id);
      run.prompt_path = path.join(runDir, "prompt.md");
      run.final_output_path = path.join(runDir, "final.md");

      // 6. Persist
      await persistNewRun(projectRoot, run, task);
      await recordAction(createAction("run_launched", run.run_id, { provider, role }));

      // 7. Launch (Fire and forget, but handle lifecycle)
      const handle = spawnSubprocess({
        command: run.command,
        cwd: run.cwd,
        envAllowlist: [...config.envAllowlist, ...adapter.requiredEnvVars],
        onStdout: (chunk) => {
          runEventBus.emitStdout(run.run_id, chunk);
          appendStdout(projectRoot, run.run_id, chunk).catch(console.error);
        },
        onStderr: (chunk) => {
          runEventBus.emitStderr(run.run_id, chunk);
          appendStderr(projectRoot, run.run_id, chunk).catch(console.error);
        },
        onExit: (code, signal) => {
          activeRuns.delete(run.run_id);
          const isCanceled = cancelledRuns.has(run.run_id);
          const finalStatus: RunStatus = isCanceled
            ? "canceled"
            : code === 0
              ? "succeeded"
              : "failed";

          const exitReason = signal ? `Killed by ${signal}` : undefined;

          loadRun(projectRoot, run.run_id)
            .then(async (currentRun) => {
              const updatedRun = transitionRun(currentRun, finalStatus, {
                exit_code: code ?? undefined,
                exit_reason: exitReason,
              });
              await updateRunMetadata(projectRoot, updatedRun);

              // Extract final output if successful
              if (finalStatus === "succeeded") {
                const stdoutData = await fs.readFile(path.join(runDir, "stdout.log"), "utf-8");
                const finalOutput = adapter.parseOutput(stdoutData);
                await writeFinalOutput(projectRoot, run.run_id, finalOutput);
              }
              cancelledRuns.delete(run.run_id);
            })
            .catch(console.error);
        },
        onError: (err) => {
          activeRuns.delete(run.run_id);
          cancelledRuns.delete(run.run_id);
          console.error(`Subprocess error for run ${run.run_id}:`, err);
          loadRun(projectRoot, run.run_id)
            .then(async (currentRun) => {
              const updatedRun = transitionRun(currentRun, "failed", {
                exit_reason: err.message,
              });
              await updateRunMetadata(projectRoot, updatedRun);
            })
            .catch(console.error);
        },
      });

      // Store handle for cancellation
      activeRuns.set(run.run_id, handle);

      // Update run to "running" status
      const runningRun = transitionRun(run, "running", { pid: handle.pid });
      await updateRunMetadata(projectRoot, runningRun);

      res.status(201).json(runningRun);
    } catch (err: unknown) {
      console.error("Failed to launch run:", err);
      res.status(500).json({ error: "Failed to launch run" });
    }
  });

  app.get("/api/runs/:runId", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      if (!runId || typeof runId !== "string")
        return res.status(400).json({ error: "Invalid runId" });
      const run = await loadRun(projectRoot, runId);
      res.json(run);
    } catch {
      res.status(404).json({ error: "Run not found" });
    }
  });

  app.get("/api/runs/:runId/output", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      if (!runId || typeof runId !== "string")
        return res.status(400).json({ error: "Invalid runId" });
      const finalOutputPath = path.join(projectRoot, ".relay", "runs", runId, "final.md");
      const content = await fs.readFile(finalOutputPath, "utf-8");
      res.json({ content });
    } catch (err: unknown) {
      const errorCode = (err as { code?: string }).code;
      if (errorCode === "ENOENT") {
        return res.status(404).json({ error: "Final output not found" });
      }
      res.status(500).json({ error: "Failed to read final output" });
    }
  });

  app.get("/api/runs/:runId/logs", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      if (!runId || typeof runId !== "string")
        return res.status(400).json({ error: "Invalid runId" });

      const [stdout, stderr] = await Promise.all([
        fs.readFile(path.join(projectRoot, ".relay", "runs", runId, "stdout.log"), "utf-8"),
        fs.readFile(path.join(projectRoot, ".relay", "runs", runId, "stderr.log"), "utf-8"),
      ]);

      res.json({ stdout, stderr });
    } catch (err: unknown) {
      const errorCode = (err as { code?: string }).code;
      if (errorCode === "ENOENT") {
        return res.status(404).json({ error: "Run logs not found" });
      }
      res.status(500).json({ error: "Failed to read run logs" });
    }
  });

  app.post("/api/runs/:runId/cancel", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      if (!runId || typeof runId !== "string")
        return res.status(400).json({ error: "Invalid runId" });
      const run = await loadRun(projectRoot, runId);
      if (run.status !== "running" && run.status !== "queued") {
        return res.status(400).json({ error: "Run is not active" });
      }

      const handle = activeRuns.get(runId);
      if (handle) {
        cancelledRuns.add(runId);
        await recordAction(createAction("run_canceled", runId));
        await cancelProcess({ handle });
        // transitionRun will be called by onExit callback of spawnSubprocess
        res.json({ success: true });
      } else {
        const canceledRun = transitionRun(run, "canceled");
        await updateRunMetadata(projectRoot, canceledRun);
        await recordAction(createAction("run_canceled", runId));
        res.json({ success: true });
      }
    } catch (err: unknown) {
      console.error("Failed to cancel run:", err);
      res.status(500).json({ error: "Failed to cancel run" });
    }
  });

  // ---------------------------------------------------------------------------
  // Handoffs
  // ---------------------------------------------------------------------------

  app.get("/api/handoffs", async (_req: Request, res: Response) => {
    try {
      const handoffsDir = path.join(projectRoot, ".relay", "handoffs");
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(handoffsDir, { withFileTypes: true });
      } catch (err: unknown) {
        const errorCode = (err as { code?: string }).code;
        if (errorCode === "ENOENT") return res.json([]);
        throw err;
      }
      const handoffIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      res.json(handoffIds);
    } catch (err: unknown) {
      console.error("Failed to list handoffs:", err);
      res.status(500).json({ error: "Failed to list handoffs" });
    }
  });

  app.post(
    "/api/handoffs/preview",
    async (req: Request<unknown, unknown, HandoffRequestBody>, res: Response) => {
      try {
        const { source_run_id, target_provider, title } = req.body;
        if (!source_run_id || !target_provider || !title) {
          return res.status(400).json({ error: "Missing required handoff preview fields" });
        }

        const preview = await buildHandoffPreview(req.body);
        res.json(preview);
      } catch (err: unknown) {
        console.error("Failed to preview handoff:", err);
        res.status(500).json({ error: "Failed to preview handoff" });
      }
    },
  );

  app.post(
    "/api/handoffs",
    async (req: Request<unknown, unknown, HandoffRequestBody>, res: Response) => {
      try {
        const { source_run_id, target_provider, title, objective, requested_outcome } = req.body;

        if (!source_run_id || !target_provider || !title) {
          return res.status(400).json({ error: "Missing required handoff fields" });
        }

        const handoffId = crypto.randomUUID();
        const preview = await buildHandoffPreview(req.body, handoffId);

        const handoff: Handoff = {
          handoff_id: handoffId,
          source_run_id,
          target_provider,
          title,
          objective: objective ?? "",
          requested_outcome: requested_outcome ?? "",
          context_items: preview.context_items,
          template_prompt: preview.final_prompt,
          final_prompt: preview.final_prompt,
          created_at: new Date().toISOString(),
        };

        await saveHandoff(projectRoot, handoff);
        await recordAction(
          createAction("handoff_created", source_run_id, {
            handoff_id: handoffId,
            target_provider,
          }),
        );
        res.status(201).json(handoff);
      } catch (err: unknown) {
        console.error("Failed to create handoff:", err);
        res.status(500).json({ error: "Failed to create handoff" });
      }
    },
  );

  app.get("/api/handoffs/:handoffId", async (req: Request, res: Response) => {
    try {
      const { handoffId } = req.params;
      if (!handoffId || typeof handoffId !== "string")
        return res.status(400).json({ error: "Invalid handoffId" });
      const handoff = await loadHandoff(projectRoot, handoffId);
      res.json(handoff);
    } catch {
      res.status(404).json({ error: "Handoff not found" });
    }
  });

  // ---------------------------------------------------------------------------
  // Usage
  // ---------------------------------------------------------------------------

  app.get("/api/usage", (_req: Request, res: Response) => {
    try {
      const snapshots = orchestrator.getAllSnapshots();
      res.json(Object.fromEntries(snapshots.entries()));
    } catch (err: unknown) {
      console.error("Failed to get usage:", err);
      res.status(500).json({ error: "Failed to get usage" });
    }
  });

  app.post("/api/usage/probe", (_req: Request, res: Response) => {
    try {
      const providers: Provider[] = ["claude", "codex", "gemini"];
      Promise.all(
        providers.map((p) => {
          return orchestrator
            .probeNow(p)
            .then(() => ({ provider: p, success: true }))
            .catch((err: unknown) => ({ provider: p, error: String(err) }));
        }),
      )
        .then((results) => {
          void recordAction(createAction("usage_adjusted"));
          res.json({ success: true, results });
        })
        .catch((err: unknown) => {
          console.error("Failed to process probe results:", err);
          res.status(500).json({ error: "Failed to process probe results" });
        });
    } catch (err: unknown) {
      console.error("Failed to trigger probe:", err);
      res.status(500).json({ error: "Failed to trigger probe" });
    }
  });

  return app;
}
