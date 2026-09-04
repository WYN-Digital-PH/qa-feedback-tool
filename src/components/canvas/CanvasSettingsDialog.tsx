import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { describeWriteError } from "@/lib/errors";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionHeading } from "@/components/layout/Page";
import { Copy } from "lucide-react";
import { toast } from "sonner";

const CANVAS_STATUSES = ["active", "paused", "completed", "archived"] as const;

type CanvasStatus = (typeof CANVAS_STATUSES)[number];

/** Canvas rows arrive from wide joins typed as plain strings; keep only real statuses. */
const isCanvasStatus = (v: string | null): v is CanvasStatus =>
  (CANVAS_STATUSES as readonly string[]).includes(v ?? "");

const STATUS_HELP: Record<string, string> = {
  active: "Guests can open the link and comment.",
  paused: "The link opens, but commenting is closed.",
  completed: "Signed off. Read-only for guests.",
  archived: "Out of the way. Read-only for guests, hidden from the default list.",
};

/**
 * Every canvas setting in one place.
 *
 * Most of these existed in the schema and were honoured by the edge functions
 * from the first release, but could only ever be set to their defaults — there
 * was no screen that wrote them. A canvas could not be renamed, its deadline
 * could not be set, and the proxy could not be turned off, even though
 * `proxy-website` had refused disabled canvases all along.
 */
/** Everything this dialog reads. The list rows it comes from are a wide join. */
export interface CanvasRecord {
  id: string;
  name: string;
  type: string;
  status: string;
  website_url: string | null;
  staging_url: string | null;
  share_token: string;
  public_key: string;
  created_at: string;
  updated_at: string;
  commenting_enabled: boolean;
  feedback_deadline: string | null;
  require_guest_name: boolean;
  require_guest_email: boolean;
  allow_guest_replies: boolean;
  allow_public_comment_view: boolean;
  capture_screenshot: boolean;
  proxy_enabled: boolean;
  widget_fallback_enabled: boolean;
  canvas_files?: { mime_type?: string | null; file_size?: number | null }[];
}

export interface CanvasSettingsDialogProps {
  canvas: CanvasRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  website_url: string;
  staging_url: string;
  status: CanvasStatus;
  commenting_enabled: boolean;
  feedback_deadline: string;
  require_guest_name: boolean;
  require_guest_email: boolean;
  allow_guest_replies: boolean;
  allow_public_comment_view: boolean;
  capture_screenshot: boolean;
  proxy_enabled: boolean;
  widget_fallback_enabled: boolean;
}

/** `timestamptz` → the local `YYYY-MM-DDTHH:mm` an `datetime-local` expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromCanvas(c: CanvasRecord): FormState {
  return {
    name: c.name ?? "",
    website_url: c.website_url ?? "",
    staging_url: c.staging_url ?? "",
    status: isCanvasStatus(c.status) ? c.status : "active",
    commenting_enabled: c.commenting_enabled ?? true,
    feedback_deadline: toLocalInput(c.feedback_deadline ?? null),
    require_guest_name: c.require_guest_name ?? true,
    require_guest_email: c.require_guest_email ?? false,
    allow_guest_replies: c.allow_guest_replies ?? true,
    allow_public_comment_view: c.allow_public_comment_view ?? true,
    capture_screenshot: c.capture_screenshot ?? true,
    proxy_enabled: c.proxy_enabled ?? true,
    widget_fallback_enabled: c.widget_fallback_enabled ?? false,
  };
}

function Toggle({ id, label, help, checked, onChange, disabled }: {
  id: string; label: string; help: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">{label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{help}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5 shrink-0" />
    </div>
  );
}

function ReadOnlyRow({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono truncate">{value}</span>
      {onCopy && (
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={onCopy}>
          <Copy className="w-3 h-3" />
          <span className="sr-only">Copy {label}</span>
        </Button>
      )}
    </div>
  );
}

export default function CanvasSettingsDialog({ canvas, onOpenChange, onSaved }: CanvasSettingsDialogProps) {
  const { roles, can } = useAuth();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const editable = can("canvases.update");

  useEffect(() => {
    setForm(canvas ? fromCanvas(canvas) : null);
  }, [canvas]);

  if (!canvas || !form) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const isWebsite = canvas.type === "website";
  const reviewUrl = `${window.location.origin}/review/${canvas.share_token}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) { toast.error("Canvas name is required"); return; }
    if (isWebsite && !/^https?:\/\//i.test(form.website_url)) {
      toast.error("Website URL must start with http(s)://");
      return;
    }

    setSaving(true);
    const patch = {
      name: form.name.trim(),
      status: form.status,
      commenting_enabled: form.commenting_enabled,
      feedback_deadline: fromLocalInput(form.feedback_deadline),
      require_guest_name: form.require_guest_name,
      require_guest_email: form.require_guest_email,
      allow_guest_replies: form.allow_guest_replies,
      allow_public_comment_view: form.allow_public_comment_view,
      capture_screenshot: form.capture_screenshot,
      ...(isWebsite
        ? {
            website_url: form.website_url.trim(),
            staging_url: form.staging_url.trim() || null,
            proxy_enabled: form.proxy_enabled,
            widget_fallback_enabled: form.widget_fallback_enabled,
          }
        : {}),
    };

    // RLS reports a blocked update as zero rows rather than an error.
    const { data, error } = await supabase.from("canvases").update(patch).eq("id", canvas.id).select("id");
    setSaving(false);

    if (error || !data?.length) {
      toast.error(
        error
          ? describeWriteError(error, { subject: "canvases", hasRole: roles.length > 0, action: "edit" })
          : "Your role isn't allowed to change canvas settings.",
      );
      return;
    }
    toast.success("Canvas settings saved");
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Canvas settings</DialogTitle>
          <DialogDescription>
            {editable
              ? "Changes apply to the shared review link immediately."
              : "Your role can view these but not change them."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={!editable} className="space-y-5 disabled:opacity-70">
            <div className="space-y-3">
              <div>
                <Label htmlFor="canvas-name">Name *</Label>
                <Input id="canvas-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>

              {isWebsite && (
                <>
                  <div>
                    <Label htmlFor="canvas-url">Website URL *</Label>
                    <Input id="canvas-url" type="url" required value={form.website_url} onChange={(e) => set("website_url", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="canvas-staging">Staging URL</Label>
                    <Input id="canvas-staging" type="url" placeholder="https://staging.clientsite.com" value={form.staging_url} onChange={(e) => set("staging_url", e.target.value)} />
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="canvas-status">Status</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v as CanvasStatus)}>
                    <SelectTrigger id="canvas-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CANVAS_STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{STATUS_HELP[form.status]}</p>
                </div>
                <div>
                  <Label htmlFor="canvas-deadline">Feedback deadline</Label>
                  <Input
                    id="canvas-deadline"
                    type="datetime-local"
                    value={form.feedback_deadline}
                    onChange={(e) => set("feedback_deadline", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.feedback_deadline ? "Commenting closes automatically at this time." : "No deadline — commenting stays open."}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <SectionHeading className="text-sm mb-1">Guests</SectionHeading>
              <div className="divide-y divide-border">
                <Toggle
                  id="commenting-enabled" label="Commenting open"
                  help="The master switch. Off means the link still opens but nothing can be added."
                  checked={form.commenting_enabled} onChange={(v) => set("commenting_enabled", v)}
                />
                <Toggle
                  id="require-name" label="Require a name"
                  help="Guests give a name before their first comment."
                  checked={form.require_guest_name} onChange={(v) => set("require_guest_name", v)}
                />
                <Toggle
                  id="require-email" label="Require an email"
                  help="Ask for an email address too, so you can follow up off-canvas."
                  checked={form.require_guest_email} onChange={(v) => set("require_guest_email", v)}
                />
                <Toggle
                  id="allow-replies" label="Allow replies on threads"
                  help="Guests can answer your responses instead of only opening new threads."
                  checked={form.allow_guest_replies} onChange={(v) => set("allow_guest_replies", v)}
                />
                <Toggle
                  id="show-comments" label="Show other comments"
                  help="Off keeps each guest's feedback private to them — useful with several stakeholders."
                  checked={form.allow_public_comment_view} onChange={(v) => set("allow_public_comment_view", v)}
                />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <SectionHeading className="text-sm mb-1">Capture</SectionHeading>
              <div className="divide-y divide-border">
                <Toggle
                  id="capture-screenshot" label="Capture a screenshot"
                  help="Attaches a picture of the page to each new piece of feedback."
                  checked={form.capture_screenshot} onChange={(v) => set("capture_screenshot", v)}
                />
                {isWebsite && (
                  <>
                    <Toggle
                      id="proxy-enabled" label="Proxy the website"
                      help="Serves the site through the review proxy so pins can be placed on it. Off disables the review canvas for this URL."
                      checked={form.proxy_enabled} onChange={(v) => set("proxy_enabled", v)}
                    />
                    <Toggle
                      id="widget-fallback" label="Offer the widget fallback"
                      help="Shows a manual comment box when a site refuses to load in the proxy."
                      checked={form.widget_fallback_enabled} onChange={(v) => set("widget_fallback_enabled", v)}
                    />
                  </>
                )}
              </div>
            </div>
          </fieldset>

          <div className="border-t border-border pt-3">
            <SectionHeading className="text-sm mb-2">Reference</SectionHeading>
            <ReadOnlyRow label="Type" value={canvas.type} />
            <ReadOnlyRow label="Review link" value={reviewUrl} onCopy={async () => {
              if (await copyToClipboard(reviewUrl)) toast.success("Review link copied");
              else toast.error("Couldn't reach the clipboard");
            }} />
            <ReadOnlyRow label="Share token" value={canvas.share_token} />
            <ReadOnlyRow label="Public key" value={canvas.public_key} />
            <ReadOnlyRow label="Created" value={new Date(canvas.created_at).toLocaleString()} />
            <ReadOnlyRow label="Last updated" value={new Date(canvas.updated_at).toLocaleString()} />
            {canvas.canvas_files?.[0] && (
              <ReadOnlyRow
                label="File"
                value={`${canvas.canvas_files[0].mime_type ?? "file"}${
                  canvas.canvas_files[0].file_size ? ` · ${(canvas.canvas_files[0].file_size / 1024 / 1024).toFixed(1)}MB` : ""
                }`}
              />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {editable ? "Cancel" : "Close"}
            </Button>
            {editable && <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
