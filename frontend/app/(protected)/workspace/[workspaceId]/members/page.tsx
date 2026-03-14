"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useAuth } from "@/lib/auth-context";
import { api, apiDelete, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, UserMinus, MailX } from "lucide-react";

interface Member {
  user_id: string | null;
  email: string;
  name: string | null;
  role: string;
  status?: "member" | "pending";
}

export default function MembersPage() {
  const { currentWorkspace, canManageMembers } = useWorkspace();
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"member" | "admin">("member");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");
  const [roleUpdatingId, setRoleUpdatingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [cancelInviteTarget, setCancelInviteTarget] = useState<Member | null>(null);
  const [cancellingInvite, setCancellingInvite] = useState(false);
  const [addSuccessMessage, setAddSuccessMessage] = useState<string | null>(null);

  const wsId = currentWorkspace?.id;

  const fetchMembers = useCallback(() => {
    if (!wsId) return;
    setLoading(true);
    api<Member[]>(`/api/v1/workspaces/${wsId}/members`)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [wsId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!wsId || !addEmail.trim()) return;
    setAddError("");
    setAddSuccessMessage(null);
    setAddSubmitting(true);
    try {
      const res = await api<{ status: "member" | "pending"; email: string }>(
        `/api/v1/workspaces/${wsId}/members`,
        {
          method: "POST",
          body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
        },
      );
      setAddEmail("");
      setAddRole("member");
      setAddOpen(false);
      fetchMembers();
      if (res.status === "pending") {
        setAddSuccessMessage(`Invite sent to ${res.email}. They'll be added when they sign up.`);
        setTimeout(() => setAddSuccessMessage(null), 6000);
      }
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Failed to add member");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleRoleChange(member: Member, newRole: "member" | "admin") {
    if (!wsId || !member.user_id || member.role === newRole) return;
    setRoleUpdatingId(member.user_id);
    try {
      await api(`/api/v1/workspaces/${wsId}/members/${member.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      fetchMembers();
    } finally {
      setRoleUpdatingId(null);
    }
  }

  async function handleCancelInvite() {
    if (!cancelInviteTarget || !wsId) return;
    setCancellingInvite(true);
    try {
      await apiDelete(
        `/api/v1/workspaces/${wsId}/invites?email=${encodeURIComponent(cancelInviteTarget.email)}`,
      );
      setCancelInviteTarget(null);
      fetchMembers();
    } finally {
      setCancellingInvite(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget || !wsId) return;
    setRemoving(true);
    try {
      await apiDelete(`/api/v1/workspaces/${wsId}/members/${removeTarget.user_id}`);
      setRemoveTarget(null);
      fetchMembers();
    } finally {
      setRemoving(false);
    }
  }

  const isWorkspaceOwner = (m: Member) => m.role === "owner";
  const isPending = (m: Member) => m.status === "pending";
  const canChangeRole = (m: Member) =>
    canManageMembers && !isWorkspaceOwner(m) && !isPending(m) && m.user_id;
  const canRemove = (m: Member) => canManageMembers && !isWorkspaceOwner(m) && !isPending(m);
  const canCancelInvite = (m: Member) => canManageMembers && isPending(m);

  if (!currentWorkspace) {
    return (
      <div className="flex-1 p-6">
        <p className="text-muted-foreground">Select a workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Members</h2>
          <p className="text-muted-foreground">
            People who have access to this workspace. You can add by email — if they haven&apos;t signed up yet,
            they&apos;ll be added when they do.
          </p>
        </div>
        {canManageMembers && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add member
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="h-20 animate-pulse" />
            </Card>
          ))}
        </div>
      ) : (
        <>
          {addSuccessMessage && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {addSuccessMessage}
            </p>
          )}
          <div className="space-y-3">
            {members.map((m) => (
              <Card key={m.user_id ?? `invite-${m.email}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                      {(m.name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {m.name || m.email}
                        {m.user_id === currentUser?.id && (
                          <span className="ml-2 text-xs text-muted-foreground font-normal">(you)</span>
                        )}
                      </p>
                      {m.name && m.status !== "pending" && (
                        <p className="text-sm text-muted-foreground truncate">{m.email}</p>
                      )}
                      {m.status === "pending" && (
                        <p className="text-sm text-muted-foreground truncate">{m.email} · Pending signup</p>
                      )}
                    </div>
                    <Badge
                      variant={m.status === "pending" ? "outline" : m.role === "owner" ? "default" : "secondary"}
                      className="shrink-0"
                    >
                      {m.status === "pending" ? "Pending" : m.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRole(m) && (
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleRoleChange(m, v as "member" | "admin")}
                        disabled={roleUpdatingId === m.user_id}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {canCancelInvite(m) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setCancelInviteTarget(m)}
                        title="Cancel invite"
                      >
                        <MailX className="h-4 w-4" />
                      </Button>
                    )}
                    {canRemove(m) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoveTarget(m)}
                        title="Remove from workspace"
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            {addError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {addError}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                placeholder="teammate@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="member-role">Role</Label>
              <Select value={addRole} onValueChange={(v) => setAddRole(v as "member" | "admin")}>
                <SelectTrigger id="member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={addSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={addSubmitting || !addEmail.trim()}>
                {addSubmitting ? "Adding..." : "Add member"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && (
                <>
                  Remove <strong>{removeTarget.name || removeTarget.email}</strong> from this workspace?
                  They will lose access to all workspace content.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!cancelInviteTarget}
        onOpenChange={(open) => !open && setCancelInviteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invite</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelInviteTarget && (
                <>
                  Cancel the invite for <strong>{cancelInviteTarget.email}</strong>? They will no longer
                  be able to join this workspace when they sign up.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancellingInvite}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvite}
              disabled={cancellingInvite}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancellingInvite ? "Cancelling..." : "Cancel invite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
