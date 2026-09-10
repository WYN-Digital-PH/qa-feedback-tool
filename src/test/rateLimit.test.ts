// @vitest-environment node
/**
 * Rate limiting for the nine public edge functions.
 *
 * The behaviour that actually bounds traffic lives in `rate_limit_hit` in
 * Postgres — `scripts/proveRateLimit.mjs` exercises that against a real
 * database, because a fixed-window counter is only as good as its atomicity
 * and nothing here can prove that.
 *
 * What is asserted here is everything a test can settle without a database:
 * that every public function is covered, that the guard runs before the work,
 * and that the bucket a request is counted against cannot be chosen by the
 * caller.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  RATE_LIMITS,
  bucketKey,
  clientIp,
} from "../../supabase/functions/_shared/rateLimitRules";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** The nine functions declared `verify_jwt = false` in supabase/config.toml. */
function publicFunctions(): string[] {
  const config = read("supabase/config.toml");
  const names: string[] = [];
  const re = /\[functions\.([a-z0-9-]+)\]\s*\r?\n\s*verify_jwt\s*=\s*false/gi;
  for (const m of config.matchAll(re)) names.push(m[1]);
  return names.sort();
}

describe("every public function is covered", () => {
  const fns = publicFunctions();

  it("finds the nine public functions", () => {
    // If this regex ever matches nothing, every case below passes vacuously.
    expect(fns).toHaveLength(9);
  });

  it.each(publicFunctions())("%s has a limit configured", (fn) => {
    expect(RATE_LIMITS[fn], `${fn} has no entry in RATE_LIMITS`).toBeDefined();
    expect(RATE_LIMITS[fn].perIp.limit).toBeGreaterThan(0);
    expect(RATE_LIMITS[fn].perIp.windowSeconds).toBeGreaterThan(0);
  });

  it.each(publicFunctions())("%s calls the guard before doing work", (fn) => {
    const src = read(`supabase/functions/${fn}/index.ts`);
    expect(src).toContain('from "../_shared/rateLimit.ts"');

    const body = src.slice(src.indexOf("Deno.serve"));
    const guard = body.indexOf("await enforceRateLimit");
    expect(guard, `${fn} never calls enforceRateLimit`).toBeGreaterThan(-1);

    // The first query or outbound fetch must come after the guard, or the
    // limit costs nothing it was meant to save.
    const work = body.search(/await\s+(admin|supabase)\s*[\r\n\s]*\.|await\s+fetchGuarded|\.from\(/);
    if (work > -1) expect(guard, `${fn} does work before the guard`).toBeLessThan(work);
  });

  it("limits every function it claims to, and nothing it does not", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toEqual(fns);
  });

  it("keeps writes tighter than reads", () => {
    // A read fires several times per page load; a write should not.
    expect(RATE_LIMITS["submit-guest-feedback"].perIp.limit)
      .toBeLessThan(RATE_LIMITS["get-public-canvas"].perIp.limit);
    // The two that cost money or pull a whole external page are tighter still.
    expect(RATE_LIMITS["capture-screenshot"].perIp.limit).toBeLessThanOrEqual(10);
  });

  it("allows a shared link more than a single address", () => {
    // One review link is expected to be opened by a whole team at once.
    for (const cfg of Object.values(RATE_LIMITS)) {
      if (!cfg.perToken) continue;
      expect(cfg.perToken.limit, `${cfg.fn}`).toBeGreaterThan(cfg.perIp.limit);
    }
  });

  it("limits capture-screenshot by address only", () => {
    // It takes no share token — it is gated on the service key instead.
    expect(RATE_LIMITS["capture-screenshot"].perToken).toBeUndefined();
    expect(read("supabase/functions/capture-screenshot/index.ts")).not.toContain("shareToken");
  });
});

describe("the caller cannot choose their own bucket", () => {
  const withHeaders = (h: Record<string, string>) =>
    new Request("https://example.test/", { headers: h });

  it("prefers the address the trusted proxy reports", () => {
    expect(clientIp(withHeaders({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "1.1.1.1",
    }))).toBe("203.0.113.7");
  });

  /**
   * `x-forwarded-for` is appended to by each hop, so the entry the trusted
   * proxy added is the LAST one. Reading the first would let a caller reset
   * their own counter on every request by sending a header of their own.
   */
  it("takes the last forwarded hop, not the spoofable first", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })))
      .toBe("203.0.113.7");

    const spoofed = clientIp(withHeaders({ "x-forwarded-for": "evil-made-up, 203.0.113.7" }));
    expect(spoofed).toBe("203.0.113.7");
  });

  it("falls back to one shared bucket rather than to no limit", () => {
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });

  it("cannot be broken out of with separators in the identifier", () => {
    // A token of "a:b" must not be able to masquerade as another bucket.
    const forged = bucketKey("token", "x:ip:203.0.113.7", "proxy-website");
    expect(forged).toBe("token:x_ip_203.0.113.7:proxy-website");
    expect(forged.startsWith("token:")).toBe(true);
  });

  it("keeps buckets apart by scope and by function", () => {
    const ip = "203.0.113.7";
    expect(bucketKey("ip", ip, "proxy-website")).not.toBe(bucketKey("token", ip, "proxy-website"));
    expect(bucketKey("ip", ip, "proxy-website")).not.toBe(bucketKey("ip", ip, "get-public-canvas"));
  });

  it("bounds an identifier a caller controls", () => {
    expect(bucketKey("token", "z".repeat(5000), "proxy-website").length).toBeLessThan(200);
  });
});

describe("the counter is shared, not per-isolate", () => {
  const shared = read("supabase/functions/_shared/rateLimit.ts");

  it("counts in Postgres", () => {
    // An in-process Map resets on every cold start and sees only its own
    // slice of the traffic, which is no limit at all.
    expect(shared).toContain('rpc("rate_limit_hit"');
    expect(shared).not.toMatch(/new Map\(\)|globalThis\.__rate/);
  });

  it("counts both buckets even when the first one blocks", () => {
    // Otherwise a token's count stalls whenever one of its addresses is
    // already blocked, and the token limit never bites.
    expect(shared).toContain("Promise.all(");
  });

  it("does not take the service down when its own storage fails", () => {
    expect(shared).toContain("[rate-limit] check failed, allowing");
  });

  it("tells a blocked caller when to come back", () => {
    const rules = read("supabase/functions/_shared/rateLimitRules.ts");
    expect(rules).toContain('"Retry-After"');
    expect(rules).toContain("status: 429");
  });
});

describe("the documented limits are the real ones", () => {
  /**
   * A table in DEPLOYMENT.md that has drifted from RATE_LIMITS is worse than
   * no table: someone sizing a client's traffic against it would be planning
   * on numbers the service does not use.
   */
  const doc = read("docs/DEPLOYMENT.md");

  it.each(Object.values(RATE_LIMITS))("$fn is documented with its real limits", (cfg) => {
    const row = doc.split(/\r?\n/).find((l) => l.startsWith(`| \`${cfg.fn}\``));
    expect(row, `${cfg.fn} is missing from the DEPLOYMENT.md table`).toBeDefined();

    const [, , ip, token] = row!.split("|").map((c) => c.trim());
    expect(ip, `${cfg.fn} per-IP limit`).toBe(String(cfg.perIp.limit));
    expect(token, `${cfg.fn} per-token limit`).toBe(
      cfg.perToken ? String(cfg.perToken.limit) : "—",
    );
  });

  it("documents that the counter is shared and fails open", () => {
    // Both are operational surprises if undocumented: an operator needs to
    // know a database outage means no limiting rather than no service.
    expect(doc).toMatch(/counter is in Postgres/i);
    expect(doc).toMatch(/fails open/i);
  });
});
