import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Check, X } from "lucide-react";
import { updateFocus } from "@/lib/api";
import type { FocusMetric } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One metric on the active Focus — a current/target bar with the current
 *  value inline-editable (click the pencil, type a number, save). Target is
 *  not editable here; use EditFocusDialog's metrics patch for that if needed. */
export function FocusMetricRow({ focusId, metric, onUpdated }: { focusId: string; metric: FocusMetric; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(metric.current));
  const [saving, setSaving] = useState(false);

  const pct = metric.target > 0 ? Math.min(100, Math.round((metric.current / metric.target) * 100)) : 0;

  async function save() {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      toast.error("Enter a number");
      return;
    }
    setSaving(true);
    try {
      await updateFocus(focusId, { metrics: [{ label: metric.label, current: num }] });
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
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-20"
            disabled={saving}
          />
          <span className="text-sm text-muted-foreground">/ {metric.target}</span>
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
            setValue(String(metric.current));
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
