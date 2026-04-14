import React, { useEffect, useState } from "react";
import { useRelay } from "./hooks/useRelay.js";
import { UsageDashboard } from "./components/UsageDashboard.js";
import { PromptComposer } from "./components/PromptComposer.js";
import { SplitPaneWorkspace } from "./components/SplitPaneWorkspace.js";
import { RunOutput } from "./components/RunOutput.js";
import { RunDetail } from "./components/RunDetail.js";
import { ProjectTimeline } from "./components/ProjectTimeline.js";
import { MemoryHealthIndicator } from "./components/MemoryHealthIndicator.js";
import { HandoffDispatch } from "./components/HandoffDispatch.js";
import type { Run } from "../core/types.js";
import type { SelectedExcerpt } from "./workflow-types.js";
import { ChevronLeft, ChevronRight, History, LayoutPanelLeft } from "lucide-react";
import { clsx } from "clsx";

type WorkspaceMode = "split" | "source" | "dispatch";

const workspaceModes: {
  value: WorkspaceMode;
  label: string;
  icon: typeof ChevronLeft;
}[] = [
  { value: "source", label: "Source", icon: ChevronLeft },
  { value: "split", label: "Split", icon: LayoutPanelLeft },
  { value: "dispatch", label: "Dispatch", icon: ChevronRight },
];

export default function App() {
  const {
    projectState,
    runs,
    usageSnapshots,
    runLogs,
    launchRun,
    subscribeToRun,
    triggerProbe,
    fetchRuns,
    wsStatus,
  } = useRelay();

  const [sourceRunId, setSourceRunId] = useState<string | null>(null);
  const [dispatchedRunId, setDispatchedRunId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("split");
  const [selectedExcerpts, setSelectedExcerpts] = useState<SelectedExcerpt[]>([]);
  const [filters, setFilters] = useState<{
    provider?: string[];
    role?: string[];
    status?: string[];
  }>({});

  useEffect(() => {
    fetchRuns(filters).catch((err: unknown) => {
      console.error(err);
    });
  }, [filters, fetchRuns]);

  const sourceRun = runs.find((run: Run) => run.run_id === sourceRunId) ?? null;
  const dispatchedRun = runs.find((run: Run) => run.run_id === dispatchedRunId) ?? null;
  const sourceLogs = sourceRunId ? runLogs[sourceRunId] : null;
  const dispatchedLogs = dispatchedRunId ? runLogs[dispatchedRunId] : null;

  useEffect(() => {
    setSelectedExcerpts([]);
    setDispatchedRunId(null);
  }, [sourceRunId]);

  useEffect(() => {
    if (sourceRun?.status === "running") {
      subscribeToRun(sourceRun.run_id);
    }
  }, [sourceRun, subscribeToRun]);

  useEffect(() => {
    if (dispatchedRun?.status === "running") {
      subscribeToRun(dispatchedRun.run_id);
    }
  }, [dispatchedRun, subscribeToRun]);

  const handleExcerptSelect = (excerpt: SelectedExcerpt) => {
    setSelectedExcerpts((prev) => {
      const next = new Map(
        prev.map((item) => [
          [
            item.source_run_id,
            item.source_file,
            String(item.byte_start),
            String(item.byte_end),
          ].join(":"),
          item,
        ]),
      );
      next.set(
        [
          excerpt.source_run_id,
          excerpt.source_file,
          String(excerpt.byte_start),
          String(excerpt.byte_end),
        ].join(":"),
        excerpt,
      );
      return Array.from(next.values());
    });
  };

  const sourcePane = (
    <div className="h-full flex flex-col">
      {sourceRun ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Source Run
            </h3>
            <button
              onClick={() => {
                setSourceRunId(null);
              }}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              CLOSE
            </button>
          </div>

          {sourceRun.status === "running" ? (
            <RunOutput
              rawContent={sourceLogs?.stdout ?? ""}
              renderedContent={sourceLogs?.stdout ?? ""}
              isStreaming={true}
              role={sourceRun.role}
              provider={sourceRun.provider}
              sourceRunId={sourceRun.run_id}
              sourceFile="stdout.log"
              onExcerptSelect={handleExcerptSelect}
            />
          ) : (
            <RunDetail run={sourceRun} onExcerptSelect={handleExcerptSelect} />
          )}
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-slate-600">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-slate-800 bg-slate-900">
            <History className="h-8 w-8 opacity-20" />
          </div>
          <div className="space-y-1">
            <p className="font-bold text-slate-400">No Source Run Selected</p>
            <p className="text-sm">
              Select a run from the history sidebar to review output or build a handoff.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const dispatchPane = (
    <div className="h-full flex flex-col">
      {dispatchedRun ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Dispatched Run
            </h3>
            <button
              onClick={() => {
                setDispatchedRunId(null);
              }}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              CLOSE
            </button>
          </div>

          {dispatchedRun.status === "running" ? (
            <RunOutput
              rawContent={dispatchedLogs?.stdout ?? ""}
              renderedContent={dispatchedLogs?.stdout ?? ""}
              isStreaming={true}
              role={dispatchedRun.role}
              provider={dispatchedRun.provider}
              sourceRunId={dispatchedRun.run_id}
              sourceFile="stdout.log"
            />
          ) : (
            <RunDetail run={dispatchedRun} />
          )}
        </div>
      ) : sourceRun ? (
        <div className="flex-1 overflow-auto p-6">
          <HandoffDispatch
            key={sourceRun.run_id}
            sourceRun={sourceRun}
            initialExcerpts={selectedExcerpts}
            onClearSelections={() => {
              setSelectedExcerpts([]);
            }}
            onSuccess={(newRunId) => {
              setDispatchedRunId(newRunId);
            }}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col gap-6 overflow-auto p-6">
          <PromptComposer
            onLaunch={(task: string, options) => {
              void (async () => {
                const newRun = await launchRun(task, options);
                setDispatchedRunId(newRun.run_id);
              })().catch(console.error);
            }}
            usageSnapshots={usageSnapshots}
            affinityRankings={projectState?.config.affinityRankings}
          />

          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-slate-900 p-8 text-center text-slate-700">
            <p className="text-sm italic">
              Launch a new task or select a source run to start a structured handoff.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const workspace =
    workspaceMode === "source" ? (
      sourcePane
    ) : workspaceMode === "dispatch" ? (
      dispatchPane
    ) : (
      <SplitPaneWorkspace left={sourcePane} right={dispatchPane} />
    );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans text-slate-200">
      <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 font-bold text-white shadow-lg shadow-blue-900/20">
            R
          </div>
          <h1 className="text-lg font-bold tracking-tight">Relay Workbench</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-slate-800 bg-slate-900/50">
            <div
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                wsStatus === "connected"
                  ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  : wsStatus === "connecting"
                    ? "bg-amber-500"
                    : "bg-red-500",
              )}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {wsStatus}
            </span>
          </div>

          {projectState && <MemoryHealthIndicator status={projectState.memoryHealth.status} />}

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-1">
            {workspaceModes.map((mode) => (
              <button
                key={mode.value}
                onClick={() => {
                  setWorkspaceMode(mode.value);
                }}
                className={clsx(
                  "flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold transition-colors",
                  workspaceMode === mode.value
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                <mode.icon className="h-3.5 w-3.5" />
                {mode.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setSidebarOpen((prev) => !prev);
            }}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800"
          >
            <LayoutPanelLeft className={clsx("h-5 w-5", sidebarOpen && "text-blue-400")} />
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <aside
          className={clsx(
            "z-10 flex shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900/30 transition-all duration-300",
            sidebarOpen ? "w-80" : "w-0",
          )}
        >
          <div className="flex-1 overflow-auto">
            <div className="flex items-center gap-2 border-b border-slate-800 p-4 text-slate-400">
              <History className="h-4 w-4" />
              <span className="text-xs font-bold uppercase tracking-widest">Project History</span>
            </div>
            <ProjectTimeline
              runs={runs}
              activeRunId={sourceRunId}
              onSelect={(runId: string) => {
                setSourceRunId(runId);
              }}
              onFilterChange={setFilters}
              currentFilters={filters}
            />
          </div>
          <div className="border-t border-slate-800 bg-slate-900/80 p-4">
            <div className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-400">
              Usage Quotas
            </div>
            <UsageDashboard
              snapshots={usageSnapshots}
              onProbe={() => {
                void triggerProbe().catch(console.error);
              }}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-slate-950">{workspace}</main>
      </div>
    </div>
  );
}
