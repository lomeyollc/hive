import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/lib/types";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-orange-700 dark:text-orange-400",
  urgent: "text-red-700 dark:text-red-400",
};

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <Badge variant="outline" className={cn(PRIORITY_CLASS[priority], className)}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = (
  Object.keys(PRIORITY_LABEL) as TaskPriority[]
).map((value) => ({ value, label: PRIORITY_LABEL[value] }));
