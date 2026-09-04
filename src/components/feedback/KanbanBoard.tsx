import { useMemo } from "react";
import { DndContext, DragEndEvent, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { useState } from "react";
import {
  humanize,
  prioritySolidClass,
  statusEdgeClass,
  statusSolidClass,
  statusBadgeClass,
} from "@/lib/feedbackMeta";
import { cn } from "@/lib/utils";

// The board's columns are the status vocabulary, in workflow order. Assignment
// is deliberately absent: it is `assigned_to`, shown on the card, not a column
// an item can be dragged into.
export const KANBAN_COLUMNS = [
  { key: "new", label: "New" },
  { key: "in_progress", label: "In progress" },
  { key: "ready_for_qa", label: "Ready for QA" },
  { key: "resolved", label: "Resolved" },
] as const;

interface KanbanBoardProps {
  items: any[];
  onStatusChange: (itemId: string, newStatus: string) => void;
  onCardClick: (item: any) => void;
  feedbackLabelMap: Record<string, string[]>;
  labels: { id: string; name: string; color: string }[];
  /** Resolves `assigned_to` to a display name; the column shows it on the card. */
  assigneeName?: (userId?: string | null) => string | null;
  /** Resolves the card's author. Without it the card falls back to `guest_name`. */
  authorName?: (item: any) => string | null;
}

function Card({ item, onClick, labelChips, assigneeName, authorName }: {
  item: any;
  onClick: () => void;
  labelChips: { id: string; name: string; color: string }[];
  assigneeName?: string | null;
  authorName?: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => { if (!isDragging) onClick(); e.stopPropagation(); }}
      className={cn(
        // The left edge carries the column colour, so a card dragged out of
        // place is obvious before it is dropped.
        "surface-card p-3 border-l-4 cursor-grab active:cursor-grabbing select-none transition-shadow hover:shadow-md",
        statusEdgeClass(item.status),
        isDragging && "opacity-30",
      )}
      style={{ touchAction: "none" }}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", prioritySolidClass(item.priority))}
          title={`${humanize(item.priority)} priority`}
        />
        <div className="text-sm line-clamp-3 flex-1 min-w-0">{item.comment}</div>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between gap-2">
        <span className="truncate">{authorName ?? item.guest_name ?? "Guest"}</span>
        {assigneeName ? (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium truncate max-w-[90px]">
            {assigneeName}
          </span>
        ) : (
          <span className="shrink-0 capitalize">{humanize(item.priority)}</span>
        )}
      </div>
      {labelChips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {labelChips.slice(0, 3).map((l) => (
            <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded text-white" style={{ background: l.color }}>{l.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Column({ columnKey, label, items, renderCard }: { columnKey: string; label: string; items: any[]; renderCard: (it: any) => JSX.Element }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey });
  return (
    <div className="flex flex-col min-w-[260px] w-[260px]">
      {/* A solid rule in the column's own colour, so the board reads as a
          sequence of stages rather than six identical grey troughs. */}
      <div className={cn("h-1 rounded-t", statusSolidClass(columnKey))} />
      <div className="px-2 py-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider">{label}</div>
        <span className={cn("text-[11px] font-semibold px-1.5 py-0.5 rounded", statusBadgeClass(columnKey))}>
          {items.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-lg p-2 space-y-2 min-h-[400px] transition-colors border border-dashed",
          isOver ? "bg-primary/10 border-primary/40" : "bg-secondary/40 border-transparent",
        )}
      >
        {items.map((it) => renderCard(it))}
        {items.length === 0 && (
          <div className="text-[11px] text-muted-foreground/60 text-center py-6">
            {isOver ? "Release to move here" : "Nothing here"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({ items, onStatusChange, onCardClick, feedbackLabelMap, labels, assigneeName, authorName }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    KANBAN_COLUMNS.forEach((c) => { g[c.key] = []; });
    items.forEach((it) => {
      // A status with no column can only be a value retired by a migration that
      // has not run yet. Fall back rather than dropping the card off the board.
      const key = g[it.status] ? it.status : (it.status === "closed" ? "resolved" : "new");
      (g[key] ??= []).push(it);
    });
    return g;
  }, [items]);

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const newStatus = String(over.id);
    const item = items.find((i) => i.id === active.id);
    if (!item || item.status === newStatus) return;
    onStatusChange(String(active.id), newStatus);
  }

  const labelChipsFor = (id: string) =>
    (feedbackLabelMap[id] ?? []).map((lid) => labels.find((l) => l.id === lid)).filter(Boolean) as any[];

  const activeItem = items.find((i) => i.id === activeId);

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_COLUMNS.map((col) => (
          <Column
            key={col.key}
            columnKey={col.key}
            label={col.label}
            items={grouped[col.key] ?? []}
            renderCard={(it) => (
              <Card
                key={it.id}
                item={it}
                onClick={() => onCardClick(it)}
                labelChips={labelChipsFor(it.id)}
                assigneeName={assigneeName?.(it.assigned_to)}
                authorName={authorName?.(it)}
              />
            )}
          />
        ))}
      </div>
      <DragOverlay>
        {activeItem && (
          <div className={cn("surface-card p-3 shadow-lg rotate-2 w-[244px] border-l-4", statusEdgeClass(activeItem.status))}>
            <div className="text-sm line-clamp-3">{activeItem.comment}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
