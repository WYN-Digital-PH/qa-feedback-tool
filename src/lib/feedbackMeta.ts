/**
 * The shared vocabulary for feedback status, priority and visibility.
 *
 * Labels and colours used to be redefined in each page (the feedback table, the
 * dashboard list and the review sidebar each had their own), which is why the
 * same status rendered in three different ways. Everything reads from here now,
 * and every colour resolves to a theme token so it rebrands with the palette.
 */

export const FEEDBACK_STATUSES = [
  "new",
  "in_progress",
  "ready_for_qa",
  "resolved",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * Statuses that still need someone to act on them.
 *
 * Everything except the sign-off, which is the only terminal state.
 */
export const ACTIVE_STATUSES: readonly string[] = ["new", "in_progress", "ready_for_qa"];

/**
 * Statuses that close a feedback item out. Setting one is gated behind the
 * `feedback.resolve` permission, so a developer can move work to Ready for QA
 * but only QA or a lead signs it off. Kept in step with the database trigger
 * `enforce_feedback_update_permissions()`.
 */
export const SIGN_OFF_STATUSES: readonly string[] = ["resolved"];

/**
 * Whether an item is assigned.
 *
 * Assignment is *not* a status. It used to be — a trigger flipped an item to
 * `assigned` as soon as somebody was put on it — which meant one fact was
 * recorded twice and the two copies could disagree: clearing the assignee left
 * the status saying `assigned`. `assigned_to` is the only record of it now, and
 * every "Assigned / Unassigned" the user sees is computed here at the moment of
 * display. Nothing writes it, and nothing can set it by hand.
 */
export function isAssigned(assignedTo?: string | null): boolean {
  return !!assignedTo;
}

/** "Assigned" or "Unassigned", derived from `assigned_to`. */
export function assignmentLabel(assignedTo?: string | null): string {
  return isAssigned(assignedTo) ? "Assigned" : "Unassigned";
}

export const FEEDBACK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  ready_for_qa: "Ready for QA",
  resolved: "Resolved",
};

/** Human label for a status or priority value ("in_progress" → "In progress"). */
export function humanize(value?: string | null): string {
  if (!value) return "—";
  return STATUS_LABELS[value] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Tone name → the token pair used for a filled badge. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export function toneClasses(tone: Tone): string {
  return TONE_CLASSES[tone];
}

export function statusTone(status?: string | null): Tone {
  switch (status) {
    case "new":
      return "warning";
    case "resolved":
      return "success";
    case "in_progress":
    case "ready_for_qa":
      return "info";
    default:
      return "neutral";
  }
}

/* --------------------------------------------------------------------------
   Status colour
   --------------------------------------------------------------------------
   Each status carries its own hue (see the --status-* tokens in index.css), so
   a board column or a badge is recognisable before its label is read.

   Every class string below is written out in full and never composed. Tailwind
   scans source text for class names, so `bg-status-${status}` would produce a
   class that exists in the markup but not in the stylesheet — the colour would
   simply be missing, with nothing to see at build time.
   -------------------------------------------------------------------------- */

/** Soft background + matching text, for badges and chips. */
const STATUS_BADGE: Record<string, string> = {
  new: "bg-status-new/15 text-status-new",
  in_progress: "bg-status-in-progress/15 text-status-in-progress",
  ready_for_qa: "bg-status-ready-for-qa/15 text-status-ready-for-qa",
  resolved: "bg-status-resolved/15 text-status-resolved",
};

/** Solid fill, for the rule above a board column and for dots. */
const STATUS_SOLID: Record<string, string> = {
  new: "bg-status-new",
  in_progress: "bg-status-in-progress",
  ready_for_qa: "bg-status-ready-for-qa",
  resolved: "bg-status-resolved",
};

/** Left edge on a board card, tinted to the column it sits in. */
const STATUS_EDGE: Record<string, string> = {
  new: "border-l-status-new",
  in_progress: "border-l-status-in-progress",
  ready_for_qa: "border-l-status-ready-for-qa",
  resolved: "border-l-status-resolved",
};

export function statusBadgeClass(status?: string | null): string {
  return STATUS_BADGE[status ?? ""] ?? "bg-secondary text-secondary-foreground";
}

export function statusSolidClass(status?: string | null): string {
  return STATUS_SOLID[status ?? ""] ?? "bg-muted-foreground";
}

export function statusEdgeClass(status?: string | null): string {
  return STATUS_EDGE[status ?? ""] ?? "border-l-border";
}

/** Solid fill for a priority dot. Priority stays a three-step scale. */
const PRIORITY_SOLID: Record<string, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  normal: "bg-status-in-progress",
  low: "bg-muted-foreground",
};

export function prioritySolidClass(priority?: string | null): string {
  return PRIORITY_SOLID[priority ?? ""] ?? "bg-muted-foreground";
}

/** Text colour for a priority, for places that show priority as plain text. */
export function priorityTextClass(priority?: string | null): string {
  switch (priority) {
    case "urgent":
      return "text-destructive font-medium";
    case "high":
      return "text-warning font-medium";
    default:
      return "text-muted-foreground";
  }
}

export function priorityTone(priority?: string | null): Tone {
  switch (priority) {
    case "urgent":
      return "danger";
    case "high":
      return "warning";
    default:
      return "neutral";
  }
}
