import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Search, MessageSquare, Tag, Plus, X, LayoutGrid, List as ListIcon, Trash2, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import KanbanBoard from "@/components/feedback/KanbanBoard";
import { useConfirm } from "@/components/ConfirmDialog";
import ActivityTimeline from "@/components/feedback/ActivityTimeline";
import { Page, PageHeader } from "@/components/layout/Page";
import { StatusBadge } from "@/components/feedback/StatusBadge";
import {
  ACTIVE_STATUSES,
  FEEDBACK_PRIORITIES as PRIORITIES,
  FEEDBACK_STATUSES as STATUSES,
  SIGN_OFF_STATUSES,
  humanize,
  priorityTextClass,
} from "@/lib/feedbackMeta";

interface LabelRow { id: string; name: string; color: string; }
interface ProfileRow { id: string; full_name: string | null; email: string | null; }

/** Sentinel for "no one", since a Select item cannot carry an empty value. */
const UNASSIGNED = "unassigned";

/** Up to two initials for the assignee chip. Falls back to a dash. */
function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Labels carry a user-chosen colour, so this one is a literal by design — it is
// only the swatch a new label starts on (a neutral slate).
const DEFAULT_LABEL_COLOR = "#64748b";

export default function Feedback() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can, user } = useAuth();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<any[]>([]);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [feedbackLabelMap, setFeedbackLabelMap] = useState<Record<string, string[]>>({});
  const [latestReplyMap, setLatestReplyMap] = useState<Record<string, { body: string; created_at: string; is_internal: boolean; author: string }>>({});
  const [statusFilter, setStatusFilter] = useState("active"); // active | all | <status>
  const [projectFilter, setProjectFilter] = useState("all");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [labelFilter, setLabelFilter] = useState("all");
  // all | mine | unassigned | <user id>
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [noteKind, setNoteKind] = useState<"public" | "internal">("internal");
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(DEFAULT_LABEL_COLOR);
  const [view, setView] = useState<"list" | "board">("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTab, setDetailTab] = useState<"thread" | "activity">("thread");

  async function loadLabels() {
    const { data } = await supabase.from("labels").select("*").order("name");
    setLabels(data ?? []);
  }

  async function loadFeedbackLabels(itemIds: string[]) {
    if (itemIds.length === 0) { setFeedbackLabelMap({}); return; }
    const { data } = await supabase.from("feedback_labels").select("feedback_item_id, label_id").in("feedback_item_id", itemIds);
    const m: Record<string, string[]> = {};
    (data ?? []).forEach((r: any) => {
      m[r.feedback_item_id] = m[r.feedback_item_id] ?? [];
      m[r.feedback_item_id].push(r.label_id);
    });
    setFeedbackLabelMap(m);
  }

  async function loadProjects() {
    const { data } = await supabase.from("projects").select("id, name").order("name");
    setProjects(data ?? []);
  }

  // `feedback_items.assigned_to` points at auth.users, not profiles, so
  // PostgREST cannot embed the name — resolve it client-side instead.
  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("id, full_name, email").order("full_name");
    setProfiles(data ?? []);
  }

  function assigneeName(id?: string | null): string | null {
    if (!id) return null;
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || "Unknown member";
  }

  async function loadLatestReplies(itemIds: string[]) {
    if (itemIds.length === 0) { setLatestReplyMap({}); return; }
    const { data } = await supabase
      .from("feedback_comments")
      .select("feedback_item_id, body, created_at, is_internal, guest_name, profiles(full_name, email)")
      .in("feedback_item_id", itemIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    const m: Record<string, any> = {};
    (data ?? []).forEach((r: any) => {
      if (m[r.feedback_item_id]) return;
      m[r.feedback_item_id] = {
        body: r.body,
        created_at: r.created_at,
        is_internal: r.is_internal,
        author: r.profiles?.full_name ?? r.profiles?.email ?? r.guest_name ?? "Team",
      };
    });
    setLatestReplyMap(m);
  }

  async function load() {
    let q = supabase
      .from("feedback_items")
      .select("*, projects(name), canvases(name, type), clients(name, company_name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (statusFilter === "active") q = q.in("status", ACTIVE_STATUSES as any);
    else if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
    if (projectFilter !== "all") q = q.eq("project_id", projectFilter);
    if (assigneeFilter === "mine" && user?.id) q = q.eq("assigned_to", user.id);
    else if (assigneeFilter === UNASSIGNED) q = q.is("assigned_to", null);
    else if (assigneeFilter !== "all" && assigneeFilter !== "mine") q = q.eq("assigned_to", assigneeFilter);
    if (!showDeleted) q = q.is("deleted_at", null);
    const { data } = await q;
    let rows = data ?? [];
    if (search.trim()) {
      const s = search.toLowerCase();
      rows = rows.filter((r: any) =>
        (r.comment ?? "").toLowerCase().includes(s) ||
        (r.guest_name ?? "").toLowerCase().includes(s) ||
        (r.original_page_url ?? "").toLowerCase().includes(s)
      );
    }
    setItems(rows);
    await Promise.all([
      loadFeedbackLabels(rows.map((r: any) => r.id)),
      loadLatestReplies(rows.map((r: any) => r.id)),
    ]);
  }

  useEffect(() => {
    loadLabels();
    loadProjects();
    loadProfiles();
  }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter, projectFilter, assigneeFilter, showDeleted]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);

  const visibleItems = useMemo(() => {
    if (labelFilter === "all") return items;
    return items.filter((i) => (feedbackLabelMap[i.id] ?? []).includes(labelFilter));
  }, [items, labelFilter, feedbackLabelMap]);

  // Opened from a notification: the item may sit outside the current filters,
  // so fetch it directly rather than hunting through the loaded page.
  const focusId = params.get("item");
  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("feedback_items")
        .select("*, projects(name), canvases(name, type), clients(name, company_name)")
        .eq("id", focusId)
        .maybeSingle();
      if (cancelled) return;
      if (data) await openItem(data);
      else toast.error("That feedback item no longer exists.");
      // Drop the parameter so a refresh doesn't reopen the sheet.
      setParams((prev) => { prev.delete("item"); return prev; }, { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [focusId]);

  async function loadComments(itemId: string) {
    let q = supabase.from("feedback_comments").select("*, profiles(full_name, email)").eq("feedback_item_id", itemId).order("created_at");
    if (!showDeleted) q = q.is("deleted_at", null);
    const { data } = await q;
    setComments(data ?? []);
  }

  function openCanvas(it: any) {
    if (!it?.canvas_id) return;
    navigate(`/app/canvas/${it.canvas_id}?focus=${it.id}`);
  }

  async function openItem(it: any) {
    setSelected(it);
    await loadComments(it.id);
  }

  // Keep the selected sheet in sync with the latest item data after realtime/loads
  useEffect(() => {
    if (!selected?.id) return;
    const fresh = items.find((i) => i.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line
  }, [items]);

  // Realtime: refresh thread when guests/team add comments to the open item
  useEffect(() => {
    if (!selected?.id) return;
    const ch = supabase
      .channel(`fc-${selected.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback_comments", filter: `feedback_item_id=eq.${selected.id}` }, () => {
        loadComments(selected.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected?.id]);

  // Realtime: refresh feedback list on any change
  useEffect(() => {
    const ch = supabase
      .channel("feedback-items-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback_items" }, () => { load(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "feedback_comments" }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [statusFilter, search]);

  async function updateField(field: string, value: any) {
    if (!selected) return;
    const patch: any = { [field]: value };
    if (field === "status" && value === "resolved") patch.resolved_at = new Date().toISOString();
    if (field === "status" && value === "closed") patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from("feedback_items").update(patch).eq("id", selected.id);
    if (error) { toast.error(error.message); return; }
    setSelected({ ...selected, ...patch });

    // Activity log
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      project_id: selected.project_id,
      canvas_id: selected.canvas_id,
      feedback_item_id: selected.id,
      user_id: user?.id,
      action: `${field}_changed`,
      details: { [field]: value },
    });
    load();
  }

  async function addComment() {
    if (!selected || !newNote.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const isInternal = noteKind === "internal";
    const { error } = await supabase.from("feedback_comments").insert({
      feedback_item_id: selected.id,
      user_id: user?.id,
      body: newNote.trim(),
      is_internal: isInternal,
    });
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({
      project_id: selected.project_id,
      canvas_id: selected.canvas_id,
      feedback_item_id: selected.id,
      user_id: user?.id,
      action: isInternal ? "internal_note_added" : "public_reply_added",
    });
    setNewNote("");
    loadComments(selected.id);
  }

  async function toggleLabel(itemId: string, labelId: string) {
    const current = feedbackLabelMap[itemId] ?? [];
    const has = current.includes(labelId);
    if (has) {
      const { error } = await supabase.from("feedback_labels").delete().eq("feedback_item_id", itemId).eq("label_id", labelId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("feedback_labels").insert({ feedback_item_id: itemId, label_id: labelId, created_by: user?.id });
      if (error) { toast.error(error.message); return; }
    }
    await loadFeedbackLabels(items.map((i) => i.id));
  }

  async function createLabel(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("labels").insert({ name: newLabelName.trim(), color: newLabelColor, created_by: user?.id });
    if (error) { toast.error(error.message); return; }
    setNewLabelName(""); setNewLabelColor(DEFAULT_LABEL_COLOR);
    loadLabels();
  }

  async function deleteLabel(id: string) {
    const label = labels.find((l) => l.id === id);
    const ok = await confirm({
      title: `Delete the "${label?.name ?? "label"}" label?`,
      description: "It is removed from every feedback item that carries it. The items themselves are untouched.",
      confirmLabel: "Delete label",
    });
    if (!ok) return;
    const { error } = await supabase.from("labels").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    loadLabels();
    loadFeedbackLabels(items.map((i) => i.id));
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  async function bulkUpdateStatus(newStatus: string) {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const patch: any = { status: newStatus };
    if (newStatus === "resolved") patch.resolved_at = new Date().toISOString();
    if (newStatus === "closed") patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from("feedback_items").update(patch).in("id", ids);
    if (error) { toast.error(error.message); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert(ids.map((fid) => {
      const it = items.find((x) => x.id === fid);
      return { project_id: it?.project_id, canvas_id: it?.canvas_id, feedback_item_id: fid, user_id: user?.id, action: "status_changed", details: { status: newStatus, bulk: true } };
    }));
    toast.success(`Updated ${ids.length} item${ids.length === 1 ? "" : "s"}`);
    clearSelection();
    load();
  }

  async function bulkAssign(userId: string) {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const target = userId === UNASSIGNED ? null : userId;
    const { error } = await supabase.from("feedback_items").update({ assigned_to: target }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    const { data: { user: actor } } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert(ids.map((fid) => {
      const it = items.find((x) => x.id === fid);
      return { project_id: it?.project_id, canvas_id: it?.canvas_id, feedback_item_id: fid, user_id: actor?.id, action: "assigned_to_changed", details: { assigned_to: target, bulk: true } };
    }));
    toast.success(target ? `Assigned ${ids.length} item${ids.length === 1 ? "" : "s"}` : "Assignment cleared");
    clearSelection();
    load();
  }

  async function bulkAddLabel(labelId: string) {
    if (selectedIds.size === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const rows = Array.from(selectedIds)
      .filter((fid) => !(feedbackLabelMap[fid] ?? []).includes(labelId))
      .map((fid) => ({ feedback_item_id: fid, label_id: labelId, created_by: user?.id }));
    if (rows.length === 0) { toast.info("All selected items already have that label"); return; }
    const { error } = await supabase.from("feedback_labels").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Labeled ${rows.length} item${rows.length === 1 ? "" : "s"}`);
    clearSelection();
    loadFeedbackLabels(items.map((i) => i.id));
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ok = await confirm({
      title: `Delete ${count} feedback item${count === 1 ? "" : "s"}?`,
      description: "Every reply, internal note and label on them goes too. This cannot be undone.",
      confirmLabel: `Delete ${count} item${count === 1 ? "" : "s"}`,
      // Bulk deletes are the easiest to fire by accident, and the hardest to
      // notice afterwards.
      confirmPhrase: count > 4 ? "delete" : undefined,
    });
    if (!ok) return;
    const { error } = await supabase.from("feedback_items").delete().in("id", Array.from(selectedIds));
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    clearSelection();
    load();
  }

  async function handleKanbanStatusChange(itemId: string, newStatus: string) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const patch: any = { status: newStatus };
    if (newStatus === "resolved") patch.resolved_at = new Date().toISOString();
    if (newStatus === "closed") patch.closed_at = new Date().toISOString();
    setItems((prev) => prev.map((p) => (p.id === itemId ? { ...p, ...patch } : p)));
    const { error } = await supabase.from("feedback_items").update(patch).eq("id", itemId);
    if (error) { toast.error(error.message); load(); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      project_id: it.project_id, canvas_id: it.canvas_id, feedback_item_id: itemId,
      user_id: user?.id, action: "status_changed", details: { status: newStatus, via: "kanban" },
    });
  }

  return (
    <Page>
      <PageHeader
        title="Feedback inbox"
        description="All feedback across projects and canvases."
        actions={
        can("labels.manage") ? (
        <Dialog open={labelManagerOpen} onOpenChange={setLabelManagerOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Tag className="w-4 h-4 mr-1" /> Manage labels</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Labels</DialogTitle></DialogHeader>
            <form onSubmit={createLabel} className="flex gap-2">
              <Input placeholder="New label name" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} />
              <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-12 h-10 rounded border border-border" />
              <Button type="submit" size="sm"><Plus className="w-4 h-4" /></Button>
            </form>
            <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-border">
              {labels.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ background: l.color }} />
                    <span className="text-sm">{l.name}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteLabel(l.id)}><X className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        ) : null
        }
      />

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="relative flex-1 min-w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search comment, page URL, guest…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (default)</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={labelFilter} onValueChange={setLabelFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Label" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All labels</SelectItem>
            {labels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Assignee" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="mine">Assigned to me</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {profiles
              .filter((p) => p.id !== user?.id)
              .map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <Checkbox checked={showDeleted} onCheckedChange={(c) => setShowDeleted(!!c)} />
          Show deleted
        </label>
        <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")}>
          <TabsList>
            <TabsTrigger value="list"><ListIcon className="w-4 h-4 mr-1" /> List</TabsTrigger>
            <TabsTrigger value="board"><LayoutGrid className="w-4 h-4 mr-1" /> Board</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {selectedIds.size > 0 && (
        <div className="surface-card p-3 mb-3 flex flex-wrap items-center gap-2 bg-primary/5 border-primary/30">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <Select onValueChange={(v) => bulkUpdateStatus(v)}>
            <SelectTrigger className="w-44 h-8"><SelectValue placeholder="Set status…" /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          {can("feedback.assign") && (
            <Select onValueChange={(v) => bulkAssign(v)}>
              <SelectTrigger className="w-44 h-8"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select onValueChange={(v) => bulkAddLabel(v)}>
            <SelectTrigger className="w-44 h-8"><SelectValue placeholder="Add label…" /></SelectTrigger>
            <SelectContent>
              {labels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {can("feedback.delete") && (
            <Button size="sm" variant="destructive" onClick={bulkDelete}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>
          )}
          <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="surface-card p-12 text-center">
          <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No feedback matches your filters.</p>
        </div>
      ) : view === "board" ? (
        <KanbanBoard
          items={visibleItems}
          onStatusChange={handleKanbanStatusChange}
          onCardClick={openItem}
          feedbackLabelMap={feedbackLabelMap}
          labels={labels}
          assigneeName={assigneeName}
        />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 w-8">
                  <Checkbox
                    checked={visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id))}
                    onCheckedChange={(c) => c ? setSelectedIds(new Set(visibleItems.map((i) => i.id))) : clearSelection()}
                  />
                </th>
                <th className="text-left px-4 py-3 w-24">Preview</th>
                <th className="text-left px-4 py-3">Comment</th>
                <th className="text-left px-4 py-3">Project</th>
                <th className="text-left px-4 py-3">Labels</th>
                <th className="text-left px-4 py-3">Assignee</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Priority</th>
                <th className="text-left px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleItems.map((it) => {
                const itemLabels = (feedbackLabelMap[it.id] ?? []).map((id) => labels.find((l) => l.id === id)).filter(Boolean) as LabelRow[];
                const checked = selectedIds.has(it.id);
                return (
                  <tr key={it.id} className={`hover:bg-secondary/30 cursor-pointer ${checked ? "bg-primary/5" : ""}`} onClick={() => openItem(it)}>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleSelected(it.id)} />
                    </td>
                    <td className="px-4 py-3">
                      {it.screenshot_url ? (
                        <img src={it.screenshot_url} alt="" className="w-16 h-12 object-cover rounded border border-border" />
                      ) : (
                        <div className="w-16 h-12 rounded bg-secondary flex items-center justify-center text-[10px] text-muted-foreground uppercase">{it.canvas_type}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {it.pin_number != null && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary">#{it.pin_number}</span>}
                        <div className={`line-clamp-2 max-w-md ${it.deleted_at ? "italic text-muted-foreground line-through" : ""}`}>{it.comment}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                        {(it.created_by_type === "team" ? "Team" : (it.guest_name ?? "Guest"))}
                        {it.pdf_page_number ? ` · p.${it.pdf_page_number}` : ""}
                        {it.original_page_url ? ` · ${(() => { try { return new URL(it.original_page_url).pathname; } catch { return it.original_page_url; } })()}` : ""}
                      </div>
                      {latestReplyMap[it.id] && (
                        <div className="text-xs text-muted-foreground mt-1 italic truncate max-w-md">
                          ↳ {latestReplyMap[it.id].is_internal ? "[internal] " : ""}{latestReplyMap[it.id].author}: {latestReplyMap[it.id].body}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{(it.projects as any)?.name}</div>
                      <div className="text-xs">{(it.canvases as any)?.name}</div>
                      {it.canvas_id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openCanvas(it); }}
                          className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 mt-0.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open in canvas
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[160px]">
                        {itemLabels.slice(0, 3).map((l) => (
                          <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded text-white" style={{ background: l.color }}>{l.name}</span>
                        ))}
                        {itemLabels.length > 3 && <span className="text-[10px] text-muted-foreground">+{itemLabels.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {it.assigned_to ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-5 h-5 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center">
                            {initials(assigneeName(it.assigned_to))}
                          </span>
                          <span className="truncate max-w-[110px] text-xs">{assigneeName(it.assigned_to)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <UserCircle2 className="w-3.5 h-3.5" /> Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                    <td className={`px-4 py-3 text-xs ${priorityTextClass(it.priority)}`}>{humanize(it.priority)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(it.created_at).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center justify-between gap-2">
                  <span>Feedback detail</span>
                  {selected.canvas_id && (
                    <Button size="sm" variant="outline" onClick={() => window.open(`/app/canvas/${selected.canvas_id}`, "_blank")}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> View on page
                    </Button>
                  )}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                {selected.screenshot_url && (
                  <img src={selected.screenshot_url} alt="" className="w-full rounded border border-border" />
                )}
                {selected.canvas_type === "image" && selected.x_percent != null && (
                  <div className="text-xs text-muted-foreground">Pin at {Number(selected.x_percent).toFixed(1)}% × {Number(selected.y_percent).toFixed(1)}% of image</div>
                )}
                {selected.canvas_type === "pdf" && (
                  <div className="text-xs text-muted-foreground">PDF page {selected.pdf_page_number ?? "?"} · pin at {Number(selected.x_percent ?? 0).toFixed(1)}% × {Number(selected.y_percent ?? 0).toFixed(1)}%</div>
                )}
                <div>
                  <Label>Comment</Label>
                  <div className="mt-1 p-3 bg-secondary/50 rounded text-sm whitespace-pre-wrap">{selected.comment}</div>
                </div>

                {/* Labels */}
                <div>
                  <Label>Labels</Label>
                  <div className="flex flex-wrap gap-1 mt-1 items-center">
                    {(feedbackLabelMap[selected.id] ?? []).map((lid) => {
                      const l = labels.find((x) => x.id === lid); if (!l) return null;
                      return (
                        <button key={l.id} onClick={() => toggleLabel(selected.id, l.id)} className="text-[11px] px-2 py-0.5 rounded text-white inline-flex items-center gap-1" style={{ background: l.color }}>
                          {l.name} <X className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-1">
                        <div className="max-h-60 overflow-y-auto">
                          {labels.map((l) => {
                            const active = (feedbackLabelMap[selected.id] ?? []).includes(l.id);
                            return (
                              <button key={l.id} onClick={() => toggleLabel(selected.id, l.id)} className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-secondary flex items-center gap-2 ${active ? "opacity-50" : ""}`}>
                                <div className="w-3 h-3 rounded" style={{ background: l.color }} />
                                {l.name}
                                {active && <span className="ml-auto text-xs">✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={selected.status} onValueChange={(v) => updateField("status", v)} disabled={!can("feedback.triage")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          // Signing work off is a separate permission from
                          // moving it along the board.
                          <SelectItem key={s} value={s} disabled={SIGN_OFF_STATUSES.includes(s) && !can("feedback.resolve")}>
                            {humanize(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select value={selected.priority} onValueChange={(v) => updateField("priority", v)} disabled={!can("feedback.triage")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PRIORITIES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Assignee</Label>
                  <Select
                    value={selected.assigned_to ?? UNASSIGNED}
                    onValueChange={(v) => updateField("assigned_to", v === UNASSIGNED ? null : v)}
                    disabled={!can("feedback.assign")}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name || p.email}{p.id === user?.id ? " (you)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* The database moves a new item to Assigned on the way past,
                      so say so rather than letting the status appear to jump. */}
                  {selected.status === "new" && can("feedback.assign") && (
                    <p className="text-xs text-muted-foreground mt-1">Assigning this will move it to Assigned.</p>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>From: {selected.guest_name ?? "Guest"}{selected.guest_email ? ` <${selected.guest_email}>` : ""}</div>
                  {selected.original_page_url && (
                    <div className="flex items-center gap-1">
                      Source: <a href={selected.original_page_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{selected.original_page_url}</a> <ExternalLink className="w-3.5 h-3.5" />
                    </div>
                  )}
                  {selected.browser && <div>Browser: {selected.browser} {selected.browser_version} · {selected.operating_system} · {selected.device_type}</div>}
                  {selected.viewport_width && <div>Viewport: {selected.viewport_width} × {selected.viewport_height}</div>}
                  {selected.element_selector && <div>Element: <code className="font-mono">{selected.element_selector}</code></div>}
                </div>

                <div className="border-t border-border pt-4">
                  <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as any)}>
                    <TabsList>
                      <TabsTrigger value="thread">Thread</TabsTrigger>
                      <TabsTrigger value="activity">Activity log</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {detailTab === "thread" ? (
                    <>
                      <div className="space-y-2 mt-3 max-h-64 overflow-y-auto">
                        {comments.length === 0 && <div className="text-xs text-muted-foreground">No replies or notes yet.</div>}
                        {comments.map((c) => (
                          <div key={c.id} className={`p-3 rounded text-sm ${c.is_internal ? "bg-warning/10 border border-warning/30" : "bg-primary/5 border border-primary/20"}`}>
                            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
                              <Badge variant={c.is_internal ? "outline" : "default"} className="text-[10px]">
                                {c.is_internal ? "Internal note" : "Public reply"}
                              </Badge>
                              <span>{(c.profiles as any)?.full_name ?? c.guest_name ?? "Team"}</span>
                              <span>· {new Date(c.created_at).toLocaleString()}</span>
                            </div>
                            <div className="whitespace-pre-wrap">{c.body}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex bg-secondary rounded-md p-0.5 w-fit">
                          <button onClick={() => setNoteKind("public")} className={`px-3 py-1 text-xs rounded ${noteKind === "public" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Public reply</button>
                          <button onClick={() => setNoteKind("internal")} className={`px-3 py-1 text-xs rounded ${noteKind === "internal" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Internal note</button>
                        </div>
                        <Textarea placeholder={noteKind === "public" ? "Reply visible to the client…" : "Note hidden from the client…"} rows={3} value={newNote} onChange={(e) => setNewNote(e.target.value)} />
                        <div className="flex items-center justify-end">
                          <Button size="sm" onClick={addComment}>Post {noteKind === "public" ? "reply" : "note"}</Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 max-h-96 overflow-y-auto">
                      <ActivityTimeline feedbackItemId={selected.id} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {confirmDialog}
    </Page>
  );
}
