import React, { useEffect, useMemo, useState } from "react";
import { useRelay } from "../hooks/useRelay.js";
import { ContextAssembly } from "./ContextAssembly.js";
import { ChevronRight, FilePlus, FolderOpen, Layers, Send, Sparkles, Target } from "lucide-react";
import type { ContextItem, Provider, Run } from "../../core/types.js";
import { clsx } from "clsx";
import type {
  HandoffDraftRequest,
  HandoffPreviewResult,
  ProjectFileEntry,
  SelectedExcerpt,
} from "../workflow-types.js";

interface HandoffDispatchProps {
  sourceRun: Run;
  initialExcerpts?: SelectedExcerpt[];
  onSuccess?: (newRunId: string) => void;
  onClearSelections?: () => void;
}

const PROVIDERS: Provider[] = ["claude", "codex", "gemini"];

function excerptKey(excerpt: SelectedExcerpt): string {
  return [
    excerpt.source_run_id,
    excerpt.source_file,
    excerpt.byte_start,
    excerpt.byte_end,
    excerpt.text,
  ].join(":");
}

export function HandoffDispatch({
  sourceRun,
  initialExcerpts = [],
  onSuccess,
  onClearSelections,
}: HandoffDispatchProps) {
  const { createHandoff, launchRun, listProjectFiles, previewHandoff } = useRelay();

  const defaultTargetProvider =
    PROVIDERS.find((provider) => provider !== sourceRun.provider) ?? "codex";
  const [targetProvider, setTargetProvider] = useState<Provider>(defaultTargetProvider);
  const [title, setTitle] = useState(`Handoff from ${sourceRun.run_id.slice(0, 8)}`);
  const [objective, setObjective] = useState("");
  const [requestedOutcome, setRequestedOutcome] = useState("");
  const [includeMemory, setIncludeMemory] = useState(true);
  const [selectedExcerpts, setSelectedExcerpts] = useState<SelectedExcerpt[]>(initialExcerpts);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [noteText, setNoteText] = useState("");
  const [preview, setPreview] = useState<HandoffPreviewResult | null>(null);
  const [previewCurrent, setPreviewCurrent] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState(".");
  const [browserEntries, setBrowserEntries] = useState<ProjectFileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  useEffect(() => {
    if (initialExcerpts.length === 0) {
      return;
    }

    setSelectedExcerpts((prev) => {
      const merged = new Map(prev.map((excerpt) => [excerptKey(excerpt), excerpt]));
      initialExcerpts.forEach((excerpt) => {
        merged.set(excerptKey(excerpt), excerpt);
      });
      return Array.from(merged.values());
    });
  }, [initialExcerpts]);

  useEffect(() => {
    setPreviewCurrent(false);
  }, [
    targetProvider,
    title,
    objective,
    requestedOutcome,
    includeMemory,
    selectedExcerpts,
    attachedFiles,
    noteText,
  ]);

  useEffect(() => {
    if (!showFileBrowser) {
      return;
    }

    setIsLoadingFiles(true);
    listProjectFiles(browserPath)
      .then((entries) => {
        setBrowserEntries(entries);
      })
      .catch(console.error)
      .finally(() => {
        setIsLoadingFiles(false);
      });
  }, [browserPath, listProjectFiles, showFileBrowser]);

  const draftContextItems = useMemo<ContextItem[]>(() => {
    const items: ContextItem[] = [];

    if (includeMemory) {
      items.push({
        type: "memory",
        content: {
          hash: sourceRun.memory_hash,
          content_ref: "AGENTS.md",
        },
      });
    }

    selectedExcerpts.forEach((excerpt) => {
      items.push({
        type: "excerpt",
        content: {
          ...excerpt,
          sha256: "preview",
        },
      });
    });

    attachedFiles.forEach((filePath) => {
      items.push({
        type: "file",
        content: {
          original_path: filePath,
          snapshot_path: "PENDING_SNAPSHOT",
          sha256: "preview",
        },
      });
    });

    if (noteText.trim()) {
      items.push({
        type: "note",
        content: {
          text: noteText.trim(),
        },
      });
    }

    return items;
  }, [attachedFiles, includeMemory, noteText, selectedExcerpts, sourceRun.memory_hash]);

  const displayedContextItems =
    previewCurrent && preview ? preview.context_items : draftContextItems;

  const buildDraftRequest = (): HandoffDraftRequest => ({
    source_run_id: sourceRun.run_id,
    target_provider: targetProvider,
    title,
    objective,
    include_memory: includeMemory,
    ...(requestedOutcome.trim() ? { requested_outcome: requestedOutcome.trim() } : {}),
    ...(selectedExcerpts.length > 0 ? { excerpt_inputs: selectedExcerpts } : {}),
    ...(attachedFiles.length > 0
      ? { file_inputs: attachedFiles.map((original_path) => ({ original_path })) }
      : {}),
    ...(noteText.trim() ? { note_text: noteText.trim() } : {}),
  });

  const handleRemoveContext = (index: number) => {
    let cursor = index;

    if (includeMemory) {
      if (cursor === 0) {
        setIncludeMemory(false);
        return;
      }
      cursor -= 1;
    }

    if (cursor < selectedExcerpts.length) {
      setSelectedExcerpts((prev) => prev.filter((_, itemIndex) => itemIndex !== cursor));
      return;
    }
    cursor -= selectedExcerpts.length;

    if (cursor < attachedFiles.length) {
      setAttachedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== cursor));
      return;
    }
    cursor -= attachedFiles.length;

    if (cursor === 0) {
      setNoteText("");
    }
  };

  const handlePreview = async () => {
    if (!title.trim() || !objective.trim()) {
      alert("Provide a title and objective before generating a preview.");
      return;
    }

    setIsPreviewing(true);
    try {
      const nextPreview = await previewHandoff(buildDraftRequest());
      setPreview(nextPreview);
      setPreviewCurrent(true);
    } catch (err: unknown) {
      console.error("Failed to preview handoff:", err);
      alert("Failed to generate handoff preview.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleDispatch = async () => {
    if (!title.trim() || !objective.trim()) {
      alert("Provide a title and objective before dispatching.");
      return;
    }

    if (!preview || !previewCurrent) {
      alert("Generate a current prompt preview before dispatching.");
      return;
    }

    setIsDispatching(true);
    try {
      const handoff = await createHandoff(buildDraftRequest());
      const newRun = await launchRun(handoff.final_prompt, {
        provider: targetProvider,
        parentRunId: sourceRun.run_id,
        handoffId: handoff.handoff_id,
        role: "implement",
      });

      setSelectedExcerpts([]);
      setAttachedFiles([]);
      setNoteText("");
      setPreview(null);
      setPreviewCurrent(false);
      onClearSelections?.();
      onSuccess?.(newRun.run_id);
    } catch (err: unknown) {
      console.error("Dispatch failed:", err);
      alert("Failed to dispatch handoff.");
    } finally {
      setIsDispatching(false);
    }
  };

  const navigateUp = () => {
    if (browserPath === ".") {
      return;
    }

    const segments = browserPath.split("/").filter(Boolean);
    segments.pop();
    setBrowserPath(segments.length > 0 ? segments.join("/") : ".");
  };

  const addFile = (filePath: string) => {
    setAttachedFiles((prev) => Array.from(new Set([...prev, filePath])));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-600/20 p-2">
            <Send className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Dispatch Handoff
            </h3>
            <p className="font-mono text-[10px] text-slate-500">From: {sourceRun.run_id}</p>
          </div>
        </div>

        {preview && (
          <div className="text-right text-[11px] text-slate-400">
            <div>{preview.estimated_bytes} bytes</div>
            <div>~{preview.estimated_tokens} tokens</div>
          </div>
        )}
      </div>

      <div className="space-y-6 p-6">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
            <Target className="w-3.5 h-3.5" /> Target Provider
          </label>
          <div className="flex gap-2">
            {PROVIDERS.map((provider) => (
              <button
                key={provider}
                onClick={() => {
                  setTargetProvider(provider);
                }}
                className={clsx(
                  "flex flex-1 flex-col items-center gap-2 rounded-lg border px-4 py-3 text-sm font-bold transition-all",
                  targetProvider === provider
                    ? "border-blue-500 bg-blue-600/20 text-blue-100 shadow-inner"
                    : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600",
                )}
              >
                <span className="text-[10px] uppercase tracking-tighter opacity-60">Agent</span>
                {provider}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Layers className="w-3.5 h-3.5" /> Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder="Handoff title..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Sparkles className="w-3.5 h-3.5" /> Objective
            </label>
            <textarea
              value={objective}
              onChange={(event) => {
                setObjective(event.target.value);
              }}
              placeholder="What should the next agent achieve?"
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
              <Layers className="w-3.5 h-3.5" /> Requested Outcome
            </label>
            <input
              type="text"
              value={requestedOutcome}
              onChange={(event) => {
                setRequestedOutcome(event.target.value);
              }}
              placeholder="e.g. fixed bug, new tests, updated docs"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Context Draft</h4>
                <p className="text-xs text-slate-500">
                  Review the exact material that will feed the target prompt.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={includeMemory}
                  onChange={(event) => {
                    setIncludeMemory(event.target.checked);
                  }}
                  className="rounded border-slate-700 bg-slate-950"
                />
                Include AGENTS.md memory
              </label>
            </div>

            <ContextAssembly
              items={displayedContextItems}
              onRemove={(index) => {
                handleRemoveContext(index);
              }}
            />

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Operator Note
              </label>
              <textarea
                value={noteText}
                onChange={(event) => {
                  setNoteText(event.target.value);
                }}
                rows={3}
                placeholder="Optional note to include in the handoff context."
                className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 transition-colors focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Project Files</h4>
                <p className="text-xs text-slate-500">
                  Browse from the project root and attach files to the handoff.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowFileBrowser((prev) => !prev);
                }}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
              >
                <FolderOpen className="mr-2 inline h-3.5 w-3.5" />
                {showFileBrowser ? "Hide Browser" : "Browse Files"}
              </button>
            </div>

            {selectedExcerpts.length > 0 && (
              <div className="rounded-md border border-blue-900/40 bg-blue-950/20 px-3 py-2 text-xs text-blue-200">
                {selectedExcerpts.length} excerpt{selectedExcerpts.length === 1 ? "" : "s"} selected
                from the source run.
              </div>
            )}

            {showFileBrowser && (
              <div className="space-y-3 rounded-md border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-mono">{browserPath}</span>
                  <button
                    onClick={() => {
                      navigateUp();
                    }}
                    disabled={browserPath === "."}
                    className="rounded border border-slate-700 px-2 py-1 disabled:text-slate-600"
                  >
                    Up
                  </button>
                </div>

                <div className="max-h-52 space-y-2 overflow-auto">
                  {isLoadingFiles ? (
                    <p className="text-xs text-slate-500">Loading files...</p>
                  ) : browserEntries.length === 0 ? (
                    <p className="text-xs text-slate-500">No files found in this directory.</p>
                  ) : (
                    browserEntries.map((entry) => (
                      <div
                        key={entry.path}
                        className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs"
                      >
                        <button
                          onClick={() => {
                            if (entry.isDirectory) {
                              setBrowserPath(entry.path);
                            }
                          }}
                          className={clsx(
                            "flex-1 truncate text-left font-mono",
                            entry.isDirectory
                              ? "text-slate-200 hover:text-white"
                              : "text-slate-300",
                          )}
                        >
                          {entry.isDirectory ? `[${entry.name}]` : entry.path}
                        </button>
                        {!entry.isDirectory && (
                          <button
                            onClick={() => {
                              addFile(entry.path);
                            }}
                            className="ml-3 rounded border border-blue-900/40 bg-blue-950/20 px-2 py-1 text-[11px] font-semibold text-blue-200"
                          >
                            <FilePlus className="mr-1 inline h-3 w-3" />
                            Add
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="text-xs text-slate-500">Attached files: {attachedFiles.length}</div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Prompt Preview</h4>
              <p className="text-xs text-slate-500">
                Generate the exact provider-specific prompt before launching.
              </p>
            </div>
            <button
              onClick={() => {
                handlePreview().catch(console.error);
              }}
              disabled={isPreviewing}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
            >
              {isPreviewing
                ? "Generating..."
                : previewCurrent
                  ? "Refresh Preview"
                  : "Generate Preview"}
            </button>
          </div>

          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <span>{preview.estimated_bytes} bytes</span>
                <span>~{preview.estimated_tokens} tokens</span>
                <span>
                  {preview.context_items.length} context item
                  {preview.context_items.length === 1 ? "" : "s"}
                </span>
                {!previewCurrent && <span className="text-amber-300">Preview is stale</span>}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300">
                {preview.final_prompt}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No preview generated yet.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={() => {
              handlePreview().catch(console.error);
            }}
            disabled={isPreviewing}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-600 disabled:opacity-50"
          >
            {isPreviewing ? "Generating Preview..." : "Generate Preview"}
          </button>
          <button
            onClick={() => {
              handleDispatch().catch(console.error);
            }}
            disabled={isDispatching || !preview || !previewCurrent}
            className="group flex items-center justify-center gap-3 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-xl shadow-blue-900/20 transition-all hover:bg-blue-500 disabled:opacity-50"
          >
            {isDispatching ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>Dispatching...</span>
              </>
            ) : (
              <>
                <Send className="w-5 h-5 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
                <span>Dispatch & Launch Run</span>
                <ChevronRight className="w-4 h-4 opacity-50" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
