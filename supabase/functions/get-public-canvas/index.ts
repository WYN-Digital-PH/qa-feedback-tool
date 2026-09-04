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
    if (!shareToken) {
      return new Response(JSON.stringify({ error: "Missing share_token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: canvas, error } = await supabase
      .from("canvases")
      .select(`
        id, name, type, website_url, staging_url, file_url, status,
        proxy_enabled, widget_fallback_enabled, commenting_enabled,
        feedback_deadline, require_guest_name, require_guest_email,
        allow_guest_replies, allow_public_comment_view, allow_approval,
        capture_screenshot,
        projects:project_id ( id, name ),
        clients:client_id ( id, name, company_name ),
        canvas_files ( id, public_url, mime_type, page_count, width, height, original_filename )
      `)
      .eq("share_token", shareToken)
      .maybeSingle();

    if (error || !canvas) {
      return new Response(JSON.stringify({ error: "Canvas not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deadlinePassed = canvas.feedback_deadline
      ? new Date(canvas.feedback_deadline as string) < new Date()
      : false;

    const proj = canvas.projects as any;
    const client = canvas.clients as any;

    return new Response(JSON.stringify({
      canvas: {
        id: canvas.id,
        name: canvas.name,
        type: canvas.type,
        website_url: canvas.website_url,
        staging_url: canvas.staging_url,
        file_url: canvas.file_url,
        status: canvas.status,
        proxy_enabled: canvas.proxy_enabled,
        widget_fallback_enabled: canvas.widget_fallback_enabled,
        commenting_enabled: canvas.commenting_enabled && !deadlinePassed && canvas.status === "active",
        feedback_deadline: canvas.feedback_deadline,
        deadline_passed: deadlinePassed,
        require_guest_name: canvas.require_guest_name,
        require_guest_email: canvas.require_guest_email,
        allow_guest_replies: canvas.allow_guest_replies,
        allow_public_comment_view: canvas.allow_public_comment_view,
        allow_approval: canvas.allow_approval,
        capture_screenshot: canvas.capture_screenshot,
        project_name: proj?.name ?? "",
        client_name: client?.company_name ?? client?.name ?? "",
        file: ((canvas as any).canvas_files ?? [])[0] ?? null,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('[get-public-canvas]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
