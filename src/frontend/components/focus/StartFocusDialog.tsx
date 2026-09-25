import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ApiError, startFocus } from "@/lib/api";
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

interface MetricDraft {
  label: string;
  target: string;
}

/**
 * Starts a new Focus for the current workspace. The backend allows only one
 * active Focus per workspace (a D1 partial unique index) — a second start
 * while one is active 409s, and that message is shown as-is rather than a
 * generic failure (per the task-2 brief's "show clear error messages").
 */
export function StartFocusDialog({
  workspaceId,
  onStarted,
}: {
  workspaceId: string;
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [notList, setNotList] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [metrics, setMetrics] = useState<MetricDraft[]>([{ label: "", target: "" }]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setWhy("");
    setNotList("");
    setEndsAt("");
    setMetrics([{ label: "", target: "" }]);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!endsAt) {
      toast.error("End date is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await startFocus({
        workspace_id: workspaceId,
        title: title.trim(),
        why: why.trim() || undefined,
        not_list: notList
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        ends_at: new Date(endsAt).toISOString(),
        metrics: metrics
          .filter((m) => m.label.trim() && m.target.trim())
          .map((m) => ({ label: m.label.trim(), target: Number(m.target) })),
      });
      toast.success("Focus started");
      onStarted();
      reset();
      setOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to start Focus";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Start a Focus
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Start a Focus</DialogTitle>
            <DialogDescription>The one thing this workspace is pushing on. 1–4 weeks is advice, not enforced.</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-4">
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-title">Title</Label>
              <Input
                id="focus-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Launch S&C"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-why">Why (one line)</Label>
              <Input
                id="focus-why"
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="Trial→paid is the leak"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-ends">Ends</Label>
              <Input id="focus-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="focus-not-list">NOT list (one per line)</Label>
              <Textarea
                id="focus-not-list"
                value={notList}
                onChange={(e) => setNotList(e.target.value)}
                placeholder="Redesign the site&#10;New marketing channels"
                rows={3}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Metrics</Label>
              {metrics.map((metric, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={metric.label}
                    onChange={(e) =>
                      setMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, label: e.target.value } : m)))
                    }
                    placeholder="Signups from strangers"
                    className="flex-1"
                  />
                  <Input
                    value={metric.target}
                    onChange={(e) =>
                      setMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, target: e.target.value } : m)))
                    }
                    placeholder="Target"
                    type="number"
                    className="w-24"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => setMetrics((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                onClick={() => setMetrics((prev) => [...prev, { label: "", target: "" }])}
              >
                <Plus className="size-3.5" />
                Add metric
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Starting…" : "Start Focus"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
