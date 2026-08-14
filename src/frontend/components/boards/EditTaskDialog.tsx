import { useState } from "react";
import { toast } from "sonner";
import { updateTask } from "@/lib/api";
import type { Task, TaskPriority } from "@/lib/types";
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
import { Pencil, AlertTriangle } from "lucide-react";

export function EditTaskDialog({
  boardSlug,
  task,
  onUpdated,
}: {
  boardSlug: string;
  task: Task;
  onUpdated: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [labels, setLabels] = useState(task.labels.join(", "));
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [needsHuman, setNeedsHuman] = useState(task.needs_human);
  const [needsHumanReason, setNeedsHumanReason] = useState(task.needs_human_reason ?? "");

  function openWithFreshValues(next: boolean) {
    if (next) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setPriority(task.priority);
      setAssignee(task.assignee ?? "");
      setLabels(task.labels.join(", "));
      setDueDate(task.due_date ?? "");
      setNeedsHuman(task.needs_human);
      setNeedsHumanReason(task.needs_human_reason ?? "");
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await updateTask(boardSlug, task.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
        assignee: assignee.trim(),
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
        due_date: dueDate,
        needs_human: needsHuman,
        needs_human_reason: needsHuman ? needsHumanReason.trim() : "",
      });
      toast.success("Task updated");
      onUpdated(updated);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={openWithFreshValues}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>Update any field, then save.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-priority">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger id="edit-priority">
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
                <Label htmlFor="edit-due">Due date</Label>
                <Input id="edit-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-assignee">Assignee</Label>
              <Input id="edit-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-labels">Labels</Label>
              <Input
                id="edit-labels"
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
                Needs a human
              </button>
              {needsHuman && (
                <Input
                  value={needsHumanReason}
                  onChange={(e) => setNeedsHumanReason(e.target.value)}
                  placeholder="Why? (shown in the Telegram ping/digest)"
                  className="mt-1"
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
