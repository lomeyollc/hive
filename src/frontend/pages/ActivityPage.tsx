import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listActivity, search, type ActivityItem, type SearchCommentResult, type SearchTaskResult } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/boards/StatusBadge";
import { Search as SearchIcon, Plus, Pencil, Hand, Trash2, MessageSquare } from "lucide-react";

const TYPE_ICON: Record<ActivityItem["type"], typeof Plus> = {
  "task.created": Plus,
  "task.updated": Pencil,
  "task.claimed": Hand,
  "task.deleted": Trash2,
  "comment.created": MessageSquare,
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  return mins >= 1 ? `${mins}m ago` : "just now";
}

/**
 * Cross-board activity feed + search. Read-only — this is where you (or an
 * agent, via the MCP list_activity/search tools) go to answer "what
 * happened" or "where did we talk about X" without opening every board.
 */
export function ActivityPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ tasks: SearchTaskResult[]; comments: SearchCommentResult[] } | null>(
    null,
  );
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listActivity().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load activity");
    }).then((data) => data && setItems(data));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      search(q)
        .then(setResults)
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Search failed"))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const showingSearch = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">What happened, and where — across every board.</p>
      </div>

      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks and comments across every board…"
          className="pl-8"
        />
      </div>

      {showingSearch ? (
        <div className="flex flex-col gap-6">
          {searching && !results && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {results && results.tasks.length === 0 && results.comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No matches.</p>
          )}

          {results && results.tasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Tasks ({results.tasks.length})</h2>
              {results.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/boards/${t.board_id}/tasks/${t.id}`)}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusBadge status={t.status} />
                    <span className="truncate">{t.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t.board_name}</span>
                </button>
              ))}
            </div>
          )}

          {results && results.comments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Comments ({results.comments.length})</h2>
              {results.comments.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/boards/${c.board_id}/tasks/${c.task_id}`)}
                  className="flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{c.author ?? "—"}</span>
                    <span>{c.board_name}</span>
                  </span>
                  <span className="line-clamp-2">{c.body}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {!items && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {items && items.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}

          {items?.map((item) => {
            const Icon = TYPE_ICON[item.type];
            return (
              <button
                key={item.id}
                onClick={() => item.task_id && navigate(`/boards/${item.board_id}/tasks/${item.task_id}`)}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 disabled:cursor-default"
                disabled={!item.task_id}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{item.actor ?? "someone"}</span> {item.summary}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.board_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
