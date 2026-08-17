import { useEffect, useState } from "react";
import { toast } from "sonner";
import { claimTask, createComment, createTask, deleteTask, listComments, updateTask } from "@/lib/api";
import type { Column, Comment, Task } from "@/lib/types";
import { GenericStatusBadge, StatusBadge } from "@/components/boards/StatusBadge";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Hand,
  Trash2,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CornerDownRight,
  Repeat,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

const RECURRENCE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

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
  allTasks,
  columns,
  onOpenTask,
  onOpenChange,
  onTaskUpdated,
  onTaskDeleted,
  /** Newest comments pushed in over the board WebSocket while this task is open. */
  liveComments,
}: {
  boardSlug: string;
  task: Task | null;
  /** Every task currently loaded for this board — used only to derive
   *  sub-tasks/parent client-side; no extra fetch needed. */
  allTasks: Task[];
  columns: Column[];
  onOpenTask: (taskId: string) => void;
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
  const [archiving, setArchiving] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

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

  const parentTask = task.parent_task_id ? (allTasks.find((t) => t.id === task.parent_task_id) ?? null) : null;
  const subtasks = allTasks.filter((t) => t.parent_task_id === task.id);

  async function handleAddSubtask() {
    if (!task || !subtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      const created = await createTask(boardSlug, { title: subtaskTitle.trim(), parent_task_id: task.id });
      onTaskUpdated(created);
      setSubtaskTitle("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add sub-task");
    } finally {
      setAddingSubtask(false);
    }
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

  async function handleResolve() {
    if (!task) return;
    try {
      const updated = await updateTask(boardSlug, task.id, { needs_human: false });
      onTaskUpdated(updated);
      toast.success("Resolved — unblocked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve");
    }
  }

  /**
   * Archive is the answer to "this is real, but nobody is going to do it" —
   * the case Delete handles badly, because deleting loses the record and
   * leaving it open lets it clutter every list forever. It is reversible from
   * the Archived view on /all, so it needs no confirmation the way Delete does.
   */
  async function handleToggleArchive() {
    if (!task) return;
    const archiving = task.archived_at === null;
    setArchiving(true);
    try {
      const updated = await updateTask(boardSlug, task.id, { archived: archiving });
      onTaskUpdated(updated);
      toast.success(archiving ? "Archived — hidden from every default view" : "Restored");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive");
    } finally {
      setArchiving(false);
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
          <div className="flex items-start gap-1 pr-6">
            <SheetTitle className="flex-1">{task.title}</SheetTitle>
            <CopyLinkButton path={`/boards/${boardSlug}/tasks/${task.id}`} className="mt-0.5" />
          </div>
          {task.description && <SheetDescription>{task.description}</SheetDescription>}
          {parentTask && (
            <button
              type="button"
              onClick={() => onOpenTask(parentTask.id)}
              className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CornerDownRight className="size-3" />
              Part of: {parentTask.title}
            </button>
          )}
          {task.recurrence && (
            <span className="flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <Repeat className="size-3" />
              Repeats {RECURRENCE_LABEL[task.recurrence]}
            </span>
          )}
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
          {task.needs_human && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">Needs you</p>
                  {task.needs_human_reason && (
                    <p className="text-xs text-muted-foreground">{task.needs_human_reason}</p>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={handleResolve}>
                <Check className="size-3.5" />
                Resolve
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            {task.labels.map((label) => (
              <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {label}
              </span>
            ))}
            <div className="ml-auto flex gap-1.5">
              <EditTaskDialog boardSlug={boardSlug} task={task} onUpdated={onTaskUpdated} />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={archiving}
                onClick={handleToggleArchive}
              >
                {task.archived_at ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                {task.archived_at ? "Restore" : "Archive"}
              </Button>
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
                    {(() => {
                      const column = columns.find((c) => c.id === task.status);
                      return column ? <StatusBadge column={column} /> : <GenericStatusBadge status={task.status} />;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[...columns]
                    .sort((a, b) => a.position - b.position)
                    .map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.name}
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

          {task.status === "planned" && (
            <div className="rounded-md border bg-muted/30 px-3 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ready to move out of Backlog?</p>
              <ul className="space-y-1 text-xs">
                <li className={task.assignee ? "text-foreground" : "text-muted-foreground"}>
                  {task.assignee ? "✓" : "○"} Owner assigned
                </li>
                <li className={task.labels.length > 0 ? "text-foreground" : "text-muted-foreground"}>
                  {task.labels.length > 0 ? "✓" : "○"} Labels set
                </li>
                <li className="text-foreground">✓ Priority set ({task.priority})</li>
              </ul>
              <Button
                size="sm"
                className="mt-2 w-fit"
                disabled={updatingStatus}
                onClick={() => handleStatusChange("open")}
              >
                Move to Open
              </Button>
            </div>
          )}

          {!task.claimed_by && (
            <Button size="sm" variant="outline" className="w-fit gap-1.5" disabled={claiming} onClick={handleClaim}>
              <Hand className="size-3.5" />
              {claiming ? "Claiming…" : "Claim this task"}
            </Button>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Sub-tasks{subtasks.length > 0 ? ` (${subtasks.length})` : ""}</p>
            {subtasks.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={() => onOpenTask(sub.id)}
                className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="flex items-center gap-1.5 truncate">
                  {(() => {
                    const column = columns.find((c) => c.id === sub.status);
                    return column ? (
                      <StatusBadge column={column} className="shrink-0" />
                    ) : (
                      <GenericStatusBadge status={sub.status} className="shrink-0" />
                    );
                  })()}
                  <span className="truncate">{sub.title}</span>
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
            <div className="flex gap-1.5">
              <Input
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSubtask()}
                placeholder="Add a sub-task…"
                className="h-8 text-sm"
              />
              <Button
                size="icon-sm"
                variant="outline"
                disabled={addingSubtask || !subtaskTitle.trim()}
                onClick={handleAddSubtask}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

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
