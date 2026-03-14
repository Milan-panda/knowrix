"use client";

import { useState } from "react";
import { Database, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, apiDelete } from "@/lib/api";

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
  created_at: string;
  last_job_error?: string | null;
}

interface SourceListProps {
  sources: Source[];
  loading: boolean;
  canManageSources?: boolean;
  onAddSource: () => void;
  onSourceDeleted?: () => void;
  onSourceReindexed?: () => void;
}

function sourceIcon(type: string) {
  if (type === "pdf" || type === "file") return "📄";
  if (type === "github") return "🐙";
  if (type === "notion") return "📓";
  if (type === "github_discussions") return "💬";
  if (type === "youtube") return "▶️";
  return "🌐";
}

function sourceTypeLabel(type: string) {
  const labels: Record<string, string> = {
    pdf: "Files",
    file: "Files",
    github: "GitHub Repo",
    web: "Web",
    notion: "Notion",
    github_discussions: "GitHub Discussions",
    youtube: "YouTube",
  };
  return labels[type] ?? type;
}

function statusVariant(status: string) {
  if (status === "ready") return "default" as const;
  if (status === "processing") return "secondary" as const;
  return "destructive" as const;
}

export function SourceList({
  sources,
  loading,
  canManageSources = true,
  onAddSource,
  onSourceDeleted,
  onSourceReindexed,
}: SourceListProps) {
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [reindexError, setReindexError] = useState<string | null>(null);

  async function handleReindex(source: Source) {
    setReindexError(null);
    setReindexingId(source.id);
    try {
      await api(`/api/v1/ingest/${source.id}/reindex`, { method: "POST" });
      onSourceReindexed?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Reindex failed";
      setReindexError(message);
    } finally {
      setReindexingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/sources/${deleteTarget.id}`);
      onSourceDeleted?.();
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="h-24" />
          </Card>
        ))}
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Database className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No sources yet</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mb-4">
            {canManageSources
              ? "Add PDFs, GitHub repos, or web URLs to start building your knowledge base."
              : "No sources have been added to this workspace yet."}
          </p>
          {canManageSources && (
            <Button onClick={onAddSource}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first source
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {reindexError && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {reindexError}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((source) => (
          <Card key={source.id} className="group transition-colors hover:border-foreground/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
                  {sourceIcon(source.source_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{source.name}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {sourceTypeLabel(source.source_type)}
                    </Badge>
                    <Badge variant={statusVariant(source.status)} className="text-[10px]">
                      {source.status === "processing" && (
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                      )}
                      {source.status}
                    </Badge>
                  </div>
                  {source.status === "error" && source.last_job_error && (
                    <p className="mt-1.5 text-xs text-destructive line-clamp-2" title={source.last_job_error}>
                      {source.last_job_error}
                    </p>
                  )}
                </div>
                {canManageSources && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => handleReindex(source)}
                      disabled={reindexingId === source.id || source.status === "processing"}
                      title="Reindex (uses AST/semantic chunking for code when supported)"
                    >
                      <RefreshCw className={`h-4 w-4 ${reindexingId === source.id ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(source)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {canManageSources && (
          <Card
            className="flex cursor-pointer items-center justify-center border-dashed transition-colors hover:border-primary hover:bg-primary/5"
            onClick={onAddSource}
          >
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <Plus className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                Add source
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                PDF &middot; GitHub &middot; URL
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete source</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and
              remove all its indexed chunks from the vector store. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
