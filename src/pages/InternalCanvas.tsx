import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Eye, MousePointer2, MessageSquare, Monitor, Tablet, Smartphone,
  ExternalLink, Loader2, ArrowLeft, Lock, Globe,
} from "lucide-react";
import { toast } from "sonner";
import ImageReviewCanvas from "@/components/review/ImageReviewCanvas";
import PdfReviewCanvas from "@/components/review/PdfReviewCanvas";
import ReviewSidebar from "@/components/review/ReviewSidebar";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { IFRAME_PLACEHOLDER_HTML, postPinTheme } from "@/lib/reviewTheme";
import { samePageUrl } from "@/lib/pageUrl";
import { FEEDBACK_STATUSES, humanize } from "@/lib/feedbackMeta";
import { commentAuthor, feedbackAuthor, makeNameResolver, profileName } from "@/lib/displayName";
import { useAuth } from "@/contexts/AuthContext";
// Screenshot capture is performed server-side (Browserless) by the capture-screenshot edge function.

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PROXY_URL = `${SUPA_URL}/functions/v1/proxy-website`;

type Mode = "browse" | "comment";
type Device = "desktop" | "tablet" | "mobile";
const DEVICE_WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };
// The vocabulary lives in one place. This page having its own copy is how the
// canvas came to offer four statuses while the inbox offered eight.
const STATUSES = [...FEEDBACK_STATUSES];
const PRIORITIES = ["low","normal","high","urgent"];

export default function InternalCanvas() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  // Editing or removing someone else's feedback is a moderation action, so it
  // rides on the same permission as deletion.
  const canModerate = can("feedback.delete");
  const [canvas, setCanvas] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [file, setFile] = useState<any>(null);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [feedbackLabelMap, setFeedbackLabelMap] = useState<Record<string, string[]>>({});
  /** Replies per feedback item, for the list indicator. Counted, not fetched in full. */
  const [replyCountMap, setReplyCountMap] = useState<Record<string, number>>({});
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("browse");
  const [device, setDevice] = useState<Device>("desktop");
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [proxyHtml, setProxyHtml] = useState("");
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentUrlInitializedRef = useRef(false);

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("open"); // "open" hides resolved; "all" shows everything
  const [fPriority, setFPriority] = useState("all");
  const [fAssignee, setFAssignee] = useState("all");
  const [fLabel, setFLabel] = useState("all");
  // Defaults to the whole canvas. Scoping to the current page by default hid
  // most of a multi-page review behind a checkbox nobody had ticked, which
  // reads as missing feedback rather than as a filter.
  const [currentPageOnly, setCurrentPageOnly] = useState(false);

  const [pdfPage, setPdfPage] = useState(1);
  const [showDeleted, setShowDeleted] = useState(false);

  const [pending, setPending] = useState<any>(null);
  const [newComment, setNewComment] = useState("");
  const [newKind, setNewKind] = useState<"public" | "internal">("internal");
  const [submitting, setSubmitting] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const pendingScrollPinIdRef = useRef<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replyKind, setReplyKind] = useState<"public" | "internal">("public");
  const [me, setMe] = useState<any>(null);

  async function reloadComments(id: string) {
    const { data, error } = await supabase
      .from("feedback_comments")
      .select("id, feedback_item_id, body, is_internal, guest_name, guest_email, user_id, guest_token, created_at, updated_at")
      .eq("feedback_item_id", id)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[InternalCanvas] reloadComments error", error);
      return;
    }
    console.log(`[InternalCanvas] loaded ${data?.length ?? 0} replies for ${id} (internal+public)`);
    setComments(data ?? []);
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user));
  }, []);

  async function loadAll() {
    if (!canvasId) return;
    const { data: c, error: cErr } = await supabase
      .from("canvases")
      .select("*, projects(id, name, client_id), clients(id, name, company_name), canvas_files(*)")
      .eq("id", canvasId)
      .maybeSingle();
    if (cErr || !c) { setError("Canvas not found or you don't have access."); setLoading(false); return; }
    setCanvas(c);
    setProject((c as any).projects);
    setClient((c as any).clients);
    setFile(((c as any).canvas_files ?? [])[0] ?? null);
    if (!currentUrlInitializedRef.current) {
      currentUrlInitializedRef.current = true;
      setCurrentUrl(c.website_url ?? "");
    }

    const [{ data: items }, { data: lbs }, { data: profs }] = await Promise.all([
      supabase.from("feedback_items").select("*").eq("canvas_id", canvasId).order("created_at"),
      supabase.from("labels").select("*").order("name"),
      supabase.from("profiles").select("id, full_name, email"),
    ]);
    setFeedback(items ?? []);
    setLabels(lbs ?? []);
    setProfiles(profs ?? []);
    if (items && items.length) {
      const { data: fl } = await supabase.from("feedback_labels").select("feedback_item_id, label_id").in("feedback_item_id", items.map((i: any) => i.id));
      const m: Record<string, string[]> = {};
      (fl ?? []).forEach((r: any) => { (m[r.feedback_item_id] = m[r.feedback_item_id] ?? []).push(r.label_id); });
      setFeedbackLabelMap(m);

      // Only the ids are pulled, not the bodies: the list needs a number, and
      // the thread already fetches the replies themselves when it opens.
      // Internal notes count here — this canvas is the team's, and it renders
      // them in the thread too.
      const { data: rc } = await supabase
        .from("feedback_comments")
        .select("feedback_item_id")
        .in("feedback_item_id", items.map((i: any) => i.id))
        .is("deleted_at", null);
      const counts: Record<string, number> = {};
      (rc ?? []).forEach((r: any) => { counts[r.feedback_item_id] = (counts[r.feedback_item_id] ?? 0) + 1; });
      setReplyCountMap(counts);
    }
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [canvasId]);

  // If navigated with ?focus=<feedback_id>, focus that item once data + canvas are ready.
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (focusedOnceRef.current) return;
    const fid = searchParams.get("focus");
    if (!fid || !canvas || feedback.length === 0) return;
    const item = feedback.find((f) => f.id === fid);
    if (!item) return;
    focusedOnceRef.current = true;
    // Show deleted so the focused item is reachable even if soft-deleted.
    if (item.deleted_at) setShowDeleted(true);
    setTimeout(() => focusItem(item), 50);
    // strip the param so refresh doesn't re-trigger navigation
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line
  }, [feedback, canvas, searchParams]);

  // Realtime: refresh on any feedback_items change for this canvas,
  // and on any feedback_comments change for items in this canvas.
  useEffect(() => {
    if (!canvasId) return;
    const ch = supabase
      .channel(`internal-canvas-${canvasId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback_items", filter: `canvas_id=eq.${canvasId}` },
        () => loadAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback_comments" },
        (payload: any) => {
          const fid = payload?.new?.feedback_item_id ?? payload?.old?.feedback_item_id;
          if (!fid) return;
          // only react if comment belongs to a feedback item in this canvas
          // (we can't filter server-side without canvas_id col, so check client-side)
          // Trigger reload of selected thread if it matches.
          if (selectedIdRef.current && fid === selectedIdRef.current) {
            reloadComments(selectedIdRef.current);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [canvasId]);

  // Polling fallback every 10s while canvas is open.
  useEffect(() => {
    if (!canvasId) return;
    const t = setInterval(() => {
      loadAll();
      if (selectedIdRef.current) reloadComments(selectedIdRef.current);
    }, 10000);
    return () => clearInterval(t);
  }, [canvasId]);

  useEffect(() => {
    if (canvas?.type !== "website" || !canvas?.share_token || !currentUrl) return;
    setProxyError(null); setIframeReady(false); setProxyHtml("");
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${PROXY_URL}?share_token=${encodeURIComponent(canvas.share_token)}&url=${encodeURIComponent(currentUrl)}`,
          { headers: { apikey: SUPA_KEY }, signal: ctrl.signal });
        const ct = r.headers.get("content-type") || "";
        if (!r.ok) {
          if (ct.includes("application/json")) {
            const j = await r.json();
            setProxyError(j.message || j.error || `Proxy error (${r.status})`);
          } else setProxyError(`Proxy error (${r.status})`);
          return;
        }
        const j = await r.json();
        if (!j?.html) { setProxyError("Proxy returned no HTML"); return; }
        setProxyHtml(j.html);
      } catch (e: any) {
        if (e?.name !== "AbortError") setProxyError(String(e?.message || e));
      }
    })();
    return () => ctrl.abort();
  }, [canvas?.share_token, canvas?.type, currentUrl]);

  /**
   * The denominator for the sidebar's `n/N`.
   *
   * This used to be `feedback.length` — every row on the canvas, across every
   * page, including resolved and soft-deleted ones. Against a list that is
   * scoped to the current page and defaults to hiding resolved, that produced
   * readings like "5/17" on a perfectly healthy canvas, which is
   * indistinguishable from feedback having gone missing.
   *
   * Counting the same structural scope the list uses — deletion state and page
   * — leaves the ratio measuring one thing: how much the user's own filters
   * are hiding.
   */
  const inScopeCount = useMemo(() => {
    let list = feedback;
    if (!showDeleted) list = list.filter((f) => !f.deleted_at);
    if (currentPageOnly && canvas?.type === "website") list = list.filter((f) => !f.original_page_url || samePageUrl(f.original_page_url, currentUrl));
    if (currentPageOnly && canvas?.type === "pdf") list = list.filter((f) => (f.pdf_page_number ?? 1) === pdfPage);
    return list.length;
  }, [feedback, showDeleted, currentPageOnly, canvas?.type, currentUrl, pdfPage]);

  /** The page's single source of display names. */
  const resolveName = useMemo(() => makeNameResolver(profiles), [profiles]);

  const filtered = useMemo(() => {
    let list = feedback;
    if (!showDeleted) list = list.filter((f) => !f.deleted_at);
    if (currentPageOnly && canvas?.type === "website") list = list.filter((f) => !f.original_page_url || samePageUrl(f.original_page_url, currentUrl));
    if (currentPageOnly && canvas?.type === "pdf") list = list.filter((f) => (f.pdf_page_number ?? 1) === pdfPage);
    if (fStatus === "open") list = list.filter((f) => f.status !== "resolved");
    else if (fStatus !== "all") list = list.filter((f) => f.status === fStatus);
    if (fPriority !== "all") list = list.filter((f) => f.priority === fPriority);
    if (fAssignee !== "all") list = list.filter((f) => (fAssignee === "unassigned" ? !f.assigned_to : f.assigned_to === fAssignee));
    if (fLabel !== "all") list = list.filter((f) => (feedbackLabelMap[f.id] ?? []).includes(fLabel));
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((f) => (f.comment ?? "").toLowerCase().includes(s) || (f.guest_name ?? "").toLowerCase().includes(s));
    }
    return list;
  }, [feedback, currentPageOnly, canvas?.type, currentUrl, pdfPage, fStatus, fPriority, fAssignee, fLabel, search, feedbackLabelMap, showDeleted]);

  const pinsOnPage = useMemo(() => {
    let list = feedback.filter((f) => !f.deleted_at);
    if (canvas?.type === "website") list = list.filter((f) => !f.original_page_url || samePageUrl(f.original_page_url, currentUrl));
    else if (canvas?.type === "pdf") list = list.filter((f) => (f.pdf_page_number ?? 1) === pdfPage);
    if (fStatus === "open") list = list.filter((f) => f.status !== "resolved");
    else if (fStatus !== "all") list = list.filter((f) => f.status === fStatus);
    return list.map((f, i) => ({
      id: f.id,
      label: f.pin_number ?? (i + 1),
      x_percent: Number(f.x_percent ?? 0),
      y_percent: Number(f.y_percent ?? 0),
      anchor_selector: f.anchor_selector ?? null,
      anchor_x_percent: f.anchor_x_percent == null ? null : Number(f.anchor_x_percent),
      anchor_y_percent: f.anchor_y_percent == null ? null : Number(f.anchor_y_percent),
      element_tag: f.element_tag ?? "",
      element_id: f.element_id ?? "",
      element_classes: f.element_classes ?? "",
      element_text: f.element_text ?? "",
      element_href: f.element_href ?? "",
      element_src: f.element_src ?? "",
      pdf_page_number: f.pdf_page_number ?? null,
      comment: f.comment ?? "",
      guest_name: f.guest_name,
      status: f.status,
      visibility: (f as any).visibility ?? "public",
    }));
  }, [feedback, canvas?.type, currentUrl, pdfPage, fStatus]);

  // If currently selected feedback gets soft-deleted, close the thread.
  const prevSelectedDeletedRef = useRef<boolean>(false);
  useEffect(() => {
    const sel = feedback.find((f) => f.id === selectedId);
    const isDeleted = !!sel?.deleted_at;
    if (selectedId && isDeleted && !prevSelectedDeletedRef.current && !showDeleted) {
      toast("Feedback deleted.");
      setSelectedId(null);
    }
    prevSelectedDeletedRef.current = isDeleted;
  }, [feedback, selectedId, showDeleted]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.origin !== "null" && ev.origin !== window.location.origin) return;
      const data = ev.data || {};
      if (data.source !== "phlash-review") return;
      if (data.type === "ready") {
        setIframeReady(true);
        postPinTheme(iframeRef.current);
        try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "set-mode", mode }, "*"); } catch {}
      } else if (data.type === "navigate") {
        setIframeReady(false);
        setCurrentUrl(data.payload.url);
      } else if (data.type === "pin-ready") {
        // Iframe finished first paint of pins. Flush any pending scroll target.
        const pid = pendingScrollPinIdRef.current;
        if (pid) {
          pendingScrollPinIdRef.current = null;
          try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "scroll-to-pin", id: pid }, "*"); } catch {}
        }
      } else if (data.type === "pin") {
        if (mode !== "comment") return;
        setPending({
          x_percent: data.payload.x_percent,
          y_percent: data.payload.y_percent,
          anchor_selector: data.payload.anchor_selector,
          anchor_x_percent: data.payload.anchor_x_percent,
          anchor_y_percent: data.payload.anchor_y_percent,
          viewport_width: data.payload.viewport_width,
          viewport_height: data.payload.viewport_height,
          scroll_x: data.payload.scroll_x,
          scroll_y: data.payload.scroll_y,
          page_url: data.payload.page_url,
          page_title: data.payload.page_title,
          element_selector: data.payload.element_selector,
          element_tag: data.payload.element_tag,
          element_id: data.payload.element_id,
          element_classes: data.payload.element_classes,
          element_text: data.payload.element_text,
          element_href: data.payload.element_href,
          element_src: data.payload.element_src,
        });
        setNewComment("");
        setNewKind("internal");
      } else if (data.type === "pin-click") {
        setSelectedId(data.payload?.id);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode]);

  useEffect(() => {
    if (!iframeReady) return;
    try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "set-mode", mode }, "*"); } catch {}
  }, [mode, iframeReady]);

  useEffect(() => {
    if (!iframeReady) return;
    try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "render-pins", pins: pinsOnPage }, "*"); } catch {}
  }, [pinsOnPage, iframeReady]);

  useEffect(() => {
    if (!selectedId) { setComments([]); return; }
    reloadComments(selectedId);
    const ch = supabase
      .channel(`internal-fc-${selectedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback_comments", filter: `feedback_item_id=eq.${selectedId}` }, () => {
        reloadComments(selectedId);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedId]);

  const selected = useMemo(() => feedback.find((f) => f.id === selectedId) ?? null, [feedback, selectedId]);

  function focusItem(item: any) {
    setSelectedId(item.id);
    if (canvas?.type === "website") {
      if (item.original_page_url && !samePageUrl(item.original_page_url, currentUrl)) {
        // Queue the scroll — will fire after iframe sends `pin-ready`.
        pendingScrollPinIdRef.current = item.id;
        setCurrentUrl(item.original_page_url);
      } else {
        // Same page: overlay queues internally if not ready, so this is safe immediately.
        try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "scroll-to-pin", id: item.id }, "*"); } catch {}
      }
    } else if (canvas?.type === "pdf") {
      if (item.pdf_page_number) setPdfPage(item.pdf_page_number);
    }
  }

  async function submitNewPin() {
    if (!pending || !canvas || !newComment.trim()) { toast.error("Add a comment"); return; }
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPA_URL}/functions/v1/submit-internal-feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPA_KEY,
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        canvas_id: canvas.id,
        comment: newComment,
        visibility: newKind,
        original_page_url: pending.page_url ?? currentUrl ?? canvas.website_url ?? null,
        page_title: pending.page_title ?? canvas.name,
        pdf_page_number: pending.pdf_page_number ?? null,
        x_percent: pending.x_percent,
        y_percent: pending.y_percent,
        anchor_selector: pending.anchor_selector ?? null,
        anchor_x_percent: pending.anchor_x_percent ?? null,
        anchor_y_percent: pending.anchor_y_percent ?? null,
        viewport_width: pending.viewport_width,
        viewport_height: pending.viewport_height,
        scroll_x: pending.scroll_x,
        scroll_y: pending.scroll_y,
        element_selector: pending.element_selector,
        element_tag: pending.element_tag,
        element_id: pending.element_id,
        element_classes: pending.element_classes,
        element_text: pending.element_text,
        element_href: pending.element_href,
        element_src: pending.element_src,
      }),
    });
    setSubmitting(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(json.error ?? "Could not save pin"); return; }
    toast.success(newKind === "internal" ? "Internal pin added" : "Public pin added");
    setPending(null);
    setMode("browse");
    loadAll();
  }

  async function submitReply() {
    if (!selectedId || !replyText.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("feedback_comments").insert({
      feedback_item_id: selectedId,
      user_id: u.user?.id,
      body: replyText,
      is_internal: replyKind === "internal",
    });
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({
      feedback_item_id: selectedId, project_id: canvas.project_id, canvas_id: canvas.id, user_id: u.user?.id,
      action: replyKind === "internal" ? "internal_note_added" : "public_reply_added",
    });
    setReplyText("");
    setReplyCountMap((m) => ({ ...m, [selectedId]: (m[selectedId] ?? 0) + 1 }));
    if (selectedId) reloadComments(selectedId);
  }

  async function updateFeedback(field: string, value: any) {
    if (!selected) return;
    const { error } = await supabase.from("feedback_items").update({ [field]: value } as any).eq("id", selected.id);
    if (error) { toast.error(error.message); return; }
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("activity_logs").insert({
      feedback_item_id: selected.id, project_id: canvas.project_id, canvas_id: canvas.id, user_id: u.user?.id,
      action: `${field}_changed`, details: { value },
    });
    loadAll();
  }

  async function toggleLabel(labelId: string) {
    if (!selected) return;
    const has = (feedbackLabelMap[selected.id] ?? []).includes(labelId);
    if (has) {
      await supabase.from("feedback_labels").delete().eq("feedback_item_id", selected.id).eq("label_id", labelId);
    } else {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("feedback_labels").insert({ feedback_item_id: selected.id, label_id: labelId, created_by: u.user?.id });
    }
    loadAll();
  }

  // Anyone may edit what they wrote themselves; touching someone else's needs
  // the moderation permission. The database enforces the permission half.
  function canEditFeedbackItem(item: any): boolean {
    if (!me) return false;
    if (canModerate) return true;
    if (!can("feedback.comment")) return false;
    // Only team-created items can be edited by their author. Guest items: moderators only.
    return item?.created_by_type === "team" && item?.created_by_user_id === me.id;
  }
  function canEditComment(c: any): boolean {
    if (!me) return false;
    if (canModerate) return true;
    if (!can("feedback.comment")) return false;
    return !!c?.user_id && c.user_id === me.id;
  }

  async function editFeedbackItem(id: string, value: string): Promise<boolean> {
    const item = feedback.find((f) => f.id === id);
    if (!item || !canEditFeedbackItem(item)) { toast.error("Not allowed"); return false; }
    const { error } = await supabase.from("feedback_items").update({ comment: value } as any).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    await supabase.from("activity_logs").insert({
      feedback_item_id: id, project_id: canvas.project_id, canvas_id: canvas.id, user_id: me?.id,
      action: "feedback_edited_by_team",
    });
    loadAll();
    return true;
  }
  async function deleteFeedbackItem(id: string): Promise<boolean> {
    const item = feedback.find((f) => f.id === id);
    if (!item || !canEditFeedbackItem(item)) { toast.error("Not allowed"); return false; }
    const { error } = await supabase.from("feedback_items").update({
      deleted_at: new Date().toISOString(),
      deleted_by_type: "team",
      deleted_by_user_id: me?.id ?? null,
    } as any).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    await supabase.from("activity_logs").insert({
      feedback_item_id: id, project_id: canvas.project_id, canvas_id: canvas.id, user_id: me?.id,
      action: "feedback_deleted_by_team",
    });
    toast.success("Feedback deleted");
    loadAll();
    return true;
  }
  async function editComment(id: string, value: string): Promise<boolean> {
    const c = comments.find((x) => x.id === id);
    if (!c || !canEditComment(c)) { toast.error("Not allowed"); return false; }
    const { error } = await supabase.from("feedback_comments").update({ body: value } as any).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    if (selectedId) reloadComments(selectedId);
    return true;
  }
  async function deleteComment(id: string): Promise<boolean> {
    const c = comments.find((x) => x.id === id);
    if (!c || !canEditComment(c)) { toast.error("Not allowed"); return false; }
    const { error } = await supabase.from("feedback_comments").update({
      deleted_at: new Date().toISOString(),
      deleted_by_type: "team",
      deleted_by_user_id: me?.id ?? null,
    } as any).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    toast.success("Reply deleted");
    if (selectedId) reloadComments(selectedId);
    return true;
  }

  if (loading) return <LoadingState fullScreen />;
  if (error || !canvas) return (
    <ErrorState
      title="Canvas unavailable"
      description={error}
      action={<Link to="/projects" className="text-sm text-primary hover:underline">← Back to projects</Link>}
    />
  );

  const reviewUrl = `${window.location.origin}/review/${canvas.share_token}`;

  let viewer: React.ReactNode = null;
  if (canvas.type === "image") {
    if (!file?.public_url) viewer = <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No image uploaded.</div>;
    else viewer = (
      <ImageReviewCanvas
        imageUrl={file.public_url}
        mode={mode}
        setMode={setMode}
        pins={pinsOnPage.filter((p) => p.pdf_page_number == null)}
        onPinDrop={(x, y) => { setPending({ x_percent: x, y_percent: y, viewport_width: window.innerWidth, viewport_height: window.innerHeight, page_title: canvas.name }); setNewComment(""); setNewKind("internal"); }}
        onPinClick={(pid) => setSelectedId(pid)}
        commentingEnabled={true}
      />
    );
  } else if (canvas.type === "pdf") {
    if (!file?.public_url) viewer = <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No PDF uploaded.</div>;
    else viewer = (
      <PdfReviewCanvas
        pdfUrl={file.public_url}
        mode={mode}
        setMode={setMode}
        pins={pinsOnPage}
        currentPage={pdfPage}
        setCurrentPage={setPdfPage}
        onPinDrop={(page, x, y) => { setPending({ x_percent: x, y_percent: y, viewport_width: window.innerWidth, viewport_height: window.innerHeight, pdf_page_number: page, page_title: `${canvas.name} (p.${page})` }); setNewComment(""); setNewKind("internal"); }}
        onPinClick={(pid) => setSelectedId(pid)}
        commentingEnabled={true}
      />
    );
  } else {
    viewer = (
      <div className="flex-1 flex items-center justify-center bg-secondary/40 overflow-auto p-4">
        {proxyError ? (
          <div className="surface-elevated p-8 max-w-md w-full text-center">
            <h2 className="font-semibold">Couldn't load website</h2>
            <p className="text-sm text-muted-foreground mt-2">{proxyError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => window.open(currentUrl, "_blank")}>
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open in new tab
            </Button>
          </div>
        ) : (
          <div className="bg-card shadow-lg transition-all" style={{ width: DEVICE_WIDTHS[device] ?? "100%", height: "100%", maxWidth: "100%" }} data-review-content data-review-capture>
            <iframe
              ref={iframeRef}
              key={currentUrl + ":" + (proxyHtml ? "loaded" : "empty")}
              srcDoc={proxyHtml || IFRAME_PLACEHOLDER_HTML}
              title="Internal review canvas"
              className="w-full h-full bg-card"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-secondary/40">
      <header className="bg-card border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <Link to={project ? `/projects/${project.id}` : "/projects"} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center"><Eye className="w-4 h-4 text-primary-foreground" /></div>
        <div className="hidden md:block min-w-0">
          <div className="text-sm font-semibold leading-tight flex items-center gap-1.5 truncate">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            {canvas.name}
            <Badge variant="secondary" className="text-[10px] ml-1">Internal</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{client?.company_name || client?.name} · {project?.name} · <span className="capitalize">{canvas.type}</span></div>
        </div>
        {canvas.type === "website" && (
          <div className="hidden lg:flex items-center gap-1 text-xs bg-secondary px-2.5 py-1 rounded font-mono text-muted-foreground max-w-md truncate">
            <Globe className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{currentUrl}</span>
          </div>
        )}
        <div className="flex-1" />
        {canvas.type === "website" && (
          <>
            <div className="hidden md:flex bg-secondary rounded-md p-0.5">
              <button onClick={() => setDevice("desktop")} className={`p-1.5 rounded ${device === "desktop" ? "bg-card shadow-sm" : ""}`}><Monitor className="w-4 h-4" /></button>
              <button onClick={() => setDevice("tablet")} className={`p-1.5 rounded ${device === "tablet" ? "bg-card shadow-sm" : ""}`}><Tablet className="w-4 h-4" /></button>
              <button onClick={() => setDevice("mobile")} className={`p-1.5 rounded ${device === "mobile" ? "bg-card shadow-sm" : ""}`}><Smartphone className="w-4 h-4" /></button>
            </div>
            <div className="flex bg-secondary rounded-md p-0.5">
              <button onClick={() => setMode("browse")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "browse" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>
                <MousePointer2 className="w-3.5 h-3.5" /> Browse
              </button>
              <button onClick={() => setMode("comment")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "comment" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>
                <MessageSquare className="w-3.5 h-3.5" /> Comment
              </button>
            </div>
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => window.open(reviewUrl, "_blank")}>
          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Public review
        </Button>
        {canvas.type === "website" && canvas.website_url && (
          <Button size="sm" variant="ghost" onClick={() => window.open(canvas.website_url, "_blank")}>
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Live site
          </Button>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden" data-review-viewer>
        <aside className="w-96 border-r border-border bg-card flex flex-col shrink-0">
          <ReviewSidebar
            mode="internal"
            items={filtered.map((f: any) => ({ ...f, deleted: !!f.deleted_at, deleted_by_type: f.deleted_by_type ?? null, reply_count: replyCountMap[f.id] ?? 0, author_name: feedbackAuthor(f, resolveName) })) as any}
            totalCount={inScopeCount}
            onClearFilters={() => { setFStatus("all"); setFPriority("all"); setFAssignee("all"); setFLabel("all"); setSearch(""); }}
            search={search}
            setSearch={setSearch}
            filterValue={fStatus}
            setFilterValue={setFStatus}
            filterOptions={[
              { value: "open", label: "Open (hide resolved)" },
              { value: "all", label: "All status" },
              ...STATUSES.map((s) => ({ value: s, label: humanize(s) })),
            ]}
            emptyText="No comments match."
            selectedId={selectedId}
            selectedItem={selected ? ({ ...selected, deleted: !!(selected as any).deleted_at, deleted_by_type: (selected as any).deleted_by_type ?? null, author_name: feedbackAuthor(selected as any, resolveName) }) as any : null}
            replies={comments.filter((c) => showDeleted || !c.deleted_at).map((c) => {
              const prof = c.user_id ? profiles.find((p: any) => p.id === c.user_id) : null;
              return {
                id: c.id,
                body: c.body,
                author: commentAuthor({ ...c, profiles: prof }, resolveName),
                created_at: c.created_at,
                is_internal: c.is_internal,
                from_team: !!c.user_id,
                deleted: !!c.deleted_at,
                deleted_by_type: c.deleted_by_type ?? null,
              };
            }) as any}
            onSelect={(id) => {
              const item = feedback.find((f) => f.id === id);
              if (item) focusItem(item);
              else setSelectedId(id);
            }}
            onBack={() => setSelectedId(null)}
            canReply={true}
            replyText={replyText}
            setReplyText={setReplyText}
            onSubmitReply={submitReply}
            internal={{
              statuses: STATUSES,
              priorities: PRIORITIES,
              profiles,
              labels,
              feedbackLabelIds: selected ? (feedbackLabelMap[selected.id] ?? []) : [],
              onUpdate: updateFeedback,
              onToggleLabel: toggleLabel,
              replyKind,
              setReplyKind,
              showInternalNotes: true,
              canEditItem: (it: any) => {
                const full = feedback.find((f) => f.id === it.id);
                return full ? canEditFeedbackItem(full) : false;
              },
              canEditReply: (r: any) => {
                const full = comments.find((c) => c.id === r.id);
                return full ? canEditComment(full) : false;
              },
              onEditItem: editFeedbackItem,
              onDeleteItem: deleteFeedbackItem,
              onEditReply: editComment,
              onDeleteReply: deleteComment,
            }}
            extraFilters={
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <Select value={fPriority} onValueChange={setFPriority}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Priority" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All priority</SelectItem>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={fAssignee} onValueChange={setFAssignee}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Assignee" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any assignee</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{profileName(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={fLabel} onValueChange={setFLabel}>
                    <SelectTrigger className="h-7 text-[11px] col-span-2"><SelectValue placeholder="Label" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any label</SelectItem>
                      {labels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={currentPageOnly} onChange={(e) => setCurrentPageOnly(e.target.checked)} />
                  Current page only
                </label>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                  Show deleted
                </label>
              </div>
            }
          />
        </aside>

        <div className="flex-1 flex overflow-hidden">
          {viewer}
        </div>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add pin</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Visibility</Label>
              <Tabs value={newKind} onValueChange={(v) => setNewKind(v as any)}>
                <TabsList className="grid grid-cols-2 w-full mt-1">
                  <TabsTrigger value="internal" className="text-xs"><Lock className="w-3.5 h-3.5 mr-1" /> Internal only</TabsTrigger>
                  <TabsTrigger value="public" className="text-xs"><Globe className="w-3.5 h-3.5 mr-1" /> Public (client visible)</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-[10px] text-muted-foreground mt-1">
                {newKind === "internal" ? "Only your team will see this pin. Hidden from the public review link." : "This pin will appear on the client's public review link."}
              </p>
            </div>
            <Textarea autoFocus rows={4} value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Describe the issue or note…" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPending(null)}>Cancel</Button>
              <Button className="flex-1" onClick={submitNewPin} disabled={submitting}>
                {submitting ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving…</> : "Add pin"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
