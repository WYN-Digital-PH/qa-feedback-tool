import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FolderKanban, MessageSquare, CheckCircle2, Clock, AlertCircle, Sparkles, type LucideIcon } from "lucide-react";
import { Page, PageHeader, SectionHeading } from "@/components/layout/Page";
import { InlineEmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/feedback/StatusBadge";
import { feedbackAuthor, makeNameResolver, type ProfileLike } from "@/lib/displayName";

interface Stats {
  projects: number;
  canvases: number;
  newFeedback: number;
  inProgress: number;
  resolved: number;
}

function StatCard({ icon: Icon, label, value, accent }: { icon: LucideIcon; label: string; value: number; accent?: string }) {
  return (
    <div className="surface-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{label}</div>
        <Icon className={`w-4 h-4 ${accent ?? "text-muted-foreground"}`} />
      </div>
      <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ projects: 0, canvases: 0, newFeedback: 0, inProgress: 0, resolved: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<ProfileLike[]>([]);
  /** Same resolver as every other surface — see src/lib/displayName.ts. */
  const resolveName = useMemo(() => makeNameResolver(profiles), [profiles]);

  useEffect(() => {
    (async () => {
      // Feedback is deleted by stamping `deleted_at`, never by removing the row,
      // so every count and list here has to exclude it explicitly. Without that
      // a client deleting their own comment left it in the dashboard totals and
      // in the recent list — visibly undone everywhere except here.
      const [projects, canvases, fbNew, fbInProg, fbResolved, profileRows, recentFb] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("canvases").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("feedback_items").select("id", { count: "exact", head: true }).eq("status", "new").is("deleted_at", null),
        supabase.from("feedback_items").select("id", { count: "exact", head: true }).in("status", ["in_progress", "ready_for_qa"]).is("deleted_at", null),
        supabase.from("feedback_items").select("id", { count: "exact", head: true }).eq("status", "resolved").is("deleted_at", null),
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("feedback_items").select("id, comment, guest_name, guest_email, created_by_type, created_by_user_id, status, priority, created_at, original_page_url, canvases(name), projects(name)").is("deleted_at", null).order("created_at", { ascending: false }).limit(8),
      ]);
      setStats({
        projects: projects.count ?? 0,
        canvases: canvases.count ?? 0,
        newFeedback: fbNew.count ?? 0,
        inProgress: fbInProg.count ?? 0,
        resolved: fbResolved.count ?? 0,
      });
      setProfiles((profileRows.data ?? []) as ProfileLike[]);
      setRecent(recentFb.data ?? []);
    })();
  }, []);

  return (
    <Page>
      <PageHeader title="Dashboard" description="Overview of active reviews and recent activity." />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard icon={FolderKanban} label="Active projects" value={stats.projects} accent="text-primary" />
        <StatCard icon={Sparkles} label="Active canvases" value={stats.canvases} accent="text-primary" />
        <StatCard icon={MessageSquare} label="New feedback" value={stats.newFeedback} accent="text-warning" />
        <StatCard icon={Clock} label="In progress" value={stats.inProgress} />
        <StatCard icon={CheckCircle2} label="Resolved" value={stats.resolved} accent="text-success" />
      </div>

      <div className="surface-card">
        <div className="px-5 py-4 border-b border-border">
          <SectionHeading>Recent feedback</SectionHeading>
        </div>
        {recent.length === 0 ? (
          <InlineEmptyState message="No feedback yet. Create a project and share a review link to get started." />
        ) : (
          <div className="divide-y divide-border">
            {recent.map((f) => (
              <Link key={f.id} to="/feedback" className="flex items-start gap-4 p-4 hover:bg-secondary/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm line-clamp-2">{f.comment}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {feedbackAuthor(f, resolveName)} · {(f.projects as any)?.name} / {(f.canvases as any)?.name}
                  </div>
                </div>
                <StatusBadge status={f.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
