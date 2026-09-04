import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function triggerCapture(feedbackId: string) {
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Fire-and-forget so we don't block the submit response
  fetch(`${SUPA_URL}/functions/v1/capture-screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ feedback_item_id: feedbackId, internal_token: SERVICE_KEY }),
  }).catch((e) => console.error("[submit-guest-feedback] trigger capture failed", e));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      share_token, original_page_url, proxied_page_url, page_title,
      comment, original_text, suggested_text,
      guest_name, guest_email, category, priority,
      x_position, y_position, x_percent, y_percent,
      anchor_selector, anchor_x_percent, anchor_y_percent,
      viewport_width, viewport_height, scroll_x, scroll_y,
      element_selector, element_tag, element_id, element_classes,
      element_text, element_href, element_src,
      browser, browser_version, operating_system, device_type,
      user_agent, screen_width, screen_height, device_pixel_ratio,
      guest_token,
    } = body ?? {};
    const isUuid = (v: any) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const tokenToStore = isUuid(guest_token) ? guest_token : null;

    if (!share_token || !comment || typeof comment !== "string" || comment.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Missing share_token or comment" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (comment.length > 5000) {
      return new Response(JSON.stringify({ error: "Comment too long" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: canvas } = await supabase
      .from("canvases")
      .select("id, project_id, client_id, type, status, commenting_enabled, feedback_deadline, require_guest_name, require_guest_email")
      .eq("share_token", share_token)
      .maybeSingle();

    if (!canvas) {
      return new Response(JSON.stringify({ error: "Invalid share token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (canvas.status !== "active" || !canvas.commenting_enabled) {
      return new Response(JSON.stringify({ error: "Commenting is closed" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (canvas.feedback_deadline && new Date(canvas.feedback_deadline) < new Date()) {
      return new Response(JSON.stringify({ error: "Feedback deadline has passed" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (canvas.require_guest_name && (!guest_name || !String(guest_name).trim())) {
      return new Response(JSON.stringify({ error: "Name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (canvas.require_guest_email && (!guest_email || !String(guest_email).trim())) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inserted, error: insErr } = await supabase
      .from("feedback_items")
      .insert({
        project_id: canvas.project_id,
        canvas_id: canvas.id,
        client_id: canvas.client_id,
        canvas_type: canvas.type,
        original_page_url, proxied_page_url, page_title,
        comment: String(comment).trim(),
        original_text: original_text ?? null,
        suggested_text: suggested_text ?? null,
        guest_name: guest_name ?? null,
        guest_email: guest_email ?? null,
        category: category ?? "general",
        priority: priority ?? "normal",
        x_position, y_position, x_percent, y_percent,
        // DOM anchor: keeps the pin on its component across viewports/reloads
        anchor_selector: anchor_selector ?? null,
        anchor_x_percent: anchor_x_percent ?? null,
        anchor_y_percent: anchor_y_percent ?? null,
        viewport_width, viewport_height, scroll_x, scroll_y,
        element_selector, element_tag, element_id, element_classes,
        element_text, element_href, element_src,
        browser, browser_version, operating_system, device_type,
        user_agent, screen_width, screen_height, device_pixel_ratio,
        screenshot_status: "pending",
        created_by_type: "guest",
        is_internal: false,
        visibility: "public",
        guest_token: tokenToStore,
      })
      .select("id")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("activity_logs").insert({
      project_id: canvas.project_id,
      canvas_id: canvas.id,
      feedback_item_id: inserted.id,
      guest_name: guest_name ?? null,
      action: "feedback_submitted",
      details: { page_url: original_page_url, category, priority },
    });

    // Trigger async screenshot capture (real browser via Browserless)
    triggerCapture(inserted.id);

    return new Response(JSON.stringify({ id: inserted.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('[submit-guest-feedback]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
