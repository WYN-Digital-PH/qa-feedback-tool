// Public-safe endpoint allowing reviewers (guests) to edit/delete their own
// feedback item / reply, and change status on their own feedback item.
// Authorization is gated by the per-row guest_token saved at creation time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_STATUSES = new Set(["new", "in_progress", "ready_for_qa", "resolved"]);

function isUuid(v: any) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { share_token, guest_token, action, target, target_id, value } = await req.json();
    if (!share_token || !isUuid(guest_token) || !action || !target || !target_id) {
      return json({ error: "Missing or invalid params" }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: canvas } = await admin
      .from("canvases")
      .select("id, project_id, status, commenting_enabled")
      .eq("share_token", share_token)
      .maybeSingle();
    if (!canvas) return json({ error: "Invalid share token" }, 404);
    if (canvas.status !== "active" || !canvas.commenting_enabled) return json({ error: "Commenting is closed" }, 403);

    if (target === "feedback") {
      const { data: fi } = await admin
        .from("feedback_items")
        .select("id, canvas_id, guest_token, visibility, is_internal, deleted_at")
        .eq("id", target_id)
        .maybeSingle();
      if (!fi || fi.canvas_id !== canvas.id) return json({ error: "Not found" }, 404);
      if (fi.deleted_at) return json({ error: "Deleted" }, 410);
      if (fi.is_internal || fi.visibility === "internal") return json({ error: "Forbidden" }, 403);
      if (!fi.guest_token || fi.guest_token !== guest_token) return json({ error: "Forbidden" }, 403);

      if (action === "edit") {
        if (typeof value !== "string" || !value.trim()) return json({ error: "Empty comment" }, 400);
        if (value.length > 5000) return json({ error: "Comment too long" }, 400);
        const { error } = await admin.from("feedback_items").update({ comment: value.trim() }).eq("id", fi.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      if (action === "delete") {
        const { error } = await admin
          .from("feedback_items")
          .update({ deleted_at: new Date().toISOString(), deleted_by_type: "guest" })
          .eq("id", fi.id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("activity_logs").insert({
          project_id: canvas.project_id,
          canvas_id: canvas.id,
          feedback_item_id: fi.id,
          action: "feedback_deleted_by_guest",
        });
        return json({ ok: true });
      }
      if (action === "set_status") {
        if (typeof value !== "string" || !ALLOWED_STATUSES.has(value)) return json({ error: "Invalid status" }, 400);
        const patch: any = { status: value };
        if (value === "resolved") patch.resolved_at = new Date().toISOString();
        const { error } = await admin.from("feedback_items").update(patch).eq("id", fi.id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("activity_logs").insert({
          project_id: canvas.project_id,
          canvas_id: canvas.id,
          feedback_item_id: fi.id,
          action: "status_changed_by_guest",
          details: { value },
        });
        return json({ ok: true });
      }
      return json({ error: "Unknown action" }, 400);
    }

    if (target === "reply") {
      const { data: c } = await admin
        .from("feedback_comments")
        .select("id, feedback_item_id, guest_token, is_internal, deleted_at")
        .eq("id", target_id)
        .maybeSingle();
      if (!c) return json({ error: "Not found" }, 404);
      if (c.deleted_at) return json({ error: "Deleted" }, 410);
      if (c.is_internal) return json({ error: "Forbidden" }, 403);
      if (!c.guest_token || c.guest_token !== guest_token) return json({ error: "Forbidden" }, 403);
      // Verify the parent feedback item is in this canvas
      const { data: parent } = await admin
        .from("feedback_items")
        .select("id, canvas_id")
        .eq("id", c.feedback_item_id)
        .maybeSingle();
      if (!parent || parent.canvas_id !== canvas.id) return json({ error: "Forbidden" }, 403);

      if (action === "edit") {
        if (typeof value !== "string" || !value.trim()) return json({ error: "Empty reply" }, 400);
        if (value.length > 5000) return json({ error: "Reply too long" }, 400);
        const { error } = await admin.from("feedback_comments").update({ body: value.trim() }).eq("id", c.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      if (action === "delete") {
        const { error } = await admin
          .from("feedback_comments")
          .update({ deleted_at: new Date().toISOString(), deleted_by_type: "guest" })
          .eq("id", c.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      return json({ error: "Unknown action" }, 400);
    }

    return json({ error: "Unknown target" }, 400);
  } catch (e) {
    console.error('[guest-feedback-mutate]', e);
    return json({ error: 'Internal server error' }, 500);
  }
});
