import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, MessageSquare, Monitor, Reply, UserCheck, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { playNotificationChime, setSoundEnabled, soundEnabled } from "@/lib/notificationSound";
import {
  desktopEnabled,
  desktopPermission,
  requestDesktopPermission,
  setDesktopEnabled,
  showDesktopNotification,
  type DesktopPermission,
} from "@/lib/desktopNotifications";
import { toast } from "sonner";

const STORAGE_KEY = "phlash_notifications_last_seen";

interface NotifItem {
  id: string;
  kind: "feedback" | "reply" | "assigned";
  created_at: string;
  title: string;
  subtitle: string;
  href: string;
  /**
   * Personal notifications track their own read state in the database, because
   * "was this addressed to me and have I seen it" has to survive a new device.
   * The derived activity items fall back to a local high-water mark.
   */
  unread: boolean;
}

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  feedback_item_id: string | null;
  read_at: string | null;
  created_at: string;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [feedback, setFeedback] = useState<any[]>([]);
  const [replies, setReplies] = useState<any[]>([]);
  const [personal, setPersonal] = useState<NotificationRow[]>([]);
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "1970-01-01T00:00:00Z");
  const [open, setOpen] = useState(false);
  const [audible, setAudible] = useState(soundEnabled);
  const [desktopOn, setDesktopOn] = useState(desktopEnabled);
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission);

  const loadPersonal = useCallback(async () => {
    if (!user?.id) { setPersonal([]); return; }
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, feedback_item_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setPersonal(data ?? []);
  }, [user?.id]);

  const loadActivity = useCallback(async () => {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: fb }, { data: rp }] = await Promise.all([
      supabase
        .from("feedback_items")
        .select("id, comment, guest_name, created_at, project_id, created_by_type")
        .eq("created_by_type", "guest")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("feedback_comments")
        .select("id, body, guest_name, created_at, feedback_item_id, is_internal, user_id")
        .eq("is_internal", false)
        .is("user_id", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setFeedback(fb ?? []);
    setReplies(rp ?? []);
  }, []);

  useEffect(() => {
    loadActivity();
    const ch = supabase
      .channel("notif-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "feedback_items" }, loadActivity)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "feedback_comments" }, loadActivity)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadActivity]);

  // Personal notifications arrive on their own channel, filtered server-side to
  // this user — RLS would hide anyone else's rows anyway, but there is no point
  // streaming them across the wire.
  useEffect(() => {
    if (!user?.id) return;
    loadPersonal();

    const ch = supabase
      .channel(`notif-personal-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          setPersonal((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev].slice(0, 30)));
          void playNotificationChime();
          toast(row.title, { description: row.body ?? undefined });
          // Only surfaces when the window isn't already in front, so someone
          // watching the inbox doesn't get an OS banner for what they can see.
          showDesktopNotification({
            title: row.title,
            body: row.body ?? undefined,
            tag: row.id,
            href: row.feedback_item_id ? `/feedback?item=${row.feedback_item_id}` : "/feedback",
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [user?.id, loadPersonal]);

  const items: NotifItem[] = useMemo(() => {
    const mine: NotifItem[] = personal.map((n) => ({
      id: `n-${n.id}`,
      kind: "assigned",
      created_at: n.created_at,
      title: n.title,
      subtitle: n.body ?? "",
      href: n.feedback_item_id ? `/feedback?item=${n.feedback_item_id}` : "/feedback",
      unread: !n.read_at,
    }));
    const fb: NotifItem[] = feedback.map((f) => ({
      id: `f-${f.id}`,
      kind: "feedback",
      created_at: f.created_at,
      title: `${f.guest_name ?? "Guest"} left feedback`,
      subtitle: f.comment ?? "",
      href: `/feedback?item=${f.id}`,
      unread: f.created_at > lastSeen,
    }));
    const rp: NotifItem[] = replies.map((r) => ({
      id: `r-${r.id}`,
      kind: "reply",
      created_at: r.created_at,
      title: `${r.guest_name ?? "Guest"} replied`,
      subtitle: r.body ?? "",
      href: r.feedback_item_id ? `/feedback?item=${r.feedback_item_id}` : "/feedback",
      unread: r.created_at > lastSeen,
    }));
    return [...mine, ...fb, ...rp].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
  }, [personal, feedback, replies, lastSeen]);

  const unread = items.filter((i) => i.unread).length;

  async function markRead() {
    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, now);
    setLastSeen(now);

    const unseen = personal.filter((n) => !n.read_at).map((n) => n.id);
    if (unseen.length === 0) return;
    setPersonal((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).in("id", unseen);
  }

  async function toggleDesktop() {
    if (desktopOn) {
      setDesktopOn(false);
      setDesktopEnabled(false);
      return;
    }

    // Browsers only allow the prompt from a user gesture, and a denial is
    // permanent until the person changes it in site settings — so ask here,
    // on an explicit click, rather than on load.
    let current = desktopPermission();
    if (current === "default") current = await requestDesktopPermission();
    setPermission(current);

    if (current === "unsupported") { toast.error("This browser can't show desktop notifications."); return; }
    if (current === "denied") {
      toast.error("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
      return;
    }

    setDesktopOn(true);
    setDesktopEnabled(true);
    toast.success("Desktop notifications on. They appear when this window isn't in front.");
  }

  function toggleSound() {
    const next = !audible;
    setAudible(next);
    setSoundEnabled(next);
    // Unmuting is a user gesture, which is exactly what an AudioContext needs
    // to start — so this doubles as a preview and as the unlock.
    if (next) void playNotificationChime();
  }

  const ICONS = { feedback: MessageSquare, reply: Reply, assigned: UserCheck } as const;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) markRead(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
          <span className="sr-only">
            {unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">Notifications</div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{items.length} recent</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleSound}
              title={audible ? "Mute notification sound" : "Unmute notification sound"}
            >
              {audible ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="sr-only">{audible ? "Mute notification sound" : "Unmute notification sound"}</span>
            </Button>
            {permission !== "unsupported" && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${desktopOn && permission === "granted" ? "text-primary" : ""}`}
                onClick={toggleDesktop}
                title={
                  permission === "denied"
                    ? "Desktop notifications are blocked in your browser settings"
                    : desktopOn
                      ? "Turn off desktop notifications"
                      : "Show notifications on your desktop"
                }
              >
                <Monitor className="w-4 h-4" />
                <span className="sr-only">
                  {desktopOn ? "Turn off desktop notifications" : "Turn on desktop notifications"}
                </span>
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">Nothing new yet.</div>
          )}
          {permission === "denied" && desktopOn && (
            <div className="px-4 py-2 text-[11px] text-warning border-b border-border">
              Desktop notifications are blocked for this site in your browser settings.
            </div>
          )}
          {items.map((it) => {
            const Icon = ICONS[it.kind];
            return (
              <Link
                key={it.id}
                to={it.href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/50 ${it.unread ? "bg-primary/5" : ""}`}
              >
                <div className="flex gap-3">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${it.kind === "assigned" ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{it.subtitle}</div>
                    <div className="text-[10px] text-muted-foreground/70 mt-0.5">{new Date(it.created_at).toLocaleString()}</div>
                  </div>
                  {it.unread && <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                </div>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
