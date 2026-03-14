"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { api, apiDelete } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileCode2, BookOpen, Loader2 } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

interface Connector {
  id: string;
  workspace_id: string;
  provider: string;
  meta: { login?: string; name?: string; workspace_name?: string; avatar_url?: string } | null;
  created_at: string | null;
}

const PROVIDERS = [
  { id: "github", name: "GitHub", icon: FileCode2, description: "Private repos and discussions" },
  { id: "notion", name: "Notion", icon: BookOpen, description: "Private pages and databases" },
] as const;

export default function ConnectorsPage() {
  const { currentWorkspace, canManageSources } = useWorkspace();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const wsId = currentWorkspace?.id;

  const fetchConnectors = useCallback(() => {
    if (!wsId) return;
    setLoading(true);
    api<Connector[]>(`/api/v1/workspaces/${wsId}/connectors`)
      .then(setConnectors)
      .catch(() => setConnectors([]))
      .finally(() => setLoading(false));
  }, [wsId]);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // Read query params for OAuth callback result
  useEffect(() => {
    if (typeof window === "undefined" || !wsId) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setMessage({ type: "success", text: `${connected === "github" ? "GitHub" : "Notion"} connected.` });
      fetchConnectors();
      window.history.replaceState({}, "", `/workspace/${wsId}/connectors`);
    }
    if (error === "access_denied") {
      setMessage({ type: "error", text: "Authorization was denied or cancelled." });
      window.history.replaceState({}, "", `/workspace/${wsId}/connectors`);
    }
  }, [wsId, fetchConnectors]);

  async function handleConnect(provider: string) {
    if (!wsId) return;
    const token = getToken();
    if (!token) {
      setMessage({ type: "error", text: "You must be signed in." });
      return;
    }
    setConnecting(provider);
    setMessage(null);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/v1/workspaces/${wsId}/connectors/${provider}/authorize`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }
      setMessage({ type: "error", text: data.detail || "Could not start connection." });
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(provider: string) {
    if (!wsId) return;
    setDisconnecting(provider);
    setMessage(null);
    try {
      await apiDelete(`/api/v1/workspaces/${wsId}/connectors/${provider}`);
      setMessage({ type: "success", text: "Disconnected." });
      fetchConnectors();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to disconnect." });
    } finally {
      setDisconnecting(null);
    }
  }

  if (!currentWorkspace) return null;

  if (!canManageSources) {
    return (
      <div className="flex-1 space-y-6 p-6 overflow-y-auto">
        <p className="text-muted-foreground">Only owners and admins can manage workspace connectors.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Integrations</h2>
        <p className="text-muted-foreground">
          Connect GitHub or Notion to index private repos and pages. Only owners and admins can add or remove connections.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${
            message.type === "success" ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map(({ id, name, icon: Icon, description }) => {
            const conn = connectors.find((c) => c.provider === id);
            return (
              <Card key={id} className="flex flex-col">
                <CardContent className="p-4 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  {conn ? (
                    <div className="mt-auto pt-3 space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {conn.meta?.login || conn.meta?.workspace_name || "Connected"}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => handleDisconnect(id)}
                        disabled={disconnecting === id}
                      >
                        {disconnecting === id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Disconnect"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-auto pt-3">
                      <Button
                        className="w-full"
                        onClick={() => handleConnect(id)}
                        disabled={connecting !== null}
                      >
                        {connecting === id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          `Connect ${name}`
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
