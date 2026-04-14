import React, { useState } from "react";
import type { Run, Provider, TaskRole, RunStatus } from "../../core/types.js";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { clsx } from "clsx";

export function ProjectTimeline({
  runs,
  activeRunId,
  onSelect,
  onFilterChange,
  currentFilters,
}: {
  runs: Run[];
  activeRunId?: string | null;
  onSelect: (id: string) => void;
  onFilterChange: (filters: { provider?: string[]; role?: string[]; status?: string[] }) => void;
  currentFilters: { provider?: string[]; role?: string[]; status?: string[] };
}) {
  const [showFilters, setShowFilters] = useState(false);

  const toggleFilter = (key: "provider" | "role" | "status", value: string) => {
    const existing = currentFilters[key] ?? [];
    const next = existing.includes(value)
      ? existing.filter((v) => v !== value)
      : [...existing, value];

    onFilterChange({
      ...currentFilters,
      [key]: next.length > 0 ? next : undefined,
    });
  };

  const providers: Provider[] = ["claude", "codex", "gemini"];
  const roles: TaskRole[] = ["plan", "implement", "review", "research", "custom"];
  const statuses: RunStatus[] = ["queued", "running", "succeeded", "failed", "canceled"];

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">History</h2>
        <button
          onClick={() => {
            setShowFilters(!showFilters);
          }}
          className={clsx(
            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors",
            showFilters || Object.values(currentFilters).some((f) => f.length > 0)
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
              : "text-slate-500 hover:text-slate-300",
          )}
        >
          <Filter className="w-3 h-3" />
          Filter
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showFilters && (
        <div className="mb-4 p-3 bg-slate-900/50 border border-slate-800 rounded-lg space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="space-y-1.5">
            <span className="text-[9px] font-bold text-slate-600 uppercase">Provider</span>
            <div className="flex flex-wrap gap-1">
              {providers.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    toggleFilter("provider", p);
                  }}
                  className={clsx(
                    "px-1.5 py-0.5 rounded text-[10px] border transition-all",
                    currentFilters.provider?.includes(p)
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[9px] font-bold text-slate-600 uppercase">Role</span>
            <div className="flex flex-wrap gap-1">
              {roles.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    toggleFilter("role", r);
                  }}
                  className={clsx(
                    "px-1.5 py-0.5 rounded text-[10px] border transition-all",
                    currentFilters.role?.includes(r)
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[9px] font-bold text-slate-600 uppercase">Status</span>
            <div className="flex flex-wrap gap-1">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    toggleFilter("status", s);
                  }}
                  className={clsx(
                    "px-1.5 py-0.5 rounded text-[10px] border transition-all",
                    currentFilters.status?.includes(s)
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              onFilterChange({});
            }}
            className="w-full py-1 text-[9px] font-bold text-slate-500 hover:text-red-400 uppercase border-t border-slate-800 mt-1 transition-colors"
          >
            Clear All
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <p className="text-xs text-slate-600 italic py-4 text-center">
          {Object.values(currentFilters).some((f) => f.length > 0)
            ? "No runs match these filters."
            : "No runs recorded yet."}
        </p>
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
