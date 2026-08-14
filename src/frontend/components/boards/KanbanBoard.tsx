import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task, TaskStatus } from "@/lib/types";
import { StatusBadge } from "@/components/boards/StatusBadge";
import { PriorityBadge } from "@/components/boards/PriorityBadge";
import { AlertTriangle } from "lucide-react";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "planned", label: "Backlog" },
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

function KanbanCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => !isDragging && onOpen(task)}
      className={`cursor-grab rounded-md border bg-card p-2.5 text-sm shadow-sm active:cursor-grabbing ${
        isDragging ? "opacity-50" : ""
      } ${task.needs_human ? "border-destructive/40 bg-destructive/5" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        {task.needs_human && <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />}
        <p className="line-clamp-2 font-medium">{task.title}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <PriorityBadge priority={task.priority} />
        {task.assignee && <span className="text-[11px] text-muted-foreground">→ {task.assignee}</span>}
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  tasks,
  onOpen,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/20 p-2 ${
        isOver ? "border-primary/50 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <StatusBadge status={status} />
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-16 flex-col gap-2">
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} onOpen={onOpen} />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            Drop here
          </div>
        )}
      </div>
      <p className="sr-only">{label}</p>
    </div>
  );
}

/**
 * Kanban board view — an alternative to the status-tab list view on the
 * same board detail page. Dragging a card between columns updates the
 * task's status via `onMove`, optimistically (the caller re-renders
 * immediately; the API call happens in the background, same pattern as
 * claim/resolve elsewhere in the app).
 */
export function KanbanBoard({
  tasks,
  onOpen,
  onMove,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: TaskStatus) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const task = tasks.find((t) => t.id === active.id);
    const newStatus = over.id as TaskStatus;
    if (!task || task.status === newStatus) return;
    onMove(task, newStatus);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <KanbanColumn key={col.status} status={col.status} label={col.label} tasks={byStatus(col.status)} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
