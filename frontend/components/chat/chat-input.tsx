"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, Paperclip } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
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
    onSend(trimmed);
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
      <div className="mt-1.5 flex gap-3 text-[10px] font-mono text-muted-foreground">
        <span><kbd className="rounded border bg-muted px-1">↵</kbd> send</span>
        <span><kbd className="rounded border bg-muted px-1">⇧↵</kbd> newline</span>
      </div>
    </div>
  );
}
