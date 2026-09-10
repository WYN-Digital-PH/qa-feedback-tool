// @vitest-environment node
/**
 * Screenshot capture caps.
 *
 * Every capture is a paid browserless render, so the ceiling has to be checked
 * *before* the provider is called — a cap enforced after the render has cost
 * exactly as much as no cap at all.
 *
 * The counting itself is `screenshot_quota_consume` in Postgres;
 * `scripts/proveScreenshotCaps.mjs` exercises that against a real database.
 * What is settled here is the arithmetic, the configuration, and the ordering
 * inside the edge function.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_CANVAS_CAP,
  DEFAULT_MONTHLY_CAP,
  WARN_AT,
  atWarnThreshold,
  describeSkip,
  resolveCaps,
  warnThreshold,
  type QuotaVerdict,
} from "../../supabase/functions/_shared/screenshotCaps";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fn = () => read("supabase/functions/capture-screenshot/index.ts");
const sql = () => read("supabase/migrations/20260911130000_screenshot_capture_caps.sql");

describe("the cap is checked before the money is spent", () => {
  it("consumes quota before the browserless request is built", () => {
    const src = fn();
    const quota = src.indexOf("screenshot_quota_consume");
    const endpoint = src.indexOf("BROWSERLESS_BASE}/screenshot");
    const call = src.indexOf("await fetch(endpoint");

    expect(quota, "the quota check is missing").toBeGreaterThan(-1);
    expect(quota).toBeLessThan(endpoint);
    expect(endpoint).toBeLessThan(call);
  });

  it("checks both ceilings in a single call", () => {
    // Two calls would let a capture pass the canvas check, fail the monthly
    // one, and still have burnt a canvas slot.
    const src = fn();
    expect(src).toContain("_canvas_limit: caps.canvas");
    expect(src).toContain("_monthly_limit: caps.monthly");
    expect(src.match(/screenshot_quota_consume/g) ?? []).toHaveLength(1);
  });

  it("marks the item skipped and logs it when over cap", () => {
    const src = fn();
    expect(src).toContain('screenshot_status: "skipped"');
    expect(src).toContain("[capture-screenshot] over cap, skipping");
    // The stored error has to say which ceiling and where it stands.
    expect(src).toContain("describeSkip(quota)");
  });

  /**
   * Rate limiting fails open — allowing extra load beats an outage. A capture
   * cap must not: failing open there spends money, and a capture deferred is
   * recoverable in a way an unbounded bill is not.
   */
  it("refuses rather than renders when the quota cannot be checked", () => {
    const src = fn();
    const branch = src.slice(src.indexOf("if (quotaErr)"), src.indexOf("const quota ="));
    expect(branch).toContain('screenshot_status: "skipped"');
    expect(branch).toContain("quota_unavailable");
    expect(branch).not.toContain("continue");
  });
});

describe("the 80% notice", () => {
  it("fires at four fifths, rounded up", () => {
    expect(WARN_AT).toBe(0.8);
    expect(warnThreshold(10)).toBe(8);
    expect(warnThreshold(100)).toBe(80);
    // Rounding up means a cap is never announced later than 80% of the way.
    expect(warnThreshold(101)).toBe(81);
    expect(warnThreshold(3)).toBe(3);
  });

  it("is not reached before the threshold", () => {
    expect(atWarnThreshold(7, 10)).toBe(false);
    expect(atWarnThreshold(8, 10)).toBe(true);
    expect(atWarnThreshold(10, 10)).toBe(true);
  });

  it("uses the same arithmetic in the database", () => {
    // Drift between the two would make the tests here meaningless.
    expect(sql()).toContain("CEIL(_canvas_limit * 0.8)");
    expect(sql()).toContain("CEIL(_monthly_limit * 0.8)");
  });

  it("goes out once per counter, not on every capture past the line", () => {
    const s = sql();
    expect(s).toContain("warned_at");
    expect(s).toContain("c_warned IS NULL");
    expect(s).toContain("m_warned IS NULL");
  });

  it("reaches the people who can act on it", () => {
    expect(sql()).toMatch(/ur\.role IN \('owner', 'admin'\)/);
    expect(sql()).toContain("'screenshot_quota'");
  });
});

describe("a refused capture costs nothing", () => {
  it("does not consume on the blocked path", () => {
    // Otherwise a caller that keeps retrying pushes the number ever further
    // past the cap, and the notice fires on traffic that rendered nothing.
    const s = sql();
    const blocked = s.slice(s.indexOf("IF block_reason IS NOT NULL"), s.indexOf("UPDATE public.screenshot_usage"));
    expect(blocked).toContain("RETURN QUERY SELECT false");
    expect(blocked).not.toContain("used + 1");
  });

  it("locks both counters in a fixed order", () => {
    // Two captures arriving together must not both read "99 of 100"; a fixed
    // order is what stops two callers deadlocking on each other.
    const s = sql();
    expect(s.match(/FOR UPDATE/g) ?? []).toHaveLength(2);
    expect(s.indexOf("scope = 'canvas' AND key = _canvas_id::text\n  FOR UPDATE"))
      .toBeLessThan(s.indexOf("scope = 'month' AND key = month_key\n  FOR UPDATE"));
  });
});

describe("the caps themselves", () => {
  it("falls back to the defaults when unset", () => {
    expect(resolveCaps({})).toEqual({ canvas: DEFAULT_CANVAS_CAP, monthly: DEFAULT_MONTHLY_CAP });
  });

  it("takes an environment override", () => {
    expect(resolveCaps({ SCREENSHOT_CANVAS_CAP: "12", SCREENSHOT_MONTHLY_CAP: "34" }))
      .toEqual({ canvas: 12, monthly: 34 });
  });

  it.each([["0"], ["-5"], ["abc"], [""], ["1.5"]])(
    "ignores a nonsensical override (%s)",
    (bad) => {
      // Reading "0" literally would switch captures off everywhere, silently.
      expect(resolveCaps({ SCREENSHOT_CANVAS_CAP: bad }).canvas).toBe(DEFAULT_CANVAS_CAP);
    },
  );

  it("names the ceiling that was hit, and where it stands", () => {
    const base: QuotaVerdict = {
      allowed: false, reason: "canvas_cap",
      canvas_used: 500, canvas_limit: 500,
      month_used: 900, month_limit: 5000, warned: false,
    };
    expect(describeSkip(base)).toContain("500/500");
    expect(describeSkip(base)).toContain("canvas");
    expect(describeSkip({ ...base, reason: "monthly_cap" })).toContain("900/5000");
  });
});

describe("the documented caps are the real ones", () => {
  const doc = read("docs/DEPLOYMENT.md");

  const row = (label: string) =>
    doc.split(/\r?\n/).find((l) => l.startsWith(`| **${label}**`)) ?? "";

  it("documents the limits that the code actually uses", () => {
    // An operator sizing a month against the docs must not be reading numbers
    // the function does not use.
    expect(row("Per canvas")).toContain(String(DEFAULT_CANVAS_CAP));
    expect(row("Per month")).toContain(String(DEFAULT_MONTHLY_CAP));
  });

  it("documents the alert threshold the database computes", () => {
    // Stated as a number so nobody has to work it out — which is exactly why
    // it can drift when a cap changes.
    expect(row("Per canvas")).toContain(String(warnThreshold(DEFAULT_CANVAS_CAP)));
    expect(row("Per month")).toContain(String(warnThreshold(DEFAULT_MONTHLY_CAP)));
  });

  it("documents that raising a cap does not re-arm the alert", () => {
    // Verified against the database: once warned_at is stamped, a raised cap
    // passes its new threshold in silence. Silent is the dangerous part.
    expect(doc).toMatch(/Raising a cap does not re-arm the alert/i);
    expect(doc).toContain("set warned_at = null");
  });

  it("documents where the alert lands and who receives it", () => {
    expect(doc).toMatch(/every owner and admin/i);
    expect(doc).toContain("screenshot_quota");
    expect(doc).toMatch(/once per counter/i);
  });

  it("documents the override names the code reads", () => {
    expect(doc).toContain("SCREENSHOT_CANVAS_CAP");
    expect(doc).toContain("SCREENSHOT_MONTHLY_CAP");
  });

  it("documents the 80% threshold and that these fail closed", () => {
    // The asymmetry with rate limiting is the surprising part, so it has to be
    // written down rather than discovered during an incident.
    expect(doc).toMatch(/CEIL\(limit × 0\.8\)/);
    expect(doc).toMatch(/fail closed/i);
  });
});
