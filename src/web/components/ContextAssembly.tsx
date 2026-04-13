import React from "react";
import { Paperclip, FileText, Quote, StickyNote, Shield } from "lucide-react";
import type { ContextItem } from "../../core/types.js";

interface ContextAssemblyProps {
  items: ContextItem[];
  onRemove?: (index: number) => void;
}

export function ContextAssembly({ items, onRemove }: ContextAssemblyProps) {
  return (
    <div className="space-y-3 p-4 bg-slate-900/50 rounded-lg border border-slate-800">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <Paperclip className="w-4 h-4" /> Context Assembly
      </h3>
      <div className="grid grid-cols-1 gap-2">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No context items selected.</p>
        ) : (
          items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 bg-slate-800 border border-slate-700 rounded-md group"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {item.type === "memory" && <Shield className="w-4 h-4 text-emerald-400" />}
                {item.type === "file" && <FileText className="w-4 h-4 text-blue-400" />}
                {item.type === "excerpt" && <Quote className="w-4 h-4 text-amber-400" />}
                {item.type === "note" && <StickyNote className="w-4 h-4 text-purple-400" />}
                <span className="text-xs text-slate-300 truncate font-mono">
                  {item.type === "file"
                    ? item.content.original_path
                    : item.type === "excerpt"
                      ? `Excerpt: ${item.content.source_file}`
                      : item.type === "memory"
                        ? "AGENTS.md (Memory)"
                        : "Note"}
                </span>
              </div>
              {onRemove && (
                <button
                  onClick={() => {
                    onRemove(i);
                  }}
                  className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className="text-lg">&times;</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
