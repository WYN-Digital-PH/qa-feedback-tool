/**
 * Turning an `activity_logs` row into a sentence.
 *
 * The timeline used to render the action verbatim and the details as raw JSON:
 *
 *     Briggs Pedrera Assigned To Changed — {"assigned_to":"4b6b3f1e-ca77-…"}
 *     Briggs - CEO Feedback Submitted — {"category":"general","page_url":"…"}
 *
 * Which is a log of the database's words, not an account of what happened. The
 * UUID is the worst of it: the one thing a reader wants from "assigned to" is
 * the person's name, and that is exactly what was withheld.
 *
 * Actions are not a closed set — the feedback sheet writes `${field}_changed`
 * for whichever field was edited — so this names the ones worth naming and
 * degrades into a readable sentence for anything it has not seen before,
 * rather than falling back to JSON.
 */
import { humanize } from "@/lib/feedbackMeta";

export interface ActivityDescription {
  /** Reads directly after the actor's name: "Sam **replied**". */
  summary: string;
  /** Secondary line — a page, a message. Omitted when there is nothing worth adding. */
  detail?: string;
}

/** Looks a user id up to a display name; returns null when unknown. */
export type ResolveName = (userId: string) => string | null;

/** Title-cases a field name: `assigned_to` → "Assigned to". */
function fieldLabel(field: string): string {
  const spaced = field.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A value as a reader would say it, rather than as it is stored. */
function valueLabel(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "nothing";
  if (typeof value === "boolean") return value ? "yes" : "no";
  // status and priority share the vocabulary the rest of the UI renders.
  if (field === "status" || field === "priority" || field === "category") return humanize(String(value));
  return String(value);
}

function asRecord(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

/** A person's name for an id, falling back to something better than a UUID. */
function personLabel(id: unknown, resolve: ResolveName): string {
  if (typeof id !== "string" || !id) return "nobody";
  return resolve(id) ?? "a former member";
}

export function describeActivity(
  action: string,
  details: unknown,
  resolveName: ResolveName = () => null,
): ActivityDescription {
  const d = asRecord(details);
  // A bulk action is worth flagging — it explains a burst of identical lines.
  const bulk = d.bulk === true ? " (bulk update)" : "";

  switch (action) {
    case "feedback_submitted": {
      const bits = [d.category, d.priority]
        .filter((v) => typeof v === "string" && v && v !== "general" && v !== "normal")
        .map((v) => humanize(String(v)));
      return {
        summary: "left this feedback",
        detail: [typeof d.page_url === "string" ? d.page_url : null, bits.join(" · ") || null]
          .filter(Boolean)
          .join(" — ") || undefined,
      };
    }

    case "guest_reply_added":
    case "public_reply_added":
      return { summary: "replied" };

    case "internal_note_added":
      return { summary: "added an internal note" };

    case "feedback_edited_by_team":
      return { summary: "edited the comment" };

    case "feedback_deleted_by_team":
      return { summary: "deleted this feedback" };

    case "feedback_deleted_by_guest":
      return { summary: "deleted their comment" };

    case "review_decision": {
      const approved = d.decision === "approved";
      return {
        summary: approved ? "approved the review" : "requested changes",
        detail: typeof d.message === "string" && d.message.trim() ? d.message : undefined,
      };
    }

    // The guest mutate endpoint writes the new status under a generic `value`.
    case "status_changed_by_guest":
      return { summary: `marked it ${humanize(String(d.value ?? ""))}` };

    case "assigned_to_changed": {
      const who = d.assigned_to;
      return {
        summary: who
          ? `assigned it to ${personLabel(who, resolveName)}${bulk}`
          : `cleared the assignee${bulk}`,
      };
    }

    case "status_changed":
      return { summary: `moved it to ${humanize(String(d.status ?? ""))}${bulk}` };
  }

  // `${field}_changed` for anything the feedback sheet can edit.
  const changed = action.match(/^(.+)_changed$/);
  if (changed) {
    const field = changed[1];
    const value = d[field] ?? d.value;
    return { summary: `changed ${fieldLabel(field)} to ${valueLabel(field, value)}${bulk}` };
  }

  // Unknown action: still a sentence, never a JSON dump.
  return { summary: action.replace(/_/g, " ") };
}
