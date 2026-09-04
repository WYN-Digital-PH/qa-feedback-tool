// Authenticated endpoint for team members to create feedback (internal or public).
// Screenshot capture is delegated to the capture-screenshot edge function (Browserless).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function triggerCapture(feedbackId: string) {
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  fetch(`${SUPA_URL}/functions/v1/capture-screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ feedback_item_id: feedbackId, internal_token: SERVICE_KEY }),
  }).catch((e) => console.error("[submit-internal-feedback] trigger capture failed", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;
    // This function writes with the service role, which bypasses RLS, so the
    // permission has to be checked explicitly. user_has_permission() is the
    // service-role variant of the has_permission() helper the policies use.
    const { data: allowed } = await admin.rpc("user_has_permission", {
      _user_id: user.id,
      _permission: "feedback.comment",
    });
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Your role can't add feedback on this canvas." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      canvas_id, comment, visibility,
      original_page_url, page_title, pdf_page_number,
      x_percent, y_percent, viewport_width, viewport_height, scroll_x, scroll_y,
      anchor_selector, anchor_x_percent, anchor_y_percent,
      element_selector, element_tag, element_id, element_classes,
      element_text, element_href, element_src,
    } = body ?? {};

    if (!canvas_id || !comment || typeof comment !== "string" || comment.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Missing canvas_id or comment" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const vis = visibility === "public" ? "public" : "internal";

    const { data: canvas } = await admin
      .from("canvases")
      .select("id, project_id, client_id, type, website_url")
      .eq("id", canvas_id)
      .maybeSingle();
    if (!canvas) {
      return new Response(JSON.stringify({ error: "Canvas not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: insErr } = await admin
      .from("feedback_items")
      .insert({
        project_id: canvas.project_id,
        canvas_id: canvas.id,
        client_id: canvas.client_id,
        canvas_type: canvas.type,
        original_page_url: original_page_url ?? canvas.website_url ?? null,
        page_title: page_title ?? null,
        pdf_page_number: pdf_page_number ?? null,
        comment: String(comment).trim(),
        x_percent, y_percent, viewport_width, viewport_height, scroll_x, scroll_y,
        // DOM anchor: keeps the pin on its component across viewports/reloads
        anchor_selector: anchor_selector ?? null,
        anchor_x_percent: anchor_x_percent ?? null,
        anchor_y_percent: anchor_y_percent ?? null,
        element_selector: element_selector ?? null,
        element_tag: element_tag ?? null,
        element_id: element_id ?? null,
        element_classes: element_classes ?? null,
        element_text: element_text ?? null,
        element_href: element_href ?? null,
        element_src: element_src ?? null,
        screenshot_status: "pending",
        created_by_type: "team",
        created_by_user_id: user.id,
        guest_name: user.email ?? "Internal",
        status: "new",
        priority: "normal",
        category: "general",
        is_internal: vis === "internal",
        visibility: vis,
      })
      .select("id, pin_number")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("activity_logs").insert({
      project_id: canvas.project_id,
      canvas_id: canvas.id,
      feedback_item_id: inserted.id,
      user_id: user.id,
      action: vis === "internal" ? "feedback_created_internal" : "feedback_created_team_public",
      details: { visibility: vis },
    });

    triggerCapture(inserted.id);

    return new Response(JSON.stringify({ id: inserted.id, pin_number: inserted.pin_number }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('[submit-internal-feedback]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
