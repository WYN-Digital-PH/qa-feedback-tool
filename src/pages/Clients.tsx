import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { describeWriteError } from "@/lib/errors";
import { canvasIdsForClient, collectCanvasFilePaths, removeStoredFiles } from "@/lib/records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Plus, Building2, MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, ExternalLink, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/layout/Page";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

interface Client {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; website_url: string | null; notes: string | null; archived: boolean;
  created_at: string; updated_at: string;
  projects?: { id: string }[];
}

const BLANK = { name: "", company_name: "", email: "", phone: "", website_url: "", notes: "" };

type Scope = "active" | "archived";

export default function Clients() {
  const { user, roles, can } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>("active");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  /** The agency being edited, or null when the edit dialog is closed. */
  const [editing, setEditing] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState(BLANK);

  /** The agency queued for deletion, or null when the confirmation is closed. */
  const [deleting, setDeleting] = useState<Client | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("clients")
      .select("*, projects(id)")
      .eq("archived", scope === "archived")
      .order("created_at", { ascending: false });
    setClients((data ?? []) as Client[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [scope]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("clients").insert({ ...form, created_by: user?.id });
    setSaving(false);
    if (error) {
      toast.error(describeWriteError(error, { subject: "agencies", hasRole: roles.length > 0 }));
      return;
    }
    toast.success("Agency added");
    setForm(BLANK);
    setOpen(false);
    if (scope !== "active") setScope("active"); else load();
  }

  function startEdit(c: Client) {
    setEditForm({
      name: c.name, company_name: c.company_name ?? "", email: c.email ?? "",
      phone: c.phone ?? "", website_url: c.website_url ?? "", notes: c.notes ?? "",
    });
    setEditing(c);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    // RLS silently matches zero rows when a policy blocks the update, so ask
    // for the row back rather than reporting a success that never happened.
    const { data, error } = await supabase
      .from("clients")
      .update(editForm)
      .eq("id", editing.id)
      .select("id");
    setSaving(false);
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "agencies", hasRole: roles.length > 0, action: "edit" })
          : "Your role isn't allowed to edit agencies.",
      );
      return;
    }
    toast.success("Agency updated");
    setEditing(null);
    load();
  }

  async function setArchived(c: Client, archived: boolean) {
    const { data, error } = await supabase
      .from("clients")
      .update({ archived })
      .eq("id", c.id)
      .select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "agencies", hasRole: roles.length > 0, action: "archive" })
          : "Your role isn't allowed to archive agencies.",
      );
      return;
    }
    toast.success(archived ? "Agency archived" : "Agency restored");
    load();
  }

  async function remove(c: Client) {
    // Uploaded files live in storage, which no database cascade can reach, so
    // note them down now — the rows naming them go with the agency.
    const paths = await collectCanvasFilePaths(await canvasIdsForClient(c.id));

    const { data, error } = await supabase.from("clients").delete().eq("id", c.id).select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "agencies", hasRole: roles.length > 0, action: "delete" })
          : "Your role isn't allowed to delete agencies.",
      );
      return;
    }
    // Only now that the record is definitely gone.
    const purge = await removeStoredFiles(paths);
    if (purge.error) toast.warning(`Agency deleted, but some uploaded files couldn't be removed: ${purge.error}`);
    else toast.success("Agency deleted");
    setDeleting(null);
    load();
  }

  const canEdit = can("clients.update");
  const canDelete = can("clients.delete");
  const showMenu = canEdit || canDelete;

  return (
    <Page>
      <PageHeader
        title="Agencies"
        description="Manage agencies you create review canvases for."
        actions={
        can("clients.create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> New Agency</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New agency</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-3">
              <div><Label>Contact name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Company</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div><Label>Website URL</Label><Input type="url" placeholder="https://" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} /></div>
              <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Create agency"}</Button>
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
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          message={scope === "archived"
            ? "No archived agencies."
            : "No agencies yet. Add your first agency to get started."}
        />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Agency</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Website</th>
                <th className="text-left px-4 py-3">Projects</th>
                <th className="text-left px-4 py-3">Added</th>
                {showMenu && <th className="w-12 px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-secondary/30 cursor-pointer"
                  onClick={() => startEdit(c)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {c.company_name || c.name}
                      {c.notes && <StickyNote className="w-3.5 h-3.5 text-muted-foreground" aria-label="Has notes" />}
                    </div>
                    {c.company_name && <div className="text-xs text-muted-foreground">{c.name}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="truncate max-w-[220px]">{c.email ?? "—"}</div>
                    {c.phone && <div className="text-xs">{c.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.website_url ? (
                      <a
                        href={c.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline inline-flex items-center gap-1 truncate max-w-[200px]"
                      >
                        {c.website_url.replace(/^https?:\/\//, "")} <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{(c.projects ?? []).length}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  {showMenu && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                            <span className="sr-only">Actions for {c.company_name || c.name}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit && (
                            <>
                              <DropdownMenuItem onClick={() => startEdit(c)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setArchived(c, !c.archived)}>
                                {c.archived
                                  ? <><ArchiveRestore className="w-3.5 h-3.5 mr-2" /> Restore</>
                                  : <><Archive className="w-3.5 h-3.5 mr-2" /> Archive</>}
                              </DropdownMenuItem>
                            </>
                          )}
                          {canEdit && canDelete && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(c)}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.company_name || editing?.name}</DialogTitle>
            <DialogDescription>
              {canEdit ? "Every detail on record for this agency." : "Your role can view these but not change them."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-70">
              <div><Label>Contact name *</Label><Input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><Label>Company</Label><Input value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
              </div>
              <div><Label>Website URL</Label><Input type="url" placeholder="https://" value={editForm.website_url} onChange={(e) => setEditForm({ ...editForm, website_url: e.target.value })} /></div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={4} placeholder="Anything the team should know before working with this agency." value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </fieldset>

            <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between gap-2"><span>Projects</span><span>{(editing?.projects ?? []).length}</span></div>
              <div className="flex justify-between gap-2"><span>Added</span><span>{editing && new Date(editing.created_at).toLocaleString()}</span></div>
              <div className="flex justify-between gap-2"><span>Last updated</span><span>{editing && new Date(editing.updated_at).toLocaleString()}</span></div>
              <div className="flex justify-between gap-2"><span>Status</span><span>{editing?.archived ? "Archived" : "Active"}</span></div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>{canEdit ? "Cancel" : "Close"}</Button>
              {canEdit && <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>}
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.company_name || deleting?.name}?`}
        description={
          <>
            This permanently removes the agency and <strong>every project, canvas, review link, uploaded file and
            piece of feedback filed under it</strong>. Shared review links stop working immediately. This cannot be
            undone — archive instead if you only want it out of the way.
          </>
        }
        confirmPhrase={deleting?.company_name || deleting?.name}
        confirmLabel="Delete agency"
        onConfirm={() => deleting && remove(deleting)}
      />
    </Page>
  );
}
