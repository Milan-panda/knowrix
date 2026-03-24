"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { api, apiDelete } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export default function ContextGroupsPage() {
  const { currentWorkspace, canManageSources } = useWorkspace();
  const [groups, setGroups] = useState<ContextGroup[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingName, setEditingName] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const wsId = currentWorkspace?.id;
  const readySources = useMemo(() => sources.filter((s) => s.status === "ready"), [sources]);

  const fetchData = useCallback(() => {
    if (!wsId) return;
    api<ContextGroup[]>(`/api/v1/context-groups?workspace_id=${wsId}`)
      .then(setGroups)
      .catch(() => setGroups([]));
    api<Source[]>(`/api/v1/sources?workspace_id=${wsId}`)
      .then(setSources)
      .catch(() => setSources([]));
  }, [wsId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function createGroup() {
    if (!wsId || !newGroupName.trim()) return;
    setSaving(true);
    try {
      await api("/api/v1/context-groups", {
        method: "POST",
        body: JSON.stringify({ workspace_id: wsId, name: newGroupName.trim() }),
      });
      setNewGroupName("");
      fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function renameGroup(group: ContextGroup) {
    const name = (editingName[group.id] || "").trim();
    if (!name || name === group.name) return;
    setSaving(true);
    try {
      await api(`/api/v1/context-groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(groupId: string) {
    setSaving(true);
    try {
      await apiDelete(`/api/v1/context-groups/${groupId}`);
      fetchData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleSource(group: ContextGroup, sourceId: string) {
    const next = new Set(group.source_ids);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    setSaving(true);
    try {
      await api(`/api/v1/context-groups/${group.id}/sources`, {
        method: "PUT",
        body: JSON.stringify({ source_ids: Array.from(next) }),
      });
      fetchData();
    } finally {
      setSaving(false);
    }
  }

  if (!currentWorkspace) {
    return <div className="flex-1 p-6 text-muted-foreground">Select a workspace.</div>;
  }

  if (!canManageSources) {
    return <div className="flex-1 p-6 text-muted-foreground">Only admins and owners can manage context groups.</div>;
  }

  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Context Groups</h2>
        <p className="text-muted-foreground">
          Organize sources into reusable groups for chat filtering. System groups are auto-managed.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 flex gap-2">
          <Input
            placeholder="Create custom group (e.g. API Docs)"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <Button onClick={createGroup} disabled={saving || !newGroupName.trim()}>
            Create
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.id}>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2">
                {group.is_system ? (
                  <>
                    <h3 className="font-medium">{group.name}</h3>
                    <span className="text-xs text-muted-foreground">system</span>
                  </>
                ) : (
                  <>
                    <Input
                      value={editingName[group.id] ?? group.name}
                      onChange={(e) =>
                        setEditingName((prev) => ({ ...prev, [group.id]: e.target.value }))
                      }
                      className="max-w-sm"
                    />
                    <Button variant="outline" onClick={() => renameGroup(group)} disabled={saving}>
                      Save
                    </Button>
                    <Button variant="destructive" onClick={() => deleteGroup(group.id)} disabled={saving}>
                      Delete
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {readySources.map((source) => {
                  const selected = group.source_ids.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      disabled={group.is_system}
                      onClick={() => toggleSource(group, source.id)}
                      className={`rounded border px-2 py-1 text-xs ${
                        selected
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground"
                      } ${group.is_system ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      {source.name}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
