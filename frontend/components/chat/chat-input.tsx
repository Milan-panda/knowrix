"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, Filter, Paperclip, X } from "lucide-react";

interface SelectedContextChip {
  id: string;
  label: string;
}

interface ChatInputProps {
  onSend: (text: string, reasoning: boolean) => void;
  onOpenContextFilter: () => void;
  contextSummary: string;
  selectedContextChips: SelectedContextChip[];
  onRemoveContext: (id: string) => void;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onOpenContextFilter,
  contextSummary,
  selectedContextChips,
  onRemoveContext,
  disabled,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`;
    }
  }, [value]);

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, reasoning);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div>
      {selectedContextChips.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {selectedContextChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onRemoveContext(chip.id)}
              className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary transition hover:bg-primary/15"
              disabled={disabled}
              title={`Remove ${chip.label}`}
            >
              <span className="max-w-[180px] truncate">{chip.label}</span>
              <X className="h-3 w-3 opacity-70" />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border bg-muted/30 p-2 transition-colors focus-within:border-primary/40">
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Ask about your code, docs, or anything in this workspace..."
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" disabled>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8"
            disabled={!value.trim() || disabled}
            onClick={handleSend}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          disabled={disabled}
          onClick={onOpenContextFilter}
        >
          <Filter className="mr-1.5 h-3.5 w-3.5" />
          Filter Context
        </Button>
        <span className="text-muted-foreground">{contextSummary}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Mode</span>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={reasoning ? "ghost" : "secondary"}
            className="h-7 px-2.5 text-xs"
            disabled={disabled}
            onClick={() => setReasoning(false)}
          >
            Fast
          </Button>
          <Button
            type="button"
            size="sm"
            variant={reasoning ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            disabled={disabled}
            onClick={() => setReasoning(true)}
          >
            Reasoning
          </Button>
        </div>
      </div>
      <div className="mt-1.5 flex gap-3 text-[10px] font-mono text-muted-foreground">
        <span><kbd className="rounded border bg-muted px-1">↵</kbd> send</span>
        <span><kbd className="rounded border bg-muted px-1">⇧↵</kbd> newline</span>
      </div>
    </div>
  );
}
