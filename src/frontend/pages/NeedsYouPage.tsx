import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { listNeedsHuman, type NeedsHumanItem } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge } from "@/components/boards/PriorityBadge";
import { AlertTriangle } from "lucide-react";
import { CrossBoardTaskSheet } from "@/components/boards/CrossBoardTaskSheet";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

/**
 * The dedicated landing page for the nav badge ("N need you") — every task
 * flagged needs_human across every board you're in, grouped by board so
 * "which product is this on" isn't a mystery. Clicking a card opens that
 * exact task in a drawer over the list, where the real Resolve action already
 * lives — this page is a triage view, not a second place to resolve things.
 *
 * The drawer opens in place rather than navigating to the board: triage is a
 * queue, and answering one item should not cost you the other nine. The task
 * still has its own URL (?task=…&task_board=…, per product-rules.md Rule 38)
 * and resolving one refreshes the list, so it leaves the queue immediately.
 */
export function NeedsYouPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<NeedsHumanItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listNeedsHuman());
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTaskId = params.get("task");
  const openTaskBoard = params.get("task_board");

  // A real history entry, so Back closes the drawer and returns to the queue.
  const openTask = useCallback(
    (boardSlug: string, taskId: string) => {
      setParams(new URLSearchParams({ task: taskId, task_board: boardSlug }));
    },
    [setParams],
  );

  const closeTask = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const byBoard = new Map<string, { name: string; items: NeedsHumanItem[] }>();
  for (const item of items ?? []) {
    const group = byBoard.get(item.board_id) ?? { name: item.board_name, items: [] };
    group.items.push(item);
    byBoard.set(item.board_id, group);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Needs you</h1>
        <p className="text-sm text-muted-foreground">
          Every task flagged across every board, oldest first — the same signal behind the Telegram
          ping and daily digest.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!items && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <AlertTriangle className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-6">
          {Array.from(byBoard.entries()).map(([boardId, group]) => (
            <div key={boardId} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {group.name} <span className="text-xs">({group.items.length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <Card
                    key={item.id}
                    className="cursor-pointer border-destructive/40 bg-destructive/5 transition-colors hover:border-destructive/70"
                    onClick={() => openTask(item.board_id, item.id)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                        <CardTitle className="text-sm leading-snug">{item.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-2 pt-0">
                      <div className="flex items-center gap-1.5">
                        <PriorityBadge priority={item.priority} />
                        <span className="text-xs text-muted-foreground">{timeAgo(item.updated_at)}</span>
                      </div>
                    </CardContent>
                    {item.needs_human_reason && (
                      <CardContent className="pt-0">
                        <p className="line-clamp-2 text-xs text-muted-foreground">{item.needs_human_reason}</p>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <CrossBoardTaskSheet
        boardSlug={openTaskBoard}
        taskId={openTaskId}
        onOpenChange={(open) => {
          if (!open) closeTask();
        }}
        onTaskChanged={() => void load()}
        onOpenTask={openTask}
      />
    </div>
  );
}
