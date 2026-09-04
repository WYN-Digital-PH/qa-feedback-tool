import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { copyToClipboard } from "@/lib/clipboard";
import { describeWriteError } from "@/lib/errors";
import { collectCanvasFilePaths, removeStoredFiles } from "@/lib/records";
import { countByStatus, humanize, statusSolidClass } from "@/lib/feedbackMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import {
  Plus, Copy, ExternalLink, ArrowLeft, Pause, Play, Globe, Image as ImageIcon, FileText, Eye,
  MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2, Settings2, CalendarClock, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import CanvasSettingsDialog, { type CanvasRecord } from "@/components/canvas/CanvasSettingsDialog";
import { Page, PageHeader } from "@/components/layout/Page";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, LoadingState } from "@/components/ui/states";

type CanvasType = "website" | "image" | "pdf";

const TYPE_LABELS: Record<CanvasType, string> = { website: "Website", image: "Image", pdf: "PDF" };
const TYPE_ICONS: Record<CanvasType, LucideIcon> = { website: Globe, image: ImageIcon, pdf: FileText };

/** The fields the canvas row actions read. The list rows themselves are a wide join. */
interface CanvasRow { id: string; name: string; status: string; feedback_items?: { id: string }[] }

/** Canvas status shown as a pill. 'archived' reads as retired, not as a warning. */
const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning",
  completed: "bg-primary/10 text-primary",
  archived: "bg-secondary text-muted-foreground",
};

/** A canvas's feedback, minus the soft-deleted rows nothing else counts either. */
function liveFeedback(canvas: any): { id: string; status?: string | null; deleted_at?: string | null }[] {
  return ((canvas?.feedback_items ?? []) as any[]).filter((f) => !f?.deleted_at);
}

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { roles, can } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [canvases, setCanvases] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CanvasType>("website");
  const [form, setForm] = useState({
    name: "", website_url: "", staging_url: "",
    require_guest_name: true, require_guest_email: false,
    allow_public_comment_view: true, allow_guest_replies: true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Rename / delete targets. `null` means the matching dialog is closed.
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [renamingCanvas, setRenamingCanvas] = useState<CanvasRow | null>(null);
  const [canvasName, setCanvasName] = useState("");
  const [deletingCanvas, setDeletingCanvas] = useState<CanvasRow | null>(null);
  /** The canvas whose settings panel is open, or null. */
  const [settingsFor, setSettingsFor] = useState<CanvasRecord | null>(null);

  async function load() {
    if (!id) return;
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("projects").select("*, clients(name, company_name)").eq("id", id).maybeSingle(),
      supabase.from("canvases").select("*, feedback_items(id, status, deleted_at), canvas_files(public_url, mime_type, file_size, original_filename)").eq("project_id", id).order("created_at", { ascending: false }),
    ]);
    setProject(p);
    setCanvases(c ?? []);
  }
  useEffect(() => { load(); }, [id]);

  async function detectImageDimensions(f: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    });
  }

  async function detectPdfPages(f: File): Promise<number | null> {
    try {
      const pdfjs = await import("pdfjs-dist");
      const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      return doc.numPages;
    } catch { return null; }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (!form.name.trim()) { toast.error("Canvas name is required"); return; }

    if (type === "website") {
      if (!/^https?:\/\//i.test(form.website_url)) { toast.error("Website URL must start with http(s)://"); return; }
    } else {
      if (!file) { toast.error(`Please upload ${type === "pdf" ? "a PDF" : "an image"}`); return; }
      const allowed = type === "pdf"
        ? ["application/pdf"]
        : ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type)) { toast.error(`Unsupported file type: ${file.type}`); return; }
      const max = type === "pdf" ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
      if (file.size > max) { toast.error(`File too large (max ${max/1024/1024 | 0}MB)`); return; }
    }

    setSaving(true);
    const { data: { user, session } } = await supabase.auth.getUser().then(async (r) => ({
      data: { user: r.data.user, session: (await supabase.auth.getSession()).data.session },
    }));

    // 1. Create canvas row
    const { data: canvas, error } = await supabase.from("canvases").insert({
      project_id: id,
      client_id: project?.client_id,
      name: form.name,
      type,
      website_url: type === "website" ? form.website_url : null,
      staging_url: type === "website" ? (form.staging_url || null) : null,
      require_guest_name: form.require_guest_name,
      require_guest_email: form.require_guest_email,
      allow_public_comment_view: form.allow_public_comment_view,
      allow_guest_replies: form.allow_guest_replies,
      created_by: user?.id,
    }).select("*").single();

    if (error || !canvas) { setSaving(false); toast.error(error?.message ?? "Could not create canvas"); return; }

    // 2. Upload file if image/pdf
    if (type !== "website" && file) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("canvas_id", canvas.id);
      fd.append("project_id", id);
      fd.append("kind", type);
      if (type === "image") {
        const dim = await detectImageDimensions(file);
        if (dim) { fd.append("width", String(dim.width)); fd.append("height", String(dim.height)); }
      } else if (type === "pdf") {
        const pages = await detectPdfPages(file);
        if (pages) fd.append("page_count", String(pages));
      }
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-canvas-file`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) {
        setSaving(false);
        // Cleanup canvas if upload failed
        await supabase.from("canvases").delete().eq("id", canvas.id);
        toast.error(j.error ?? "Upload failed");
        return;
      }
    }

    setSaving(false);
    toast.success("Canvas created");
    setForm({ name: "", website_url: "", staging_url: "", require_guest_name: true, require_guest_email: false, allow_public_comment_view: true, allow_guest_replies: true });
    setFile(null);
    setType("website");
    setOpen(false);
    load();
  }

  /**
   * Shared write path for a canvas. RLS reports a blocked write as zero rows
   * rather than an error, so every caller asks for the row back.
   */
  async function applyToCanvas(canvasId: string, patch: TablesUpdate<"canvases">, action: string): Promise<boolean> {
    const { data, error } = await supabase.from("canvases").update(patch).eq("id", canvasId).select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "canvases", hasRole: roles.length > 0, action })
          : `Your role isn't allowed to ${action} canvases.`,
      );
      return false;
    }
    return true;
  }

  async function togglePause(canvas: CanvasRow) {
    const next = canvas.status === "active" ? "paused" : "active";
    if (!(await applyToCanvas(canvas.id, { status: next }, "pause"))) return;
    toast.success(next === "paused" ? "Commenting paused" : "Commenting active");
    load();
  }

  async function setCanvasArchived(canvas: CanvasRow, archived: boolean) {
    if (!(await applyToCanvas(canvas.id, { status: archived ? "archived" : "active" }, "archive"))) return;
    // Guest submission already refuses anything but an active canvas, so
    // archiving closes the public link without touching the share token.
    toast.success(archived ? "Canvas archived — its review link is now read-only" : "Canvas restored");
    load();
  }

  async function saveCanvasName(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingCanvas) return;
    setSaving(true);
    const ok = await applyToCanvas(renamingCanvas.id, { name: canvasName.trim() }, "rename");
    setSaving(false);
    if (!ok) return;
    toast.success("Canvas renamed");
    setRenamingCanvas(null);
    load();
  }

  async function deleteCanvas(canvas: CanvasRow) {
    // Uploaded files live in storage, which no database cascade can reach, so
    // note them down now — the rows naming them go with the canvas.
    const paths = await collectCanvasFilePaths([canvas.id]);

    const { data, error } = await supabase.from("canvases").delete().eq("id", canvas.id).select("id");
    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "canvases", hasRole: roles.length > 0, action: "delete" })
          : "Your role isn't allowed to delete canvases.",
      );
      return;
    }
    // Only now that the record is definitely gone.
    const purge = await removeStoredFiles(paths);
    if (purge.error) toast.warning(`Canvas deleted, but its uploaded file couldn't be removed: ${purge.error}`);
    else toast.success("Canvas deleted");
    setDeletingCanvas(null);
    load();
  }

  async function applyToProject(patch: TablesUpdate<"projects">, action: string): Promise<boolean> {
    if (!id) return false;
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

  async function saveProjectName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await applyToProject({ name: projectName.trim() }, "rename");
    setSaving(false);
    if (!ok) return;
    toast.success("Project renamed");
    setRenamingProject(false);
    load();
  }

  async function setProjectArchived(archived: boolean) {
    if (!(await applyToProject({ status: archived ? "archived" : "active" }, "archive"))) return;
    toast.success(archived ? "Project archived" : "Project restored");
    load();
  }

  async function deleteProject() {
    if (!id) return;
    const paths = await collectCanvasFilePaths(canvases.map((c) => c.id));

    const { data, error } = await supabase.from("projects").delete().eq("id", id).select("id");
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
    nav("/projects", { replace: true });
  }

  async function copyShare(token: string) {
    const url = `${window.location.origin}/review/${token}`;
    if (await copyToClipboard(url)) toast.success("Review link copied");
    else toast.error(`Couldn't reach the clipboard. Link: ${url}`);
  }

  if (!project) return <LoadingState />;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
            <ArrowLeft className="w-3.5 h-3.5" /> Projects
          </Link>
        }
        title={project.name}
        description={
          <>
            {(project.clients as any)?.company_name || (project.clients as any)?.name}
            {project.status === "archived" && (
              <span className="ml-2 text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">Archived</span>
            )}
          </>
        }
        actions={
        <>
        {can("canvases.create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> New canvas</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New review canvas</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-3">
              <div>
                <Label>Canvas type</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(["website", "image", "pdf"] as CanvasType[]).map((t) => {
                    const Icon = TYPE_ICONS[t];
                    return (
                      <button key={t} type="button" onClick={() => setType(t)} className={`p-3 rounded-md border text-center ${type === t ? "border-primary bg-primary/5" : "border-border"}`}>
                        <Icon className="w-5 h-5 mx-auto mb-1" />
                        <div className="text-xs font-medium">{TYPE_LABELS[t]}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div><Label>Canvas name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={type === "website" ? "Homepage Review" : type === "pdf" ? "Brand Guidelines.pdf" : "Hero Banner"} /></div>

              {type === "website" && (
                <>
                  <div><Label>Website URL *</Label><Input required type="url" placeholder="https://clientsite.com" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} /></div>
                  <div><Label>Staging URL (optional)</Label><Input type="url" placeholder="https://staging.clientsite.com" value={form.staging_url} onChange={(e) => setForm({ ...form, staging_url: e.target.value })} /></div>
                </>
              )}

              {type === "image" && (
                <div>
                  <Label>Image file * (JPG, PNG, WEBP, GIF — max 10MB)</Label>
                  <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
                </div>
              )}

              {type === "pdf" && (
                <div>
                  <Label>PDF file * (max 25MB)</Label>
                  <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
                </div>
              )}

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between"><Label htmlFor="rgn" className="font-normal">Require guest name</Label><Switch id="rgn" checked={form.require_guest_name} onCheckedChange={(v) => setForm({ ...form, require_guest_name: v })} /></div>
                <div className="flex items-center justify-between"><Label htmlFor="rge" className="font-normal">Require guest email</Label><Switch id="rge" checked={form.require_guest_email} onCheckedChange={(v) => setForm({ ...form, require_guest_email: v })} /></div>
                                <div className="flex items-center justify-between"><Label htmlFor="agr" className="font-normal">Allow guest replies on threads</Label><Switch id="agr" checked={form.allow_guest_replies} onCheckedChange={(v) => setForm({ ...form, allow_guest_replies: v })} /></div>
                <div className="flex items-center justify-between"><Label htmlFor="pcv" className="font-normal">Show comments to guests</Label><Switch id="pcv" checked={form.allow_public_comment_view} onCheckedChange={(v) => setForm({ ...form, allow_public_comment_view: v })} /></div>
              </div>
              <Button type="submit" disabled={saving} className="w-full">{saving ? "Creating…" : "Create canvas"}</Button>
            </form>
          </DialogContent>
        </Dialog>
        ) : null}
        {(can("projects.update") || can("projects.delete")) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="w-4 h-4" />
                <span className="sr-only">Project actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can("projects.update") && (
                <>
                  <DropdownMenuItem onClick={() => { setProjectName(project.name); setRenamingProject(true); }}>
                    <Pencil className="w-3.5 h-3.5 mr-2" /> Rename project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setProjectArchived(project.status !== "archived")}>
                    {project.status === "archived"
                      ? <><ArchiveRestore className="w-3.5 h-3.5 mr-2" /> Restore project</>
                      : <><Archive className="w-3.5 h-3.5 mr-2" /> Archive project</>}
                  </DropdownMenuItem>
                </>
              )}
              {can("projects.update") && can("projects.delete") && <DropdownMenuSeparator />}
              {can("projects.delete") && (
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingProject(true)}>
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete project
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        </>
        }
      />

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Canvases</h2>
      {canvases.length === 0 ? (
        <EmptyState
          icon={Eye}
          message="No canvases yet. Add a website, image, or PDF to generate a shareable review link."
        />
      ) : (
        <div className="space-y-3">
          {canvases.map((c) => {
            const reviewUrl = `${window.location.origin}/review/${c.share_token}`;
            const Icon = TYPE_ICONS[c.type as CanvasType] ?? Globe;
            return (
              <div key={c.id} className="surface-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <h3 className="font-semibold">{c.name}</h3>
                      <span className="text-[10px] uppercase tracking-wide bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{c.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[c.status] ?? STATUS_STYLES.paused}`}>{c.status}</span>
                    </div>
                    {c.type === "website" && c.website_url && (
                      <a href={c.website_url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-1 truncate">
                        {c.website_url} <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {c.type !== "website" && (c.canvas_files?.[0]?.public_url) && (
                      <a href={c.canvas_files[0].public_url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 mt-1 truncate">
                        Open original file <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <div className="mt-3 flex items-center gap-2 bg-secondary/50 px-3 py-2 rounded-md text-xs font-mono truncate">
                      <span className="truncate flex-1 text-muted-foreground">{reviewUrl}</span>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => copyShare(c.share_token)}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                    {/* The settings that change what a guest can actually do,
                        surfaced here so they don't only live behind a dialog. */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{liveFeedback(c).length} feedback item{liveFeedback(c).length === 1 ? "" : "s"}</span>
                      {!c.commenting_enabled && <span className="text-warning">Commenting closed</span>}
                      {c.feedback_deadline && (
                        <span className={new Date(c.feedback_deadline) < new Date() ? "text-destructive" : ""}>
                          <CalendarClock className="w-3.5 h-3.5 inline mr-0.5 -mt-0.5" />
                          {new Date(c.feedback_deadline) < new Date() ? "Deadline passed" : `Due ${new Date(c.feedback_deadline).toLocaleDateString()}`}
                        </span>
                      )}
                      {c.require_guest_email && <span>Email required</span>}
                      {!c.allow_public_comment_view && <span>Comments private per guest</span>}
                      {c.type === "website" && !c.proxy_enabled && <span className="text-warning">Proxy off</span>}
                      <span>Added {new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                    {/* Where the work actually stands, without opening the canvas.
                        Every status is shown, empty ones included: "0 New" is
                        information, and a row whose chips move around as counts
                        change is harder to read at a glance than a fixed one. */}
                    {liveFeedback(c).length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {countByStatus(liveFeedback(c)).map(({ status, count }) => (
                          <span
                            key={status}
                            className={`inline-flex items-center gap-1.5 ${count === 0 ? "text-muted-foreground/50" : "text-muted-foreground"}`}
                          >
                            <span className={`w-2 h-2 rounded-full ${count === 0 ? "bg-muted-foreground/30" : statusSolidClass(status)}`} />
                            <span className={count > 0 ? "font-medium text-foreground" : ""}>{count}</span>
                            {humanize(status)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button size="sm" onClick={() => window.open(`/app/canvas/${c.id}`, "_blank")}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> Internal review
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => window.open(reviewUrl, "_blank")}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Public link
                    </Button>
                    {(can("canvases.update") || can("canvases.delete")) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MoreHorizontal className="w-3.5 h-3.5 mr-1" /> More
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {can("canvases.update") && (
                            <>
                              <DropdownMenuItem onClick={() => { setCanvasName(c.name); setRenamingCanvas(c); }}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setSettingsFor(c)}>
                                <Settings2 className="w-3.5 h-3.5 mr-2" /> Settings…
                              </DropdownMenuItem>
                              {c.status !== "archived" && (
                                <DropdownMenuItem onClick={() => togglePause(c)}>
                                  {c.status === "active"
                                    ? <><Pause className="w-3.5 h-3.5 mr-2" /> Pause commenting</>
                                    : <><Play className="w-3.5 h-3.5 mr-2" /> Resume commenting</>}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setCanvasArchived(c, c.status !== "archived")}>
                                {c.status === "archived"
                                  ? <><ArchiveRestore className="w-3.5 h-3.5 mr-2" /> Restore</>
                                  : <><Archive className="w-3.5 h-3.5 mr-2" /> Archive</>}
                              </DropdownMenuItem>
                            </>
                          )}
                          {!can("canvases.update") && (
                            <DropdownMenuItem onClick={() => setSettingsFor(c)}>
                              <Settings2 className="w-3.5 h-3.5 mr-2" /> View settings
                            </DropdownMenuItem>
                          )}
                          {can("canvases.update") && can("canvases.delete") && <DropdownMenuSeparator />}
                          {can("canvases.delete") && (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingCanvas(c)}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete canvas
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        Always test the public review link in an incognito/private browser before sending it to the client.
      </p>
      <CanvasSettingsDialog
        canvas={settingsFor}
        onOpenChange={(o) => !o && setSettingsFor(null)}
        onSaved={load}
      />

      <Dialog open={renamingProject} onOpenChange={setRenamingProject}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename project</DialogTitle></DialogHeader>
          <form onSubmit={saveProjectName} className="space-y-3">
            <div><Label>Project name *</Label><Input required autoFocus value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
            <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Save"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renamingCanvas} onOpenChange={(o) => !o && setRenamingCanvas(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename canvas</DialogTitle></DialogHeader>
          <form onSubmit={saveCanvasName} className="space-y-3">
            <div><Label>Canvas name *</Label><Input required autoFocus value={canvasName} onChange={(e) => setCanvasName(e.target.value)} /></div>
            <Button type="submit" disabled={saving} className="w-full">{saving ? "Saving…" : "Save"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={deletingProject}
        onOpenChange={setDeletingProject}
        title={`Delete ${project.name}?`}
        description={
          <>
            This permanently removes the project and <strong>every canvas, review link, uploaded file and piece of
            feedback under it</strong>. Shared review links stop working immediately. This cannot be undone — archive
            instead if you only want it out of the way.
          </>
        }
        confirmPhrase={project.name}
        confirmLabel="Delete project"
        onConfirm={deleteProject}
      />

      <ConfirmDeleteDialog
        open={!!deletingCanvas}
        onOpenChange={(o) => !o && setDeletingCanvas(null)}
        title={`Delete ${deletingCanvas?.name}?`}
        description={
          <>
            This permanently removes the canvas, its uploaded file, and{" "}
            <strong>
              {liveFeedback(deletingCanvas).length} piece
              {liveFeedback(deletingCanvas).length === 1 ? "" : "s"} of feedback
            </strong>{" "}
            along with every reply and approval decision. The shared review link stops working immediately. Archive
            instead to close the link but keep the record.
          </>
        }
        confirmLabel="Delete canvas"
        onConfirm={() => deletingCanvas && deleteCanvas(deletingCanvas)}
      />

    </Page>
  );
}
