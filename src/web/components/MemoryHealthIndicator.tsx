import React from "react";
import { ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { clsx } from "clsx";

export type MemoryHealthStatus = "healthy" | "modified" | "missing";

export function MemoryHealthIndicator({ status }: { status: MemoryHealthStatus }) {
  const config = {
    healthy: {
      icon: ShieldCheck,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      label: "Healthy",
    },
    modified: {
      icon: ShieldAlert,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      label: "Modified",
    },
    missing: { icon: ShieldOff, color: "text-red-500", bg: "bg-red-500/10", label: "Missing" },
  }[status];

  return (
    <div
      className={clsx(
        "flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-800",
        config.bg,
      )}
    >
      <config.icon className={clsx("w-4 h-4", config.color)} />
      <span className="text-xs font-medium text-slate-300">Memory: {config.label}</span>
    </div>
  );
}
