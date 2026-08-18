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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Hand,
  Trash2,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  MoreHorizontal,
  Pencil,
  Repeat,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

const RECURRENCE_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/** Descriptions longer than this are collapsed on open — agents write essays,
 *  and a wall of text pushed status, comments and everything else off-screen. */
const DESCRIPTION_COLLAPSE_CHARS = 420;

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
  const [descExpanded, setDescExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const taskId = task?.id ?? null;

  useEffect(() => {
    setDescExpanded(false);
    setCommentBody("");
  }, [taskId]);

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
  const description = task.description?.trim() ?? "";
  const longDescription = description.length > DESCRIPTION_COLLAPSE_CHARS;

  /** Only the fields that actually carry a value — an all-"—" grid is noise. */
  const details: { label: string; value: string }[] = [
    { label: "Claimed by", value: task.claimed_by ?? "" },
    { label: "Due", value: task.due_date ?? "" },
    { label: "Created by", value: task.created_by ?? "" },
    { label: "Updated", value: formatDateTime(task.updated_at) },
  ].filter((d) => d.value !== "");

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
      {/* No SheetDescription: the task description lives in the scroll body, so
          Radix's auto-description wiring is opted out of explicitly. */}
      <SheetContent aria-describedby={undefined} className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {/* Pinned: title and the two actions used on nearly every open — change
            status, and copy the link. Everything rare sits behind the ⋯ menu. */}
        <SheetHeader className="gap-3 border-b p-4 pr-12">
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

          <div className="flex items-start gap-1">
            <SheetTitle className="flex-1 text-base leading-snug">{task.title}</SheetTitle>
            <CopyLinkButton path={`/boards/${boardSlug}/tasks/${task.id}`} className="mt-0.5 shrink-0" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="mt-0.5 shrink-0" aria-label="Task actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil className="size-3.5" />
                  Edit task
                </DropdownMenuItem>
                <DropdownMenuItem disabled={archiving} onSelect={() => void handleToggleArchive()}>
                  {task.archived_at ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                  {task.archived_at ? "Restore" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={deleting} onSelect={() => void handleDelete()}>
                  <Trash2 className="size-3.5" />
                  {deleting ? "Deleting…" : "Delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={task.status}
              onValueChange={(v) => handleStatusChange(v as Task["status"])}
              disabled={updatingStatus}
            >
              <SelectTrigger size="sm" className="w-auto" aria-label="Status">
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

            <PriorityBadge priority={task.priority} />

            <span className="text-xs text-muted-foreground">
              {task.assignee ? task.assignee : "Unassigned"}
            </span>

            {task.recurrence && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Repeat className="size-3" />
                {RECURRENCE_LABEL[task.recurrence]}
              </span>
            )}

            {!task.claimed_by && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 gap-1.5 text-xs"
                disabled={claiming}
                onClick={handleClaim}
              >
                <Hand className="size-3.5" />
                {claiming ? "Claiming…" : "Claim"}
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
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

          {task.archived_at && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Archived — hidden from every default view. Restore it from the ⋯ menu.
            </p>
          )}

          {description && (
            <div className="flex flex-col items-start gap-1">
              <p
                className={`text-sm whitespace-pre-wrap text-muted-foreground ${
                  longDescription && !descExpanded ? "line-clamp-6" : ""
                }`}
              >
                {description}
              </p>
              {longDescription && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                >
                  {descExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {task.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {task.labels.map((label) => (
                <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
          )}

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

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="text-foreground">{detail.value}</dd>
              </div>
            ))}
          </dl>

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
            <p className="text-sm font-medium">
              Comments{comments && comments.length > 0 ? ` (${comments.length})` : ""}
            </p>

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

        <SheetFooter className="mt-auto border-t p-4">
          <div className="flex w-full flex-col gap-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handlePostComment();
                }
              }}
              placeholder="Add a comment… (⌘↵ to post)"
              rows={2}
            />
            {commentBody.trim() && (
              <Button size="sm" className="self-end" disabled={posting} onClick={handlePostComment}>
                {posting ? "Posting…" : "Comment"}
              </Button>
            )}
          </div>
        </SheetFooter>

        {/* Rendered controlled, with no trigger of its own — opened from the ⋯ menu. */}
        <EditTaskDialog
          boardSlug={boardSlug}
          task={task}
          onUpdated={onTaskUpdated}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
