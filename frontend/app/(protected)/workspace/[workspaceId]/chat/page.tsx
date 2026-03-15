"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatInput } from "@/components/chat/chat-input";
import { ContextSelector } from "@/components/chat/context-selector";
import type { Message, Citation } from "@/components/chat/message-bubble";
import { useWorkspace } from "@/lib/workspace-context";
import { api, streamSSE } from "@/lib/api";

const SUGGESTIONS = [
  "How does auth work in this codebase?",
  "Explain the ingestion pipeline",
  "What changed in the API layer recently?",
  "Show me the Qdrant collection schema",
];

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
}

interface ChatMessageDTO {
  id: string;
  role: string;
  content: string;
  sources_json: string | null;
}

export default function ChatPage() {
  const { currentWorkspace } = useWorkspace();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");

  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const isStreamingRef = useRef(false);
  const loadedThreadRef = useRef<string | null>(null);

  // Fetch workspace sources
  useEffect(() => {
    if (!currentWorkspace) return;
    api<Source[]>(`/api/v1/sources?workspace_id=${currentWorkspace.id}`)
      .then((srcs) => {
        setSources(srcs);
        setSelectedSourceIds(new Set(srcs.filter((s) => s.status === "ready").map((s) => s.id)));
      })
      .catch(() => {});
  }, [currentWorkspace]);

  // Load thread from URL param
  useEffect(() => {
    if (threadParam && threadParam !== loadedThreadRef.current) {
      loadedThreadRef.current = threadParam;
      setActiveThreadId(threadParam);
      api<ChatMessageDTO[]>(`/api/v1/chat/threads/${threadParam}/messages`)
        .then((msgs) =>
          setMessages(
            msgs.map((m) => ({
              id: m.id,
              role: m.role === "user" ? "user" : "ai",
              text: m.content,
              citations: m.sources_json ? parseCitations(m.sources_json) : undefined,
            })),
          ),
        )
        .catch(() => setMessages([]));
    } else if (!threadParam) {
      loadedThreadRef.current = null;
      setActiveThreadId(null);
      setMessages([]);
    }
  }, [threadParam]);

  function parseCitations(json: string): Citation[] {
    try {
      const chunks = JSON.parse(json) as Array<{
        source_name: string;
        source_type: string;
        file_path?: string;
        page_url?: string;
      }>;
      return chunks.map((c, i) => ({
        index: i + 1,
        label: c.file_path ? `${c.source_name}:${c.file_path}` : c.source_name,
        url: c.page_url || undefined,
        type: (c.source_type as Citation["type"]) || "web",
      }));
    } catch {
      return [];
    }
  }

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const handleSend = useCallback(
    async (text: string) => {
      if (!currentWorkspace || isStreamingRef.current) return;
      isStreamingRef.current = true;

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);

      const aiMsgId = `a-${Date.now()}`;
      let fullText = "";
      const sourceFilter = Array.from(selectedSourceIds);

      try {
        const stream = streamSSE("/api/v1/chat", {
          workspace_id: currentWorkspace.id,
          thread_id: activeThreadId,
          message: text,
          source_ids: sourceFilter.length > 0 ? sourceFilter : undefined,
        });

        let sourcesReceived: Message["citations"] = [];
        let firstToken = true;

        for await (const { event, data } of stream) {
          if (event === "sources") {
            try {
              const chunks = JSON.parse(data) as Array<{
                source_name: string;
                source_type: string;
                file_path?: string;
                page_url?: string;
              }>;
              sourcesReceived = chunks.map((c, i) => ({
                index: i + 1,
                label: c.file_path ? `${c.source_name}:${c.file_path}` : c.source_name,
                url: c.page_url || undefined,
                type: (c.source_type as Citation["type"]) || "web",
              }));
            } catch {}
          } else if (event === "token") {
            try {
              const { text: token } = JSON.parse(data);
              if (token) {
                fullText += token;
                if (firstToken) {
                  firstToken = false;
                  setIsTyping(false);
                  setMessages((prev) => [
                    ...prev,
                    { id: aiMsgId, role: "ai", text: fullText, citations: sourcesReceived },
                  ]);
                } else {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === aiMsgId ? { ...m, text: fullText } : m)),
                  );
                }
              }
            } catch {}
          } else if (event === "done") {
            try {
              const doneData = JSON.parse(data);
              if (doneData.thread_id && !activeThreadId) {
                setActiveThreadId(doneData.thread_id);
                loadedThreadRef.current = doneData.thread_id;
                window.history.replaceState(null, "", `?thread=${doneData.thread_id}`);
                window.dispatchEvent(new CustomEvent("thread-created"));
              }
            } catch {}
            break;
          }
        }
      } catch (err) {
        setIsTyping(false);
        const errorText = err instanceof Error ? err.message : "Failed to get a response";
        setMessages((prev) => [
          ...prev,
          { id: aiMsgId, role: "ai", text: `**Error:** ${errorText}` },
        ]);
      } finally {
        setIsTyping(false);
        isStreamingRef.current = false;
      }
    },
    [currentWorkspace, activeThreadId, selectedSourceIds],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatArea
        messages={messages}
        isTyping={isTyping}
        suggestions={SUGGESTIONS}
        onSuggestionClick={handleSend}
      />
      <div className="shrink-0 border-t bg-background px-4 pt-3 pb-4 space-y-2">
        <ContextSelector
          sources={sources}
          selectedIds={selectedSourceIds}
          onToggle={toggleSource}
        />
        <ChatInput onSend={handleSend} disabled={isTyping} />
      </div>
    </div>
  );
}
