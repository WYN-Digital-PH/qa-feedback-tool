#!/usr/bin/env node
/**
 * Proves the rate limit actually limits.
 *
 * The unit tests in src/test/rateLimit.test.ts cover everything that can be
 * settled without a database: coverage of all nine public functions, guard
 * placement, and that a caller cannot choose their own bucket. None of that
 * proves the thing that matters — that the Nth request is allowed, the
 * (N+1)th is refused, and that two requests arriving together cannot both
 * slip through the same slot.
 *
 * This exercises the real `rate_limit_hit` in the real database, then
 * optionally the deployed HTTP endpoints.
 *
 *   node scripts/proveRateLimit.mjs            # counter only
 *   node scripts/proveRateLimit.mjs --http     # counter + live endpoints
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 * Every bucket it creates is namespaced `proof-<runid>` and deleted at the end.
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WITH_HTTP = process.argv.includes("--http");

if (!URL_BASE || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const RUN = `proof-${Date.now().toString(36)}`;
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/** One call to the limiter. Returns the row it produced. */
async function hit(bucket, limit, windowSeconds) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/rate_limit_hit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _bucket: bucket, _limit: limit, _window_seconds: windowSeconds }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`rate_limit_hit failed (${res.status}): ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body[0] : body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  await fetch(`${URL_BASE}/rest/v1/rate_limits?bucket=like.${RUN}*`, {
    method: "DELETE",
    headers,
  });
}

// ---------------------------------------------------------------------------

async function proveCounter() {
  console.log("\n=== the counter ===");

  // 1. The limit is exact: N through, N+1 refused.
  {
    const bucket = `${RUN}:exact`;
    const LIMIT = 5;
    const verdicts = [];
    for (let i = 1; i <= LIMIT + 3; i++) verdicts.push((await hit(bucket, LIMIT, 60)).allowed);

    const allowed = verdicts.filter(Boolean).length;
    check("allows exactly the limit", allowed === LIMIT, `${allowed} of ${verdicts.length} allowed`);
    check(
      "refuses from the very next request",
      verdicts.slice(0, LIMIT).every(Boolean) && verdicts.slice(LIMIT).every((v) => !v),
      verdicts.map((v) => (v ? "y" : "n")).join(""),
    );
  }

  // 2. Buckets do not bleed into each other.
  {
    const LIMIT = 3;
    for (let i = 0; i < LIMIT; i++) await hit(`${RUN}:iso-a`, LIMIT, 60);
    const a = await hit(`${RUN}:iso-a`, LIMIT, 60);
    const b = await hit(`${RUN}:iso-b`, LIMIT, 60);
    check("an exhausted bucket is blocked", a.allowed === false);
    check("a different bucket is unaffected", b.allowed === true, `hits=${b.hits}`);
  }

  // 3. The window really does reset.
  {
    const bucket = `${RUN}:window`;
    const LIMIT = 2;
    await hit(bucket, LIMIT, 2);
    await hit(bucket, LIMIT, 2);
    const over = await hit(bucket, LIMIT, 2);
    check("blocked while the window is open", over.allowed === false, `retry_after=${over.retry_after}s`);
    check("retry_after is inside the window", over.retry_after >= 1 && over.retry_after <= 2);

    await sleep(2600);
    const after = await hit(bucket, LIMIT, 2);
    check("allowed again once the window passes", after.allowed === true, `hits reset to ${after.hits}`);
  }

  // 4. Concurrency: the check has to be atomic, or a burst walks straight
  //    through it. This is the case an in-process counter cannot get right.
  {
    const bucket = `${RUN}:race`;
    const LIMIT = 20;
    const BURST = 60;
    const results = await Promise.all(
      Array.from({ length: BURST }, () => hit(bucket, LIMIT, 60)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    check(
      "a concurrent burst gets exactly the limit through",
      allowed === LIMIT,
      `${allowed} of ${BURST} allowed, expected ${LIMIT}`,
    );

    const counted = Math.max(...results.map((r) => r.hits));
    check("every request in the burst was counted", counted === BURST, `highest hits=${counted}`);
  }
}

// ---------------------------------------------------------------------------

async function proveHttp() {
  console.log("\n=== the deployed endpoints ===");

  // A read endpoint with a low enough limit to reach quickly. Uses a bogus
  // share token: the limiter runs before the token is looked up, so this
  // proves the limit without touching real data.
  const fn = "submit-review-decision"; // perIp 10/min — the tightest write
  const url = `${URL_BASE}/functions/v1/${fn}`;

  const statuses = [];
  for (let i = 0; i < 16; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        share_token: `${RUN}-not-a-real-token`,
        decision: "approved",
      }),
    });
    statuses.push(res.status);
    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      const body = await res.json().catch(() => ({}));
      check("a 429 carries Retry-After", !!retry, `Retry-After: ${retry}`);
      check("a 429 names itself", body.error === "rate_limited", JSON.stringify(body));
      break;
    }
  }

  const blocked = statuses.filter((s) => s === 429).length;
  check(
    `${fn} starts refusing within its limit`,
    blocked > 0,
    `statuses: ${statuses.join(",")}`,
  );
  check(
    "requests before the limit were not refused",
    statuses.indexOf(429) === -1 || statuses.indexOf(429) >= 10,
    `first 429 at request ${statuses.indexOf(429) + 1}`,
  );
}

// ---------------------------------------------------------------------------

(async () => {
  console.log(`Rate-limit proof — run id ${RUN}`);
  try {
    await proveCounter();
    if (WITH_HTTP) await proveHttp();
    else console.log("\n(skipping live endpoints; pass --http to include them)");
  } catch (e) {
    failed++;
    console.error("\nHARNESS ERROR:", e.message);
  } finally {
    await cleanup().catch(() => {});
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
