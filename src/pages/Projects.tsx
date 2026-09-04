import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { describeWriteError } from "@/lib/errors";
import { canvasIdsForProject, collectCanvasFilePaths, removeStoredFiles } from "@/lib/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Plus, FolderKanban, MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/layout/Page";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

type Scope = "active" | "archived";

/** The fields the row actions read. The list rows themselves are a wide join. */
interface ProjectRow { id: string; name: string; status: string; client_id: string | null; created_at: string }

/**
 * A project's own status. `archived` is the reversible "put it away"; the
 * others describe where the work is. Constrained in the database by
 * `projects_status_check`, so this list and that constraint move together.
 */
const PROJECT_STATUSES = ["active", "completed", "archived"] as const;

const PROJECT_STATUS_HELP: Record<string, string> = {
  active: "In flight. Shows in the default list.",
  completed: "Delivered, but still on the active list for reference.",
  archived: "Hidden from the default list. Canvases keep working.",
};

export default function Projects() {
  const { user, roles, can } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("active");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", client_id: "" });
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", client_id: "", status: "active" });
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);

  async function load() {
    setLoading(true);
    // "Active" covers everything that is not put away, so a completed project
    // doesn't vanish from the list the moment it is marked done.
    const base = supabase.from("projects").select("*, clients(name, company_name), canvases(id)");
    const scoped = scope === "archived"
      ? base.eq("status", "archived")
      : base.neq("status", "archived");

    const [{ data: p }, { data: c }] = await Promise.all([
      scoped.order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, company_name").eq("archived", false).order("created_at", { ascending: false }),
    ]);
    setProjects(p ?? []);
    setClients(c ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [scope]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) { toast.error("Select an agency"); return; }
    setSaving(true);
    const { error } = await supabase.from("projects").insert({ name: form.name, client_id: form.client_id, created_by: user?.id });
    setSaving(false);
    if (error) {
      toast.error(describeWriteError(error, { subject: "projects", hasRole: roles.length > 0 }));
      return;
    }
    toast.success("Project created");
    setForm({ name: "", client_id: "" });
    setOpen(false);
    if (scope !== "active") setScope("active"); else load();
  }

  /** Shared write path: RLS reports a blocked update as zero rows, not an error. */
  async function apply(id: string, patch: TablesUpdate<"projects">, action: string): Promise<boolean> {
    const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "projects", hasRole: roles.length > 0, action })
          : `Your role isn't allowed to ${action} projects.`,
      );
      return false;
    }
    return true;
  }

  function startEdit(p: ProjectRow) {
    setEditForm({ name: p.name, client_id: p.client_id ?? "", status: p.status ?? "active" });
    setEditing(p);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editForm.name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    const ok = await apply(editing.id, {
      name: editForm.name.trim(),
      client_id: editForm.client_id || null,
      status: editForm.status,
    }, "edit");
    setSaving(false);
    if (!ok) return;
    toast.success("Project updated");
    setEditing(null);
    load();
  }

  async function setArchived(p: ProjectRow, archived: boolean) {
    if (!(await apply(p.id, { status: archived ? "archived" : "active" }, "archive"))) return;
    toast.success(archived ? "Project archived" : "Project restored");
    load();
  }

  async function remove(p: ProjectRow) {
    // Note the uploads before the rows naming them go with the project.
    const paths = await collectCanvasFilePaths(await canvasIdsForProject(p.id));

    const { data, error } = await supabase.from("projects").delete().eq("id", p.id).select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "projects", hasRole: roles.length > 0, action: "delete" })
          : "Your role isn't allowed to delete projects.",
      );
      return;
    }
    const purge = await removeStoredFiles(paths);
    if (purge.error) toast.warning(`Project deleted, but some uploaded files couldn't be removed: ${purge.error}`);
    else toast.success("Project deleted");
    setDeleting(null);
    load();
  }

  const canEdit = can("projects.update");
  const canDelete = can("projects.delete");
  const showMenu = canEdit || canDelete;

  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Each project holds one or more review canvases."
        actions={
        can("projects.create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> New project</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-3">
              <div>
                <Label>Agency *</Label>
                <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select agency" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.company_name || c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Project name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create project"}</Button>
            </form>
          </DialogContent>
        </Dialog>
        ) : null
        }
      />

      <div className="mb-4 inline-flex rounded-md border border-border p-0.5 text-sm">
        {(["active", "archived"] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              "px-3 py-1 rounded capitalize transition-colors",
              scope === s ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          message={scope === "archived"
            ? "No archived projects."
            : "No projects yet. Create an agency first, then add a project."}
        />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="surface-card p-5 relative hover:border-primary transition-colors">
              {showMenu && (
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                        <span className="sr-only">Actions for {p.name}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && (
                        <>
                          <DropdownMenuItem onClick={() => startEdit(p)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setArchived(p, p.status !== "archived")}>
                            {p.status === "archived"
                              ? <><ArchiveRestore className="w-3.5 h-3.5 mr-2" /> Restore</>
                              : <><Archive className="w-3.5 h-3.5 mr-2" /> Archive</>}
                          </DropdownMenuItem>
                        </>
                      )}
                      {canEdit && canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(p)}>
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              <Link to={`/projects/${p.id}`} className="block pr-8">
                <div className="text-xs text-muted-foreground">{(p.clients as any)?.company_name || (p.clients as any)?.name || "No agency"}</div>
                <div className="font-semibold mt-1">{p.name}</div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded capitalize",
                      p.status === "archived" ? "bg-secondary" : p.status === "completed" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
                    )}
                  >
                    {p.status}
                  </span>
                  <span>{(p.canvases ?? []).length} canvas{(p.canvases ?? []).length === 1 ? "" : "es"}</span>
                  <span>Started {new Date(p.created_at).toLocaleDateString()}</span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>Moving a project to another agency takes its canvases and feedback with it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <div>
              <Label>Project name *</Label>
              <Input required autoFocus value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div>
              <Label>Agency</Label>
              <Select value={editForm.client_id} onValueChange={(v) => setEditForm({ ...editForm, client_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select agency" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing?.client_id && !clients.some((c) => c.id === editing.client_id) && (
                <p className="text-xs text-warning mt-1">Its current agency is archived, so it isn't listed here.</p>
              )}
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{PROJECT_STATUS_HELP[editForm.status]}</p>
            </div>
            <div className="border-t border-border pt-3 text-xs text-muted-foreground flex justify-between gap-2">
              <span>Started</span>
              <span>{editing && new Date(editing.created_at).toLocaleString()}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={
          <>
            This permanently removes the project and <strong>every canvas, review link, uploaded file and piece of
            feedback under it</strong>. Shared review links stop working immediately. This cannot be undone — archive
            instead if you only want it out of the way.
          </>
        }
        confirmPhrase={deleting?.name}
        confirmLabel="Delete project"
        onConfirm={() => deleting && remove(deleting)}
      />
    </Page>
  );
}
