import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { ApiError, updateFocus } from "@/lib/api";
import type { Focus } from "@/lib/types";
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

/** Edits title/why/NOT list/end date on the active Focus. Metrics have their
 *  own inline edit on FocusPage (setMetric's upsert path), not this dialog. */
export function EditFocusDialog({ focus, onUpdated }: { focus: Focus; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(focus.title);
  const [why, setWhy] = useState(focus.why ?? "");
  const [notList, setNotList] = useState(focus.not_list.join("\n"));
  const [endsAt, setEndsAt] = useState(focus.ends_at.slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  function openWithFreshValues(next: boolean) {
    if (next) {
      setTitle(focus.title);
      setWhy(focus.why ?? "");
      setNotList(focus.not_list.join("\n"));
      setEndsAt(focus.ends_at.slice(0, 10));
      setError(null);
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
    setError(null);
    try {
      await updateFocus(focus.id, {
        title: title.trim(),
        why: why.trim(),
        not_list: notList
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
      });
      toast.success("Focus updated");
      onUpdated();
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to update Focus";
      setError(message);
      toast.error(message);
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
            <DialogTitle>Edit Focus</DialogTitle>
            <DialogDescription>Update the title, why, NOT list, or end date.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-focus-title">Title</Label>
              <Input id="edit-focus-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-focus-why">Why (one line)</Label>
              <Input id="edit-focus-why" value={why} onChange={(e) => setWhy(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-focus-ends">Ends</Label>
              <Input id="edit-focus-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-focus-not-list">NOT list (one per line)</Label>
              <Textarea
                id="edit-focus-not-list"
                value={notList}
                onChange={(e) => setNotList(e.target.value)}
                rows={3}
              />
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
