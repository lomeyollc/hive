import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Column } from "@/lib/types";

/**
 * Colors are role-based where a role exists (done is always green, active
 * always amber, open always blue — matches the old fixed-status palette so
 * existing boards don't visually change), then cycle a fixed palette by
 * position for custom columns so each one is still visually distinct.
 */
const ROLE_CLASS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  active: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

const CUSTOM_PALETTE = [
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300",
];

function classFor(column: Pick<Column, "role" | "position">): string {
  if (column.role) return ROLE_CLASS[column.role];
  return CUSTOM_PALETTE[column.position % CUSTOM_PALETTE.length];
}

export function StatusBadge({ column, className }: { column: Column; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(classFor(column), "border-transparent", className)}>
      {column.name}
    </Badge>
  );
}

export function humanizeStatus(status: string): string {
  return status.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * For cross-board contexts (activity feed, search results, board-list task
 * counts) where the relevant board's actual Column definitions aren't
 * loaded — a generic badge built straight from the raw status string,
 * deterministically colored so distinct statuses stay visually
 * distinguishable within one list even without board context.
 */
export function GenericStatusBadge({ status, className }: { status: string; className?: string }) {
  const hash = Array.from(status).reduce((h, c) => h + c.charCodeAt(0), 0);
  return (
    <Badge
      variant="secondary"
      className={cn(CUSTOM_PALETTE[hash % CUSTOM_PALETTE.length], "border-transparent", className)}
    >
      {humanizeStatus(status)}
    </Badge>
  );
}
