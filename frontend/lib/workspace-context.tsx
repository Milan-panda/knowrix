"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

export type WorkspaceRole = "owner" | "admin" | "member";

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  role?: WorkspaceRole;  // present when from list/get; create response may omit until refetch
}

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  loading: boolean;
}

interface WorkspaceContextValue extends WorkspaceState {
  currentRole: WorkspaceRole | null;
  canManageSources: boolean;
  canManageMembers: boolean;
  createWorkspace: (name: string) => Promise<Workspace>;
  switchWorkspace: (id: string) => void;
  refetch: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params?.workspaceId as string | undefined;

  const [state, setState] = useState<WorkspaceState>({
    workspaces: [],
    currentWorkspace: null,
    loading: true,
  });

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await api<Workspace[]>("/api/v1/workspaces");
      const current = workspaceId
        ? data.find((w) => w.id === workspaceId) ?? data[0] ?? null
        : data[0] ?? null;
      setState({ workspaces: data, currentWorkspace: current, loading: false });
    } catch {
      setState({ workspaces: [], currentWorkspace: null, loading: false });
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const createWorkspace = useCallback(
    async (name: string) => {
      const ws = await api<Workspace>("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await fetchWorkspaces();
      return ws;
    },
    [fetchWorkspaces],
  );

  const switchWorkspace = useCallback(
    (id: string) => {
      router.push(`/workspace/${id}`);
    },
    [router],
  );

  const currentRole = state.currentWorkspace?.role ?? null;
  const canManageSources = currentRole === "owner" || currentRole === "admin";
  const canManageMembers = currentRole === "owner" || currentRole === "admin";

  const value = useMemo(
    () => ({
      ...state,
      currentRole,
      canManageSources,
      canManageMembers,
      createWorkspace,
      switchWorkspace,
      refetch: fetchWorkspaces,
    }),
    [state, currentRole, canManageSources, canManageMembers, createWorkspace, switchWorkspace, fetchWorkspaces],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
