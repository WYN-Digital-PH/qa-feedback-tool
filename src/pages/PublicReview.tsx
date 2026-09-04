import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Eye, MousePointer2, MessageSquare, Check, X, Monitor, Tablet, Smartphone, ExternalLink, Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import ImageReviewCanvas from "@/components/review/ImageReviewCanvas";
import PdfReviewCanvas from "@/components/review/PdfReviewCanvas";
import ReviewSidebar from "@/components/review/ReviewSidebar";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { IFRAME_PLACEHOLDER_HTML, postPinTheme } from "@/lib/reviewTheme";
import { readOrCreateGuestToken } from "@/lib/guestToken";
import { samePageUrl } from "@/lib/pageUrl";
// Screenshot capture is performed server-side (Browserless) by the capture-screenshot edge function.

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const PROXY_URL = `${SUPA_URL}/functions/v1/proxy-website`;



type Mode = "browse" | "comment";
type Device = "desktop" | "tablet" | "mobile";

interface CanvasFile {
  id: string;
  public_url: string;
  mime_type: string;
  page_count: number | null;
  width: number | null;
  height: number | null;
  original_filename: string | null;
}

interface Canvas {
  id: string;
  name: string;
  type: "website" | "image" | "pdf";
  website_url: string | null;
  status: string;
  commenting_enabled: boolean;
  feedback_deadline: string | null;
  deadline_passed: boolean;
  require_guest_name: boolean;
  require_guest_email: boolean;
  allow_guest_replies: boolean;
  allow_public_comment_view: boolean;
  allow_approval: boolean;
  capture_screenshot: boolean;
  proxy_enabled: boolean;
  widget_fallback_enabled: boolean;
  project_name: string;
  client_name: string;
  file: CanvasFile | null;
}

interface PendingPin {
  // shared
  comment_seed?: string;
  // website
  x_position?: number; y_position?: number;
  x_percent: number; y_percent: number;
  // DOM anchor — selector for the element the pin was placed on, plus the
  // offset inside that element's box. Keeps the pin on its component when the
  // page reflows at another viewport width or is reloaded.
  anchor_selector?: string;
  anchor_x_percent?: number; anchor_y_percent?: number;
  viewport_width: number; viewport_height: number;
  scroll_x?: number; scroll_y?: number;
  element_selector?: string; element_tag?: string; element_id?: string;
  element_classes?: string; element_text?: string; element_href?: string; element_src?: string;
  page_url?: string; page_title?: string;
  // pdf
  pdf_page_number?: number;
}

function getEnv() {
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android/i.test(ua);
  return {
    user_agent: ua,
    browser: /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Unknown",
    operating_system: /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : /Android/.test(ua) ? "Android" : /iOS|iPhone|iPad/.test(ua) ? "iOS" : "Unknown",
    device_type: isMobile ? "mobile" : "desktop",
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    device_pixel_ratio: window.devicePixelRatio,
  };
}

const DEVICE_WIDTHS: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 };

export default function PublicReview() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);

  const [mode, setMode] = useState<Mode>("browse");
  const [device, setDevice] = useState<Device>("desktop");
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [iframeReady, setIframeReady] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingPin | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");


  // Sidebar
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarFilter, setSidebarFilter] = useState<"all" | "page" | "unresolved" | "resolved">("unresolved");

  // PDF state
  const [pdfPage, setPdfPage] = useState(1);

  // Reply thread sheet
  const [threadOpen, setThreadOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentUrlInitializedRef = useRef(false);
  const pendingScrollPinIdRef = useRef<string | null>(null);

  // Per-browser token that claims ownership of the pins and replies left here.
  const guestToken = useMemo(() => readOrCreateGuestToken(shareToken ?? ""), [shareToken]);

  // Load canvas
  useEffect(() => {
    if (!shareToken) return;
    (async () => {
      const res = await fetch(`${SUPA_URL}/functions/v1/get-public-canvas?share_token=${encodeURIComponent(shareToken)}`, {
        headers: { apikey: SUPA_KEY },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not load review canvas");
        setLoading(false);
        return;
      }
      setCanvas(json.canvas);
      if (!currentUrlInitializedRef.current) {
        currentUrlInitializedRef.current = true;
        setCurrentUrl(json.canvas.website_url ?? "");
      }
      setLoading(false);
      const stored = localStorage.getItem(`phlash_guest_${shareToken}`);
      if (stored) {
        try {
          const g = JSON.parse(stored);
          setGuestName(g.name ?? "");
          setGuestEmail(g.email ?? "");
        } catch {}
      }
    })();
  }, [shareToken]);

  // Load comments
  useEffect(() => {
    if (!shareToken || !canvas?.allow_public_comment_view) return;
    let cancelled = false;
    const load = async () => {
      const qs = new URLSearchParams({ share_token: shareToken });
      if (guestToken) qs.set("guest_token", guestToken);
      const res = await fetch(`${SUPA_URL}/functions/v1/get-public-canvas-comments?${qs.toString()}`, {
        headers: { apikey: SUPA_KEY },
      });
      const json = await res.json();
      if (!cancelled) setComments(json.comments ?? []);
    };
    load();
    // Poll so screenshot_status / screenshot_url updates appear after server-side capture completes
    const interval = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [shareToken, canvas, currentUrl, refreshTick, guestToken]);

  // ============ WEBSITE CANVAS — proxy iframe + overlay events ============
  const [proxyHtml, setProxyHtml] = useState<string>("");
  useEffect(() => {
    if (canvas?.type !== "website") return;
    if (!shareToken || !currentUrl) return;
    setProxyError(null);
    setIframeReady(false);
    setProxyHtml("");
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(
          `${PROXY_URL}?share_token=${encodeURIComponent(shareToken)}&url=${encodeURIComponent(currentUrl)}`,
          { headers: { apikey: SUPA_KEY }, signal: ctrl.signal }
        );
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
        if (e?.name !== "AbortError") setProxyError(`Could not load website (${String(e?.message || e)})`);
      }
    })();
    return () => ctrl.abort();
  }, [shareToken, currentUrl, canvas?.type]);

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      // srcdoc iframes report origin "null"; same-window same-origin is also fine.
      // Reject anything else to prevent forged cross-origin postMessage commands.
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
        const pid = pendingScrollPinIdRef.current;
        if (pid) {
          pendingScrollPinIdRef.current = null;
          try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "scroll-to-pin", id: pid }, "*"); } catch {}
        }
      } else if (data.type === "pin") {
        if (mode !== "comment") return;
        if (canvas?.require_guest_name && !guestName) { setIdentityOpen(true); return; }
        setPending(data.payload as PendingPin);
        setCommentText("");
      } else if (data.type === "pin-click") {
        if (data.payload?.id) openThread(data.payload.id);
      } else if (data.type === "form-blocked") {
        toast.info("Forms are disabled inside review mode.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, canvas, guestName]);

  useEffect(() => {
    try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "set-mode", mode }, "*"); } catch {}
  }, [mode, iframeReady]);

  // ============ IDENTITY ============
  function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (canvas?.require_guest_name && !guestName.trim()) { toast.error("Please enter your name"); return; }
    if (canvas?.require_guest_email && !guestEmail.trim()) { toast.error("Please enter your email"); return; }
    localStorage.setItem(`phlash_guest_${shareToken}`, JSON.stringify({ name: guestName, email: guestEmail }));
    setIdentityOpen(false);
  }

  useEffect(() => {
    if (!canvas) return;
    if (canvas.require_guest_name && !guestName) setIdentityOpen(true);
  }, [canvas, guestName]);

  // ============ SUBMIT FEEDBACK ============
  async function submitFeedback() {
    if (!pending || !shareToken || !canvas) return;
    if (!commentText.trim()) { toast.error("Please add a comment"); return; }
    setSubmitting(true);
    const env = getEnv();

    const payload: any = {
      share_token: shareToken,
      canvas_id: canvas.id,
      original_page_url: pending.page_url ?? canvas.website_url ?? null,
      proxied_page_url: window.location.href,
      page_title: pending.page_title ?? canvas.name,
      comment: commentText,
      guest_name: guestName,
      guest_email: guestEmail,
      category, priority,
      x_percent: pending.x_percent,
      y_percent: pending.y_percent,
      anchor_selector: pending.anchor_selector ?? null,
      anchor_x_percent: pending.anchor_x_percent ?? null,
      anchor_y_percent: pending.anchor_y_percent ?? null,
      viewport_width: pending.viewport_width,
      viewport_height: pending.viewport_height,
      pdf_page_number: pending.pdf_page_number ?? null,
      x_position: pending.x_position,
      y_position: pending.y_position,
      scroll_x: pending.scroll_x,
      scroll_y: pending.scroll_y,
      element_selector: pending.element_selector,
      element_tag: pending.element_tag,
      element_id: pending.element_id,
      element_classes: pending.element_classes,
      element_text: pending.element_text,
      element_href: pending.element_href,
      element_src: pending.element_src,
      ...env,
      guest_token: guestToken,
    };
    const res = await fetch(`${SUPA_URL}/functions/v1/submit-guest-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) { toast.error(json.error ?? "Could not submit"); return; }
    toast.success("Feedback submitted. Thank you.");
    setPending(null);
    setCommentText("");
    setMode("browse");
    setRefreshTick((t) => t + 1);
  }

  // ============ THREAD / REPLIES ============
  async function openThread(itemId: string) {
    setThreadOpen(itemId);
    const item = comments.find((c) => c.id === itemId);
    setThread(item);
    setReplies([]);
    setReplyText("");
    if (canvas?.type === "website" && item?.original_page_url) {
      if (!samePageUrl(item.original_page_url, currentUrl)) {
        pendingScrollPinIdRef.current = item.id;
        setCurrentUrl(item.original_page_url);
      } else {
        try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "scroll-to-pin", id: item.id }, "*"); } catch {}
      }
    } else if (canvas?.type === "pdf" && item?.pdf_page_number) {
      setPdfPage(item.pdf_page_number);
    }
    if (!shareToken) return;
    const qs = new URLSearchParams({ share_token: shareToken, feedback_item_id: itemId });
    if (guestToken) qs.set("guest_token", guestToken);
    const r = await fetch(`${SUPA_URL}/functions/v1/get-public-feedback-thread?${qs.toString()}`, { headers: { apikey: SUPA_KEY } });
    const j = await r.json();
    setReplies(j.replies ?? []);
  }

  async function submitReply() {
    if (!threadOpen || !shareToken || !replyText.trim()) return;
    if (canvas?.require_guest_name && !guestName.trim()) { setIdentityOpen(true); return; }
    const r = await fetch(`${SUPA_URL}/functions/v1/submit-guest-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
      body: JSON.stringify({ share_token: shareToken, feedback_item_id: threadOpen, body: replyText, guest_name: guestName, guest_email: guestEmail, guest_token: guestToken }),
    });
    const j = await r.json();
    if (!r.ok) { toast.error(j.error ?? "Reply failed"); return; }
    setReplyText("");
    openThread(threadOpen);
    setRefreshTick((t) => t + 1);
  }

  async function guestMutate(target: "feedback" | "reply", target_id: string, action: "edit" | "delete" | "set_status", value?: string): Promise<boolean> {
    if (!shareToken) return false;
    const r = await fetch(`${SUPA_URL}/functions/v1/guest-feedback-mutate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY },
      body: JSON.stringify({ share_token: shareToken, guest_token: guestToken, target, target_id, action, value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? "Action failed"); return false; }
    setRefreshTick((t) => t + 1);
    if (threadOpen) openThread(threadOpen);
    return true;
  }

  // ============ FILTERED COMMENTS for sidebar ============
  const filteredComments = useMemo(() => {
    let list = comments;
    if (canvas?.type === "website" && sidebarFilter === "page") list = list.filter((c) => samePageUrl(c.original_page_url, currentUrl));
    if (canvas?.type === "pdf" && sidebarFilter === "page") list = list.filter((c) => (c.pdf_page_number ?? 1) === pdfPage);
    if (sidebarFilter === "unresolved") list = list.filter((c) => c.status !== "resolved");
    if (sidebarFilter === "resolved") list = list.filter((c) => c.status === "resolved");
    if (sidebarFilter === "page") list = list.filter((c) => c.status !== "resolved");
    if (sidebarSearch.trim()) {
      const s = sidebarSearch.toLowerCase();
      list = list.filter((c) => (c.comment ?? "").toLowerCase().includes(s) || (c.guest_name ?? "").toLowerCase().includes(s));
    }
    return list;
  }, [comments, sidebarFilter, sidebarSearch, currentUrl, pdfPage, canvas?.type]);

  // Show resolved only when user explicitly filters for it
  const showResolved = sidebarFilter === "resolved" || sidebarFilter === "all";
  const pinsForViewer = useMemo(() => {
    let list = comments;
    // Always restrict website pins to current page
    if (canvas?.type === "website") list = list.filter((c) => !c.original_page_url || samePageUrl(c.original_page_url, currentUrl));
    if (!showResolved) list = list.filter((c) => c.status !== "resolved");
    return list.map((c, i) => ({
      id: c.id,
      label: c.pin_number ?? (i + 1),
      x_percent: Number(c.x_percent ?? 0),
      y_percent: Number(c.y_percent ?? 0),
      anchor_selector: c.anchor_selector ?? null,
      anchor_x_percent: c.anchor_x_percent == null ? null : Number(c.anchor_x_percent),
      anchor_y_percent: c.anchor_y_percent == null ? null : Number(c.anchor_y_percent),
      element_tag: c.element_tag ?? "",
      element_id: c.element_id ?? "",
      element_classes: c.element_classes ?? "",
      element_text: c.element_text ?? "",
      element_href: c.element_href ?? "",
      element_src: c.element_src ?? "",
      pdf_page_number: c.pdf_page_number ?? null,
      comment: c.comment ?? "",
      guest_name: c.guest_name,
      status: c.status,
      visibility: "public" as const,
    }));
  }, [comments, canvas?.type, currentUrl, showResolved]);

  // Push pins into proxy iframe overlay (website canvas only)
  useEffect(() => {
    if (!iframeReady) return;
    try { iframeRef.current?.contentWindow?.postMessage({ source: "phlash-review-parent", type: "render-pins", pins: pinsForViewer }, "*"); } catch {}
  }, [pinsForViewer, iframeReady]);

  if (loading) return <LoadingState label="Loading review…" fullScreen />;

  if (error || !canvas) {
    return (
      <ErrorState
        title="Review link unavailable"
        description={error ?? "This review link is invalid or has been removed."}
      />
    );
  }

  // ============ Sidebar shared component ============
  const filterOptions = [
    { value: "unresolved", label: "Open" },
    { value: "all", label: "All comments" },
    ...((canvas.type === "website" || canvas.type === "pdf") ? [{ value: "page", label: canvas.type === "pdf" ? "Current page" : "This page" }] : []),
    { value: "resolved", label: "Resolved" },
  ];

  const selectedItem = (thread ?? comments.find((c) => c.id === threadOpen)) ?? null;

  const sidebarContent = (
    <ReviewSidebar
      mode="public"
      items={filteredComments as any}
      totalCount={comments.length}
      onClearFilters={() => { setSidebarFilter("all"); setSidebarSearch(""); }}
      search={sidebarSearch}
      setSearch={setSidebarSearch}
      filterValue={sidebarFilter}
      setFilterValue={(v) => setSidebarFilter(v as any)}
      filterOptions={filterOptions}
      emptyText={canvas.commenting_enabled ? "No feedback matches your filter." : "Commenting is currently paused."}
      selectedId={threadOpen}
      selectedItem={selectedItem as any}
      replies={replies as any}
      onSelect={(id) => openThread(id)}
      onBack={() => { setThreadOpen(null); setThread(null); setReplies([]); }}
      canReply={!!(canvas.allow_guest_replies && canvas.commenting_enabled)}
      replyText={replyText}
      setReplyText={setReplyText}
      onSubmitReply={submitReply}
      guestActions={{
        guestStatuses: [
          { value: "new", label: "Active" },
          { value: "in_progress", label: "In progress" },
          { value: "ready_for_qa", label: "Ready for QA" },
          { value: "resolved", label: "Resolved" },
        ],
        onEditFeedback: (id, value) => guestMutate("feedback", id, "edit", value),
        onDeleteFeedback: (id) => guestMutate("feedback", id, "delete"),
        onSetStatus: (id, value) => guestMutate("feedback", id, "set_status", value),
        onEditReply: (id, value) => guestMutate("reply", id, "edit", value),
        onDeleteReply: (id) => guestMutate("reply", id, "delete"),
      }}
    />
  );

  // ============ MAIN VIEWER ============
  let viewer: React.ReactNode;

  if (canvas.type === "image") {
    if (!canvas.file?.public_url) {
      viewer = <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">No image uploaded for this canvas yet.</div>;
    } else {
      viewer = (
        <ImageReviewCanvas
          imageUrl={canvas.file.public_url}
          mode={mode}
          setMode={(m) => {
            if (m === "comment" && canvas.require_guest_name && !guestName) { setIdentityOpen(true); return; }
            if (m === "comment" && !canvas.commenting_enabled) { toast.error("Commenting is closed"); return; }
            setMode(m);
          }}
          pins={pinsForViewer.filter((p) => p.pdf_page_number == null)}
          onPinDrop={(x, y) => {
            setPending({
              x_percent: x, y_percent: y,
              viewport_width: window.innerWidth, viewport_height: window.innerHeight,
              page_title: canvas.name, page_url: canvas.file?.public_url ?? null,
            } as any);
            setCommentText("");
          }}
          onPinClick={(pid) => openThread(pid)}
          commentingEnabled={canvas.commenting_enabled}
        />
      );
    }
  } else if (canvas.type === "pdf") {
    if (!canvas.file?.public_url) {
      viewer = <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">No PDF uploaded for this canvas yet.</div>;
    } else {
      viewer = (
        <PdfReviewCanvas
          pdfUrl={canvas.file.public_url}
          mode={mode}
          setMode={(m) => {
            if (m === "comment" && canvas.require_guest_name && !guestName) { setIdentityOpen(true); return; }
            if (m === "comment" && !canvas.commenting_enabled) { toast.error("Commenting is closed"); return; }
            setMode(m);
          }}
          pins={pinsForViewer}
          currentPage={pdfPage}
          setCurrentPage={setPdfPage}
          onPinDrop={(page, x, y) => {
            setPending({
              x_percent: x, y_percent: y,
              viewport_width: window.innerWidth, viewport_height: window.innerHeight,
              pdf_page_number: page,
              page_title: `${canvas.name} (p.${page})`, page_url: canvas.file?.public_url ?? null,
            } as any);
            setCommentText("");
          }}
          onPinClick={(pid) => openThread(pid)}
          commentingEnabled={canvas.commenting_enabled}
        />
      );
    }
  } else {
    // WEBSITE — original proxy iframe
    viewer = (
      <div className="flex-1 flex items-center justify-center bg-secondary/40 overflow-auto p-4">
        {proxyError ? (
          <div className="surface-elevated p-8 max-w-md w-full text-center">
            <h2 className="font-semibold">We couldn't load this website inside the review canvas</h2>
            <p className="text-sm text-muted-foreground mt-2">{proxyError}</p>
            <p className="text-xs text-muted-foreground mt-3">This site may have security restrictions, require login, or block automated requests. You can still leave page-level feedback below — no account required.</p>
            <div className="flex gap-2 mt-4 justify-center">
              <Button variant="outline" size="sm" onClick={() => window.open(currentUrl, "_blank")}>
                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open website in new tab
              </Button>
              {canvas.widget_fallback_enabled && canvas.commenting_enabled && (
                <Button size="sm" onClick={() => {
                  if (canvas.require_guest_name && !guestName) { setIdentityOpen(true); return; }
                  setPending({
                    x_position: 0, y_position: 0, x_percent: 0, y_percent: 0,
                    anchor_selector: "",
                    viewport_width: window.innerWidth, viewport_height: window.innerHeight,
                    scroll_x: 0, scroll_y: 0,
                    element_selector: "", element_tag: "", element_id: "",
                    element_classes: "", element_text: "", element_href: "", element_src: "",
                    page_url: currentUrl, page_title: canvas.name,
                  });
                  setCommentText("");
                }}>
                  <MessageSquare className="w-3.5 h-3.5 mr-1" /> Leave feedback
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-card shadow-lg transition-all" style={{ width: DEVICE_WIDTHS[device] ?? "100%", height: "100%", maxWidth: "100%" }} data-review-content data-review-capture>
            <iframe
              ref={iframeRef}
              key={currentUrl + ":" + (proxyHtml ? "loaded" : "empty")}
              srcDoc={proxyHtml || IFRAME_PLACEHOLDER_HTML}
              title="Review canvas"
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
      {/* Top toolbar */}
      <header className="bg-card border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center"><Eye className="w-4 h-4 text-primary-foreground" /></div>
          <div className="hidden md:block">
            <div className="text-sm font-semibold leading-tight">{canvas.name}</div>
            <div className="text-[11px] text-muted-foreground">{canvas.client_name} · {canvas.project_name} · <span className="capitalize">{canvas.type}</span></div>
          </div>
        </div>
        {canvas.type === "website" && (
          <div className="hidden lg:flex items-center gap-1 text-xs bg-secondary px-2.5 py-1 rounded font-mono text-muted-foreground max-w-md truncate">
            <ExternalLink className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{currentUrl}</span>
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
              <button
                onClick={() => {
                  if (!canvas.commenting_enabled) { toast.error("Commenting is closed for this canvas."); return; }
                  if (canvas.require_guest_name && !guestName) { setIdentityOpen(true); return; }
                  setMode("comment");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium ${mode === "comment" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Comment
              </button>
            </div>
          </>
        )}

        {/* Mobile sidebar trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" className="md:hidden"><MessagesSquare className="w-4 h-4 mr-1" /> {comments.length}</Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[80vh] p-0">
            <SheetHeader className="px-4 py-3 border-b border-border"><SheetTitle>Comments</SheetTitle></SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>

      </header>

      {/* Main split — sidebar on LEFT */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-border bg-card flex-col shrink-0 hidden md:flex">
          {sidebarContent}
        </aside>
        <div className="flex-1 flex overflow-hidden">
          {viewer}
        </div>
      </div>

      {/* Identity modal */}
      <Dialog open={identityOpen} onOpenChange={(o) => {
        if (!o && canvas.require_guest_name && !guestName.trim()) return;
        setIdentityOpen(o);
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Before leaving feedback</DialogTitle></DialogHeader>
          <form onSubmit={saveIdentity} className="space-y-3">
            <div>
              <Label>Your name {canvas.require_guest_name && "*"}</Label>
              <Input required={canvas.require_guest_name} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            </div>
            <div>
              <Label>Email {canvas.require_guest_email ? "*" : "(optional)"}</Label>
              <Input type="email" required={canvas.require_guest_email} value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full">Continue</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Comment composer */}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Leave feedback</DialogTitle></DialogHeader>
          {pending && (
            <div className="space-y-3">
              {pending.element_text && (
                <div className="text-xs bg-secondary/50 p-2 rounded">
                  <div className="text-muted-foreground mb-1">You clicked on:</div>
                  <div className="line-clamp-2">"{pending.element_text}"</div>
                </div>
              )}
              {pending.pdf_page_number && (
                <div className="text-xs bg-secondary/50 p-2 rounded">PDF page {pending.pdf_page_number}</div>
              )}
              <div>
                <Label>Comment *</Label>
                <Textarea autoFocus rows={4} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Describe what you'd like changed…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["general","design","content","bug","mobile","seo","form","performance","other"].map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["low","normal","high","urgent"].map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setPending(null)} className="flex-1">Cancel</Button>
                <Button onClick={submitFeedback} disabled={submitting} className="flex-1">
                  {submitting ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Submitting…</> : "Submit feedback"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>



    </div>
  );
}
