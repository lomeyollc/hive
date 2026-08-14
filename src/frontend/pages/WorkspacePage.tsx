import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listMembers, updateWorkspace } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/types";
import { useWorkspace } from "@/context/workspace-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InviteMemberDialog } from "@/components/workspace/InviteMemberDialog";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Pencil, Check, X } from "lucide-react";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function WorkspaceName({ id, name, onRenamed }: { id: string; name: string; onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="group flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-0 group-hover:opacity-100"
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    );
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateWorkspace(id, { name: trimmed });
      onRenamed(trimmed);
      toast.success("Workspace renamed");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename workspace");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 max-w-xs text-2xl font-semibold"
        disabled={saving}
      />
      <Button variant="ghost" size="icon" className="size-7" onClick={() => void save()} disabled={saving}>
        <Check className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(false)} disabled={saving}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

export function WorkspacePage() {
  const { current, refresh } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setMembers(null);
    listMembers(current.id)
      .then((memberData) => {
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
  }, [current]);

  if (error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!current) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <WorkspaceName id={current.id} name={current.name} onRenamed={() => void refresh()} />
        <p className="text-sm text-muted-foreground">Workspace id: {current.id}</p>
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
            workspaceId={current.id}
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
