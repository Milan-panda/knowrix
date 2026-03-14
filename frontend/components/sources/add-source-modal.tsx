"use client";

import { useState, useRef, useEffect, useCallback, FormEvent, DragEvent } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Globe,
  FileCode2,
  FileUp,
  BookOpen,
  MessageSquare,
  Youtube,
  Hash,
  FileText,
  Server,
  BookMarked,
  Lock,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export type SourceKind =
  | "web"
  | "github"
  | "files"
  | "notion"
  | "github_discussions"
  | "youtube";

type SourceOption = {
  id: SourceKind | string;
  label: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { id: "web", label: "Web URL", icon: <Globe className="h-4 w-4" /> },
  { id: "github", label: "GitHub Repo", icon: <FileCode2 className="h-4 w-4" /> },
  { id: "files", label: "Files", icon: <FileUp className="h-4 w-4" /> },
  { id: "notion", label: "Notion", icon: <BookOpen className="h-4 w-4" /> },
  { id: "github_discussions", label: "GitHub Discussions", icon: <MessageSquare className="h-4 w-4" /> },
  { id: "youtube", label: "YouTube (transcript)", icon: <Youtube className="h-4 w-4" /> },
  { id: "slack", label: "Slack", icon: <Hash className="h-4 w-4" />, comingSoon: true },
  { id: "google_docs", label: "Google Docs", icon: <FileText className="h-4 w-4" />, comingSoon: true },
  { id: "sharepoint", label: "SharePoint", icon: <Server className="h-4 w-4" />, comingSoon: true },
  { id: "docusaurus", label: "Docusaurus", icon: <BookMarked className="h-4 w-4" />, comingSoon: true },
  { id: "confluence", label: "Confluence", icon: <Lock className="h-4 w-4" />, comingSoon: true },
];

type NotionPageNode = {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  last_edited: string | null;
  parent_id: string | null;
  children: NotionPageNode[];
};

function NotionPageTree({
  pages,
  depth,
  selectedPages,
  expandedPages,
  onToggleSelect,
  onToggleExpand,
}: {
  pages: NotionPageNode[];
  depth: number;
  selectedPages: Set<string>;
  expandedPages: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}) {
  return (
    <>
      {pages.map((page) => {
        const selected = selectedPages.has(page.id);
        const expanded = expandedPages.has(page.id);
        const hasChildren = page.children && page.children.length > 0;
        return (
          <div key={page.id}>
            <button
              type="button"
              onClick={() => onToggleSelect(page.id)}
              className={cn(
                "w-full flex items-center gap-2 py-2 text-left text-sm border-b last:border-b-0 transition-colors",
                selected ? "bg-primary/5" : "hover:bg-muted/50"
              )}
              style={{ paddingLeft: `${depth * 20 + 10}px`, paddingRight: "12px" }}
            >
              {hasChildren ? (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onToggleExpand(page.id); }}
                  className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/10 transition-colors"
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                </span>
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <div className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
              )}>
                {selected && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </div>
              <span className="text-base leading-none shrink-0">{page.icon || "📄"}</span>
              <span className="truncate flex-1">{page.title}</span>
              {hasChildren && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                  {page.children.length}
                </span>
              )}
              {page.last_edited && !hasChildren && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                  {new Date(page.last_edited).toLocaleDateString()}
                </span>
              )}
            </button>
            {hasChildren && expanded && (
              <NotionPageTree
                pages={page.children}
                depth={depth + 1}
                selectedPages={selectedPages}
                expandedPages={expandedPages}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSourceAdded: () => void;
}

export function AddSourceModal({
  open,
  onOpenChange,
  workspaceId,
  onSourceAdded,
}: AddSourceModalProps) {
  const [selectedSource, setSelectedSource] = useState<SourceKind>("web");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [crawlDepth, setCrawlDepth] = useState("1");
  const [notionUrl, setNotionUrl] = useState("");
  const [ghDiscussionsUrl, setGhDiscussionsUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [connectedProviders, setConnectedProviders] = useState<Set<string>>(new Set());

  const fetchConnectors = useCallback(() => {
    if (!workspaceId) return;
    api<{ provider: string }[]>(`/api/v1/workspaces/${workspaceId}/connectors`)
      .then((list) => setConnectedProviders(new Set(list.map((c) => c.provider))))
      .catch(() => setConnectedProviders(new Set()));
  }, [workspaceId]);

  useEffect(() => {
    if (open) fetchConnectors();
  }, [open, fetchConnectors]);

  const notionConnected = connectedProviders.has("notion");
  const githubConnected = connectedProviders.has("github");
  const integrationsPath = `/workspace/${workspaceId}/connectors`;

  // Notion page browser
  const [notionMode, setNotionMode] = useState<"browse" | "url">("browse");
  const [notionPages, setNotionPages] = useState<NotionPageNode[]>([]);
  const [notionPagesLoading, setNotionPagesLoading] = useState(false);
  const [notionSearch, setNotionSearch] = useState("");
  const [notionSelectedPages, setNotionSelectedPages] = useState<Set<string>>(new Set());
  const [notionExpanded, setNotionExpanded] = useState<Set<string>>(new Set());
  const notionSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotionPages = useCallback((query = "") => {
    if (!workspaceId || !notionConnected) return;
    setNotionPagesLoading(true);
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    api<{ pages: NotionPageNode[] }>(`/api/v1/workspaces/${workspaceId}/connectors/notion/pages${qs}`)
      .then((data) => {
        setNotionPages(data.pages);
        const expanded = new Set<string>();
        for (const p of data.pages) {
          if (p.children?.length) expanded.add(p.id);
        }
        setNotionExpanded(expanded);
      })
      .catch(() => setNotionPages([]))
      .finally(() => setNotionPagesLoading(false));
  }, [workspaceId, notionConnected]);

  useEffect(() => {
    if (open && selectedSource === "notion" && notionConnected && notionMode === "browse") {
      fetchNotionPages();
    }
  }, [open, selectedSource, notionConnected, notionMode, fetchNotionPages]);

  function handleNotionSearchChange(value: string) {
    setNotionSearch(value);
    if (notionSearchTimer.current) clearTimeout(notionSearchTimer.current);
    notionSearchTimer.current = setTimeout(() => fetchNotionPages(value), 400);
  }

  function toggleNotionPage(id: string) {
    setNotionSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleNotionExpand(id: string) {
    setNotionExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function flattenNotionTree(pages: NotionPageNode[]): NotionPageNode[] {
    const flat: NotionPageNode[] = [];
    for (const p of pages) {
      flat.push(p);
      if (p.children?.length) flattenNotionTree(p.children).forEach((c) => flat.push(c));
    }
    return flat;
  }

  async function handleNotionBrowseSubmit() {
    if (notionSelectedPages.size === 0) return;
    setError("");
    setSubmitting(true);
    try {
      const allFlat = flattenNotionTree(notionPages);
      for (const pageId of notionSelectedPages) {
        const page = allFlat.find((p) => p.id === pageId);
        if (!page) continue;
        await api("/api/v1/sources/notion", {
          method: "POST",
          body: JSON.stringify({
            workspace_id: workspaceId,
            type: "notion",
            name: page.title || "Notion page",
            url: page.url,
          }),
        });
      }
      setNotionSelectedPages(new Set());
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add Notion source");
    } finally {
      setSubmitting(false);
    }
  }

  function clearForm() {
    setError("");
    setUrl("");
    setBranch("");
    setWebUrl("");
    setCrawlDepth("1");
    setNotionUrl("");
    setGhDiscussionsUrl("");
    setYoutubeUrl("");
    setNotionSearch("");
    setNotionSelectedPages(new Set());
    setNotionMode("browse");
  }

  async function handleFileUpload(file: File) {
    setError("");
    setSubmitting(true);
    try {
      const { apiUpload } = await import("@/lib/api");
      const formData = new FormData();
      formData.append("file", file);
      await apiUpload(
        `/api/v1/sources/upload?workspace_id=${workspaceId}`,
        formData,
      );
      onSourceAdded();
      onOpenChange(false);
      clearForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }

  function handleFileSelect() {
    const file = fileInputRef.current?.files?.[0];
    if (file) handleFileUpload(file);
  }

  async function handleGithubSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      const name = url.split("/").slice(-2).join("/") || url;
      await api("/api/v1/sources/github", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceId,
          type: "github",
          name,
          url: url.trim(),
        }),
      });
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWebSubmit(e: FormEvent) {
    e.preventDefault();
    if (!webUrl.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      let parsed: URL;
      try {
        parsed = new URL(webUrl.trim());
      } catch {
        throw new Error("Please enter a valid URL (e.g. https://docs.example.com)");
      }
      const name = parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
      await api("/api/v1/sources/web", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceId,
          type: "web",
          name,
          url: webUrl.trim(),
          max_depth: parseInt(crawlDepth, 10),
        }),
      });
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNotionSubmit(e: FormEvent) {
    e.preventDefault();
    if (!notionUrl.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      let parsed: URL;
      try {
        parsed = new URL(notionUrl.trim());
      } catch {
        throw new Error("Please enter a valid Notion page URL");
      }
      const name = parsed.pathname.split("/").filter(Boolean).pop() || "Notion page";
      await api("/api/v1/sources/notion", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceId,
          type: "notion",
          name: name.replace(/-/g, " "),
          url: notionUrl.trim(),
        }),
      });
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add Notion source");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGhDiscussionsSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ghDiscussionsUrl.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      let parsed: URL;
      try {
        parsed = new URL(ghDiscussionsUrl.trim());
      } catch {
        throw new Error("Please enter a valid GitHub repo URL (e.g. https://github.com/owner/repo)");
      }
      const parts = parsed.pathname.replace(/^\/+/, "").split("/");
      if (parts.length < 2) throw new Error("URL must be a repository (e.g. https://github.com/owner/repo)");
      const name = `${parts[0]}/${parts[1]} · Discussions`;
      await api("/api/v1/sources/github_discussions", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceId,
          type: "github_discussions",
          name,
          url: ghDiscussionsUrl.trim(),
        }),
      });
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add GitHub Discussions source");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleYoutubeSubmit(e: FormEvent) {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      let parsed: URL;
      try {
        parsed = new URL(youtubeUrl.trim());
      } catch {
        throw new Error("Please enter a valid YouTube video URL");
      }
      const videoId = parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).pop();
      if (!videoId) throw new Error("Could not find video ID in URL");
      const name = `YouTube: ${videoId}`;
      await api("/api/v1/sources/youtube", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: workspaceId,
          type: "youtube",
          name,
          url: youtubeUrl.trim(),
        }),
      });
      clearForm();
      onSourceAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add YouTube source");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) clearForm(); }}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>Add Source</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="px-6 pt-3">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          </div>
        )}

        <div className="flex min-h-[420px] max-h-[70vh]">
          {/* Sidebar: source type list */}
          <nav
            className="w-[200px] shrink-0 border-r bg-muted/30 flex flex-col py-2 overflow-y-auto"
            aria-label="Source type"
          >
            {SOURCE_OPTIONS.map((opt) =>
              opt.comingSoon ? (
                <div
                  key={opt.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-muted-foreground/50 cursor-default select-none"
                >
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 font-normal opacity-60">
                    Soon
                  </Badge>
                </div>
              ) : (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => { setSelectedSource(opt.id as SourceKind); setError(""); }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors rounded-none border-l-2 border-transparent",
                    selectedSource === opt.id
                      ? "bg-background border-primary text-foreground border-l-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              )
            )}
          </nav>

          {/* Content: form for selected source */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {selectedSource === "files" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.md,.txt"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors cursor-pointer",
                    dragging ? "border-primary bg-primary/5" : "hover:border-primary hover:bg-primary/5"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {submitting ? "Uploading..." : "Drop files here — PDF, DOCX, TXT, or MD"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70 font-mono">
                    or click to browse · max 50MB
                  </p>
                </div>
              </>
            )}

            {selectedSource === "github" && (
              <form onSubmit={handleGithubSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="github-url">Repository URL</Label>
                  <Input
                    id="github-url"
                    placeholder="https://github.com/user/repo"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="github-branch">Branch (optional)</Label>
                  <Input
                    id="github-branch"
                    placeholder="main"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
                {githubConnected ? (
                  <p className="text-xs text-muted-foreground">
                    GitHub connected — public and private repos are supported.
                  </p>
                ) : (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
                    <p>Only <span className="font-medium text-foreground">public repos</span> can be indexed without a connection.</p>
                    <Link
                      href={integrationsPath}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                    >
                      Connect GitHub for private repos
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !url.trim()}>
                    {submitting ? "Adding..." : "Start Indexing"}
                  </Button>
                </div>
              </form>
            )}

            {selectedSource === "web" && (
              <form onSubmit={handleWebSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="web-url">URL</Label>
                  <Input
                    id="web-url"
                    placeholder="https://docs.example.com"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crawl-depth">Crawl Depth</Label>
                  <Select value={crawlDepth} onValueChange={setCrawlDepth}>
                    <SelectTrigger id="crawl-depth">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — Single page only</SelectItem>
                      <SelectItem value="1">1 — Page + direct links</SelectItem>
                      <SelectItem value="2">2 — Two levels deep</SelectItem>
                      <SelectItem value="3">3 — Three levels deep</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  Crawls same-domain links only. Respects robots.txt. Rate-limited. Max 50 pages.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !webUrl.trim()}>
                    {submitting ? "Adding..." : "Start Crawling"}
                  </Button>
                </div>
              </form>
            )}

            {selectedSource === "notion" && (
              notionConnected ? (
                <div className="space-y-3">
                  {/* Mode toggle */}
                  <div className="flex gap-1 rounded-lg bg-muted p-1">
                    <button
                      type="button"
                      onClick={() => setNotionMode("browse")}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        notionMode === "browse" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Browse Pages
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotionMode("url")}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        notionMode === "url" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Paste URL
                    </button>
                  </div>

                  {notionMode === "browse" && (
                    <>
                      <Input
                        placeholder="Search pages..."
                        value={notionSearch}
                        onChange={(e) => handleNotionSearchChange(e.target.value)}
                      />
                      <div className="border rounded-md max-h-[280px] overflow-y-auto">
                        {notionPagesLoading ? (
                          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                            Loading pages...
                          </div>
                        ) : notionPages.length === 0 ? (
                          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                            {notionSearch ? "No pages found" : "No pages available. Share pages with the integration in Notion."}
                          </div>
                        ) : (
                          <NotionPageTree
                            pages={notionPages}
                            depth={0}
                            selectedPages={notionSelectedPages}
                            expandedPages={notionExpanded}
                            onToggleSelect={toggleNotionPage}
                            onToggleExpand={toggleNotionExpand}
                          />
                        )}
                      </div>
                      {notionSelectedPages.size > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {notionSelectedPages.size} page{notionSelectedPages.size > 1 ? "s" : ""} selected — sub-pages will also be indexed.
                        </p>
                      )}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={handleNotionBrowseSubmit}
                          disabled={submitting || notionSelectedPages.size === 0}
                        >
                          {submitting ? "Adding..." : `Add ${notionSelectedPages.size || ""} Page${notionSelectedPages.size !== 1 ? "s" : ""}`}
                        </Button>
                      </div>
                    </>
                  )}

                  {notionMode === "url" && (
                    <form onSubmit={handleNotionSubmit} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="notion-url">Notion page URL</Label>
                        <Input
                          id="notion-url"
                          placeholder="https://www.notion.so/workspace/Page-title-abc123"
                          value={notionUrl}
                          onChange={(e) => setNotionUrl(e.target.value)}
                          required
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        All sub-pages under this page will also be indexed.
                      </p>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={submitting || !notionUrl.trim()}>
                          {submitting ? "Adding..." : "Add Notion"}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-10">
                  <BookOpen className="h-10 w-10 text-muted-foreground/40" />
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Notion integration required</p>
                    <p className="text-xs text-muted-foreground max-w-[280px]">
                      Connect your Notion workspace first to index pages and sub-pages.
                    </p>
                  </div>
                  <Link href={integrationsPath} onClick={() => onOpenChange(false)}>
                    <Button size="sm" className="gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Go to Integrations
                    </Button>
                  </Link>
                </div>
              )
            )}

            {selectedSource === "github_discussions" && (
              <form onSubmit={handleGhDiscussionsSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gh-discussions-url">Repository URL</Label>
                  <Input
                    id="gh-discussions-url"
                    placeholder="https://github.com/owner/repo"
                    value={ghDiscussionsUrl}
                    onChange={(e) => setGhDiscussionsUrl(e.target.value)}
                    required
                  />
                </div>
                {githubConnected ? (
                  <p className="text-xs text-muted-foreground">
                    GitHub connected — public and private repo discussions are supported.
                  </p>
                ) : (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
                    <p>Only <span className="font-medium text-foreground">public repos</span> can be indexed without a connection. Discussions must be enabled on the repo.</p>
                    <Link
                      href={integrationsPath}
                      onClick={() => onOpenChange(false)}
                      className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                    >
                      Connect GitHub for private repos
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !ghDiscussionsUrl.trim()}>
                    {submitting ? "Adding..." : "Add Discussions"}
                  </Button>
                </div>
              </form>
            )}

            {selectedSource === "youtube" && (
              <form onSubmit={handleYoutubeSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="youtube-url">YouTube video URL</Label>
                  <Input
                    id="youtube-url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  Indexing uses the video transcript only. If the video has no captions/transcript, ingestion will fail.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !youtubeUrl.trim()}>
                    {submitting ? "Adding..." : "Add via transcript"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
