import { useState } from "react";
import { useWorkspace } from "@/context/workspace-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { ChevronsUpDown, Plus, Check } from "lucide-react";

/**
 * A single workspace has nothing to switch between — show its name as
 * plain text (Rule 37: no dropdown for a fixed non-choice). Once there are
 * two or more, it becomes a real switcher. "Create workspace" always lives
 * at the bottom of the dropdown once you're using it at all.
 */
export function WorkspaceSwitcher() {
  const { workspaces, current, setCurrentId, refresh } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (!workspaces || !current) return null;

  if (workspaces.length === 1) {
    return <span className="text-sm font-medium text-muted-foreground">{current.name}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-medium">
          {current.name}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} onSelect={() => setCurrentId(ws.id)} className="justify-between">
            {ws.name}
            {ws.id === current.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} asChild>
          <div>
            <CreateWorkspaceDialog
              trigger={
                <button className="flex w-full items-center gap-2" onClick={() => setOpen(true)}>
                  <Plus className="size-3.5" />
                  New workspace
                </button>
              }
              open={open}
              onOpenChange={setOpen}
              onCreated={async (ws) => {
                await refresh();
                setCurrentId(ws.id);
              }}
            />
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
