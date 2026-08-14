import { useState } from "react";
import { toast } from "sonner";
import { createColumn, deleteColumn, reorderColumns, updateColumn as apiUpdateColumn } from "@/lib/api";
import type { Column } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronUp, ChevronDown, Lock } from "lucide-react";

const ROLE_LABEL: Record<string, string> = {
  open: "claims from here",
  active: "claimed tasks land here",
  done: "completing a recurring task here spawns the next one",
};

function ColumnRow({
  column,
  siblings,
  isFirst,
  isLast,
  onRenamed,
  onMoved,
  onDeleted,
}: {
  column: Column;
  siblings: Column[];
  isFirst: boolean;
  isLast: boolean;
  onRenamed: (name: string) => void;
  onMoved: (direction: "up" | "down") => void;
  onDeleted: (reassignTo: string) => Promise<void>;
}) {
  const [name, setName] = useState(column.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reassignTo, setReassignTo] = useState(siblings[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === column.name) {
      setName(column.name);
      return;
    }
    onRenamed(trimmed);
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await onDeleted(reassignTo);
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-4"
            disabled={isFirst}
            onClick={() => onMoved("up")}
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-4"
            disabled={isLast}
            onClick={() => onMoved("down")}
          >
            <ChevronDown className="size-3" />
          </Button>
        </div>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="h-8 flex-1"
        />

        {column.role ? (
          <Badge variant="outline" className="flex shrink-0 items-center gap-1 text-[11px]">
            <Lock className="size-3" />
            {column.role}
          </Badge>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-destructive"
            onClick={() => setConfirmingDelete((v) => !v)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {column.role && <p className="pl-8 text-[11px] text-muted-foreground">{ROLE_LABEL[column.role]}</p>}

      {confirmingDelete && (
        <div className="flex items-center gap-2 pl-8">
          <span className="text-xs text-muted-foreground">Move any tasks here to:</span>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {siblings.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" disabled={busy || !reassignTo} onClick={handleDelete}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export function ManageColumnsDialog({
  slug,
  columns,
  open,
  onOpenChange,
  onColumnsChanged,
}: {
  slug: string;
  columns: Column[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onColumnsChanged: (columns: Column[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const ordered = [...columns].sort((a, b) => a.position - b.position);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const column = await createColumn(slug, newName.trim());
      onColumnsChanged([...columns, column]);
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add column");
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(id: string, name: string) {
    try {
      const column = await apiUpdateColumn(slug, id, name);
      onColumnsChanged(columns.map((c) => (c.id === id ? column : c)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename column");
    }
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const idx = ordered.findIndex((c) => c.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    try {
      const reordered = await reorderColumns(
        slug,
        next.map((c) => c.id),
      );
      onColumnsChanged(reordered);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder columns");
    }
  }

  async function handleDelete(id: string, reassignTo: string) {
    try {
      await deleteColumn(slug, id, reassignTo);
      onColumnsChanged(columns.filter((c) => c.id !== id));
      toast.success("Column deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete column");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            This board's stages — rename, reorder, add, or delete. The three locked columns drive claiming and
            recurring tasks, so they can be renamed but never deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {ordered.map((column, i) => (
            <ColumnRow
              key={column.id}
              column={column}
              siblings={columns.filter((c) => c.id !== column.id)}
              isFirst={i === 0}
              isLast={i === ordered.length - 1}
              onRenamed={(name) => handleRename(column.id, name)}
              onMoved={(dir) => handleMove(column.id, dir)}
              onDeleted={(reassignTo) => handleDelete(column.id, reassignTo)}
            />
          ))}
        </div>

        <div className="flex gap-1.5 border-t pt-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="New column name…"
            className="h-8 text-sm"
          />
          <Button size="icon-sm" variant="outline" disabled={adding || !newName.trim()} onClick={handleAdd}>
            <Plus className="size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
