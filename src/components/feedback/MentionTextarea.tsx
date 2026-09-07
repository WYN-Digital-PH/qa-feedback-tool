import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  findMentionQuery,
  matchCandidates,
  type MentionCandidate,
  type PendingMention,
} from "@/lib/mentions";

/**
 * A plain textarea that can name a teammate.
 *
 * The textarea holds what the writer sees — "@Briggs Pedrera" — and never the
 * stored token, which would be unreadable mid-sentence. Every pick is recorded
 * in `pending` so the caller can swap the labels for account ids at submit
 * time with `encodeMentions`.
 *
 * The picker is only ever mounted where mentioning makes sense: pass no
 * `candidates` and this is an ordinary textarea.
 */
export default function MentionTextarea({
  value,
  onChange,
  candidates,
  pending,
  onPendingChange,
  placeholder,
  rows = 3,
  className,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Who may be mentioned. Empty disables the picker entirely. */
  candidates?: readonly MentionCandidate[];
  pending: readonly PendingMention[];
  onPendingChange: (next: PendingMention[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const enabled = !!candidates?.length;
  const matches = useMemo(
    () => (query && enabled ? matchCandidates(candidates!, query.query) : []),
    [query, candidates, enabled],
  );
  const open = !!query && matches.length > 0;

  // A pick that scrolls out of range shouldn't stay selected.
  useEffect(() => { setActive(0); }, [query?.query]);

  function sync(next: string, caret: number) {
    onChange(next);
    setQuery(enabled ? findMentionQuery(next, caret) : null);
  }

  function choose(candidate: MentionCandidate) {
    if (!query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(query.start + 1 + query.query.length);
    const next = `${before}@${candidate.name}${after.startsWith(" ") ? "" : " "}${after}`;

    onChange(next);
    setQuery(null);
    if (!pending.some((p) => p.id === candidate.id && p.label === candidate.name)) {
      onPendingChange([...pending, { id: candidate.id, label: candidate.name }]);
    }

    // Put the caret after what we just inserted rather than at the end.
    const caret = before.length + 1 + candidate.name.length + 1;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter is how you pick, so it must not also post the note.
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
    }
  }

  return (
    <div className="relative">
      <Textarea
        id={id}
        ref={ref}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-expanded={enabled ? open : undefined}
        onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const el = e.currentTarget;
          setQuery(enabled ? findMentionQuery(el.value, el.selectionStart ?? 0) : null);
        }}
        onBlur={() => {
          // Let a click on the list land before it is torn down.
          setTimeout(() => setQuery(null), 120);
        }}
      />

      {open && (
        <ul
          role="listbox"
          aria-label="Team members"
          className="absolute z-50 bottom-full mb-1 w-full max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1"
        >
          {matches.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm flex flex-col",
                  i === active ? "bg-secondary" : "hover:bg-secondary/60",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
              >
                <span className="truncate">{c.name}</span>
                {c.email && <span className="truncate text-[11px] text-muted-foreground">{c.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
