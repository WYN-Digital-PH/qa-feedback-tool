// Authenticated upload endpoint for image/pdf canvas assets.
// Validates type & size, stores in canvas-files bucket, records in canvas_files table.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const PDF_MIMES = ["application/pdf"];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_PDF = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claims.claims.sub as string;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const canvasId = form.get("canvas_id") as string | null;
    const projectId = form.get("project_id") as string | null;
    const kind = (form.get("kind") as string | null) ?? "image"; // image | pdf
    const pageCount = Number(form.get("page_count") || 0) || null;
    const widthPx = Number(form.get("width") || 0) || null;
    const heightPx = Number(form.get("height") || 0) || null;

    if (!file || !canvasId || !projectId) {
      return new Response(JSON.stringify({ error: "Missing file, canvas_id or project_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allowed = kind === "pdf" ? PDF_MIMES : IMAGE_MIMES;
    const max = kind === "pdf" ? MAX_PDF : MAX_IMAGE;
    if (!allowed.includes(file.type)) {
      return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (file.size > max) {
      return new Response(JSON.stringify({ error: `File too large (max ${(max/1024/1024)|0}MB)` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Uploading a canvas file is part of creating a canvas. This function writes
    // with the service role, which bypasses RLS, so check the permission here.
    const { data: allowed } = await admin.rpc("user_has_permission", {
      _user_id: userId,
      _permission: "canvases.create",
    });
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Your role can't add canvas files." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || (kind === "pdf" ? "pdf" : "bin");
    const path = `${projectId}/${canvasId}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await admin.storage.from("canvas-files").upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = admin.storage.from("canvas-files").getPublicUrl(path);

    const { data: row, error: insErr } = await admin.from("canvas_files").insert({
      canvas_id: canvasId,
      storage_path: path,
      public_url: pub.publicUrl,
      mime_type: file.type,
      file_size: file.size,
      original_filename: file.name,
      page_count: pageCount,
      width: widthPx,
      height: heightPx,
      created_by: userId,
    }).select("*").single();
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mirror to canvases.file_url for quick reference
    await admin.from("canvases").update({ file_url: pub.publicUrl }).eq("id", canvasId);

    return new Response(JSON.stringify({ ok: true, file: row }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error('[upload-canvas-file]', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
