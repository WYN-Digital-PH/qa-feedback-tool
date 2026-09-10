/**
 * How many screenshots may be captured, and against what.
 *
 * Kept apart from the edge function so the numbers and the threshold maths can
 * be unit-tested from the app's Node toolchain — nothing here imports
 * supabase-js or touches a Deno global.
 *
 * Rate limiting bounds how *fast* captures can be asked for; this bounds how
 * *many* there are in total. Both are needed: a slow loop running for a week
 * never trips a per-minute limit but still spends real money at browserless.
 */

/** Fallbacks. Both are overridable per environment — see `resolveCaps`. */
export const DEFAULT_CANVAS_CAP = 500;
export const DEFAULT_MONTHLY_CAP = 5000;

/** The fraction of a cap at which owners and admins are told. */
export const WARN_AT = 0.8;

export interface Caps {
  canvas: number;
  monthly: number;
}

/**
 * Reads the caps from the environment, falling back to the defaults.
 *
 * A nonsensical value (unset, non-numeric, zero, negative) falls back rather
 * than being honoured: `SCREENSHOT_CANVAS_CAP=0` almost certainly means
 * "misconfigured", and reading it literally would silently switch captures off
 * everywhere.
 */
export function resolveCaps(env: Record<string, string | undefined>): Caps {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    canvas: read("SCREENSHOT_CANVAS_CAP", DEFAULT_CANVAS_CAP),
    monthly: read("SCREENSHOT_MONTHLY_CAP", DEFAULT_MONTHLY_CAP),
  };
}

/** What `screenshot_quota_consume` answers with. */
export interface QuotaVerdict {
  allowed: boolean;
  reason: "canvas_cap" | "monthly_cap" | null;
  canvas_used: number;
  canvas_limit: number;
  month_used: number;
  month_limit: number;
  warned: boolean;
}

/**
 * Whether a count has reached the notice threshold.
 *
 * Exported so the same arithmetic the database uses can be checked directly:
 * `CEIL(limit * 0.8)`, so 80% of 10 is 8 and 80% of 101 is 81 — a cap is never
 * announced later than four fifths of the way through.
 */
export function warnThreshold(limit: number): number {
  return Math.ceil(limit * WARN_AT);
}

export function atWarnThreshold(used: number, limit: number): boolean {
  return limit > 0 && used >= warnThreshold(limit);
}

/** The line written when a capture is refused, for the log and the stored error. */
export function describeSkip(v: QuotaVerdict): string {
  return v.reason === "canvas_cap"
    ? `Screenshot cap reached for this canvas (${v.canvas_used}/${v.canvas_limit}).`
    : `Monthly screenshot cap reached for the workspace (${v.month_used}/${v.month_limit}).`;
}
