/**
 * Guards for the screenshot capture function.
 *
 * Source-level, because the edge functions have no test harness yet (Phase 1.2
 * of the development plan). These are the two properties whose absence was
 * expensive: a request with no timeout and no retry, and an error path that
 * wrote the provider's API token into a database column.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const FN = read("supabase/functions/capture-screenshot/index.ts");
const SCRUB = read("supabase/migrations/20260905140000_redact_leaked_screenshot_tokens.sql");
const PUBLIC_COMMENTS = read("supabase/functions/get-public-canvas-comments/index.ts");

describe("a capture attempt cannot hang", () => {
  it("aborts a request that stalls", () => {
    expect(FN).toContain("AbortController");
    expect(FN).toMatch(/signal: abort\.signal/);
    expect(FN).toMatch(/ATTEMPT_TIMEOUT_MS/);
  });

  it("retries, because a connect timeout is the most transient failure there is", () => {
    expect(FN).toMatch(/MAX_ATTEMPTS\s*=\s*\d+/);
    expect(FN).toMatch(/for \(let attempt = 1; attempt <= MAX_ATTEMPTS/);
    expect(FN).toContain("BACKOFF_MS");
  });

  it("does not retry a request that is simply wrong", () => {
    // Repeating a 4xx spends the invocation budget to be told the same thing.
    expect(FN).toMatch(/if \(!isRetryable\(res\.status\)\) break;/);
    expect(FN).toMatch(/status === 408 \|\| status === 429 \|\| status >= 500/);
  });

  it("keeps the worst case inside an edge function's budget", () => {
    const perAttempt = Number(FN.match(/ATTEMPT_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ""));
    const attempts = Number(FN.match(/MAX_ATTEMPTS = (\d+)/)![1]);
    const backoff = (FN.match(/BACKOFF_MS = \[([^\]]+)\]/)![1].match(/[\d_]+/g) ?? [])
      .reduce((a, b) => a + Number(b.replace(/_/g, "")), 0);
    expect(perAttempt * attempts + backoff).toBeLessThanOrEqual(150_000);
  });
});

describe("the provider token never leaves the function", () => {
  it("every path that records a failure redacts first", () => {
    // The exact leak: Deno puts the request URL, token and all, into the
    // message of a network error, and that was written to the database.
    const networkPath = FN.slice(FN.indexOf("catch (e)"), FN.indexOf("finally"));
    expect(networkPath).toMatch(/redact\(e, BROWSERLESS_KEY\)/);
    expect(FN).toMatch(/redact\(await res\.text\(\), BROWSERLESS_KEY\)/);
    expect(FN).toMatch(/redact\(upErr\.message, BROWSERLESS_KEY\)/);
  });

  it("never writes a raw exception into screenshot_error", () => {
    expect(FN).not.toMatch(/screenshot_error: `Network error: \$\{String\(e\)/);
    for (const m of FN.matchAll(/screenshot_error: `([^`]*)`/g)) {
      expect(m[1], `unredacted interpolation: ${m[1]}`).not.toMatch(/\$\{String\(e\)|\$\{e\}/);
    }
  });

  it("redacts a token even when it did not supply it", () => {
    // The regex half of the helper, applied to the shape from the real report.
    const pattern = FN.match(/text\.replace\(([\s\S]*?), "\$1\[redacted\]"\)/)![1];
    const re = new RegExp(pattern.trim().replace(/^\//, "").replace(/\/gi$/, ""), "gi");
    const sample =
      'error sending request for url (https://production-sfo.browserless.io/screenshot?token=abc123def)';
    const out = sample.replace(re, "$1[redacted]");
    expect(out).toContain("token=[redacted]");
    expect(out).not.toContain("abc123def");
  });

  it("was never exposed to a guest", () => {
    // Worth pinning: the blast radius of the leak depends on this staying true.
    expect(PUBLIC_COMMENTS).not.toContain("screenshot_error");
  });
});

describe("the rows written before the fix are cleaned up", () => {
  it("scrubs feedback_items.screenshot_error", () => {
    expect(SCRUB).toContain("UPDATE public.feedback_items");
    expect(SCRUB).toMatch(/regexp_replace\(\s*screenshot_error/);
    expect(SCRUB).toContain("[redacted]");
  });

  it("says plainly that the token still has to be rotated", () => {
    // A migration cannot reach the edge function logs.
    expect(SCRUB.toLowerCase()).toContain("rotated");
  });
});
