import { useEffect, useState } from "react";
import { toast } from "sonner";
import { claimTask, createComment, deleteTask, listComments, updateTask } from "@/lib/api";
import type { Comment, Task } from "@/lib/types";
import { STATUS_OPTIONS, StatusBadge } from "@/components/boards/StatusBadge";
import { PriorityBadge } from "@/components/boards/PriorityBadge";
import { EditTaskDialog } from "@/components/boards/EditTaskDialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Hand, Trash2 } from "lucide-react";

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function TaskDetailSheet({
  boardSlug,
  task,
  onOpenChange,
  onTaskUpdated,
  onTaskDeleted,
  /** Newest comments pushed in over the board WebSocket while this task is open. */
  liveComments,
}: {
  boardSlug: string;
  task: Task | null;
  onOpenChange: (open: boolean) => void;
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
  liveComments: Comment[];
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!task) {
      setComments(null);
      return;
    }
    let cancelled = false;
    setComments(null);
    listComments(boardSlug, task.id)
      .then((data) => {
        if (!cancelled) setComments(data);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Failed to load comments");
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardSlug, task]);

  // Merge in comments broadcast live for this task while the sheet is open.
  useEffect(() => {
    if (!task || comments === null) return;
    const relevant = liveComments.filter(
      (c) => c.task_id === task.id && !comments.some((existing) => existing.id === c.id),
    );
    if (relevant.length > 0) {
      setComments((prev) => [...(prev ?? []), ...relevant]);
    }
    // Only re-run when the live comment feed grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveComments]);

  if (!task) {
    return (
      <Sheet open={false} onOpenChange={onOpenChange}>
        <SheetContent />
      </Sheet>
    );
  }

  async function handlePostComment() {
    if (!task || !commentBody.trim()) return;
    setPosting(true);
    try {
      const comment = await createComment(boardSlug, task.id, commentBody.trim());
      setComments((prev) => [...(prev ?? []), comment]);
      setCommentBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  async function handleClaim() {
    if (!task) return;
    setClaiming(true);
    try {
      const updated = await claimTask(boardSlug, task.id);
      onTaskUpdated(updated);
      toast.success("Task claimed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to claim task");
    } finally {
      setClaiming(false);
    }
  }

  async function handleStatusChange(status: Task["status"]) {
    if (!task) return;
    setUpdatingStatus(true);
    try {
      const updated = await updateTask(boardSlug, task.id, { status });
      onTaskUpdated(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDelete() {
    if (!task) return;
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteTask(boardSlug, task.id);
      toast.success("Task deleted");
      onTaskDeleted(task.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={task !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-8">{task.title}</SheetTitle>
          {task.description && <SheetDescription>{task.description}</SheetDescription>}
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            {task.labels.map((label) => (
              <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {label}
              </span>
            ))}
            <div className="ml-auto flex gap-1.5">
              <EditTaskDialog boardSlug={boardSlug} task={task} onUpdated={onTaskUpdated} />
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive" disabled={deleting} onClick={handleDelete}>
                <Trash2 className="size-3.5" />
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Select
                value={task.status}
                onValueChange={(v) => handleStatusChange(v as Task["status"])}
                disabled={updatingStatus}
              >
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue>
                    <StatusBadge status={task.status} />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Assignee</p>
              <p className="mt-1.5">{task.assignee ?? "—"}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Claimed by</p>
              <p className="mt-1.5">{task.claimed_by ?? "Unclaimed"}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Due</p>
              <p className="mt-1.5">{task.due_date ?? "—"}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Created by</p>
              <p className="mt-1.5">{task.created_by ?? "—"}</p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="mt-1.5">{formatDateTime(task.updated_at)}</p>
            </div>
          </div>

          {!task.claimed_by && (
            <Button size="sm" variant="outline" className="w-fit gap-1.5" disabled={claiming} onClick={handleClaim}>
              <Hand className="size-3.5" />
              {claiming ? "Claiming…" : "Claim this task"}
            </Button>
          )}

          <Separator />

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Comments</p>

            {comments === null && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-3/4" />
              </div>
            )}

            {comments !== null && comments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}

            {comments !== null && comments.length > 0 && (
              <div className="flex flex-col gap-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">{comment.author}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-auto border-t pt-4">
          <div className="flex w-full flex-col gap-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a comment…"
              rows={2}
            />
            <Button size="sm" className="self-end" disabled={posting || !commentBody.trim()} onClick={handlePostComment}>
              {posting ? "Posting…" : "Comment"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
