import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity } from "lucide-react";

interface Props {
  feedbackItemId?: string;
  projectId?: string;
  canvasId?: string;
  limit?: number;
}

function formatAction(a: string) {
  return a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ActivityTimeline({ feedbackItemId, projectId, canvasId, limit = 30 }: Props) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchLogs() {
    let q = supabase
      .from("activity_logs")
      .select("*, profiles(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (feedbackItemId) q = q.eq("feedback_item_id", feedbackItemId);
    else if (canvasId) q = q.eq("canvas_id", canvasId);
    else if (projectId) q = q.eq("project_id", projectId);
    const { data } = await q;
    setLogs(data ?? []);
    setLoading(false);
  }

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
  if (logs.length === 0) return <div className="text-xs text-muted-foreground">No activity recorded yet.</div>;

  return (
    <div className="space-y-2">
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2 text-xs">
          <Activity className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div>
              <span className="font-medium">{(l.profiles as any)?.full_name ?? l.guest_name ?? "System"}</span>
              {" "}
              <span className="text-muted-foreground">{formatAction(l.action)}</span>
              {l.details && Object.keys(l.details).length > 0 && (
                <span className="text-muted-foreground"> — <code className="font-mono text-[10px]">{JSON.stringify(l.details)}</code></span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground/70">{new Date(l.created_at).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
