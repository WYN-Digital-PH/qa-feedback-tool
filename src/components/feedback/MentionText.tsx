import { splitMentions } from "@/lib/mentions";
import type { ResolveName } from "@/lib/displayName";
import { cn } from "@/lib/utils";

/**
 * A comment body with its mentions picked out.
 *
 * Mentions are stored as account ids, so the name shown here is resolved at
 * render time — a teammate who renames themselves is named correctly on notes
 * written long before.
 */
export default function MentionText({
  body,
  resolve,
  className,
}: {
  body?: string | null;
  resolve?: ResolveName;
  className?: string;
}) {
  const parts = splitMentions(body, resolve);
  return (
    <div className={cn("whitespace-pre-wrap", className)}>
      {parts.map((part, i) =>
        part.type === "mention" ? (
          <span key={i} className="font-medium text-primary bg-primary/10 rounded px-1 py-0.5">
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </div>
  );
}
