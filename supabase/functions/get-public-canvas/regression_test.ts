// Phase 1 regression tests for public guest review flow.
// Run: bun supabase test (or via supabase--test_edge_functions tool)
// Verifies guest endpoints are reachable WITHOUT auth and reject invalid tokens.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const F = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

async function call(name: string, qs = "", init: RequestInit = {}) {
  const r = await fetch(`${F(name)}${qs}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, ...(init.headers ?? {}) },
  });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

Deno.test("get-public-canvas: rejects missing share_token (no auth required)", async () => {
  const r = await call("get-public-canvas");
  assertEquals(r.status, 400);
});

Deno.test("get-public-canvas: 404 for unknown share_token", async () => {
  const r = await call("get-public-canvas", "?share_token=phlash_test_invalid_xxx");
  assertEquals(r.status, 404);
});

Deno.test("get-public-canvas-comments: rejects missing share_token", async () => {
  const r = await call("get-public-canvas-comments");
  assertEquals(r.status, 400);
});

Deno.test("submit-guest-feedback: rejects missing comment", async () => {
  const r = await call("submit-guest-feedback", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_token: "x" }),
  });
  assertEquals(r.status, 400);
});

Deno.test("submit-guest-feedback: 404 for invalid share_token (still no auth required)", async () => {
  const r = await call("submit-guest-feedback", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_token: "phlash_test_invalid_xxx", comment: "hello" }),
  });
  assertEquals(r.status, 404);
});

Deno.test("submit-review-decision: rejects invalid decision", async () => {
  const r = await call("submit-review-decision", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_token: "x", decision: "maybe" }),
  });
  assertEquals(r.status, 400);
});

Deno.test("submit-guest-reply: rejects missing fields (no auth required)", async () => {
  const r = await call("submit-guest-reply", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_token: "x" }),
  });
  assertEquals(r.status, 400);
});

Deno.test("get-public-feedback-thread: rejects missing params", async () => {
  const r = await call("get-public-feedback-thread");
  assertEquals(r.status, 400);
});

Deno.test("proxy-website: rejects missing params", async () => {
  const r = await call("proxy-website");
  assertEquals(r.status, 400);
});
