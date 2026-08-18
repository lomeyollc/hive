import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listColumns, listTasks } from "@/lib/api";
import type { Column, Task } from "@/lib/types";
import { TaskDetailSheet } from "@/components/boards/TaskDetailSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The task drawer for the cross-board pages (/all, /needs-you), where the
 * board's tasks and columns aren't already in memory the way they are on a
 * board page.
 *
 * Why it exists: those two pages used to navigate to /boards/:slug/tasks/:id,
 * which threw away the list you were triaging — filters, scroll position,
 * selection and all — to answer one question about one task. Opening the same
 * drawer in place keeps the list behind it, and the task still gets its own
 * URL (?task=…&task_board=…) so it stays linkable and Back closes it.
 *
 * There is no single-task REST endpoint, so this loads the board's tasks and
 * columns — which also gives the drawer the parent/sub-task links it needs.
 */
export function CrossBoardTaskSheet({
  boardSlug,
  taskId,
  onOpenChange,
  onTaskChanged,
  onOpenTask,
}: {
  boardSlug: string | null;
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Fired whenever the task changed, so the list behind can reload. */
  onTaskChanged: () => void;
  /** Opening a parent or sub-task from inside the drawer. */
  onOpenTask: (boardSlug: string, taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);

  useEffect(() => {
    if (!boardSlug || !taskId) {
      setTasks(null);
      return;
    }
    let cancelled = false;
    setTasks(null);
    Promise.all([listTasks(boardSlug, { archived: "all" }), listColumns(boardSlug)])
      .then(([boardTasks, boardColumns]) => {
        if (cancelled) return;
        setTasks(boardTasks);
        setColumns(boardColumns);
        if (!boardTasks.some((t) => t.id === taskId)) {
          toast.error("That task no longer exists");
          onOpenChange(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Failed to load task");
        onOpenChange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardSlug, taskId, onOpenChange]);

  const handleUpdated = useCallback(
    (updated: Task) => {
      setTasks((prev) => {
        if (!prev) return prev;
        const exists = prev.some((t) => t.id === updated.id);
        return exists ? prev.map((t) => (t.id === updated.id ? updated : t)) : [...prev, updated];
      });
      onTaskChanged();
    },
    [onTaskChanged],
  );

  const handleDeleted = useCallback(
    (deletedId: string) => {
      setTasks((prev) => prev?.filter((t) => t.id !== deletedId) ?? prev);
      onTaskChanged();
    },
    [onTaskChanged],
  );

  if (!boardSlug || !taskId) return null;

  // The board's tasks are still loading — hold the drawer open with a
  // skeleton rather than flashing the list, so a click always feels like it
  // landed somewhere.
  if (!tasks) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent aria-describedby={undefined} className="flex w-full flex-col gap-0 p-0 sm:w-[46vw] sm:min-w-[34rem] sm:max-w-[56rem]">
          <SheetHeader className="gap-3 border-b p-4 pr-12">
            <SheetTitle className="sr-only">Loading task</SheetTitle>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-7 w-40" />
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const task = tasks.find((t) => t.id === taskId) ?? null;

  return (
    <TaskDetailSheet
      boardSlug={boardSlug}
      task={task}
      allTasks={tasks}
      columns={columns}
      onOpenTask={(id) => onOpenTask(boardSlug, id)}
      onOpenChange={onOpenChange}
      onTaskUpdated={handleUpdated}
      onTaskDeleted={handleDeleted}
      liveComments={[]}
      boardLabel={boardSlug}
    />
  );
}
