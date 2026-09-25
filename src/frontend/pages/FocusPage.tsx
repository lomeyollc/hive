import { Target, AlertTriangle } from "lucide-react";
import { useFocus } from "@/context/focus-context";
import { useWorkspace } from "@/context/workspace-context";
import type { Focus, FocusStatus } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StartFocusDialog } from "@/components/focus/StartFocusDialog";
import { EditFocusDialog } from "@/components/focus/EditFocusDialog";
import { CloseFocusDialog } from "@/components/focus/CloseFocusDialog";
import { FocusMetricRow } from "@/components/focus/FocusMetricRow";
import { useDocumentTitle } from "@/hooks/use-document-title";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

const STATUS_BADGE: Record<FocusStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "Active", variant: "default" },
  hit: { label: "Hit", variant: "default" },
  missed: { label: "Missed", variant: "destructive" },
  parked: { label: "Parked", variant: "secondary" },
};

function PastFocusCard({ focus }: { focus: Focus }) {
  const badge = STATUS_BADGE[focus.status];
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{focus.title}</CardTitle>
          <CardDescription>
            {formatDate(focus.starts_at)} – {formatDate(focus.closed_at ?? focus.ends_at)}
          </CardDescription>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </CardHeader>
      {focus.lesson && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{focus.lesson}</p>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * `/focus` — the active Focus (edit, metrics, NOT list, close) plus the
 * history of past ones. See docs/superpowers/specs/2026-09-25-focus-design.md's
 * "UI" for the shape this follows.
 */
export function FocusPage() {
  useDocumentTitle("Focus");
  const { current } = useWorkspace();
  const { active, past, loading, error, refresh } = useFocus();

  if (!current) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (loading && !active && past.length === 0) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Focus</h1>
        <p className="text-sm text-muted-foreground">The one thing this workspace is pushing on right now.</p>
      </div>

      {!active && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Target className="size-6 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">
            A Focus is the one push this workspace is on for the next 1–4 weeks — a title, why it matters, what's
            explicitly NOT happening, and the numbers that say whether it landed.
          </p>
          <StartFocusDialog workspaceId={current.id} onStarted={() => void refresh()} />
        </div>
      )}

      {active && (
        <Card className={active.overdue ? "border-destructive/40" : undefined}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle>{active.title}</CardTitle>
                {active.overdue && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="size-3" />
                    Overdue
                  </Badge>
                )}
              </div>
              {active.why && <CardDescription>{active.why}</CardDescription>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <EditFocusDialog focus={active} onUpdated={() => void refresh()} />
              <CloseFocusDialog focus={active} onClosed={() => void refresh()} />
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                {formatDate(active.starts_at)} – {formatDate(active.ends_at)}
              </span>
              {active.overdue ? (
                <span className="font-medium text-destructive">Past its end date — close or extend</span>
              ) : (
                <span>
                  {active.days_left} day{active.days_left === 1 ? "" : "s"} left
                </span>
              )}
              {active.progress.total > 0 && (
                <span>
                  {active.progress.done}/{active.progress.total} tasks done
                </span>
              )}
            </div>

            {active.not_list.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-sm font-medium">NOT this Focus</h3>
                <ul className="flex flex-col gap-1">
                  {active.not_list.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      · {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {active.metrics.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-sm font-medium">Metrics</h3>
                <div className="flex flex-col gap-2">
                  {active.metrics.map((metric) => (
                    <FocusMetricRow key={metric.id} focusId={active.id} metric={metric} onUpdated={() => void refresh()} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Past</h2>
          <div className="flex flex-col gap-3">
            {past.map((focus) => (
              <PastFocusCard key={focus.id} focus={focus} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
