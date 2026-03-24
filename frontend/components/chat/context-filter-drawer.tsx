"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface Source {
  id: string;
  name: string;
  source_type: string;
  status: string;
}

interface ContextGroup {
  id: string;
  workspace_id: string;
  name: string;
  is_system: boolean;
  source_ids: string[];
  sources_count: number;
}

interface ContextFilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: Source[];
  groups: ContextGroup[];
  selectedSourceIds: Set<string>;
  selectedGroupIds: Set<string>;
  onToggleSource: (id: string) => void;
  onToggleGroup: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

function sourceIcon(type: string) {
  if (type === "pdf" || type === "file") return "📄";
  if (type === "github") return "🐙";
  if (type === "notion") return "📓";
  if (type === "github_discussions") return "💬";
  if (type === "youtube") return "▶️";
  return "🌐";
}

export function ContextFilterDrawer({
  open,
  onOpenChange,
  sources,
  groups,
  selectedSourceIds,
  selectedGroupIds,
  onToggleSource,
  onToggleGroup,
  onSelectAll,
  onClearAll,
}: ContextFilterDrawerProps) {
  const readySources = sources.filter((s) => s.status === "ready");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="border-b">
          <SheetTitle>Filter Context</SheetTitle>
          <SheetDescription>
            Select groups or specific sources to scope chat answers.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 py-3 border-b flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedSourceIds.size}/{readySources.length} sources selected
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onSelectAll}>All</Button>
            <Button size="sm" variant="outline" onClick={onClearAll}>None</Button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-5">
          <section className="space-y-2">
            <h4 className="text-sm font-medium">Groups</h4>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No groups yet.</p>
            ) : (
              <div className="grid gap-2">
                {groups.map((group) => {
                  const active = selectedGroupIds.has(group.id);
                  return (
                    <button
                      key={group.id}
                      onClick={() => onToggleGroup(group.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted/30 text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{group.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {group.sources_count} sources{group.is_system ? " · system" : ""}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium">Sources</h4>
            <div className="grid gap-1.5">
              {readySources.map((source) => {
                const active = selectedSourceIds.has(source.id);
                return (
                  <button
                    key={source.id}
                    onClick={() => onToggleSource(source.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span>{sourceIcon(source.source_type)}</span>
                      <span className="truncate">{source.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
