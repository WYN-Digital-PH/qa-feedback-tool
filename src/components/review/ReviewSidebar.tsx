import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Send, Lock, MessageSquare, ImageOff, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/feedback/StatusBadge";
import { useConfirm } from "@/components/ConfirmDialog";
import { humanize } from "@/lib/feedbackMeta";
import { profileName } from "@/lib/displayName";

export interface SidebarItem {
  id: string;
  pin_number?: number | null;
  comment: string;
  guest_name?: string | null;
  guest_email?: string | null;
  created_at: string;
  status?: string | null;
  priority?: string | null;
  original_page_url?: string | null;
  page_title?: string | null;
  pdf_page_number?: number | null;
  device_type?: string | null;
  browser?: string | null;
  screenshot_url?: string | null;
  screenshot_status?: "pending" | "processing" | "completed" | "failed" | string | null;
  visibility?: "public" | "internal" | string | null;
  /**
   * Replies under this item, for the list indicator. Counted by the caller,
   * which is the only side that knows which replies the viewer may see — a
   * guest must not be told that internal notes exist.
   */
  reply_count?: number | null;
  /**
   * Who wrote it, already resolved by the caller — the only side that holds the
   * profiles list. Falls back to `guest_name` when absent, which is right for
   * the public canvas where every author is a guest.
   */
  author_name?: string | null;
  mine?: boolean;
  deleted?: boolean;
  deleted_by_type?: string | null;
}

export interface SidebarReply {
  id: string;
  body: string;
  author?: string | null;
  created_at: string;
  is_internal?: boolean;
  from_team?: boolean;
  mine?: boolean;
  deleted?: boolean;
  deleted_by_type?: string | null;
}

// Optional reviewer (guest) actions enabled on the public canvas only.
export interface GuestActions {
  guestStatuses: { value: string; label: string }[];
  onEditFeedback: (id: string, value: string) => Promise<boolean> | void;
  onDeleteFeedback: (id: string) => Promise<boolean> | void;
  onSetStatus: (id: string, value: string) => Promise<boolean> | void;
  onEditReply: (id: string, value: string) => Promise<boolean> | void;
  onDeleteReply: (id: string) => Promise<boolean> | void;
}

export interface InternalSidebarProps {
  statuses: string[];
  priorities: string[];
  profiles: { id: string; full_name?: string | null; email?: string | null }[];
  labels: { id: string; name: string; color: string }[];
  feedbackLabelIds: string[];
  onUpdate: (field: string, value: any) => void;
  onToggleLabel: (labelId: string) => void;
  replyKind: "public" | "internal";
  setReplyKind: (k: "public" | "internal") => void;
  showInternalNotes: boolean;
  // Optional internal team edit/delete (gated by ownership/admin in parent)
  canEditItem?: (item: SidebarItem) => boolean;
  canEditReply?: (reply: SidebarReply) => boolean;
  onEditItem?: (id: string, value: string) => Promise<boolean> | void;
  onDeleteItem?: (id: string) => Promise<boolean> | void;
  onEditReply?: (id: string, value: string) => Promise<boolean> | void;
  onDeleteReply?: (id: string) => Promise<boolean> | void;
}

export interface ReviewSidebarProps {
  mode: "public" | "internal";
  // list
  items: SidebarItem[];
  /**
   * How many items are in scope for this view before the user's own filters —
   * the denominator of the `n/N` badge. Callers must pass the count after the
   * structural rules (deleted, current page) and before status/priority/
   * assignee/label/search, or the badge stops meaning "your filters hide this
   * many" and starts looking like missing data.
   */
  totalCount: number;
  /** Clears every filter this sidebar owns. Enables the "n hidden" reset. */
  onClearFilters?: () => void;
  search: string;
  setSearch: (v: string) => void;
  filterValue: string;
  setFilterValue: (v: string) => void;
  filterOptions: { value: string; label: string }[];
  emptyText?: string;
  // selection / thread
  selectedId: string | null;
  selectedItem: SidebarItem | null;
  replies: SidebarReply[];
  onSelect: (id: string) => void;
  onBack: () => void;
  // composer
  canReply: boolean;
  replyText: string;
  setReplyText: (s: string) => void;
  onSubmitReply: () => void;
  // optional
  internal?: InternalSidebarProps;
  // reviewer (guest) actions — public canvas only
  guestActions?: GuestActions;
  // extra filters bar (rendered inline before list — internal only)
  extraFilters?: React.ReactNode;
}

export default function ReviewSidebar(props: ReviewSidebarProps) {
  const { mode, items, totalCount, onClearFilters, search, setSearch, filterValue, setFilterValue, filterOptions,
    selectedId, selectedItem, replies, onSelect, onBack,
    canReply, replyText, setReplyText, onSubmitReply, internal, guestActions, extraFilters, emptyText } = props;
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [brokenScreenshotIds, setBrokenScreenshotIds] = useState<Record<string, boolean>>({});
  const [editingItem, setEditingItem] = useState<{ id: string; value: string } | null>(null);
  const [editingReply, setEditingReply] = useState<{ id: string; value: string } | null>(null);
  // Rendered in both return trees below — the thread view and the list view.
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    if (selectedItem) {
      console.debug("[phlash screenshot] Thread rendering screenshot_url", {
        mode,
        feedbackId: selectedItem.id,
        screenshot_url: selectedItem.screenshot_url ?? null,
      });
    }
  }, [mode, selectedItem?.id, selectedItem?.screenshot_url]);

  // group by page_title || original_page_url
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: SidebarItem[] }>();
    items.forEach((it) => {
      const key =
        it.pdf_page_number != null
          ? `Page ${it.pdf_page_number}`
          : it.page_title || it.original_page_url || "Untitled";
      if (!map.has(key)) map.set(key, { key, label: key, items: [] });
      map.get(key)!.items.push(it);
    });
    return Array.from(map.values());
  }, [items]);

  /**
   * Where the open thread sits in the list, and what its neighbours are.
   *
   * Derived from `items` rather than asked of the caller, so the arrows always
   * walk exactly what is on screen — same filter, same order — and cannot drift
   * out of step with it. Null while nothing is open, or when the open item is
   * not in the current list (it can be filtered out while still selected).
   */
  const threadPosition = useMemo(() => {
    if (!selectedId) return null;
    const i = items.findIndex((it) => it.id === selectedId);
    if (i === -1) return null;
    return {
      index: i + 1,
      total: items.length,
      prevId: i > 0 ? items[i - 1].id : null,
      nextId: i < items.length - 1 ? items[i + 1].id : null,
    };
  }, [items, selectedId]);

  // Stable pin numbers come from feedback_items.pin_number (DB-assigned, unique per canvas).
  // Fallback to created_at index only if pin_number is missing for legacy rows.
  function pinLabel(it: SidebarItem, fallbackIdx: number): number | string {
    return it.pin_number ?? fallbackIdx;
  }
  const indexById = useMemo(() => {
    const m = new Map<string, number | string>();
    items.forEach((it, i) => m.set(it.id, pinLabel(it, i + 1)));
    return m;
  }, [items]);

  // ============ THREAD VIEW ============
  if (selectedId && selectedItem) {
    const pinNumber = selectedItem.pin_number ?? indexById.get(selectedItem.id) ?? "—";
    const visibleReplies = mode === "public"
      ? replies.filter((r) => !r.is_internal)
      : (internal?.showInternalNotes ? replies : replies.filter((r) => !r.is_internal));

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} className="h-7 px-2 -ml-1">
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
          </Button>
          {/*
            Walking a review meant thread → Back → next thread, every time.
            Stepping straight to the neighbour keeps the canvas in one place and
            the reviewer in one rhythm. The order is the list's own, so it
            follows whatever filter and grouping is on screen; an item that the
            current filter excludes has no neighbours and both arrows disable.
          */}
          {threadPosition && (
            <div className="flex items-center gap-0.5">
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={!threadPosition.prevId}
                onClick={() => threadPosition.prevId && onSelect(threadPosition.prevId)}
                aria-label="Previous comment"
                title="Previous comment"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums px-0.5">
                {threadPosition.index}/{threadPosition.total}
              </span>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0"
                disabled={!threadPosition.nextId}
                onClick={() => threadPosition.nextId && onSelect(threadPosition.nextId)}
                aria-label="Next comment"
                title="Next comment"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {pinNumber}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">
              {selectedItem.page_title || (selectedItem.pdf_page_number != null ? `Page ${selectedItem.pdf_page_number}` : selectedItem.original_page_url || "")}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Unified thread: original comment + replies */}
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Thread</Label>
            <div className="space-y-2 mt-1.5">
              {/* Original comment — always first */}
              <div className={`p-2.5 rounded-md text-sm border ${selectedItem.visibility === "internal" ? "border-warning/40 bg-warning/5" : "border-primary/30 bg-primary/5"}`}>
                <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1 flex-wrap">
                  {selectedItem.visibility === "internal" && <Lock className="w-3.5 h-3.5 text-warning" />}
                  <span className="font-medium text-foreground">{selectedItem.author_name ?? selectedItem.guest_name ?? "Guest"}</span>
                  {mode === "internal" && selectedItem.guest_email && (
                    <span className="text-muted-foreground">· {selectedItem.guest_email}</span>
                  )}
                  <span>·</span>
                  <span>{new Date(selectedItem.created_at).toLocaleString()}</span>
                  <span className="ml-1 text-[9px] uppercase tracking-wide text-primary font-semibold">Original</span>
                  {selectedItem.visibility === "internal" && (
                    <span className="text-[9px] uppercase tracking-wide text-warning font-semibold">Internal</span>
                  )}
                  {mode === "public" && guestActions && selectedItem.mine && !selectedItem.deleted && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="ml-auto p-0.5 rounded hover:bg-secondary" aria-label="Comment options"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => setEditingItem({ id: selectedItem.id, value: selectedItem.comment })}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={async () => {
                            const ok0 = await confirm({
                              title: "Delete this comment?",
                              description: "Your comment and any replies to it are removed from the review. This cannot be undone.",
                              confirmLabel: "Delete comment",
                            });
                            if (!ok0) return;
                            const ok = await guestActions.onDeleteFeedback(selectedItem.id);
                            if (ok !== false) onBack();
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {mode === "internal" && internal && !selectedItem.deleted && internal.canEditItem?.(selectedItem) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="ml-auto p-0.5 rounded hover:bg-secondary" aria-label="Comment options"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => setEditingItem({ id: selectedItem.id, value: selectedItem.comment })}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={async () => {
                            const ok0 = await confirm({
                              title: "Delete this feedback?",
                              description: "It is hidden from the canvas and from the inbox's default view. Anyone who can show deleted items will still see it.",
                              confirmLabel: "Delete feedback",
                            });
                            if (!ok0) return;
                            const ok = await internal.onDeleteItem?.(selectedItem.id);
                            if (ok !== false) onBack();
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {selectedItem.deleted ? (
                  <div className="italic text-muted-foreground text-xs">
                    This comment was deleted{selectedItem.deleted_by_type ? ` by ${selectedItem.deleted_by_type}` : ""}.
                  </div>
                ) : editingItem?.id === selectedItem.id ? (
                  <div className="space-y-1.5">
                    <Textarea rows={3} value={editingItem.value} onChange={(e) => setEditingItem({ id: selectedItem.id, value: e.target.value })} />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 text-xs" onClick={async () => {
                        if (!editingItem.value.trim()) return;
                        const fn = mode === "internal" ? internal?.onEditItem : guestActions?.onEditFeedback;
                        const ok = fn ? await fn(selectedItem.id, editingItem.value.trim()) : false;
                        if (ok !== false) setEditingItem(null);
                      }}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingItem(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{selectedItem.comment}</div>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {mode === "public" && guestActions && selectedItem.mine ? (
                    <Select value={selectedItem.status ?? "new"} onValueChange={(v) => guestActions.onSetStatus(selectedItem.id, v)}>
                      <SelectTrigger className="h-6 text-[10px] w-auto px-2 capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {guestActions.guestStatuses.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="capitalize text-xs">{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StatusBadge status={selectedItem.status} size="xs" />
                  )}
                </div>
              </div>

              {/* Replies */}
              {visibleReplies.length === 0 ? (
                <div className="text-xs text-muted-foreground italic px-1">No replies yet.</div>
              ) : (
                visibleReplies.map((r) => (
                  <div key={r.id} className={`p-2.5 rounded-md text-sm border ${r.is_internal ? "bg-warning/5 border-warning/30" : r.from_team ? "bg-secondary/60 border-border" : "bg-secondary/30 border-border"}`}>
                    <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1">
                      {r.is_internal && <Lock className="w-3.5 h-3.5" />}
                      <span className="font-medium text-foreground">{r.author || "User"}</span>
                      <span>·</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                      {r.is_internal && <span className="text-warning font-medium ml-1">Internal</span>}
                      {mode === "public" && guestActions && r.mine && !r.is_internal && !r.deleted && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="ml-auto p-0.5 rounded hover:bg-secondary" aria-label="Reply options"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-32">
                            <DropdownMenuItem onClick={() => setEditingReply({ id: r.id, value: r.body })}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={async () => {
                                const ok0 = await confirm({
                                  title: "Delete this reply?",
                                  description: "The reply is removed from the thread.",
                                  confirmLabel: "Delete reply",
                                });
                                if (!ok0) return;
                                await guestActions.onDeleteReply(r.id);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {mode === "internal" && internal && !r.deleted && internal.canEditReply?.(r) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="ml-auto p-0.5 rounded hover:bg-secondary" aria-label="Reply options"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-32">
                            <DropdownMenuItem onClick={() => setEditingReply({ id: r.id, value: r.body })}>
                              <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={async () => {
                                const ok0 = await confirm({
                                  title: "Delete this reply?",
                                  description: "The reply is removed from the thread.",
                                  confirmLabel: "Delete reply",
                                });
                                if (!ok0) return;
                                await internal.onDeleteReply?.(r.id);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {r.deleted ? (
                      <div className="italic text-muted-foreground text-xs">
                        This reply was deleted{r.deleted_by_type ? ` by ${r.deleted_by_type}` : ""}.
                      </div>
                    ) : editingReply?.id === r.id ? (
                      <div className="space-y-1.5">
                        <Textarea rows={3} value={editingReply.value} onChange={(e) => setEditingReply({ id: r.id, value: e.target.value })} />
                        <div className="flex gap-1.5">
                          <Button size="sm" className="h-7 text-xs" onClick={async () => {
                            if (!editingReply.value.trim()) return;
                            const fn = mode === "internal" ? internal?.onEditReply : guestActions?.onEditReply;
                            const ok = fn ? await fn(r.id, editingReply.value.trim()) : false;
                            if (ok !== false) setEditingReply(null);
                          }}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingReply(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{r.body}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Screenshot section — visible to internal always; public only when feedback is public */}
          {(mode === "internal" || (mode === "public" && selectedItem.visibility !== "internal")) && (
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Screenshot</Label>
              <div className="mt-1.5">
                {(() => {
                  const status = selectedItem.screenshot_status ?? (selectedItem.screenshot_url ? "completed" : "pending");
                  const broken = brokenScreenshotIds[selectedItem.id];
                  if (status === "completed" && selectedItem.screenshot_url && !broken) {
                    return (
                      <button
                        type="button"
                        onClick={() => setScreenshotOpen(true)}
                        className="block w-full rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary/40 transition"
                        aria-label="Open larger screenshot preview"
                      >
                        <img
                          src={selectedItem.screenshot_url}
                          alt="Feedback screenshot"
                          className="w-full max-h-40 object-cover bg-muted"
                          loading="lazy"
                          onError={() => setBrokenScreenshotIds((prev) => ({ ...prev, [selectedItem.id]: true }))}
                        />
                      </button>
                    );
                  }
                  if (status === "pending" || status === "processing") {
                    return (
                      <div className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/30 px-3 py-4 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Screenshot is being generated…
                      </div>
                    );
                  }
                  return (
                    <div className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/30 px-3 py-4 text-xs text-muted-foreground">
                      <ImageOff className="w-3.5 h-3.5" />
                      Screenshot unavailable
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Internal controls */}
          {mode === "internal" && internal && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Status</Label>
                <Select value={selectedItem.status ?? "new"} onValueChange={(v) => internal.onUpdate("status", v)}>
                  <SelectTrigger className="h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{internal.statuses.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Priority</Label>
                <Select value={selectedItem.priority ?? "normal"} onValueChange={(v) => internal.onUpdate("priority", v)}>
                  <SelectTrigger className="h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{internal.priorities.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Assignee</Label>
                <Select value={(selectedItem as any).assigned_to ?? "unassigned"} onValueChange={(v) => internal.onUpdate("assigned_to", v === "unassigned" ? null : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {internal.profiles.map((p) => <SelectItem key={p.id} value={p.id}>{profileName(p)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Labels</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {internal.labels.map((l) => {
                    const has = internal.feedbackLabelIds.includes(l.id);
                    return (
                      <button key={l.id} onClick={() => internal.onToggleLabel(l.id)}
                        className={`text-[10px] px-2 py-0.5 rounded border ${has ? "text-white border-transparent" : "text-muted-foreground border-border"}`}
                        style={has ? { backgroundColor: l.color } : {}}>
                        {l.name}
                      </button>
                    );
                  })}
                  {internal.labels.length === 0 && <div className="text-[10px] text-muted-foreground">No labels yet.</div>}
                </div>
              </div>
              <div className="col-span-2 flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => internal.onUpdate("status", "resolved")}>
                  Mark resolved
                </Button>
              </div>
            </div>
          )}

        </div>

        {/* Composer */}
        {canReply && (
          <div className="p-3 border-t border-border space-y-2 bg-card">
            {mode === "internal" && internal && (
              <Tabs value={internal.replyKind} onValueChange={(v) => internal.setReplyKind(v as any)}>
                <TabsList className="grid grid-cols-2 h-8 w-full">
                  <TabsTrigger value="public" className="text-xs">Public reply</TabsTrigger>
                  <TabsTrigger value="internal" className="text-xs">Internal note</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <Textarea
              rows={3}
              placeholder={mode === "internal" && internal?.replyKind === "internal" ? "Internal note (only your team)…" : "Write a reply…"}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <Button size="sm" className="w-full" onClick={onSubmitReply} disabled={!replyText.trim()}>
              <Send className="w-3.5 h-3.5 mr-1" />
              Send {mode === "internal" && internal?.replyKind === "internal" ? "note" : "reply"}
            </Button>
          </div>
        )}

        {/* Larger screenshot preview modal */}
        <Dialog open={screenshotOpen} onOpenChange={setScreenshotOpen}>
          <DialogContent className="max-w-4xl p-2">
            <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
            <DialogDescription className="sr-only">Larger preview of the feedback screenshot</DialogDescription>
            {selectedItem.screenshot_url && (
              <img
                src={selectedItem.screenshot_url}
                alt="Feedback screenshot full preview"
                className="w-full h-auto max-h-[80vh] object-contain rounded"
              />
            )}
          </DialogContent>
        </Dialog>
        {confirmDialog}
      </div>
    );
  }

  // ============ LIST VIEW ============
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Comments
          </div>
          <div className="text-[11px] text-muted-foreground">{items.length}/{totalCount}</div>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-xs" placeholder="Search comments…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterValue} onValueChange={setFilterValue}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {filterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {extraFilters}
        {/*
          Filters are sticky and easy to forget, and a hidden item is
          indistinguishable from one that was never saved. Saying how many are
          hidden, and offering one click to see them, is what turns "the
          feedback is gone" back into "the filter is on".
        */}
        {onClearFilters && items.length < totalCount && (
          <button
            type="button"
            onClick={onClearFilters}
            className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {totalCount - items.length} hidden by filters — show all
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-6 text-xs text-muted-foreground text-center">{emptyText ?? "No comments yet."}</div>
        ) : (
          <div>
            {grouped.map((g) => (
              <div key={g.key}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground bg-secondary/40 border-b border-border truncate">
                  {g.label}
                </div>
                <div className="divide-y divide-border">
                  {g.items.map((c) => {
                    const num = indexById.get(c.id) ?? 0;
                    const isInternal = c.visibility === "internal";
                    return (
                      <button
                        key={c.id}
                        onClick={() => onSelect(c.id)}
                        className="w-full text-left p-3 hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${isInternal ? "bg-warning text-warning-foreground" : "bg-primary text-primary-foreground"}`}>
                            {num}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                {isInternal && <Lock className="w-2.5 h-2.5 text-warning" />}
                                {c.author_name ?? c.guest_name ?? "Guest"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</div>
                            </div>
                            <div className="text-sm line-clamp-2 mt-0.5">{c.comment}</div>
                            <div className="flex flex-wrap gap-1 mt-1 items-center">
                              <StatusBadge status={c.status} size="xs" />
                              {isInternal && (
                                <span className="text-[10px] uppercase tracking-wide bg-warning/15 text-warning px-1.5 py-0.5 rounded font-semibold">Internal</span>
                              )}
                              {c.priority && c.priority !== "normal" && (
                                <span className="text-[10px] capitalize text-warning">{c.priority}</span>
                              )}
                              {c.device_type && (
                                <span className="text-[10px] text-muted-foreground capitalize">{c.device_type}</span>
                              )}
                              {!!c.reply_count && (
                                <span
                                  className="text-[10px] text-muted-foreground flex items-center gap-0.5"
                                  title={`${c.reply_count} ${c.reply_count === 1 ? "reply" : "replies"}`}
                                >
                                  <MessageSquare className="w-2.5 h-2.5" />
                                  {c.reply_count}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
