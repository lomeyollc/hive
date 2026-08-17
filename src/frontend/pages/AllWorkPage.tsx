import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, AlertTriangle, Search, X } from "lucide-react";
import {
  bulkUpdateTasks,
  listAllTasks,
  listBoards,
  type AllWorkFilters,
} from "@/lib/api";
import type { AllWorkTask, Board, TaskPriority } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MultiSelectFilter } from "@/components/boards/MultiSelectFilter";
import { PriorityBadge, PRIORITY_OPTIONS } from "@/components/boards/PriorityBadge";
import { GenericStatusBadge } from "@/components/boards/StatusBadge";

/**
 * "All work" — every task in every board you can see, as one flat list.
 *
 * Why this page exists: Hive puts each board in its own Durable Object, so
 * until now the only way to answer "what should I do next" was to open seven
 * boards and hold the answer in your head. This reads the D1 index in one
 * query and filters server-side, so the whole workspace is one list you can
 * sort, group, and act on in bulk.
 *
 * The bulk bar is the point of the page as much as the list is. A backlog
 * gets unusable by accumulating tasks nobody will ever start; clearing thirty
 * of those has to be one sitting, not thirty page loads.
 *
 * Saved views are just filter presets, not separate code paths — the URL is
 * the state, so every view and every ad-hoc filter combination is equally
 * linkable and equally reloadable.
 */

/** How long a live task can sit untouched before the list says so. */
const STALE_DAYS = 14;

type SortKey = NonNullable<AllWorkFilters["sort"]>;
type GroupKey = "none" | "board" | "priority" | "status" | "assignee";

interface SavedView {
  id: string;
  label: string;
  /** Applied on top of whatever the user has NOT explicitly overridden. */
  params: Record<string, string>;
  hint: string;
}

const SAVED_VIEWS: SavedView[] = [
  { id: "open", label: "All open", params: {}, hint: "Everything not archived" },
  {
    id: "needs-you",
    label: "Needs you",
    params: { needs_human: "1" },
    hint: "Blocked on a decision from you",
  },
  {
    id: "now",
    label: "Now",
    params: { priority: "urgent,high", sort: "priority" },
    hint: "Urgent and high only",
  },
  {
    id: "stale",
    label: "Stale",
    params: { stale_days: String(STALE_DAYS), sort: "updated" },
    hint: `Untouched for ${STALE_DAYS}+ days — archive candidates`,
  },
  {
    id: "archived",
    label: "Archived",
    params: { archived: "only", sort: "updated" },
    hint: "Cold storage. Restore anything that turns out to matter",
  },
];

const SORT_LABEL: Record<SortKey, string> = {
  priority: "Priority",
  updated: "Last updated",
  created: "Newest",
  due: "Due date",
};

const GROUP_LABEL: Record<GroupKey, string> = {
  none: "No grouping",
  board: "Board",
  priority: "Priority",
  status: "Status",
  assignee: "Assignee",
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function timeAgo(iso: string): string {
  const days = daysSince(iso);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return "now";
}

/** A stable key for a task, since ids are only unique within their board. */
function taskKey(task: Pick<AllWorkTask, "board_id" | "id">): string {
  return `${task.board_id}:${task.id}`;
}

export function AllWorkPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState<AllWorkTask[] | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Kept separate from the URL so typing doesn't fire a request per keystroke;
  // committed to the URL on submit.
  const [searchDraft, setSearchDraft] = useState(params.get("q") ?? "");

  const csv = useCallback((key: string): string[] => {
    const raw = params.get(key);
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [params]);

  const filters: AllWorkFilters = useMemo(
    () => ({
      board: csv("board"),
      priority: csv("priority") as TaskPriority[],
      status: csv("status"),
      label: csv("label"),
      assignee: params.get("assignee") ?? undefined,
      needsHuman: params.get("needs_human") === "1",
      archived: (params.get("archived") as AllWorkFilters["archived"]) ?? "exclude",
      staleDays: Number(params.get("stale_days")) || undefined,
      q: params.get("q") ?? undefined,
      sort: (params.get("sort") as SortKey) ?? "priority",
    }),
    [csv, params],
  );

  const group = (params.get("group") as GroupKey) ?? "board";
  const sort = filters.sort ?? "priority";

  /** Writes one or more params, dropping empty ones so URLs stay readable. */
  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const activeView = SAVED_VIEWS.find((view) =>
    Object.entries(view.params).every(([k, v]) => params.get(k) === v) &&
    // "All open" would otherwise match every view, since its params are empty.
    (view.id !== "open" || (!params.get("needs_human") && !params.get("archived") && !params.get("stale_days"))),
  );

  const applyView = (view: SavedView) => {
    const next = new URLSearchParams();
    // A saved view is a fresh start, except for grouping — that is a display
    // preference, not part of the question being asked.
    if (params.get("group")) next.set("group", params.get("group")!);
    for (const [key, value] of Object.entries(view.params)) next.set(key, value);
    setParams(next, { replace: true });
    setSearchDraft("");
  };

  const load = useCallback(async () => {
    try {
      const items = await listAllTasks(filters);
      setTasks(items);
      setError(null);
      // Drop selections for rows that are no longer in the list — acting on
      // an invisible selection is how bulk tools cause accidents.
      setSelected((prev) => {
        const visible = new Set(items.map(taskKey));
        return new Set(Array.from(prev).filter((key) => visible.has(key)));
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
      toast.error(message);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listBoards()
      .then(setBoards)
      .catch(() => {
        // Non-fatal: the board filter falls back to whatever the loaded rows
        // reveal, so a failure here degrades the filter list, not the page.
      });
  }, []);

  // Labels and statuses have no registry to read from — they are per-board
  // and open-ended — so their options come from what is currently loaded,
  // with anything already selected pinned so a filter can always be cleared.
  const labelOptions = useMemo(() => {
    const values = new Set<string>(filters.label ?? []);
    for (const task of tasks ?? []) for (const label of task.labels) values.add(label);
    return Array.from(values).sort().map((value) => ({ value, label: value }));
  }, [tasks, filters.label]);

  const statusOptions = useMemo(() => {
    const values = new Set<string>(filters.status ?? []);
    for (const task of tasks ?? []) values.add(task.status);
    return Array.from(values).sort().map((value) => ({ value, label: value.replace(/_/g, " ") }));
  }, [tasks, filters.status]);

  const boardOptions = useMemo(() => {
    if (boards.length > 0) return boards.map((b) => ({ value: b.id, label: b.name }));
    const seen = new Map<string, string>();
    for (const task of tasks ?? []) seen.set(task.board_id, task.board_name);
    return Array.from(seen).map(([value, label]) => ({ value, label }));
  }, [boards, tasks]);

  const groups = useMemo(() => {
    const rows = tasks ?? [];
    if (group === "none") return [{ key: "all", label: "", items: rows }];
    const buckets = new Map<string, { label: string; items: AllWorkTask[] }>();
    for (const task of rows) {
      const [key, label] =
        group === "board"
          ? [task.board_id, task.board_name]
          : group === "priority"
            ? [task.priority, task.priority]
            : group === "status"
              ? [task.status, task.status.replace(/_/g, " ")]
              : [task.assignee ?? "none", task.assignee ?? "Unassigned"];
      const bucket = buckets.get(key) ?? { label, items: [] };
      bucket.items.push(task);
      buckets.set(key, bucket);
    }
    return Array.from(buckets, ([key, value]) => ({ key, ...value }));
  }, [tasks, group]);

  const toggleOne = (task: AllWorkTask) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = taskKey(task);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === (tasks?.length ?? 0) ? new Set() : new Set((tasks ?? []).map(taskKey))));
  };

  const selectedTasks = (tasks ?? []).filter((task) => selected.has(taskKey(task)));

  const runBulk = async (
    patch: Parameters<typeof bulkUpdateTasks>[1],
    describe: (n: number) => string,
  ) => {
    if (selectedTasks.length === 0) return;
    setBusy(true);
    try {
      const result = await bulkUpdateTasks(
        selectedTasks.map((task) => ({ board_id: task.board_id, id: task.id })),
        patch,
      );
      // Partial failure is a real outcome here, not an edge case — say so
      // rather than reporting a clean success over a half-applied change.
      if (result.failed_count > 0) {
        toast.warning(`${describe(result.updated_count)} — ${result.failed_count} failed`);
      } else {
        toast.success(describe(result.updated_count));
      }
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk update failed");
    } finally {
      setBusy(false);
    }
  };

  const showingArchive = filters.archived === "only";
  const hasFilters =
    Array.from(params.keys()).filter((key) => key !== "group" && key !== "sort").length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">All work</h1>
          <p className="text-sm text-muted-foreground">
            {activeView?.hint ?? "Every task across every board, in one list."}
          </p>
        </div>
        {tasks && (
          <p className="text-sm text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </p>
        )}
      </div>

      {/* Saved views — filter presets, not separate pages. */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => applyView(view)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeView?.id === view.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {view.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            setParam({ q: searchDraft.trim() || null });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search title and description"
            className="h-8 w-56 pl-8 text-sm"
          />
        </form>

        <MultiSelectFilter
          label="Board"
          options={boardOptions}
          selected={filters.board ?? []}
          onChange={(next) => setParam({ board: next.join(",") || null })}
        />
        <MultiSelectFilter
          label="Priority"
          options={PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          selected={filters.priority ?? []}
          onChange={(next) => setParam({ priority: next.join(",") || null })}
        />
        <MultiSelectFilter
          label="Status"
          options={statusOptions}
          selected={filters.status ?? []}
          onChange={(next) => setParam({ status: next.join(",") || null })}
        />
        <MultiSelectFilter
          label="Label"
          options={labelOptions}
          selected={filters.label ?? []}
          onChange={(next) => setParam({ label: next.join(",") || null })}
        />

        <Button
          variant="outline"
          size="sm"
          className={filters.needsHuman ? "border-destructive/50 text-destructive" : "text-muted-foreground"}
          onClick={() => setParam({ needs_human: filters.needsHuman ? null : "1" })}
        >
          <AlertTriangle className="size-3.5" />
          Needs you
        </Button>

        <Select value={sort} onValueChange={(value) => setParam({ sort: value })}>
          <SelectTrigger size="sm" className="w-auto min-w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                Sort: {SORT_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={group} onValueChange={(value) => setParam({ group: value })}>
          <SelectTrigger size="sm" className="w-auto min-w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GROUP_LABEL) as GroupKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                Group: {GROUP_LABEL[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              const next = new URLSearchParams();
              if (params.get("group")) next.set("group", params.get("group")!);
              setParams(next, { replace: true });
              setSearchDraft("");
            }}
          >
            <X className="size-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Bulk bar — only present when it can actually do something. */}
      {selectedTasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-accent/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedTasks.length} selected</span>
          <span className="h-4 w-px bg-border" />
          {showingArchive ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runBulk({ archived: false }, (n) => `Restored ${n}`)}
            >
              <ArchiveRestore className="size-3.5" />
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runBulk({ archived: true }, (n) => `Archived ${n}`)}
            >
              <Archive className="size-3.5" />
              Archive
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                Set priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Applies to all {selectedTasks.length}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PRIORITY_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() =>
                    void runBulk({ priority: option.value }, (n) => `Set ${n} to ${option.label.toLowerCase()}`)
                  }
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void runBulk({ needs_human: false }, (n) => `Cleared the flag on ${n}`)}
          >
            Clear needs-you
          </Button>

          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Deselect
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!tasks && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "Nothing matches these filters." : "No tasks yet."}
          </p>
        </div>
      )}

      {tasks && tasks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={
                      selected.size === 0 ? false : selected.size === tasks.length ? true : "indeterminate"
                    }
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Task</TableHead>
                {group !== "board" && <TableHead className="w-40">Board</TableHead>}
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24">Priority</TableHead>
                <TableHead className="w-20 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((bucket) => (
                <Fragment key={bucket.key}>
                  {group !== "none" && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={group === "board" ? 5 : 6} className="bg-muted/40 py-1.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {bucket.label} ({bucket.items.length})
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                  {bucket.items.map((task) => {
                    const stale = !task.archived_at && daysSince(task.updated_at) >= STALE_DAYS;
                    return (
                      <TableRow
                        key={taskKey(task)}
                        data-state={selected.has(taskKey(task)) ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => navigate(`/boards/${task.board_id}/tasks/${task.id}`)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${task.title}`}
                            checked={selected.has(taskKey(task))}
                            onCheckedChange={() => toggleOne(task)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {task.needs_human && (
                              <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                            )}
                            <span className={task.archived_at ? "text-muted-foreground line-through" : ""}>
                              {task.title}
                            </span>
                            {stale && (
                              <Badge variant="outline" className="text-muted-foreground">
                                stale
                              </Badge>
                            )}
                            {task.labels.map((label) => (
                              <Badge key={label} variant="secondary" className="font-normal">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        {group !== "board" && (
                          <TableCell className="text-sm text-muted-foreground">{task.board_name}</TableCell>
                        )}
                        <TableCell>
                          <GenericStatusBadge status={task.status} />
                        </TableCell>
                        <TableCell>
                          <PriorityBadge priority={task.priority} />
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {timeAgo(task.updated_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
