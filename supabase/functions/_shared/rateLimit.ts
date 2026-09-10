/**
 * Rate limiting for the public edge functions.
 *
 * Every function with `verify_jwt = false` is reachable by anyone with the
 * URL, so each one calls `enforceRateLimit` before it does any real work.
 *
 * Two buckets are counted per request:
 *
 *   ip:<address>:<function>     one caller cannot exhaust the service
 *   token:<share token>:<fn>    one leaked review link cannot either, however
 *                               many addresses it is used from
 *
 * Both are counted even when the first is already over, so the numbers stay
 * honest: a token's count must not stall just because one of the addresses
 * using it got blocked first.
 *
 * The counter is in Postgres (`rate_limit_hit`). Edge isolates are ephemeral
 * and concurrent, so an in-process Map would reset on every cold start and see
 * only its own slice of the traffic — no limit at all.
 *
 * The rules and the pure helpers live in `rateLimitRules.ts` so they can be
 * unit-tested outside Deno; this module is the part that needs a database.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  RATE_LIMITS,
  bucketKey,
  clientIp,
  tooManyRequests,
  type RateLimitConfig,
  type RateLimitRule,
} from "./rateLimitRules.ts";

export {
  RATE_LIMITS,
  bucketKey,
  clientIp,
  tooManyRequests,
  type RateLimitConfig,
  type RateLimitRule,
};

interface HitResult {
  allowed: boolean;
  hits: number;
  limit_value: number;
  retry_after: number;
}

/**
 * Counts this request and returns a 429 when it is over either limit.
 *
 * Returns null to mean "carry on". Call it before doing the work, and after
 * the share token is known.
 *
 * A failure to reach the database is not treated as a block: a limiter that
 * takes the whole service down when its own storage hiccups is worse than the
 * abuse it prevents. That choice is logged so it is visible rather than quiet.
 */
export async function enforceRateLimit(
  req: Request,
  opts: {
    fn: string;
    shareToken?: string | null;
    corsHeaders: Record<string, string>;
    /** Overrides the table; used by the proof harness. */
    config?: RateLimitConfig;
    client?: SupabaseClient;
  },
): Promise<Response | null> {
  const config = opts.config ?? RATE_LIMITS[opts.fn];
  if (!config) return null; // Unconfigured function: nothing to enforce.

  const admin = opts.client ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const checks: { bucket: string; rule: RateLimitRule }[] = [
    { bucket: bucketKey("ip", clientIp(req), config.fn), rule: config.perIp },
  ];
  if (config.perToken && opts.shareToken) {
    checks.push({ bucket: bucketKey("token", opts.shareToken, config.fn), rule: config.perToken });
  }

  const results = await Promise.all(
    checks.map(async ({ bucket, rule }) => {
      const { data, error } = await admin.rpc("rate_limit_hit", {
        _bucket: bucket,
        _limit: rule.limit,
        _window_seconds: rule.windowSeconds,
      });
      if (error) {
        console.error("[rate-limit] check failed, allowing", opts.fn, bucket, error.message);
        return null;
      }
      return (Array.isArray(data) ? data[0] : data) as HitResult | null;
    }),
  );

  const blocked = results.filter((r): r is HitResult => !!r && !r.allowed);
  if (blocked.length === 0) return null;

  const retryAfter = Math.max(...blocked.map((r) => r.retry_after || 1));
  console.warn("[rate-limit] blocked", opts.fn, "retry in", retryAfter);
  return tooManyRequests(retryAfter, opts.corsHeaders);
}
