import { Hand, AlertTriangle } from "lucide-react";
import type { Task } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/boards/StatusBadge";
import { PriorityBadge } from "@/components/boards/PriorityBadge";

export function TaskCard({
  task,
  onOpen,
  onClaim,
  claiming,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onClaim: (task: Task) => void;
  claiming: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer gap-2 py-3 transition-colors hover:border-foreground/30 ${
        task.needs_human ? "border-destructive/40 bg-destructive/5" : ""
      }`}
      onClick={() => onOpen(task)}
    >
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {task.needs_human && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
            <p className="truncate text-sm font-medium">{task.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.assignee && (
              <span className="text-xs text-muted-foreground">→ {task.assignee}</span>
            )}
          </div>
          {task.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.labels.map((label) => (
                <span
                  key={label}
                  className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {!task.claimed_by && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            disabled={claiming}
            onClick={(e) => {
              e.stopPropagation();
              onClaim(task);
            }}
          >
            <Hand className="size-3.5" />
            {claiming ? "Claiming…" : "Claim"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
