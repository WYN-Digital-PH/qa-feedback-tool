import {
  humanize,
  priorityTone,
  statusBadgeClass,
  statusSolidClass,
  toneClasses,
  type Tone,
} from "@/lib/feedbackMeta";
import { cn } from "@/lib/utils";

type Size = "sm" | "xs";

const SIZE: Record<Size, string> = {
  sm: "text-xs px-2 py-1",
  xs: "text-[10px] px-1.5 py-0.5",
};

interface PillProps {
  tone: Tone;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}

/** Base pill. Prefer `StatusBadge` / `PriorityBadge` so tones stay consistent. */
export function Pill({ tone, size = "sm", className, children }: PillProps) {
  return (
    <span className={cn("inline-flex items-center rounded font-medium", SIZE[size], toneClasses(tone), className)}>
      {children}
    </span>
  );
}

/**
 * A status pill. Each status has its own hue rather than sharing one of five
 * tones, because "In review", "Assigned" and "In progress" all used to render
 * the same blue — which made a board or a list impossible to scan.
 */
export function StatusBadge({ status, size = "sm", className }: { status?: string | null; size?: Size; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded font-medium whitespace-nowrap",
        SIZE[size],
        statusBadgeClass(status),
        className,
      )}
    >
      <span className={cn("rounded-full", size === "xs" ? "w-1 h-1" : "w-1.5 h-1.5", statusSolidClass(status))} />
      {humanize(status ?? "new")}
    </span>
  );
}

/** Just the colour, for places with no room for a label. */
export function StatusDot({ status, className }: { status?: string | null; className?: string }) {
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", statusSolidClass(status), className)}
      title={humanize(status)}
    />
  );
}

export function PriorityBadge({ priority, size = "sm", className }: { priority?: string | null; size?: Size; className?: string }) {
  return (
    <Pill tone={priorityTone(priority)} size={size} className={className}>
      {humanize(priority)}
    </Pill>
  );
}
