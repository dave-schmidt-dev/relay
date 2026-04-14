import { useState, useEffect, useCallback, useRef } from "react";
import type { Run, Provider, TaskRole, Handoff } from "../../core/types.js";
import type { RelayConfig } from "../../core/storage.js";
import type { MemoryHealthResult } from "../../core/memory-health.js";
import type { UsageSnapshot } from "../../prober/probe-orchestrator.js";
import type {
  HandoffDraftRequest,
  HandoffPreviewResult,
  ProjectFileEntry,
  RunLogResponse,
} from "../workflow-types.js";

export interface ProjectState {
  config: RelayConfig;
  memoryHealth: MemoryHealthResult;
}

export interface RunLogs {
  stdout: string;
  stderr: string;
}

export function useRelay() {
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [usageSnapshots, setUsageSnapshots] = useState<Record<string, UsageSnapshot>>({});
  const [runLogs, setRunLogs] = useState<Record<string, RunLogs>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRuns = useRef<Set<string>>(new Set());

  const fetchProjectState = useCallback(async () => {
    try {
      const res = await fetch("/api/project/state");
      if (!res.ok) throw new Error("Failed to fetch project state");
      const data = (await res.json()) as ProjectState;
      setProjectState(data);
    } catch (err: unknown) {
      console.error("Failed to fetch project state:", err);
    }
  }, []);

  const fetchRuns = useCallback(
    async (filters?: {
      provider?: string | string[];
      role?: string | string[];
      status?: string | string[];
    }) => {
      try {
        let url = "/api/runs";
        if (filters) {
          const params = new URLSearchParams();
          if (filters.provider) {
            if (Array.isArray(filters.provider)) {
              filters.provider.forEach((p) => {
                params.append("provider", p);
              });
            } else {
              params.set("provider", filters.provider);
            }
          }
          if (filters.role) {
            if (Array.isArray(filters.role)) {
              filters.role.forEach((r) => {
                params.append("role", r);
              });
            } else {
              params.set("role", filters.role);
            }
          }
          if (filters.status) {
            if (Array.isArray(filters.status)) {
              filters.status.forEach((s) => {
                params.append("status", s);
              });
            } else {
              params.set("status", filters.status);
            }
          }
          const queryString = params.toString();
          if (queryString) {
            url += "?" + queryString;
          }
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch runs");
        const runIds = (await res.json()) as string[];

        const runPromises = runIds.map(async (id) => {
          const r = await fetch(`/api/runs/${id}`);
          if (!r.ok) return null;
          return (await r.json()) as Run;
        });

        const loadedRuns = (await Promise.all(runPromises)).filter((r): r is Run => r !== null);
        setRuns(
          loadedRuns.sort(
            (a, b) => new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime(),
          ),
        );
      } catch (err: unknown) {
        console.error("Failed to fetch runs:", err);
      }
    },
    [],
  );

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (!res.ok) throw new Error("Failed to fetch usage");
      const data = (await res.json()) as Record<string, UsageSnapshot>;
      setUsageSnapshots(data);
    } catch (err: unknown) {
      console.error("Failed to fetch usage:", err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchProjectState(), fetchRuns(), fetchUsage()]);
    setIsLoading(false);
  }, [fetchProjectState, fetchRuns, fetchUsage]);

  useEffect(() => {
    refreshAll().catch((err: unknown) => {
      console.error(err);
    });
  }, [refreshAll]);

  // WebSocket Setup
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = typeof event.data === "string" ? event.data : "";
        const message = JSON.parse(data) as {
          type: string;
          runId: string;
          chunk?: string;
          status?: Run["status"];
        };
        if (message.type === "stdout" || message.type === "stderr") {
          setRunLogs((prev) => {
            const current = prev[message.runId] ?? { stdout: "", stderr: "" };
            const typeKey = message.type as keyof RunLogs;
            const existingContent = current[typeKey];
            return {
              ...prev,
              [message.runId]: {
                ...current,
                [typeKey]: existingContent + (message.chunk ?? ""),
              },
            };
          });
        } else if (message.type === "status_change" && message.status) {
          const newStatus = message.status;
          setRuns((prev) =>
            prev.map((run) => (run.run_id === message.runId ? { ...run, status: newStatus } : run)),
          );
        }
      } catch (err: unknown) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onopen = () => {
      console.log("Connected to Relay WebSocket");
      setWsStatus("connected");
      // Re-subscribe to any active runs if we re-connected
      subscribedRuns.current.forEach((runId) => {
        ws.send(JSON.stringify({ type: "subscribe", runId }));
      });
    };

    ws.onclose = () => {
      console.log("Relay WebSocket disconnected");
      setWsStatus("disconnected");
    };

    ws.onerror = () => {
      console.error("Relay WebSocket error");
      setWsStatus("disconnected");
    };

    return () => {
      ws.close();
    };
  }, []);

  const subscribeToRun = useCallback((runId: string) => {
    if (subscribedRuns.current.has(runId)) return;
    subscribedRuns.current.add(runId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", runId }));
    }
  }, []);

  const launchRun = useCallback(
    async (
      task: string,
      options?: {
        provider?: Provider | undefined;
        role?: TaskRole | undefined;
        parentRunId?: string | undefined;
        handoffId?: string | undefined;
      },
    ) => {
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, ...options }),
        });
        if (!res.ok) throw new Error("Failed to launch run");
        const newRun = (await res.json()) as Run;
        setRuns((prev) => [newRun, ...prev]);
        setActiveRunId(newRun.run_id);
        subscribeToRun(newRun.run_id);
        return newRun;
      } catch (err: unknown) {
        console.error("Failed to launch run:", err);
        throw err;
      }
    },
    [subscribeToRun],
  );

  const triggerProbe = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/probe", { method: "POST" });
      if (!res.ok) throw new Error("Failed to trigger probe");
      await fetchUsage();
    } catch (err: unknown) {
      console.error("Failed to trigger probe:", err);
    }
  }, [fetchUsage]);

  const previewHandoff = useCallback(async (handoff: HandoffDraftRequest) => {
    try {
      const res = await fetch("/api/handoffs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handoff),
      });
      if (!res.ok) throw new Error("Failed to preview handoff");
      return (await res.json()) as HandoffPreviewResult;
    } catch (err: unknown) {
      console.error("Failed to preview handoff:", err);
      throw err;
    }
  }, []);

  const createHandoff = useCallback(async (handoff: HandoffDraftRequest) => {
    try {
      const res = await fetch("/api/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handoff),
      });
      if (!res.ok) throw new Error("Failed to create handoff");
      return (await res.json()) as Handoff;
    } catch (err: unknown) {
      console.error("Failed to create handoff:", err);
      throw err;
    }
  }, []);

  const cancelRun = useCallback(
    async (runId: string) => {
      try {
        const res = await fetch(`/api/runs/${runId}/cancel`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("Failed to cancel run");
        await fetchRuns(); // Refresh status
      } catch (err: unknown) {
        console.error("Failed to cancel run:", err);
        throw err;
      }
    },
    [fetchRuns],
  );

  const fetchRunOutput = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/output`);
      if (!res.ok) return null;
      const data = (await res.json()) as { content: string };
      return data.content;
    } catch (err: unknown) {
      console.error("Failed to fetch run output:", err);
      return null;
    }
  }, []);

  const fetchRunLogs = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/logs`);
      if (!res.ok) return null;
      return (await res.json()) as RunLogResponse;
    } catch (err: unknown) {
      console.error("Failed to fetch run logs:", err);
      return null;
    }
  }, []);

  const listProjectFiles = useCallback(async (dir = ".") => {
    try {
      const res = await fetch(`/api/project/files?dir=${encodeURIComponent(dir)}`);
      if (!res.ok) throw new Error("Failed to list project files");
      return (await res.json()) as ProjectFileEntry[];
    } catch (err: unknown) {
      console.error("Failed to list project files:", err);
      throw err;
    }
  }, []);

  const exportRun = useCallback(async (runId: string, exportId?: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportId }),
      });
      if (!res.ok) throw new Error("Failed to export run");
      return (await res.json()) as { exportId: string; exportPath: string };
    } catch (err: unknown) {
      console.error("Failed to export run:", err);
      throw err;
    }
  }, []);

  return {
    projectState,
    runs,
    usageSnapshots,
    runLogs,
    activeRunId,
    setActiveRunId,
    isLoading,
    refreshAll,
    launchRun,
    triggerProbe,
    previewHandoff,
    createHandoff,
    subscribeToRun,
    cancelRun,
    fetchRunOutput,
    fetchRunLogs,
    listProjectFiles,
    exportRun,
    fetchRuns,
    wsStatus,
  };
}
