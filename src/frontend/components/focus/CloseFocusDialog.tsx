import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { ApiError, closeFocus } from "@/lib/api";
import type { Focus, FocusStatus } from "@/lib/types";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_OPTIONS: { value: FocusStatus; label: string }[] = [
  { value: "hit", label: "Hit — got it done" },
  { value: "missed", label: "Missed — didn't land" },
  { value: "parked", label: "Parked — dropped for something else" },
];

/** Closes the active Focus as hit/missed/parked, freeing the workspace's
 *  active slot. Closing is not reversible (see focus.ts's closeFocus). */
export function CloseFocusDialog({ focus, onClosed }: { focus: Focus; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<FocusStatus>("hit");
  const [lesson, setLesson] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await closeFocus(focus.id, status, lesson.trim() || undefined);
      toast.success("Focus closed");
      onClosed();
      setStatus("hit");
      setLesson("");
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to close Focus";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <CheckCircle2 className="size-3.5" />
          Close Focus
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Close "{focus.title}"</DialogTitle>
            <DialogDescription>This frees the workspace to start a new Focus. Not reversible.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-focus-status">Result</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as FocusStatus)}>
                <SelectTrigger id="close-focus-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="close-focus-lesson">Lesson (optional)</Label>
              <Textarea
                id="close-focus-lesson"
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                placeholder="What would you do differently next time?"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Closing…" : "Close Focus"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
