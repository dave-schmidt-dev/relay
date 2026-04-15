import React, { useState } from "react";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Shield,
  ChevronDown,
  ChevronUp,
  Cpu,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { UsageSnapshot } from "../../prober/probe-orchestrator.js";
import type { ClaudeUsageSnapshot } from "../../prober/claude-probe.js";
import type { CodexUsageSnapshot } from "../../prober/codex-probe.js";
import type { GeminiUsageSnapshot } from "../../prober/gemini-probe.js";
import type { GithubUsageSnapshot } from "../../prober/github-probe.js";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UsageDashboardProps {
  snapshots: Record<string, UsageSnapshot>;
  onProbe: () => void;
  isProbing?: boolean;
}

export function UsageDashboard({ snapshots, onProbe, isProbing }: UsageDashboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const snapshotsArray = Object.values(snapshots);

  if (!isExpanded) {
    return (
      <div className="flex flex-col gap-2 p-3 bg-slate-900/50 border border-slate-800 rounded-lg">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => {
              setIsExpanded(true);
            }}
          >
            <Cpu className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-200">
              Quotas
            </span>
            <ChevronDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
          </div>
          <button
            onClick={onProbe}
            disabled={isProbing}
            className="p-1.5 rounded-md hover:bg-slate-800 disabled:opacity-50 text-slate-400 hover:text-blue-400 transition-all"
            title="Probe Now"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isProbing && "animate-spin text-blue-500")} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {snapshotsArray.map((s) => (
            <ProviderMiniStatus key={s.provider} snapshot={s} />
          ))}
          {snapshotsArray.length === 0 && (
            <span className="text-[10px] text-slate-600">No data</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-900 border border-slate-800 rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-2 cursor-pointer group"
          onClick={() => {
            setIsExpanded(false);
          }}
        >
          <Clock className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100 group-hover:text-white">
            Provider Quotas
          </h2>
          <ChevronUp className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
        </div>
        <button
          onClick={onProbe}
          disabled={isProbing}
          className={cn(
            "p-2 rounded-md transition-all flex items-center gap-2 text-xs font-medium",
            isProbing
              ? "bg-slate-800 text-blue-400 cursor-not-allowed"
              : "bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-600/30",
          )}
          title="Probe Now"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isProbing && "animate-spin")} />
          {isProbing ? "Probing..." : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
        {snapshotsArray.map((snapshot) => (
          <ProviderCard key={snapshot.provider} snapshot={snapshot} />
        ))}
        {snapshotsArray.length === 0 && (
          <div className="text-slate-500 text-sm py-4 text-center border border-dashed border-slate-800 rounded-md">
            No usage data available.
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderMiniStatus({ snapshot }: { snapshot: UsageSnapshot }) {
  const isError = !!snapshot.error;
  const isStale = snapshot.stale;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors",
        isError
          ? "bg-red-900/10 border-red-900/30 text-red-500"
          : isStale
            ? "bg-amber-900/10 border-amber-900/30 text-amber-500"
            : "bg-slate-800 border-slate-700 text-slate-300",
      )}
      title={`${snapshot.provider}: ${isError ? (snapshot.error ?? "Error") : "OK"}`}
    >
      <span className="capitalize">{snapshot.provider.charAt(0)}</span>
      {isError ? (
        <AlertTriangle className="w-2.5 h-2.5" />
      ) : (
        <div
          className={cn("w-1.5 h-1.5 rounded-full", isStale ? "bg-amber-500" : "bg-emerald-500")}
        />
      )}
    </div>
  );
}

function ProviderCard({ snapshot }: { snapshot: UsageSnapshot }) {
  const isError = !!snapshot.error;
  const isStale = snapshot.stale;

  return (
    <div
      className={cn(
        "p-3 rounded-md border transition-all duration-200",
        isError
          ? "bg-red-900/10 border-red-800/50"
          : isStale
            ? "bg-amber-900/10 border-amber-800/50"
            : "bg-slate-800/50 border-slate-700 hover:border-slate-600",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs text-slate-200 capitalize tracking-tight">
            {snapshot.provider}
          </span>
          {isError ? (
            <AlertTriangle className="w-3 h-3 text-red-500" />
          ) : isStale ? (
            <AlertTriangle className="w-3 h-3 text-amber-500" />
          ) : (
            <CheckCircle className="w-3 h-3 text-emerald-500" />
          )}
        </div>
        <span className="text-[9px] font-medium text-slate-500 bg-slate-900/50 px-1.5 py-0.5 rounded">
          {new Date(snapshot.probedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {isError ? (
        <div
          className="text-[10px] text-red-400 italic break-words bg-red-900/20 p-2 rounded border border-red-900/30"
          title={snapshot.error ?? "Unknown error"}
        >
          {snapshot.error}
        </div>
      ) : (
        <div className="space-y-3">
          {snapshot.provider === "claude" && (
            <ClaudeMetrics data={snapshot.data as unknown as ClaudeUsageSnapshot} />
          )}
          {snapshot.provider === "codex" && (
            <CodexMetrics data={snapshot.data as unknown as CodexUsageSnapshot} />
          )}
          {snapshot.provider === "gemini" && (
            <GeminiMetrics data={snapshot.data as unknown as GeminiUsageSnapshot} />
          )}
          {snapshot.provider === "github" && (
            <GithubMetrics data={snapshot.data as unknown as GithubUsageSnapshot} />
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
  value,
}: {
  label: string;
  percent: number | null;
  reset?: string | null;
  value?: string | number | null;
}) {
  // If we have neither percent nor a display value, show "N/A"
  const hasPercent = percent !== null;
  const hasValue = value !== undefined && value !== null;

  if (!hasPercent && !hasValue)
    return (
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-600 italic">No data</span>
      </div>
    );

  const isLow = hasPercent && percent < 20;
  const isExhausted = hasPercent && percent === 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-400 font-medium">{label}</span>
        <span
          className={cn(
            "font-bold tabular-nums",
            isExhausted ? "text-red-500" : isLow ? "text-amber-500" : "text-emerald-400",
          )}
        >
          {hasValue ? value : `${String(percent)}%`}
        </span>
      </div>
      {hasPercent && (
        <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800/50">
          <div
            className={cn(
              "h-full transition-all duration-700 ease-out",
              isExhausted
                ? "bg-red-600"
                : isLow
                  ? "bg-amber-500"
                  : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]",
            )}
            style={{ width: `${String(percent)}%` }}
          />
        </div>
      )}
      {reset && (
        <div className="text-[9px] text-slate-500 flex items-center gap-1 opacity-80 leading-tight">
          <Clock className="w-2.5 h-2.5" />
          <span className="truncate">
            {reset.toLowerCase().startsWith("resets") ? reset : `Resets ${reset}`}
          </span>
        </div>
      )}
    </div>
  );
}

function IdentityBadge({ icon: Icon, text }: { icon: React.ElementType; text: string | null }) {
  if (!text) return null;
  return (
    <div className="flex items-center gap-1 text-[9px] text-slate-400 bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/50 max-w-full overflow-hidden">
      <Icon className="w-2.5 h-2.5 flex-shrink-0 opacity-70" />
      <span className="truncate">{text}</span>
    </div>
  );
}

function ClaudeMetrics({ data }: { data: ClaudeUsageSnapshot }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1 mb-1">
        <IdentityBadge icon={User} text={data.accountEmail} />
        <IdentityBadge icon={Shield} text={data.accountOrganization} />
      </div>
      <MetricBar label="Session" percent={data.sessionPercentLeft} reset={data.primaryReset} />
      <MetricBar label="Weekly" percent={data.weeklyPercentLeft} reset={data.secondaryReset} />
      {(data.opusPercentLeft !== null || data.opusReset) && (
        <MetricBar label="Opus" percent={data.opusPercentLeft} reset={data.opusReset} />
      )}
    </div>
  );
}

function CodexMetrics({ data }: { data: CodexUsageSnapshot }) {
  return (
    <div className="space-y-2.5">
      <MetricBar
        label="Credits"
        percent={null}
        value={data.credits !== null ? `$${data.credits.toFixed(2)}` : null}
      />
      <MetricBar label="5h Limit" percent={data.fiveHourPercentLeft} reset={data.fiveHourReset} />
      <MetricBar label="Weekly" percent={data.weeklyPercentLeft} reset={data.weeklyReset} />
    </div>
  );
}

function GeminiMetrics({ data }: { data: GeminiUsageSnapshot }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1 mb-1">
        <IdentityBadge icon={User} text={data.accountEmail} />
        <IdentityBadge icon={Shield} text={data.accountTier} />
      </div>
      <MetricBar label="Flash" percent={data.flashPercentLeft} reset={data.flashReset} />
      <MetricBar label="Pro" percent={data.proPercentLeft} reset={data.proReset} />
    </div>
  );
}

function GithubMetrics({ data }: { data: GithubUsageSnapshot }) {
  return (
    <div className="space-y-2.5">
      <MetricBar label="Usage" percent={data.premiumPercentLeft} reset={data.premiumReset} />
      {data.premiumRequests !== null && (
        <MetricBar label="Requests" percent={null} value={data.premiumRequests} />
      )}
    </div>
  );
}
