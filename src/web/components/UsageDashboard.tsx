import React from "react";
import { RefreshCw, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { UsageSnapshot } from "../../prober/probe-orchestrator.js";
import type { ClaudeUsageSnapshot } from "../../prober/claude-probe.js";
import type { CodexUsageSnapshot } from "../../prober/codex-probe.js";
import type { GeminiUsageSnapshot } from "../../prober/gemini-probe.js";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UsageDashboardProps {
  snapshots: Record<string, UsageSnapshot>;
  onProbe: () => void;
  isProbing?: boolean;
}

export function UsageDashboard({ snapshots, onProbe, isProbing }: UsageDashboardProps) {
  const snapshotsArray = Object.values(snapshots);

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-900 border border-slate-800 rounded-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400" />
          Provider Quotas
        </h2>
        <button
          onClick={onProbe}
          disabled={isProbing}
          className="p-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white transition-colors"
          title="Probe Now"
        >
          <RefreshCw className={cn("w-4 h-4", isProbing && "animate-spin")} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {snapshotsArray.map((snapshot) => (
          <ProviderCard key={snapshot.provider} snapshot={snapshot} />
        ))}
        {snapshotsArray.length === 0 && (
          <div className="text-slate-500 text-sm py-4 text-center">
            No usage data available. Probe to fetch.
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderCard({ snapshot }: { snapshot: UsageSnapshot }) {
  const isError = !!snapshot.error;
  const isStale = snapshot.stale;

  return (
    <div
      className={cn(
        "p-3 rounded-md border transition-colors",
        isError
          ? "bg-red-900/20 border-red-800"
          : isStale
            ? "bg-amber-900/20 border-amber-800"
            : "bg-slate-800 border-slate-700",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-200 capitalize">{snapshot.provider}</span>
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
          ) : isStale ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </div>
        <span className="text-[10px] text-slate-500">
          {new Date(snapshot.probedAt).toLocaleTimeString()}
        </span>
      </div>

      {isError ? (
        <div
          className="text-xs text-red-400 italic truncate"
          title={snapshot.error ?? "Unknown error"}
        >
          {snapshot.error}
        </div>
      ) : (
        <div className="space-y-2">
          {snapshot.provider === "claude" && (
            <ClaudeMetrics data={snapshot.data as ClaudeUsageSnapshot} />
          )}
          {snapshot.provider === "codex" && (
            <CodexMetrics data={snapshot.data as CodexUsageSnapshot} />
          )}
          {snapshot.provider === "gemini" && (
            <GeminiMetrics data={snapshot.data as GeminiUsageSnapshot} />
          )}
        </div>
      )}
    </div>
  );
}

function MetricBar({
  label,
  percent,
  reset,
}: {
  label: string;
  percent: number | null;
  reset: string | null;
}) {
  if (percent === null) return null;

  const isLow = percent < 20;
  const isExhausted = percent === 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400">{label}</span>
        <span
          className={cn(
            "font-bold",
            isExhausted ? "text-red-500" : isLow ? "text-amber-500" : "text-emerald-400",
          )}
        >
          {String(percent)}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-500",
            isExhausted ? "bg-red-600" : isLow ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {reset && (
        <div className="text-[9px] text-slate-500 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          Resets {reset}
        </div>
      )}
    </div>
  );
}

function ClaudeMetrics({ data }: { data: ClaudeUsageSnapshot }) {
  return (
    <div className="space-y-2">
      <MetricBar label="Session" percent={data.sessionPercentLeft} reset={data.primaryReset} />
      <MetricBar label="Weekly" percent={data.weeklyPercentLeft} reset={data.secondaryReset} />
      {data.opusPercentLeft !== null && (
        <MetricBar label="Opus" percent={data.opusPercentLeft} reset={data.opusReset} />
      )}
    </div>
  );
}

function CodexMetrics({ data }: { data: CodexUsageSnapshot }) {
  return (
    <div className="space-y-2">
      <MetricBar label="5h Limit" percent={data.fiveHourPercentLeft} reset={data.fiveHourReset} />
      <MetricBar label="Weekly" percent={data.weeklyPercentLeft} reset={data.weeklyReset} />
    </div>
  );
}

function GeminiMetrics({ data }: { data: GeminiUsageSnapshot }) {
  return (
    <div className="space-y-2">
      <MetricBar label="Flash" percent={data.flashPercentLeft} reset={data.flashReset} />
      <MetricBar label="Pro" percent={data.proPercentLeft} reset={data.proReset} />
    </div>
  );
}
