// Returns public-safe replies (is_internal=false) for a feedback item, scoped by share_token.
// Never exposes internal notes, assignees, or user emails.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const shareToken = url.searchParams.get("share_token");
    const feedbackId = url.searchParams.get("feedback_item_id");
    if (!shareToken || !feedbackId) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: canvas } = await admin.from("canvases").select("id").eq("share_token", shareToken).maybeSingle();
    if (!canvas) return new Response(JSON.stringify({ error: "Invalid share token" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: fi } = await admin.from("feedback_items").select("id, canvas_id, is_internal, visibility, deleted_at").eq("id", feedbackId).maybeSingle();
    if (!fi || fi.canvas_id !== canvas.id || fi.is_internal || fi.visibility === "internal" || fi.deleted_at) {
      return new Response(JSON.stringify({ replies: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url2 = new URL(req.url);
    const guestToken = url2.searchParams.get("guest_token") || "";
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const myToken = isUuid(guestToken) ? guestToken : null;

    const { data } = await admin
      .from("feedback_comments")
      .select("id, body, guest_name, user_id, created_at, guest_token")
      .eq("feedback_item_id", feedbackId)
      .eq("is_internal", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    // Anonymize team members as "Team" — never leak internal user emails/names.
    // Expose `mine` so the reviewer can edit/delete their own replies. Never leak guest_token.
    const replies = (data ?? []).map((r: any) => ({
      id: r.id,
      body: r.body,
      author: r.guest_name ?? (r.user_id ? "Team" : "Guest"),
      from_team: !!r.user_id,
      created_at: r.created_at,
      mine: !!myToken && r.guest_token === myToken,
    }));

    return new Response(JSON.stringify({ replies }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('[get-public-feedback-thread]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
