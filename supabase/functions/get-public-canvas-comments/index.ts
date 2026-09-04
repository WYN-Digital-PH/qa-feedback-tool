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
    const pageUrl = url.searchParams.get("page_url");
    const guestTokenParam = url.searchParams.get("guest_token") || "";
    const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const myToken = isUuid(guestTokenParam) ? guestTokenParam : null;
    if (!shareToken) {
      return new Response(JSON.stringify({ error: "Missing share_token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: canvas } = await supabase
      .from("canvases")
      .select("id, allow_public_comment_view")
      .eq("share_token", shareToken)
      .maybeSingle();

    if (!canvas) {
      return new Response(JSON.stringify({ error: "Invalid share token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // `allow_public_comment_view` is about not showing one stakeholder what
    // another said. It was also hiding a reviewer's own feedback from them,
    // which serves nobody — they wrote it, and they need to see it back before
    // finishing the review. Without a token there is no "own" to fall back to.
    const ownOnly = !canvas.allow_public_comment_view;
    if (ownOnly && !myToken) {
      return new Response(JSON.stringify({ comments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let q = supabase
      .from("feedback_items")
      .select("id, pin_number, comment, guest_name, original_page_url, page_title, pdf_page_number, x_percent, y_percent, anchor_selector, anchor_x_percent, anchor_y_percent, element_tag, element_id, element_classes, element_text, element_href, element_src, viewport_width, status, category, priority, created_at, screenshot_url, screenshot_status, canvas_type, guest_token")
      .eq("canvas_id", canvas.id)
      .eq("is_internal", false)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (pageUrl) q = q.eq("original_page_url", pageUrl);
    if (ownOnly) q = q.eq("guest_token", myToken);

    const { data: items } = await q;
    // Strip guest_token, attach `mine` boolean.
    const out = (items ?? []).map((r: any) => {
      const mine = !!myToken && r.guest_token === myToken;
      const { guest_token: _gt, ...rest } = r;
      return { ...rest, mine };
    });

    return new Response(JSON.stringify({ comments: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('[get-public-canvas-comments]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
