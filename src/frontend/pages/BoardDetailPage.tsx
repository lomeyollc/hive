import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { claimTask, listTasks } from "@/lib/api";
import { useBoardSocket } from "@/hooks/use-board-socket";
import type { Comment, Task, TaskStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateTaskDialog } from "@/components/boards/CreateTaskDialog";
import { TaskCard } from "@/components/boards/TaskCard";
import { TaskDetailSheet } from "@/components/boards/TaskDetailSheet";

const TABS: { value: "all" | TaskStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

export function BoardDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [liveComments, setLiveComments] = useState<Comment[]>([]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setTasks(null);
    listTasks(slug)
      .then((data) => {
        if (!cancelled) setTasks(data);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to load tasks";
        if (!cancelled) setError(message);
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const upsertTask = useCallback((task: Task) => {
    setTasks((prev) => {
      if (!prev) return [task];
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx === -1) return [task, ...prev];
      const next = [...prev];
      next[idx] = task;
      return next;
    });
  }, []);

  useBoardSocket(
    slug,
    useCallback(
      (msg) => {
        switch (msg.type) {
          case "task.created":
          case "task.updated":
          case "task.claimed":
            upsertTask(msg.task);
            break;
          case "task.deleted":
            setTasks((prev) => prev?.filter((t) => t.id !== msg.taskId) ?? prev);
            break;
          case "comment.created":
            setLiveComments((prev) => [...prev, msg.comment]);
            break;
        }
      },
      [upsertTask],
    ),
  );

  const counts = useMemo(() => {
    const base: Record<TaskStatus, number> = { open: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of tasks ?? []) base[t.status] += 1;
    return base;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (!tasks) return [];
    return filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const selectedTask = tasks?.find((t) => t.id === selectedTaskId) ?? null;

  async function handleClaim(task: Task) {
    if (!slug) return;
    setClaimingId(task.id);
    try {
      const updated = await claimTask(slug, task.id);
      upsertTask(updated);
      toast.success("Task claimed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to claim task");
    } finally {
      setClaimingId(null);
    }
  }

  if (!slug) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/boards">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{slug}</h1>
            <p className="text-sm text-muted-foreground">
              {tasks ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
          </div>
        </div>
        <CreateTaskDialog boardSlug={slug} onCreated={upsertTask} />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              {tab.value !== "all" && counts[tab.value] > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">{counts[tab.value]}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!tasks && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {tasks && visibleTasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks here yet.</p>
      )}

      {tasks && visibleTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={(t) => setSelectedTaskId(t.id)}
              onClaim={handleClaim}
              claiming={claimingId === task.id}
            />
          ))}
        </div>
      )}

      <TaskDetailSheet
        boardSlug={slug}
        task={selectedTask}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
        onTaskUpdated={upsertTask}
        liveComments={liveComments}
      />
    </div>
  );
}
