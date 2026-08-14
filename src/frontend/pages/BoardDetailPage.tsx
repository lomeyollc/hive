import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search, LayoutGrid, List as ListIcon } from "lucide-react";
import { toast } from "sonner";
import { claimTask, listTasks, updateTask } from "@/lib/api";
import { useBoardSocket } from "@/hooks/use-board-socket";
import type { Comment, Task, TaskStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateTaskDialog } from "@/components/boards/CreateTaskDialog";
import { BoardSettingsMenu } from "@/components/boards/BoardSettingsMenu";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { TaskCard } from "@/components/boards/TaskCard";
import { TaskDetailSheet } from "@/components/boards/TaskDetailSheet";
import { KanbanBoard } from "@/components/boards/KanbanBoard";

const TABS: { value: "all" | TaskStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "planned", label: "Backlog" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

export function BoardDetailPage() {
  const { slug, taskId } = useParams<{ slug: string; taskId?: string }>();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  // The open task IS the URL (Rule 38) — taskId comes from the route, not
  // local state, so copying the URL or reloading reproduces the same sheet.
  const selectedTaskId = taskId ?? null;
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
    const base: Record<TaskStatus, number> = { planned: 0, open: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of tasks ?? []) base[t.status] += 1;
    return base;
  }, [tasks]);

  const searchedTasks = useMemo(() => {
    if (!tasks) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) => t.title.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
    );
  }, [tasks, search]);

  // List view respects both the status tab and search; the board view shows
  // every status as its own column, so only search narrows it.
  const visibleTasks = useMemo(
    () => (filter === "all" ? searchedTasks : searchedTasks.filter((t) => t.status === filter)),
    [searchedTasks, filter],
  );

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

  async function handleMove(task: Task, status: TaskStatus) {
    if (!slug) return;
    const previous = task.status;
    upsertTask({ ...task, status }); // optimistic — Rule 7
    try {
      const updated = await updateTask(slug, task.id, { status });
      upsertTask(updated);
    } catch (err) {
      upsertTask({ ...task, status: previous }); // roll back on failure
      toast.error(err instanceof Error ? err.message : "Failed to move task");
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
          <CopyLinkButton path={`/boards/${slug}`} />
          <BoardSettingsMenu slug={slug} onDeleted={() => navigate("/boards")} />
        </div>
        <CreateTaskDialog boardSlug={slug} onCreated={upsertTask} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === "list" ? (
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
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-[220px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="h-8 pl-8 text-sm"
            />
          </div>

          {/* Two fixed options -> segmented control, not a dropdown (Rule 37). */}
          <div className="flex rounded-md border p-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant={view === "board" ? "secondary" : "ghost"}
              onClick={() => setView("board")}
              title="Board view"
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={view === "list" ? "secondary" : "ghost"}
              onClick={() => setView("list")}
              title="List view"
            >
              <ListIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

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

      {tasks && view === "board" && (
        <KanbanBoard
          tasks={searchedTasks}
          onOpen={(t) => navigate(`/boards/${slug}/tasks/${t.id}`)}
          onMove={handleMove}
        />
      )}

      {tasks && view === "list" && visibleTasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No tasks here yet.</p>
      )}

      {tasks && view === "list" && visibleTasks.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={(t) => navigate(`/boards/${slug}/tasks/${t.id}`)}
              onClaim={handleClaim}
              claiming={claimingId === task.id}
            />
          ))}
        </div>
      )}

      <TaskDetailSheet
        boardSlug={slug}
        task={selectedTask}
        allTasks={tasks ?? []}
        onOpenTask={(id) => navigate(`/boards/${slug}/tasks/${id}`)}
        onOpenChange={(open) => !open && navigate(`/boards/${slug}`)}
        onTaskUpdated={upsertTask}
        onTaskDeleted={(deletedTaskId) => {
          setTasks((prev) => prev?.filter((t) => t.id !== deletedTaskId) ?? prev);
          navigate(`/boards/${slug}`);
        }}
        liveComments={liveComments}
      />
    </div>
  );
}
