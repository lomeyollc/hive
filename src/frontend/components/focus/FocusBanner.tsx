import { Link } from "react-router-dom";
import { Target, AlertTriangle } from "lucide-react";
import { useFocus } from "@/context/focus-context";

/**
 * The Focus banner — under the header on every protected page (mounted once
 * in AppShell). Shows the active Focus's title, days left, each metric as a
 * current/target bar, and task progress; hidden entirely when there is no
 * active Focus. See docs/superpowers/specs/2026-09-25-focus-design.md's "UI".
 */
export function FocusBanner() {
  const { active } = useFocus();

  if (!active) return null;

  const overdue = active.overdue;
  const { total, done } = active.progress;

  return (
    <Link
      to="/focus"
      className={`block border-b px-4 py-3 transition-colors ${
        overdue
          ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
          : "border-border bg-muted/40 hover:bg-muted/60"
      }`}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Target className={`size-4 shrink-0 ${overdue ? "text-destructive" : "text-muted-foreground"}`} />
          <span className="min-w-0 truncate text-sm font-medium">{active.title}</span>
          {overdue ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
              <AlertTriangle className="size-3.5" />
              Past its end date — close or extend
            </span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">
              {active.days_left} day{active.days_left === 1 ? "" : "s"} left
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          {active.metrics.map((metric) => {
            const pct = metric.target > 0 ? Math.min(100, Math.round((metric.current / metric.target) * 100)) : 0;
            return (
              <div key={metric.id} className="flex min-w-0 items-center gap-1.5">
                <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{metric.label}</span>
                <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border">
                  <div
                    className={`h-full rounded-full ${overdue ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {metric.current}/{metric.target}
                </span>
              </div>
            );
          })}

          {total > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {done}/{total} tasks
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
