import { useState } from "react";
import { toast } from "sonner";
import { createTask } from "@/lib/api";
import type { Column, RecurrenceInterval, Task, TaskPriority, TaskStatus } from "@/lib/types";
import { PRIORITY_OPTIONS } from "@/components/boards/PriorityBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, AlertTriangle } from "lucide-react";

export function CreateTaskDialog({
  boardSlug,
  columns,
  onCreated,
}: {
  boardSlug: string;
  columns: Column[];
  onCreated: (task: Task) => void;
}) {
  const defaultColumnId = () => columns.find((c) => c.role === "open")?.id ?? columns[0]?.id ?? "";
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultColumnId());
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignee, setAssignee] = useState("");
  const [labels, setLabels] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [needsHuman, setNeedsHuman] = useState(false);
  const [needsHumanReason, setNeedsHumanReason] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceInterval | "none">("none");

  function reset() {
    setTitle("");
    setDescription("");
    setStatus(defaultColumnId());
    setPriority("normal");
    setAssignee("");
    setLabels("");
    setDueDate("");
    setNeedsHuman(false);
    setNeedsHumanReason("");
    setRecurrence("none");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const task = await createTask(boardSlug, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assignee: assignee.trim() || undefined,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        due_date: dueDate || undefined,
        needs_human: needsHuman || undefined,
        needs_human_reason: needsHuman ? needsHumanReason.trim() || undefined : undefined,
        recurrence: recurrence === "none" ? undefined : recurrence,
      });
      toast.success(needsHuman ? "Task created — pinged you on Telegram" : "Task created");
      onCreated(task);
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          New task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create task</DialogTitle>
            <DialogDescription>Add a new task to this board.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix the flaky claim endpoint"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details, repro steps, acceptance criteria…"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger id="task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...columns]
                      .sort((a, b) => a.position - b.position)
                      .map((column) => (
                        <SelectItem key={column.id} value={column.id}>
                          {column.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger id="task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-due">Due date</Label>
                <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-recurrence">Repeats</Label>
                <Select value={recurrence} onValueChange={(v) => setRecurrence(v as typeof recurrence)}>
                  <SelectTrigger id="task-recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Doesn't repeat</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recurrence !== "none" && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Marking this task Done will automatically create the next occurrence.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-assignee">Assignee</Label>
              <Input
                id="task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="you@example.com or an agent name"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-labels">Labels</Label>
              <Input
                id="task-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="bug, backend (comma-separated)"
              />
            </div>

            <div className="flex flex-col gap-1.5 rounded-md border p-3">
              <button
                type="button"
                onClick={() => setNeedsHuman((v) => !v)}
                className={`flex items-center gap-1.5 text-sm font-medium ${needsHuman ? "text-destructive" : "text-muted-foreground"}`}
              >
                <AlertTriangle className="size-3.5" />
                Needs a human — ping me now
              </button>
              {needsHuman && (
                <Input
                  value={needsHumanReason}
                  onChange={(e) => setNeedsHumanReason(e.target.value)}
                  placeholder="Why? (shown in the Telegram ping)"
                  className="mt-1"
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
