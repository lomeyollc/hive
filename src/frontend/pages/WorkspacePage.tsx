import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listMembers, listWorkspaces } from "@/lib/api";
import type { Workspace, WorkspaceMember } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { InviteMemberDialog } from "@/components/workspace/InviteMemberDialog";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function WorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkspaces()
      .then(async (workspaces) => {
        const ws = workspaces[0] ?? null;
        if (cancelled) return;
        setWorkspace(ws);
        if (!ws) return setMembers([]);
        const memberData = await listMembers(ws.id);
        if (!cancelled) setMembers(memberData);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load workspace";
        if (!cancelled) setError(message);
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!workspace) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">Workspace id: {workspace.id}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Invite links have to be copied and shared by hand — email delivery isn't wired up yet.
            </CardDescription>
          </div>
          <InviteMemberDialog
            workspaceId={workspace.id}
            onInvited={(member) => setMembers((prev) => [...(prev ?? []), member])}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members === null && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {members?.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.email}</p>
                <p className="text-xs text-muted-foreground">
                  {m.role} · {m.status === "active" ? `joined ${formatDate(m.accepted_at ?? m.invited_at)}` : `invited ${formatDate(m.invited_at)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={m.status === "active" ? "default" : "secondary"}>
                  {m.status === "active" ? "Active" : "Invited"}
                </Badge>
                {m.invite_url && <CopyLinkButton path={m.invite_url.replace(window.location.origin, "")} />}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
