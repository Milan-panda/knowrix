"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { CreateWorkspaceModal } from "@/components/workspace/create-workspace-modal";

interface Workspace {
  id: string;
  name: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    api<Workspace[]>("/api/v1/workspaces")
      .then((workspaces) => {
        if (workspaces.length > 0) {
          router.replace(`/workspace/${workspaces[0].id}`);
        } else {
          setShowModal(true);
          setLoading(false);
        }
      })
      .catch((err) => {
        setLoading(false);
        if (err instanceof ApiError && err.status === 401) {
          return;
        }
        setShowModal(true);
      });
  }, [router]);

  if (loading && !showModal) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <CreateWorkspaceModal
        open={showModal}
        dismissible={false}
        onCreated={(ws) => {
          router.replace(`/workspace/${ws.id}`);
        }}
      />
    </div>
  );
}
