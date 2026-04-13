import React from "react";
import type { Run } from "../../core/types.js";
import { Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import { clsx } from "clsx";

export function ProjectTimeline({
  runs,
  activeRunId,
  onSelect,
}: {
  runs: Run[];
  activeRunId?: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">History</h2>
      {runs.length === 0 ? (
        <p className="text-xs text-slate-600 italic">No runs recorded yet.</p>
      ) : (
        runs.map((run) => (
          <button
            key={run.run_id}
            onClick={() => {
              onSelect(run.run_id);
            }}
            className={clsx(
              "flex flex-col p-3 rounded-lg border text-left transition-all",
              activeRunId === run.run_id
                ? "bg-blue-600/10 border-blue-500 shadow-blue-900/10"
                : "bg-slate-900 border-slate-800 hover:border-slate-700",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-slate-500">{run.run_id.slice(0, 8)}</span>
              {run.status === "succeeded" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : run.status === "failed" ? (
                <XCircle className="w-3.5 h-3.5 text-red-500" />
              ) : run.status === "running" ? (
                <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-slate-600" />
              )}
            </div>
            <span className="text-sm font-medium text-slate-200 truncate capitalize">
              {run.role}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1 bg-slate-800 text-slate-400 rounded">
                {run.provider}
              </span>
              <span className="text-[10px] text-slate-600">
                {run.started_at ? new Date(run.started_at).toLocaleTimeString() : "Pending"}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
