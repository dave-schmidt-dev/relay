import React, { useEffect, useState, useCallback } from "react";
import { useRelay } from "../hooks/useRelay.js";
import { RunOutput } from "./RunOutput.js";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Hash,
  StopCircle,
  Timer,
  User,
  XCircle,
} from "lucide-react";
import type { Run } from "../../core/types.js";
import { clsx } from "clsx";
import type { SelectedExcerpt } from "../workflow-types.js";

interface RunDetailProps {
  run: Run;
  onExcerptSelect?: (excerpt: SelectedExcerpt) => void;
}

export function RunDetail({ run, onExcerptSelect }: RunDetailProps) {
  const { cancelRun, fetchRunLogs, fetchRunOutput, exportRun } = useRelay();
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const [rawStdout, setRawStdout] = useState("");
  const [isCanceling, setIsCanceling] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const loadOutput = useCallback(async () => {
    const logs = await fetchRunLogs(run.run_id);
    setRawStdout(logs?.stdout ?? "");

    if (run.status === "succeeded") {
      const output = await fetchRunOutput(run.run_id);
      setFinalOutput(output);
    } else {
      setFinalOutput(null);
    }
  }, [fetchRunLogs, fetchRunOutput, run.run_id, run.status]);

  useEffect(() => {
    loadOutput().catch(console.error);
  }, [loadOutput]);

  const handleCancel = async () => {
    if (!window.confirm("Are you sure you want to cancel this run?")) return;
    setIsCanceling(true);
    try {
      await cancelRun(run.run_id);
    } catch (err: unknown) {
      console.error("Failed to cancel run:", err);
      alert("Failed to cancel run");
    } finally {
      setIsCanceling(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportRun(run.run_id);
      alert(`Run exported to: ${result.exportPath}`);
    } catch (err: unknown) {
      console.error("Failed to export run:", err);
      alert("Failed to export run");
    } finally {
      setIsExporting(false);
    }
  };

  const statusColor = {
    queued: "text-slate-400 bg-slate-900 border-slate-800",
    running: "text-blue-400 bg-blue-950/30 border-blue-900/50 animate-pulse",
    succeeded: "text-emerald-400 bg-emerald-950/30 border-emerald-900/50",
    failed: "text-red-400 bg-red-950/30 border-red-900/50",
    canceled: "text-amber-400 bg-amber-950/30 border-amber-900/50",
  }[run.status];

  const statusIcon = {
    queued: <Clock className="w-4 h-4" />,
    running: <Timer className="w-4 h-4" />,
    succeeded: <CheckCircle2 className="w-4 h-4" />,
    failed: <XCircle className="w-4 h-4" />,
    canceled: <StopCircle className="w-4 h-4" />,
  }[run.status];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString();
  };

  const getDuration = () => {
    if (!run.started_at || !run.ended_at) return null;
    const start = new Date(run.started_at).getTime();
    const end = new Date(run.ended_at).getTime();
    const secs = Math.floor((end - start) / 1000);
    if (secs < 60) return `${String(secs)}s`;
    return `${String(Math.floor(secs / 60))}m ${String(secs % 60)}s`;
  };

  const renderedOutput = finalOutput ?? rawStdout;
  const hasOutput = renderedOutput.length > 0 || rawStdout.length > 0;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/50 px-6 py-4">
          <div className="flex items-center gap-4">
            <div
              className={clsx(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold",
                statusColor,
              )}
            >
              {statusIcon}
              <span className="uppercase tracking-wider">{run.status}</span>
            </div>
            <h2 className="flex items-center gap-2 font-mono text-lg font-bold text-slate-100">
              <Hash className="w-4 h-4 text-slate-500" />
              {run.run_id.slice(0, 8)}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                handleExport().catch(console.error);
              }}
              disabled={isExporting}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 border border-slate-700 transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {isExporting ? "Exporting..." : "Export Markdown"}
            </button>

            {(run.status === "running" || run.status === "queued") && (
              <button
                onClick={() => {
                  handleCancel().catch(console.error);
                }}
                disabled={isCanceling}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-900/20 transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                <StopCircle className="w-4 h-4" />
                {isCanceling ? "Canceling..." : "Cancel Run"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <Cpu className="w-3 h-3" /> Provider
            </label>
            <div className="flex items-center gap-2 font-medium text-slate-200">
              <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-xs">
                {run.provider}
              </span>
              <span className="text-xs text-slate-500">v{run.provider_version}</span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <User className="w-3 h-3" /> Role
            </label>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-200">
              {run.role}
            </div>
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <Calendar className="w-3 h-3" /> Started
            </label>
            <div className="text-xs text-slate-300">{formatDate(run.started_at)}</div>
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <Clock className="w-3 h-3" /> Duration
            </label>
            <div className="text-xs text-slate-300">
              {getDuration() ?? (run.status === "running" ? "Active..." : "N/A")}
            </div>
          </div>
        </div>

        {run.exit_reason && (
          <div className="px-6 pb-6">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/30 bg-red-950/20 p-3">
              <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-red-400" />
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-tight text-red-400">
                  Exit Reason
                </span>
                <p className="text-xs text-red-200/80">{run.exit_reason}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {hasOutput && (
        <div className="min-h-[400px] flex-1">
          <RunOutput
            rawContent={rawStdout}
            renderedContent={renderedOutput}
            role={run.role}
            provider={run.provider}
            sourceRunId={run.run_id}
            sourceFile="stdout.log"
            onExcerptSelect={onExcerptSelect}
          />
        </div>
      )}
    </div>
  );
}
