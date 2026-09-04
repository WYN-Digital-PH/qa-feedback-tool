// Server-side screenshot capture using Browserless (real Chromium).
// Invoked asynchronously after a feedback item is inserted.
// Expects: { feedback_item_id: string, internal_token: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSERLESS_BASE = "https://production-sfo.browserless.io";

function pinScript(opts: {
  scrollX: number;
  scrollY: number;
  xPercent: number;
  yPercent: number;
  anchorSelector: string;
  anchorXPercent: number;
  anchorYPercent: number;
  pinLabel: number | string;
  visibility: string;
}) {
  const color = opts.visibility === "internal" ? "#d97706" : "#0e8a93";
  return `
    (function(){
      try {
        // Wait for layout
        document.documentElement.style.scrollBehavior = 'auto';
        var fullW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
        var fullH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);

        var layer = document.createElement('div');
        layer.id = 'phlash-screenshot-pin-layer';
        // Zero-sized origin box, so a positioned <body> can't offset the marker.
        layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483640;';
        (document.body || document.documentElement).appendChild(layer);
        var lr = layer.getBoundingClientRect();
        var originX = window.scrollX + lr.left;
        var originY = window.scrollY + lr.top;

        // Prefer the element the comment was anchored to: this browser renders
        // the page at its own width, so the stored document percentages only
        // match if nothing reflowed.
        var pinX = null, pinY = null;
        var sel = ${JSON.stringify(opts.anchorSelector || "")};
        if (sel) {
          var el = null;
          try { el = document.querySelector(sel); } catch (e) {}
          if (el) {
            var r = el.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) {
              pinX = window.scrollX + r.left + (${opts.anchorXPercent} / 100) * r.width;
              pinY = window.scrollY + r.top + (${opts.anchorYPercent} / 100) * r.height;
            }
          }
        }
        var anchored = pinX !== null;
        if (!anchored) {
          pinX = (${opts.xPercent} / 100) * fullW;
          pinY = (${opts.yPercent} / 100) * fullH;
        }

        var marker = document.createElement('div');
        marker.textContent = ${JSON.stringify(String(opts.pinLabel))};
        marker.style.cssText = [
          'position:absolute',
          'left:'+(pinX - originX)+'px',
          'top:'+(pinY - originY)+'px',
          'transform:translate(-2px,-26px)',
          'width:28px','height:28px',
          'border-radius:999px 999px 999px 2px',
          'background:${color}',
          'color:white',
          'display:flex','align-items:center','justify-content:center',
          'font-size:12px','font-weight:700',
          'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
          'border:2px solid white',
          'pointer-events:none',
          'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'
        ].join(';');
        layer.appendChild(marker);

        if (anchored) {
          // Centre the anchored element rather than restoring the commenter's
          // scroll offset, which belongs to a different layout.
          window.scrollTo(
            Math.max(0, Math.min(pinX - window.innerWidth / 2, fullW - window.innerWidth)),
            Math.max(0, Math.min(pinY - window.innerHeight / 2, fullH - window.innerHeight))
          );
        } else {
          window.scrollTo(${opts.scrollX}, ${opts.scrollY});
        }
      } catch (e) {}
    })();
  `;
}

async function setStatus(
  admin: ReturnType<typeof createClient>,
  feedbackId: string,
  patch: Record<string, unknown>,
) {
  await admin.from("feedback_items").update(patch).eq("id", feedbackId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const BROWSERLESS_KEY = Deno.env.get("BROWSERLESS_API_KEY");

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { feedback_item_id, internal_token } = body ?? {};
  if (!feedback_item_id || internal_token !== SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPA_URL, SERVICE_KEY);

  const { data: item, error: itemErr } = await admin
    .from("feedback_items")
    .select("id, canvas_id, original_page_url, x_percent, y_percent, anchor_selector, anchor_x_percent, anchor_y_percent, viewport_width, viewport_height, scroll_x, scroll_y, pin_number, visibility, canvas_type")
    .eq("id", feedback_item_id)
    .maybeSingle();

  if (itemErr || !item) {
    return new Response(JSON.stringify({ error: "Feedback not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only website canvases support real-browser capture; others fail cleanly.
  if (item.canvas_type !== "website" || !item.original_page_url) {
    await setStatus(admin, item.id, {
      screenshot_status: "failed",
      screenshot_error: "Capture only supported for website canvases with a URL",
    });
    return new Response(JSON.stringify({ ok: false, reason: "unsupported_canvas" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!BROWSERLESS_KEY) {
    await setStatus(admin, item.id, {
      screenshot_status: "failed",
      screenshot_error: "BROWSERLESS_API_KEY not configured",
    });
    return new Response(JSON.stringify({ ok: false, reason: "no_provider" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await setStatus(admin, item.id, { screenshot_status: "processing", screenshot_error: null });

  const viewportWidth = Math.max(320, Math.min(2560, Number(item.viewport_width) || 1280));
  const viewportHeight = Math.max(320, Math.min(2000, Number(item.viewport_height) || 800));
  const scrollX = Math.max(0, Number(item.scroll_x) || 0);
  const scrollY = Math.max(0, Number(item.scroll_y) || 0);

  const script = pinScript({
    scrollX, scrollY,
    xPercent: Number(item.x_percent) || 0,
    yPercent: Number(item.y_percent) || 0,
    anchorSelector: typeof item.anchor_selector === "string" ? item.anchor_selector : "",
    anchorXPercent: Number(item.anchor_x_percent) || 0,
    anchorYPercent: Number(item.anchor_y_percent) || 0,
    pinLabel: item.pin_number ?? "•",
    visibility: String(item.visibility ?? "public"),
  });

  const browserlessPayload = {
    url: item.original_page_url,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1 },
    gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
    addScriptTag: [{ content: script }],
    waitForTimeout: 1200,
    options: { type: "jpeg", quality: 80, fullPage: false, omitBackground: false },
  };

  console.log("[capture-screenshot] requesting", {
    feedback_item_id: item.id,
    url: item.original_page_url,
    viewportWidth, viewportHeight, scrollX, scrollY,
  });

  let blob: ArrayBuffer | null = null;
  try {
    const res = await fetch(
      `${BROWSERLESS_BASE}/screenshot?token=${encodeURIComponent(BROWSERLESS_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(browserlessPayload),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      console.error("[capture-screenshot] Browserless error", res.status, text.slice(0, 500));
      await setStatus(admin, item.id, {
        screenshot_status: "failed",
        screenshot_error: `Browserless ${res.status}: ${text.slice(0, 280)}`,
      });
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    blob = await res.arrayBuffer();
  } catch (e) {
    console.error("[capture-screenshot] fetch failed", e);
    await setStatus(admin, item.id, {
      screenshot_status: "failed",
      screenshot_error: `Network error: ${String(e).slice(0, 280)}`,
    });
    return new Response(JSON.stringify({ ok: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!blob || blob.byteLength < 200) {
    await setStatus(admin, item.id, {
      screenshot_status: "failed",
      screenshot_error: "Empty screenshot returned",
    });
    return new Response(JSON.stringify({ ok: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const path = `${item.canvas_id}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await admin.storage
    .from("screenshots")
    .upload(path, new Uint8Array(blob), { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    console.error("[capture-screenshot] upload failed", upErr.message);
    await setStatus(admin, item.id, {
      screenshot_status: "failed",
      screenshot_error: `Upload failed: ${upErr.message}`,
    });
    return new Response(JSON.stringify({ ok: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: pub } = admin.storage.from("screenshots").getPublicUrl(path);

  await setStatus(admin, item.id, {
    screenshot_url: pub.publicUrl,
    screenshot_status: "completed",
    screenshot_error: null,
  });
  console.log("[capture-screenshot] completed", { feedback_item_id: item.id, url: pub.publicUrl });

  return new Response(JSON.stringify({ ok: true, screenshot_url: pub.publicUrl }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
