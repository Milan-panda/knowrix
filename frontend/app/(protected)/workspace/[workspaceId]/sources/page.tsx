"use client";

import { useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";
import { SourceList } from "@/components/sources/source-list";
import { AddSourceModal } from "@/components/sources/add-source-modal";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
  created_at: string;
  last_job_error?: string | null;
}

export default function SourcesPage() {
  const { currentWorkspace, canManageSources } = useWorkspace();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchSources = useCallback((silent = false) => {
    if (!currentWorkspace) return;
    if (!silent) setLoading(true);
    api<Source[]>(`/api/v1/sources?workspace_id=${currentWorkspace.id}`)
      .then(setSources)
      .catch(() => setSources([]))
      .finally(() => { if (!silent) setLoading(false); });
  }, [currentWorkspace]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Poll for status changes while any source is processing (silent = no skeleton flicker)
  useEffect(() => {
    const hasProcessing = sources.some((s) => s.status === "processing");
    if (!hasProcessing) return;

    const interval = setInterval(() => fetchSources(true), 3000);
    return () => clearInterval(interval);
  }, [sources, fetchSources]);

  return (
    <div className="flex-1 space-y-6 p-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sources</h2>
          <p className="text-muted-foreground">
            Manage the knowledge sources in this workspace. Code (e.g. GitHub) is indexed by
            function/class boundaries (AST) when supported; in Chat, citations show
            <span className="font-medium text-foreground/80"> (function name)</span> or
            <span className="font-medium text-foreground/80"> (class name)</span> when semantic chunking was used.
          </p>
          {!canManageSources && (
            <p className="mt-2 text-sm text-muted-foreground">
              Only admins and owners can add or remove sources.
            </p>
          )}
        </div>
        {canManageSources && sources.length > 0 && (
          <Button onClick={() => setShowModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add source
          </Button>
        )}
      </div>

      <SourceList
        sources={sources}
        loading={loading}
        canManageSources={canManageSources}
        onAddSource={() => setShowModal(true)}
        onSourceDeleted={fetchSources}
        onSourceReindexed={fetchSources}
      />

      {currentWorkspace && (
        <AddSourceModal
          open={showModal}
          onOpenChange={setShowModal}
          workspaceId={currentWorkspace.id}
          onSourceAdded={fetchSources}
        />
      )}
    </div>
  );
}
