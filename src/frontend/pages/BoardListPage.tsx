import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { listBoards, listWorkspaces } from "@/lib/api";
import type { Board, Workspace } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/boards/StatusBadge";
import { CreateBoardDialog } from "@/components/boards/CreateBoardDialog";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { Users } from "lucide-react";
import type { TaskStatus } from "@/lib/types";

const COUNT_STATUSES: TaskStatus[] = ["open", "in_progress", "blocked", "done"];

export function BoardListPage() {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listBoards(), listWorkspaces()])
      .then(([boardData, workspaceData]) => {
        if (cancelled) return;
        setBoards(boardData);
        setWorkspaces(workspaceData);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load boards";
        if (!cancelled) setError(message);
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Single-workspace assumption for v1 — the UI doesn't have a workspace
  // switcher yet. Multiple workspaces work at the data/API level already
  // (see routes.ts); this just always targets the first one.
  const workspace = workspaces?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Boards</h1>
          <p className="text-sm text-muted-foreground">
            {workspace ? workspace.name : "Every board is a live, agent-writable task list."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspace && (
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <Link to="/workspace">
                <Users className="size-3.5" />
                Members
              </Link>
            </Button>
          )}
          {workspace && (
            <CreateBoardDialog
              workspaceId={workspace.id}
              onCreated={(board) => setBoards((prev) => [...(prev ?? []), board])}
            />
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!boards && !workspaces && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {workspaces && workspaces.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-sm text-muted-foreground">
            No workspace yet. A workspace is where your boards and teammates live.
          </p>
          <CreateWorkspaceDialog onCreated={(ws) => setWorkspaces([ws])} />
        </div>
      )}

      {boards && workspace && boards.length === 0 && (
        <p className="text-sm text-muted-foreground">No boards yet — create the first one above.</p>
      )}

      {boards && boards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <Link key={board.id} to={`/boards/${board.id}`}>
              <Card className="h-full transition-colors hover:border-foreground/30">
                <CardHeader>
                  <CardTitle>{board.name}</CardTitle>
                  {board.description && <CardDescription>{board.description}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {COUNT_STATUSES.map((status) => {
                    const count = board.task_counts?.[status] ?? 0;
                    if (count === 0) return null;
                    return (
                      <div key={status} className="flex items-center gap-1">
                        <StatusBadge status={status} />
                        <span className="text-xs text-muted-foreground">{count}</span>
                      </div>
                    );
                  })}
                  {!board.task_counts && (
                    <span className="text-xs text-muted-foreground">No task counts yet</span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
