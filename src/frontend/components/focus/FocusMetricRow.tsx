import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Check, X } from "lucide-react";
import { updateFocus } from "@/lib/api";
import type { FocusMetric } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One metric on the active Focus — a current/target bar with both current
 *  and target inline-editable (click the pencil, type numbers, save). Both
 *  go through the same `PATCH /api/focus/:id { metrics: [...] }` upsert. */
export function FocusMetricRow({ focusId, metric, onUpdated }: { focusId: string; metric: FocusMetric; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(String(metric.current));
  const [target, setTarget] = useState(String(metric.target));
  const [saving, setSaving] = useState(false);

  const pct = metric.target > 0 ? Math.min(100, Math.round((metric.current / metric.target) * 100)) : 0;

  async function save() {
    const currentNum = Number(current);
    const targetNum = Number(target);
    if (!Number.isFinite(currentNum) || !Number.isFinite(targetNum)) {
      toast.error("Enter numbers for both current and target");
      return;
    }
    setSaving(true);
    try {
      await updateFocus(focusId, { metrics: [{ label: metric.label, current: currentNum, target: targetNum }] });
      onUpdated();
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update metric");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{metric.label}</p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {editing ? (
        <div className="flex shrink-0 items-center gap-1">
          <Input
            autoFocus
            type="number"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-20"
            disabled={saving}
            aria-label="Current"
          />
          <span className="text-sm text-muted-foreground">/</span>
          <Input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-20"
            disabled={saving}
            aria-label="Target"
          />
          <Button variant="ghost" size="icon" className="size-7" onClick={() => void save()} disabled={saving}>
            <Check className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(false)} disabled={saving}>
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="group flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground"
          onClick={() => {
            setCurrent(String(metric.current));
            setTarget(String(metric.target));
            setEditing(true);
          }}
        >
          {metric.current} / {metric.target}
          <Pencil className="size-3 opacity-0 group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}
