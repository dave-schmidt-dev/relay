import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, Info, Terminal } from "lucide-react";
import { clsx } from "clsx";
import type { SelectedExcerpt } from "../workflow-types.js";

interface RunOutputProps {
  rawContent: string;
  renderedContent?: string;
  isStreaming?: boolean;
  role?: string;
  provider?: string;
  sourceRunId?: string;
  sourceFile?: string;
  onExcerptSelect?: ((excerpt: SelectedExcerpt) => void) | undefined;
}

export function RunOutput({
  rawContent,
  renderedContent,
  isStreaming,
  role,
  provider,
  sourceRunId,
  sourceFile = "stdout.log",
  onExcerptSelect,
}: RunOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rawContentRef = useRef<HTMLPreElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [isRaw, setIsRaw] = useState(false);
  const [selectionText, setSelectionText] = useState("");

  const displayedRenderedContent = renderedContent ?? rawContent;

  const scrollToBottom = () => {
    if (scrollRef.current && !userScrolled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [displayedRenderedContent, rawContent]);

  useEffect(() => {
    setSelectionText("");
  }, [isRaw, rawContent, displayedRenderedContent]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
    setUserScrolled(!isAtBottom);
  };

  const getRawSelection = () => {
    if (!isRaw || !sourceRunId || !onExcerptSelect || !rawContentRef.current) {
      return null;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!rawContentRef.current.contains(range.commonAncestorContainer)) {
      return null;
    }

    const selectedText = selection.toString();
    if (!selectedText.trim()) {
      return null;
    }

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(rawContentRef.current);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    const startChar = prefixRange.toString().length;
    const endChar = startChar + selectedText.length;
    const encoder = new TextEncoder();
    const byteStart = encoder.encode(rawContent.slice(0, startChar)).length;
    const byteEnd = encoder.encode(rawContent.slice(0, endChar)).length;

    return {
      source_run_id: sourceRunId,
      source_file: sourceFile,
      byte_start: byteStart,
      byte_end: byteEnd,
      text: selectedText.trim(),
    } satisfies SelectedExcerpt;
  };

  const updateSelection = () => {
    const excerpt = getRawSelection();
    setSelectionText(excerpt?.text ?? "");
  };

  const captureExcerpt = () => {
    const excerpt = getRawSelection();
    if (!excerpt) {
      return;
    }

    onExcerptSelect?.(excerpt);
    setSelectionText("");
    window.getSelection()?.removeAllRanges();
  };

  const excerptCaptureEnabled = Boolean(onExcerptSelect && isRaw && sourceRunId && selectionText);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Terminal className="h-4 w-4 text-blue-400" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              {role ?? "Run"} Output
            </span>
            <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {provider}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex rounded-md border border-slate-700 bg-slate-950 p-0.5">
            <button
              onClick={() => {
                setIsRaw(false);
              }}
              className={clsx(
                "rounded px-2 py-0.5 text-[10px] font-bold transition-colors",
                !isRaw ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300",
              )}
            >
              RENDERED
            </button>
            <button
              onClick={() => {
                setIsRaw(true);
              }}
              className={clsx(
                "rounded px-2 py-0.5 text-[10px] font-bold transition-colors",
                isRaw ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300",
              )}
            >
              RAW
            </button>
          </div>

          {onExcerptSelect && (
            <button
              onClick={() => {
                captureExcerpt();
              }}
              disabled={!excerptCaptureEnabled}
              className={clsx(
                "rounded border px-2 py-1 text-[10px] font-bold transition-colors",
                excerptCaptureEnabled
                  ? "border-blue-800/50 bg-blue-900/20 text-blue-400 hover:text-blue-300"
                  : "border-slate-800 bg-slate-900 text-slate-600",
              )}
            >
              EXTRACT SELECTION
            </button>
          )}

          {isStreaming && (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              <span className="text-[10px] font-medium uppercase tracking-tighter text-blue-400">
                Streaming
              </span>
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={updateSelection}
        onKeyUp={updateSelection}
        className="flex-1 overflow-auto p-6 font-sans selection:bg-blue-500/30"
      >
        {isRaw ? (
          <pre
            ref={rawContentRef}
            className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300"
          >
            {rawContent || "Waiting for output..."}
          </pre>
        ) : (
          <div className="prose prose-invert prose-slate prose-sm max-w-none prose-pre:border prose-pre:border-slate-800 prose-pre:bg-slate-950 prose-code:text-blue-300 prose-headings:text-slate-100 prose-a:text-blue-400">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayedRenderedContent || "*Waiting for output...*"}
            </ReactMarkdown>
          </div>
        )}

        {isStreaming && !rawContent && !displayedRenderedContent && (
          <div className="flex items-center gap-2 text-sm italic text-slate-500">
            <Info className="h-4 w-4" />
            Initializing agent process...
          </div>
        )}
      </div>

      {selectionText && isRaw && onExcerptSelect && (
        <div className="border-t border-slate-800 bg-slate-950/80 px-4 py-2 text-[11px] text-slate-400">
          Selected excerpt:{" "}
          <span className="text-slate-200">
            {selectionText.slice(0, 120)}
            {selectionText.length > 120 ? "..." : ""}
          </span>
        </div>
      )}

      {userScrolled && isStreaming && (
        <button
          onClick={() => {
            setUserScrolled(false);
            scrollToBottom();
          }}
          className="absolute bottom-6 right-8 flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-all hover:bg-blue-500"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          New Output
        </button>
      )}
    </div>
  );
}
