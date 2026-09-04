import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";
import { describeActivity } from "@/lib/activityLog";

interface Props {
  feedbackItemId?: string;
  projectId?: string;
  canvasId?: string;
  limit?: number;
}

export default function ActivityTimeline({ feedbackItemId, projectId, canvasId, limit = 30 }: Props) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Names for the ids that turn up inside `details`. An assignment records who
   * it went to as a UUID, and a UUID is precisely what the reader is trying to
   * look up. Fetched once — the table is small, and the log rows have no
   * foreign key to join through.
   */
  const [names, setNames] = useState<Record<string, string>>({});

  async function fetchLogs() {
    let q = supabase
      .from("activity_logs")
      .select("*, profiles(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (feedbackItemId) q = q.eq("feedback_item_id", feedbackItemId);
    else if (canvasId) q = q.eq("canvas_id", canvasId);
    else if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q;
    // A dropped error here is how this component spent its whole life rendering
    // "No activity recorded yet." over a failing request: an empty list and a
    // broken query looked identical. Keep them distinguishable.
    if (error) {
      console.error("[ActivityTimeline] could not load activity", error);
      setError(error.message);
      setLogs([]);
    } else {
      setError(null);
      setLogs(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    supabase.from("profiles").select("id, full_name, email").then(({ data }) => {
      if (cancelled) return;
      const m: Record<string, string> = {};
      (data ?? []).forEach((r: any) => { m[r.id] = r.full_name || r.email || ""; });
      setNames(m);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
    const key = feedbackItemId ?? canvasId ?? projectId ?? "all";
    const ch = supabase
      .channel(`activity-${key}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_logs" }, (payload: any) => {
        const row = payload.new;
        if (feedbackItemId && row.feedback_item_id !== feedbackItemId) return;
        if (!feedbackItemId && canvasId && row.canvas_id !== canvasId) return;
        if (!feedbackItemId && !canvasId && projectId && row.project_id !== projectId) return;
        fetchLogs();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [feedbackItemId, projectId, canvasId, limit]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading activity…</div>;
  if (error) return <div className="text-xs text-destructive">Activity could not be loaded. {error}</div>;
  if (logs.length === 0) return <div className="text-xs text-muted-foreground">No activity recorded yet.</div>;

  return (
    <div className="space-y-2">
      {logs.map((l) => {
        const { summary, detail } = describeActivity(l.action, l.details, (id) => names[id] || null);
        const actor = (l.profiles as any)?.full_name ?? (l.profiles as any)?.email ?? l.guest_name ?? "System";
        return (
          <div key={l.id} className="flex gap-2 text-xs">
            <Activity className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div>
                <span className="font-medium">{actor}</span>{" "}
                <span className="text-muted-foreground">{summary}</span>
              </div>
              {detail && (
                <div className="text-[11px] text-muted-foreground/80 truncate" title={detail}>{detail}</div>
              )}
              <div className="text-[10px] text-muted-foreground/70">{new Date(l.created_at).toLocaleString()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
