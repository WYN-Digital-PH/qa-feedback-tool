import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { describeWriteError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Clock, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Where a canvas stands with its reviewers, and the log behind it.
 *
 * This used to render `review_decisions` straight out as a list, which quietly
 * turned a permanent log into a status indicator: once a client picked
 * "Request changes", the warning sat on the project page for good. Resolving
 * their comments changed nothing, because a resolved comment and an open
 * change request were unrelated records.
 *
 * So the summary line is the thing to read, and the log is the evidence under
 * it. A round of requested changes stays open until somebody with
 * `feedback.resolve` says the work is done — a client's decision is never
 * edited away, and only a client can turn it into an approval.
 */

type Decision = Tables<"review_decisions">;

/** The rounds still waiting on the team — the only rows that need an action. */
function openChangeRequests(decisions: Decision[]): Decision[] {
  return decisions.filter((d) => d.decision === "changes_requested" && !d.addressed_at);
}

export default function ApprovalHistory({ canvasId }: { canvasId: string }) {
  const { can } = useAuth();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [comments, setComments] = useState<{ open: number; total: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, total, open] = await Promise.all([
      supabase
        .from("review_decisions")
        .select("*")
        .eq("canvas_id", canvasId)
        .order("created_at", { ascending: false }),
      supabase
        .from("feedback_items")
        .select("id", { count: "exact", head: true })
        .eq("canvas_id", canvasId)
        .eq("is_internal", false)
        .is("deleted_at", null),
      supabase
        .from("feedback_items")
        .select("id", { count: "exact", head: true })
        .eq("canvas_id", canvasId)
        .eq("is_internal", false)
        .is("deleted_at", null)
        .not("status", "in", "(resolved,closed)"),
    ]);
    setDecisions(data ?? []);
    setComments({ open: open.count ?? 0, total: total.count ?? 0 });
  }, [canvasId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Close every open round at once.
   *
   * A client who reviews twice leaves two rows, and the work that answers them
   * is the same work — acknowledging each separately would be busywork. The
   * timestamp and the actor are stamped by a trigger, so sending
   * `addressed_at` only signals intent and neither can be forged here.
   */
  async function markAddressed() {
    const ids = openChangeRequests(decisions).map((d) => d.id);
    if (!ids.length) return;

    setClosing(true);
    const { data, error } = await supabase
      .from("review_decisions")
      .update({ addressed_at: new Date().toISOString() })
      .in("id", ids)
      .select("id");
    setClosing(false);

    // RLS reports a blocked update as zero rows rather than an error.
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "review decisions", hasRole: true, action: "close" })
          : "Your role isn't allowed to close a round of requested changes.",
      );
      return;
    }
    toast.success(ids.length === 1 ? "Round marked as addressed" : `${ids.length} rounds marked as addressed`);
    load();
  }

  if (decisions.length === 0) return null;

  const open = openChangeRequests(decisions);
  const latest = decisions[0];

  return (
    <div className="mt-3 border-t border-border pt-3">
      {/* ------------------------------------------------- where it stands now */}
      {open.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-warning">
                Changes requested by {open.map((d) => d.reviewer_name ?? "a guest").join(", ")}
              </div>
              {open[0].message && (
                <p className="text-xs text-muted-foreground italic mt-1">"{open[0].message}"</p>
              )}
              {comments && comments.total > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {comments.open === 0
                    ? `All ${comments.total} comment${comments.total === 1 ? "" : "s"} resolved`
                    : `${comments.open} of ${comments.total} comment${comments.total === 1 ? "" : "s"} still open`}
                </p>
              )}
            </div>
          </div>

          {can("feedback.resolve") && (
            <Button size="sm" variant="outline" className="mt-2.5 w-full" onClick={markAddressed} disabled={closing}>
              {closing && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Mark addressed
            </Button>
          )}
        </div>
      ) : latest.decision === "approved" ? (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
          <span className="text-success font-medium">Approved</span>
          <span className="text-muted-foreground truncate">by {latest.reviewer_name ?? "a guest"}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-medium">Addressed</span>
          <span className="text-muted-foreground">awaiting re-review</span>
        </div>
      )}

      {/* ------------------------------------------------------------ the log */}
      {/* Closed by default. The summary above is the part worth reading, and a
          canvas that has been round the houses a few times would otherwise
          stand several times taller than the cards either side of it. */}
      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        aria-expanded={historyOpen}
        className="flex items-center gap-1 mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          aria-hidden
          className={`w-3.5 h-3.5 transition-transform ${historyOpen ? "rotate-90" : ""}`}
        />
        Approval history
        <span className="font-normal normal-case tracking-normal">({decisions.length})</span>
      </button>

      {/* Bounded even when open, so one long-running canvas cannot run away
          with the page the moment somebody opens its history. */}
      <div hidden={!historyOpen} className="space-y-1.5 mt-2 max-h-52 overflow-y-auto">
        {decisions.map((d) => {
          const approved = d.decision === "approved";
          const Icon = approved ? CheckCircle2 : AlertCircle;
          return (
            <div key={d.id} className="flex items-start gap-2 text-xs">
              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${approved ? "text-success" : "text-warning"}`} />
              <div className="flex-1 min-w-0">
                <div>
                  <span className={`font-medium capitalize ${approved ? "text-success" : "text-warning"}`}>
                    {String(d.decision).replace(/_/g, " ")}
                  </span>
                  {" by "}
                  <span>{d.reviewer_name ?? "Guest"}</span>
                  {d.reviewer_email && <span className="text-muted-foreground"> &lt;{d.reviewer_email}&gt;</span>}
                </div>
                {d.message && <div className="text-muted-foreground italic line-clamp-2">"{d.message}"</div>}
                <div className="text-[10px] text-muted-foreground/70">
                  {new Date(d.created_at).toLocaleString()}
                  {d.addressed_at && (
                    <span className="text-success"> · addressed {new Date(d.addressed_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
