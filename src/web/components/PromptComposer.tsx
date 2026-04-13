import React, { useState, useMemo, useEffect } from "react";
import { Send, Zap, Shield, Search, Terminal, LucideIcon, Quote, X, FilePlus } from "lucide-react";
import { clsx } from "clsx";
import type { Provider, TaskRole } from "../../core/types.js";
import type { UsageSnapshot } from "../../prober/probe-orchestrator.js";
import type { AffinityRankings } from "../../core/provider-router.js";
import { routeTask } from "../../core/provider-router.js";

interface PromptComposerProps {
  onLaunch: (
    task: string,
    options: { provider?: Provider | undefined; role?: TaskRole | undefined },
  ) => void;
  usageSnapshots: Record<string, UsageSnapshot>;
  affinityRankings?: AffinityRankings | undefined;
  isLaunching?: boolean;
  initialExcerpts?: string[];
}

const ROLES: { value: TaskRole; label: string; icon: LucideIcon }[] = [
  { value: "plan", label: "Plan", icon: Search },
  { value: "implement", label: "Implement", icon: Terminal },
  { value: "review", label: "Review", icon: Shield },
  { value: "research", label: "Research", icon: Zap },
  { value: "custom", label: "Custom", icon: Send },
];

export function PromptComposer({
  onLaunch,
  usageSnapshots,
  affinityRankings,
  isLaunching,
  initialExcerpts = [],
}: PromptComposerProps) {
  const [task, setTask] = useState("");
  const [role, setRole] = useState<TaskRole>("implement");
  const [providerOverride, setProviderOverride] = useState<Provider | "auto">("auto");
  const [excerpts, setExcerpts] = useState<string[]>(initialExcerpts);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFileAdd, setShowFileAdd] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");

  // Sync excerpts if initialExcerpts changes (e.g. from App state)
  useEffect(() => {
    if (initialExcerpts.length > 0) {
      setExcerpts((prev: string[]) => {
        const unique = new Set([...prev, ...initialExcerpts]);
        return Array.from(unique);
      });
    }
  }, [initialExcerpts]);

  const snapshotsMap = useMemo(() => {
    const map = new Map<Provider, UsageSnapshot>();
    Object.values(usageSnapshots).forEach((s: UsageSnapshot) => {
      map.set(s.provider, s);
    });
    return map;
  }, [usageSnapshots]);

  const suggestion = useMemo(() => {
    return routeTask(role, snapshotsMap, affinityRankings);
  }, [role, snapshotsMap, affinityRankings]);

  const handleLaunch = () => {
    if (!task.trim() || isLaunching) return;

    // Assemble final task with excerpts and files if present
    let finalTask = task;
    if (excerpts.length > 0) {
      finalTask +=
        "\n\n### CONTEXT EXCERPTS\n\n" + excerpts.map((e: string) => `> ${e}`).join("\n\n---\n\n");
    }
    if (attachedFiles.length > 0) {
      finalTask +=
        "\n\n### ATTACHED FILES\n\n" + attachedFiles.map((f: string) => `- ${f}`).join("\n");
    }

    onLaunch(finalTask, {
      role,
      provider: providerOverride === "auto" ? undefined : providerOverride,
    });
    setTask("");
    setExcerpts([]);
    setAttachedFiles([]);
  };

  const removeExcerpt = (index: number) => {
    setExcerpts((prev: string[]) => {
      return prev.filter((_, i) => i !== index);
    });
  };

  const addFile = () => {
    if (newFilePath.trim()) {
      setAttachedFiles((prev: string[]) => {
        return [...new Set([...prev, newFilePath.trim()])];
      });
      setNewFilePath("");
      setShowFileAdd(false);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev: string[]) => {
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-900 border border-slate-800 rounded-lg shadow-xl relative overflow-hidden group/composer">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => {
                setRole(r.value);
              }}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                role === r.value
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700",
              )}
            >
              <r.icon className="w-3.5 h-3.5" />
              {r.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            setShowFileAdd(!showFileAdd);
          }}
          className={clsx(
            "p-1.5 rounded-md transition-colors border",
            showFileAdd
              ? "bg-blue-900/20 border-blue-500 text-blue-400"
              : "bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-300",
          )}
          title="Attach Project File"
        >
          <FilePlus className="w-4 h-4" />
        </button>
      </div>

      {showFileAdd && (
        <div className="p-3 bg-slate-950 border border-blue-900/30 rounded-md flex gap-2 animate-in slide-in-from-top-2 duration-200">
          <input
            type="text"
            value={newFilePath}
            onChange={(e) => {
              setNewFilePath(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addFile();
              }
            }}
            placeholder="File path (e.g. src/core/types.ts)"
            className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <button
            onClick={() => {
              addFile();
            }}
            className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-500"
          >
            ADD
          </button>
        </div>
      )}

      {(excerpts.length > 0 || attachedFiles.length > 0) && (
        <div className="space-y-3 max-h-60 overflow-auto p-2 bg-slate-950/50 rounded border border-slate-800/50">
          {excerpts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">
                <Quote className="w-3 h-3" /> Attached Excerpts ({excerpts.length})
              </div>
              <div className="grid grid-cols-1 gap-2">
                {excerpts.map((e: string, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-400 relative group/excerpt"
                  >
                    <div className="flex-1 line-clamp-2 italic">"{e}"</div>
                    <button
                      onClick={() => {
                        removeExcerpt(i);
                      }}
                      className="p-1 hover:bg-slate-800 rounded text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">
                <FilePlus className="w-3 h-3" /> Attached Files ({attachedFiles.length})
              </div>
              <div className="grid grid-cols-1 gap-2">
                {attachedFiles.map((f: string, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-slate-900 border border-slate-800 rounded text-xs text-slate-300 font-mono"
                  >
                    <div className="truncate">{f}</div>
                    <button
                      onClick={() => {
                        removeFile(i);
                      }}
                      className="p-1 hover:bg-slate-800 rounded text-slate-600 hover:text-red-400 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <textarea
          value={task}
          onChange={(e) => {
            setTask(e.target.value);
          }}
          placeholder="What needs to be done?"
          className="w-full h-32 p-4 bg-slate-950 border border-slate-800 rounded-md text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 resize-none transition-all"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleLaunch();
            }
          }}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-3">
          <div className="text-[10px] text-slate-500 flex items-center gap-2">
            <span className="hidden sm:inline">⌘+Enter to launch</span>
            <div className="h-3 w-px bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Routing:</span>
              <select
                value={providerOverride}
                onChange={(e) => {
                  setProviderOverride(e.target.value as Provider | "auto");
                }}
                className="bg-transparent text-blue-400 focus:outline-none cursor-pointer hover:text-blue-300 transition-colors"
              >
                <option value="auto">Auto ({suggestion?.suggested ?? "none"})</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="gemini">Gemini</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => {
              handleLaunch();
            }}
            disabled={!task.trim() || isLaunching}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-md font-medium transition-all shadow-lg shadow-blue-900/20"
          >
            {isLaunching ? <Zap className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
            Launch
          </button>
        </div>
      </div>

      {suggestion && providerOverride === "auto" && (
        <div className="text-[10px] text-slate-500 italic px-1">{suggestion.reason}</div>
      )}
    </div>
  );
}
