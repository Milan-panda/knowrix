"use client";

import { X } from "lucide-react";

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
}

interface ContextSelectorProps {
  sources: Source[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

function sourceIcon(type: string) {
  if (type === "pdf" || type === "file") return "📄";
  if (type === "github") return "🐙";
  if (type === "notion") return "📓";
  if (type === "github_discussions") return "💬";
  if (type === "youtube") return "▶️";
  return "🌐";
}

export function ContextSelector({ sources, selectedIds, onToggle }: ContextSelectorProps) {
  const readySources = sources.filter((s) => s.status === "ready");

  if (readySources.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] font-mono text-muted-foreground shrink-0">
        context:
      </span>
      {readySources.map((source) => {
        const isSelected = selectedIds.has(source.id);
        return (
          <button
            key={source.id}
            onClick={() => onToggle(source.id)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono transition-all cursor-pointer border ${
              isSelected
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-muted/30 border-transparent text-muted-foreground opacity-50 hover:opacity-80"
            }`}
          >
            <span className="text-xs">{sourceIcon(source.source_type)}</span>
            <span className="max-w-[100px] truncate">{source.name}</span>
            {isSelected && (
              <X className="h-2.5 w-2.5 opacity-60 hover:opacity-100" />
            )}
          </button>
        );
      })}
    </div>
  );
}
