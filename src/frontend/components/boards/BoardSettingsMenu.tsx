import { useState } from "react";
import { toast } from "sonner";
import { deleteBoard, getBoard, updateBoard } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function BoardSettingsMenu({ slug, onDeleted }: { slug: string; onDeleted: () => void }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function openRename() {
    setLoadingCurrent(true);
    setRenameOpen(true);
    try {
      const board = await getBoard(slug);
      setName(board.name);
      setDescription(board.description ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load board");
      setRenameOpen(false);
    } finally {
      setLoadingCurrent(false);
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await updateBoard(slug, { name: name.trim(), description: description.trim() || undefined });
      toast.success("Board updated");
      setRenameOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update board");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete board "${slug}" and all its tasks from view? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteBoard(slug);
      toast.success("Board deleted");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete board");
      setDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={openRename}>
            <Pencil className="size-3.5" />
            Rename board
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={deleting} onSelect={handleDelete}>
            <Trash2 className="size-3.5" />
            {deleting ? "Deleting…" : "Delete board"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleRename}>
            <DialogHeader>
              <DialogTitle>Board settings</DialogTitle>
              <DialogDescription>Rename this board or update its description.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-rename-name">Name</Label>
                <Input
                  id="board-rename-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loadingCurrent}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-rename-description">Description</Label>
                <Textarea
                  id="board-rename-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loadingCurrent}
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={saving || loadingCurrent}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
