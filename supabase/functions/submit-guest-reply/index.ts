// Public-safe endpoint allowing guests to reply to a feedback thread.
// Requires share_token + feedback_item_id + body. Always stored as is_internal=false.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isUuid(v: any) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { share_token, feedback_item_id, body, guest_name, guest_email, guest_token } = await req.json();
    if (!share_token || !feedback_item_id || !body || typeof body !== "string" || !body.trim()) {
      return new Response(JSON.stringify({ error: "Missing share_token, feedback_item_id, or body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.length > 5000) {
      return new Response(JSON.stringify({ error: "Reply too long" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: canvas } = await admin
      .from("canvases")
      .select("id, project_id, status, commenting_enabled, allow_guest_replies, require_guest_name, require_guest_email")
      .eq("share_token", share_token)
      .maybeSingle();
    if (!canvas) return new Response(JSON.stringify({ error: "Invalid share token" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!canvas.allow_guest_replies) return new Response(JSON.stringify({ error: "Replies are disabled" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (canvas.status !== "active" || !canvas.commenting_enabled) return new Response(JSON.stringify({ error: "Commenting is closed" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (canvas.require_guest_name && !guest_name?.trim()) return new Response(JSON.stringify({ error: "Name is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (canvas.require_guest_email && !guest_email?.trim()) return new Response(JSON.stringify({ error: "Email is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: fi } = await admin.from("feedback_items").select("id, canvas_id").eq("id", feedback_item_id).maybeSingle();
    if (!fi || fi.canvas_id !== canvas.id) {
      return new Response(JSON.stringify({ error: "Feedback item not found in this canvas" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tokenToStore = isUuid(guest_token) ? guest_token : null;

    const { data: ins, error } = await admin.from("feedback_comments").insert({
      feedback_item_id,
      body: body.trim(),
      is_internal: false,
      guest_name: guest_name ?? null,
      guest_email: guest_email ?? null,
      guest_token: tokenToStore,
    }).select("id, body, guest_name, created_at").single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await admin.from("activity_logs").insert({
      project_id: canvas.project_id,
      canvas_id: canvas.id,
      feedback_item_id,
      guest_name: guest_name ?? null,
      action: "guest_reply_added",
    });

    return new Response(JSON.stringify({ ok: true, reply: ins }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('[submit-guest-reply]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
