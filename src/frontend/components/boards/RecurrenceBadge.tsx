import { Repeat } from "lucide-react";
import type { RecurrenceInterval } from "@/lib/types";

export const RECURRENCE_LABEL: Record<RecurrenceInterval, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/**
 * The one marker that says "this task comes back". A recurring task and the
 * occurrence it spawned share a title, so without this they are
 * indistinguishable in any list — the drawer was the only place that said so.
 */
export function RecurrenceBadge({
  recurrence,
  className = "",
}: {
  recurrence: RecurrenceInterval;
  className?: string;
}) {
  const label = RECURRENCE_LABEL[recurrence];
  return (
    <span
      className={`flex items-center gap-1 text-xs text-muted-foreground ${className}`}
      title={`Repeats ${label.toLowerCase()} — completing it creates the next occurrence`}
    >
      <Repeat className="size-3 shrink-0" />
      {label}
    </span>
  );
}
