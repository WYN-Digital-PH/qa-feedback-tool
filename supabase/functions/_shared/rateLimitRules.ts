/**
 * The rate-limit rules, and everything about them that is pure.
 *
 * Kept apart from `rateLimit.ts` so it can be unit-tested from the app's Node
 * toolchain: that module imports supabase-js over https, which only Deno can
 * resolve. Nothing here touches the network or the Deno globals.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitConfig {
  /** Function name, so buckets from different functions never collide. */
  fn: string;
  perIp: RateLimitRule;
  /** Omitted where a function has no share token, e.g. capture-screenshot. */
  perToken?: RateLimitRule;
}

/**
 * The limits each public function runs with.
 *
 * Read endpoints are generous — a review page issues several on load. Writes
 * are tighter, and the two that cost real resources per call (an external
 * fetch, a browserless render) are tighter still.
 *
 * Per-token allowances are higher than per-IP because a single review link is
 * expected to be opened by a whole team at once.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Reads — cheap, and several fire per page load.
  "get-public-canvas": {
    fn: "get-public-canvas",
    perIp: { limit: 120, windowSeconds: 60 },
    perToken: { limit: 600, windowSeconds: 60 },
  },
  "get-public-canvas-comments": {
    fn: "get-public-canvas-comments",
    perIp: { limit: 120, windowSeconds: 60 },
    perToken: { limit: 600, windowSeconds: 60 },
  },
  "get-public-feedback-thread": {
    fn: "get-public-feedback-thread",
    perIp: { limit: 120, windowSeconds: 60 },
    perToken: { limit: 600, windowSeconds: 60 },
  },

  // Writes — a person cannot type this fast; a script can.
  "submit-guest-feedback": {
    fn: "submit-guest-feedback",
    perIp: { limit: 20, windowSeconds: 60 },
    perToken: { limit: 100, windowSeconds: 60 },
  },
  "submit-guest-reply": {
    fn: "submit-guest-reply",
    perIp: { limit: 20, windowSeconds: 60 },
    perToken: { limit: 100, windowSeconds: 60 },
  },
  "guest-feedback-mutate": {
    fn: "guest-feedback-mutate",
    perIp: { limit: 30, windowSeconds: 60 },
    perToken: { limit: 150, windowSeconds: 60 },
  },
  "submit-review-decision": {
    fn: "submit-review-decision",
    perIp: { limit: 10, windowSeconds: 60 },
    perToken: { limit: 30, windowSeconds: 60 },
  },

  // Expensive — each call pulls a whole external page through the function.
  "proxy-website": {
    fn: "proxy-website",
    perIp: { limit: 60, windowSeconds: 60 },
    perToken: { limit: 240, windowSeconds: 60 },
  },
  // Expensive and metered: every call is a paid browserless render. No share
  // token reaches this one — it is gated on the service key — so IP only.
  "capture-screenshot": {
    fn: "capture-screenshot",
    perIp: { limit: 10, windowSeconds: 60 },
  },
};

/**
 * The caller's address.
 *
 * Supabase sits behind Cloudflare, which sets `cf-connecting-ip` to the real
 * peer and appends it to `x-forwarded-for`. Both are client-supplied in
 * principle, so the *last* entry of `x-forwarded-for` is the one the trusted
 * proxy added — reading the first would let a caller reset their own counter
 * on every request by sending `X-Forwarded-For: <anything>`.
 */
export function clientIp(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip")?.trim();
  if (direct) return direct;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  // Without an address every anonymous caller shares one bucket. That is
  // deliberately strict rather than unlimited.
  return "unknown";
}

/** Keeps a bucket key bounded, and free of anything that could forge a key. */
function keyPart(value: string, max = 100): string {
  return value.replace(/[^\w.-]/g, "_").slice(0, max);
}

export function bucketKey(scope: "ip" | "token", identifier: string, fn: string): string {
  return `${scope}:${keyPart(identifier)}:${keyPart(fn, 60)}`;
}

/** Builds the 429 a blocked caller receives. */
export function tooManyRequests(
  retryAfter: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Wait a moment and try again.",
      retry_after: retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
