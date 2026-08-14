import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  planned: "Backlog",
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  planned: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_CLASS[status], "border-transparent", className)}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = (
  Object.keys(STATUS_LABEL) as TaskStatus[]
).map((value) => ({ value, label: STATUS_LABEL[value] }));
