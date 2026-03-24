"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatInput } from "@/components/chat/chat-input";
import { ContextFilterDrawer } from "@/components/chat/context-filter-drawer";
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

interface ChatThreadDTO {
  id: string;
  title: string;
  selected_source_ids?: string[] | null;
}

interface ContextGroup {
  id: string;
  workspace_id: string;
  name: string;
  is_system: boolean;
  source_ids: string[];
  sources_count: number;
}

interface SelectedContextChip {
  id: string;
  label: string;
}

export default function ChatPage() {
  const { currentWorkspace } = useWorkspace();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");

  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<ContextGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const isStreamingRef = useRef(false);
  const loadedThreadRef = useRef<string | null>(null);
  const selectionInitializedRef = useRef(false);
  const storageKey = currentWorkspace ? `chat:contextSelection:${currentWorkspace.id}` : null;

  // Fetch workspace sources
  useEffect(() => {
    if (!currentWorkspace) return;
    selectionInitializedRef.current = false;
    api<Source[]>(`/api/v1/sources?workspace_id=${currentWorkspace.id}`)
      .then((srcs) => {
        setSources(srcs);
        const readyIds = new Set(srcs.filter((s) => s.status === "ready").map((s) => s.id));
        if (!selectionInitializedRef.current) {
          const storedRaw = storageKey ? window.localStorage.getItem(storageKey) : null;
          if (storedRaw) {
            try {
              const stored = JSON.parse(storedRaw) as { sourceIds?: string[]; groupIds?: string[] };
              const filteredSources = (stored.sourceIds || []).filter((id) => readyIds.has(id));
              setSelectedSourceIds(new Set(filteredSources));
              setSelectedGroupIds(new Set(stored.groupIds || []));
            } catch {
              setSelectedSourceIds(new Set());
              setSelectedGroupIds(new Set());
            }
          } else {
            // New default: no preselected context to avoid accidental broad retrieval.
            setSelectedSourceIds(new Set());
            setSelectedGroupIds(new Set());
          }
          selectionInitializedRef.current = true;
        } else {
          // Keep current intent but drop sources that are no longer ready.
          setSelectedSourceIds((prev) => new Set(Array.from(prev).filter((id) => readyIds.has(id))));
        }
      })
      .catch(() => {});

    api<ContextGroup[]>(`/api/v1/context-groups?workspace_id=${currentWorkspace.id}`)
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [currentWorkspace, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        sourceIds: Array.from(selectedSourceIds),
        groupIds: Array.from(selectedGroupIds),
      }),
    );
  }, [selectedSourceIds, selectedGroupIds, storageKey]);

  // Load thread from URL param
  useEffect(() => {
    if (threadParam && threadParam !== loadedThreadRef.current && currentWorkspace) {
      loadedThreadRef.current = threadParam;
      setActiveThreadId(threadParam);
      api<ChatThreadDTO[]>(`/api/v1/chat/threads?workspace_id=${currentWorkspace.id}`)
        .then((threads) => {
          const thread = threads.find((t) => t.id === threadParam);
          if (!thread?.selected_source_ids) return;
          const nextSources = new Set(thread.selected_source_ids);
          setSelectedSourceIds(nextSources);
          setSelectedGroupIds(
            new Set(
              groups
                .filter((g) => g.source_ids.length > 0 && g.source_ids.every((id) => nextSources.has(id)))
                .map((g) => g.id),
            ),
          );
        })
        .catch(() => {});
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
  }, [threadParam, currentWorkspace, groups]);

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
      setSelectedGroupIds(
        new Set(
          groups
            .filter((g) => g.source_ids.length > 0 && g.source_ids.every((sid) => next.has(sid)))
            .map((g) => g.id),
        ),
      );
      return next;
    });
  }

  function selectAllSources() {
    setSelectedSourceIds(new Set(sources.filter((s) => s.status === "ready").map((s) => s.id)));
    setSelectedGroupIds(new Set(groups.map((g) => g.id)));
  }

  function clearAllSources() {
    setSelectedSourceIds(new Set());
    setSelectedGroupIds(new Set());
  }

  function toggleGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      const turningOn = !next.has(groupId);
      if (turningOn) next.add(groupId);
      else next.delete(groupId);

      setSelectedSourceIds((prevSources) => {
        const nextSources = new Set(prevSources);
        if (turningOn) {
          group.source_ids.forEach((id) => nextSources.add(id));
        } else {
          group.source_ids.forEach((id) => nextSources.delete(id));
        }
        return nextSources;
      });

      return next;
    });
  }

  const handleSend = useCallback(
    async (text: string, reasoning = false) => {
      if (!currentWorkspace || isStreamingRef.current) return;
      isStreamingRef.current = true;

      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);

      const aiMsgId = `a-${Date.now()}`;
      let fullText = "";
      const sourceFilter = Array.from(selectedSourceIds);

      if (sourceFilter.length === 0) {
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: aiMsgId,
            role: "ai",
            text: "Select at least one context source before sending. Use **all** for broad search or pick specific sources for focused answers.",
          },
        ]);
        isStreamingRef.current = false;
        return;
      }

      try {
        const stream = streamSSE("/api/v1/chat", {
          workspace_id: currentWorkspace.id,
          thread_id: activeThreadId,
          message: text,
          reasoning,
          source_ids: sourceFilter,
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

  const selectedContextChips: SelectedContextChip[] = sources
    .filter((s) => selectedSourceIds.has(s.id))
    .map((s) => ({ id: s.id, label: s.name }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatArea
        messages={messages}
        isTyping={isTyping}
        suggestions={SUGGESTIONS}
        onSuggestionClick={handleSend}
      />
      <div className="shrink-0 border-t bg-background px-4 pt-3 pb-4 space-y-2">
        <ChatInput
          onSend={handleSend}
          onOpenContextFilter={() => setIsFilterOpen(true)}
          contextSummary={`Context: ${selectedGroupIds.size} groups, ${selectedSourceIds.size} sources`}
          selectedContextChips={selectedContextChips}
          onRemoveContext={toggleSource}
          disabled={isTyping}
        />
      </div>
      <ContextFilterDrawer
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        sources={sources}
        groups={groups}
        selectedSourceIds={selectedSourceIds}
        selectedGroupIds={selectedGroupIds}
        onToggleSource={toggleSource}
        onToggleGroup={toggleGroup}
        onSelectAll={selectAllSources}
        onClearAll={clearAllSources}
      />
    </div>
  );
}
