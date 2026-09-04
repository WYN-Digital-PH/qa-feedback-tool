import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { share_token, reviewer_name, reviewer_email, decision, message } = await req.json();

    if (!share_token || !decision || !["approved", "changes_requested"].includes(decision)) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: canvas } = await supabase
      .from("canvases")
      .select("id, project_id, client_id, allow_approval, status")
      .eq("share_token", share_token)
      .maybeSingle();

    if (!canvas) {
      return new Response(JSON.stringify({ error: "Invalid share token" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!canvas.allow_approval) {
      return new Response(JSON.stringify({ error: "Approvals are disabled for this canvas" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase.from("review_decisions").insert({
      project_id: canvas.project_id,
      canvas_id: canvas.id,
      client_id: canvas.client_id,
      share_token,
      reviewer_name: reviewer_name ?? null,
      reviewer_email: reviewer_email ?? null,
      decision,
      message: message ?? null,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("activity_logs").insert({
      project_id: canvas.project_id,
      canvas_id: canvas.id,
      guest_name: reviewer_name ?? null,
      action: "review_decision",
      details: { decision, message },
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('[submit-review-decision]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
