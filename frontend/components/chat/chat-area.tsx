"use client";

import { useRef, useEffect } from "react";
import { MessageBubble, type Message } from "./message-bubble";

interface ChatAreaProps {
  messages: Message[];
  isTyping?: boolean;
  suggestions?: string[];
  onSuggestionClick?: (text: string) => void;
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 px-6">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-primary/10 text-xs">
        ✦
      </div>
      <div className="flex items-center gap-1 py-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatArea({
  messages,
  isTyping,
  suggestions,
  onSuggestionClick,
}: ChatAreaProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  if (messages.length === 0 && !isTyping) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <div className="mb-4 text-4xl opacity-30">✦</div>
        <h3 className="text-xl font-bold tracking-tight">
          Ask anything about your codebase
        </h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
          ContextIQ searches across all your sources -- PDFs, GitHub repos, and
          web docs -- to give you grounded, cited answers.
        </p>
        {suggestions && suggestions.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-lg">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="rounded-full border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary hover:bg-primary/5"
                onClick={() => onSuggestionClick?.(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto py-6">
      <div className="mt-auto" />
      <div className="flex flex-col gap-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isTyping && <TypingIndicator />}
      </div>
      <div ref={endRef} />
    </div>
  );
}
