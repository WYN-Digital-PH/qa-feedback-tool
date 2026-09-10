#!/usr/bin/env node
/**
 * Proves the screenshot caps actually cap.
 *
 * src/test/screenshotCaps.test.ts settles the arithmetic and the ordering
 * inside the edge function. Neither proves the thing that matters: that the
 * Nth capture is allowed, the (N+1)th is refused without consuming anything,
 * and that a burst arriving together cannot all pass the same check.
 *
 *   node scripts/proveScreenshotCaps.mjs
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Care is taken to leave production untouched:
 *   - canvases are random UUIDs, never real ones, and their rows are deleted
 *   - the canvas tests pass an enormous monthly limit, so the shared monthly
 *     counter can neither block nor raise its 80% notice during the run
 *   - the monthly counter's value and warned_at are snapshotted and restored
 *   - the monthly-cap test blocks rather than consumes, so it changes nothing
 *   - any notification the run raises is deleted afterwards
 */

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

/** Big enough that the shared monthly counter can never bind during the run. */
const MONTH_NOOP = 1_000_000_000;

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

let passed = 0;
let failed = 0;
const startedAt = new Date().toISOString();
const canvases = [];

function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`); }
}

function newCanvas() {
  const id = crypto.randomUUID();
  canvases.push(id);
  return id;
}

async function rpc(name, args) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST", headers, body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${name} failed (${res.status}): ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body[0] : body;
}

const consume = (canvasId, canvasLimit, monthlyLimit = MONTH_NOOP) =>
  rpc("screenshot_quota_consume", {
    _canvas_id: canvasId, _canvas_limit: canvasLimit, _monthly_limit: monthlyLimit,
  });

async function usageRow(scope, key) {
  const res = await fetch(
    `${URL_BASE}/rest/v1/screenshot_usage?scope=eq.${scope}&key=eq.${encodeURIComponent(key)}&select=used,warned_at`,
    { headers },
  );
  const rows = await res.json();
  return rows[0] ?? { used: 0, warned_at: null };
}

const monthKey = () => new Date().toISOString().slice(0, 7);

// ---------------------------------------------------------------------------

async function run() {
  const month = monthKey();
  const before = await usageRow("month", month);
  console.log(`Screenshot cap proof — month ${month}, currently ${before.used} used\n`);

  // 1. The canvas cap is exact.
  {
    console.log("=== the canvas ceiling ===");
    const canvas = newCanvas();
    const LIMIT = 5;
    const verdicts = [];
    for (let i = 0; i < LIMIT + 3; i++) verdicts.push(await consume(canvas, LIMIT));

    const allowed = verdicts.filter((v) => v.allowed).length;
    check("allows exactly the cap", allowed === LIMIT, `${allowed} of ${verdicts.length}`);
    check(
      "refuses from the very next capture",
      verdicts.slice(0, LIMIT).every((v) => v.allowed) && verdicts.slice(LIMIT).every((v) => !v.allowed),
      verdicts.map((v) => (v.allowed ? "y" : "n")).join(""),
    );
    check("says which ceiling was hit", verdicts[LIMIT].reason === "canvas_cap", verdicts[LIMIT].reason);

    // A refused capture must not consume: otherwise retries push the number
    // ever further past the cap.
    const after = await usageRow("canvas", canvas);
    check("a refused capture consumes nothing", after.used === LIMIT, `used=${after.used}, expected ${LIMIT}`);
  }

  // 2. The 80% notice.
  {
    console.log("\n=== the 80% notice ===");
    const canvas = newCanvas();
    const LIMIT = 10; // threshold = 8
    const warned = [];
    for (let i = 1; i <= LIMIT; i++) warned.push((await consume(canvas, LIMIT)).warned);

    check("silent below the threshold", warned.slice(0, 7).every((w) => !w), warned.slice(0, 7).join(","));
    check("fires on the capture that crosses it", warned[7] === true, `capture 8 warned=${warned[7]}`);
    check("does not fire again after", warned.slice(8).every((w) => !w), warned.slice(8).join(","));

    const notes = await fetch(
      `${URL_BASE}/rest/v1/notifications?kind=eq.screenshot_quota&created_at=gte.${startedAt}&select=user_id,title,body`,
      { headers },
    ).then((r) => r.json());
    check("owners and admins were told", notes.length > 0, `${notes.length} notification(s)`);
    // The earlier block warned too (cap 5, threshold 4), so match on any of
    // them rather than assuming which arrived first.
    check(
      "the notice carries the numbers",
      notes.some((n) => /8 of its 10/.test(n.body ?? "")),
      notes.map((n) => n.body).join(" | "),
    );
  }

  // 3. The monthly ceiling. Setting the limit to what is already used blocks
  //    without consuming, so this proves the ceiling binds and changes nothing.
  {
    console.log("\n=== the monthly ceiling ===");
    const canvas = newCanvas();
    const now = await usageRow("month", month);
    const verdict = await consume(canvas, 1000, now.used);

    check("blocks when the month is spent", verdict.allowed === false, `used=${now.used}, limit=${now.used}`);
    check("says it was the monthly ceiling", verdict.reason === "monthly_cap", verdict.reason);

    const still = await usageRow("month", month);
    check("the blocked attempt consumed nothing", still.used === now.used, `${now.used} -> ${still.used}`);

    const canvasRow = await usageRow("canvas", canvas);
    check(
      "and burnt no canvas slot either",
      canvasRow.used === 0,
      `canvas used=${canvasRow.used}`,
    );
  }

  // 4. Which ceiling wins when both would block.
  {
    console.log("\n=== precedence ===");
    const canvas = newCanvas();
    await consume(canvas, 1);                       // canvas now full
    const now = await usageRow("month", month);
    const verdict = await consume(canvas, 1, now.used); // both would block
    check("the canvas ceiling is reported first", verdict.reason === "canvas_cap", verdict.reason);
  }

  // 5. Concurrency. This is the case an in-process counter cannot get right.
  {
    console.log("\n=== a simultaneous burst ===");
    const canvas = newCanvas();
    const LIMIT = 5;
    const BURST = 20;
    const results = await Promise.all(
      Array.from({ length: BURST }, () => consume(canvas, LIMIT)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    check(
      "exactly the cap gets through",
      allowed === LIMIT,
      `${allowed} of ${BURST} allowed, expected ${LIMIT}`,
    );
    const row = await usageRow("canvas", canvas);
    check("the counter matches what was allowed", row.used === LIMIT, `used=${row.used}`);
  }

  return before;
}

async function cleanup(before) {
  const month = monthKey();

  // Synthetic canvases.
  for (const id of canvases) {
    await fetch(`${URL_BASE}/rest/v1/screenshot_usage?scope=eq.canvas&key=eq.${id}`, {
      method: "DELETE", headers,
    });
  }

  // Put the shared monthly counter back exactly as it was.
  if (before) {
    await fetch(`${URL_BASE}/rest/v1/screenshot_usage?scope=eq.month&key=eq.${month}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ used: before.used, warned_at: before.warned_at }),
    });
    const now = await usageRow("month", month);
    check(
      "the shared monthly counter was restored",
      now.used === before.used,
      `${before.used} -> ${now.used}`,
    );
  }

  // Notifications this run raised.
  await fetch(
    `${URL_BASE}/rest/v1/notifications?kind=eq.screenshot_quota&created_at=gte.${startedAt}`,
    { method: "DELETE", headers },
  );
  const left = await fetch(
    `${URL_BASE}/rest/v1/notifications?kind=eq.screenshot_quota&created_at=gte.${startedAt}&select=id`,
    { headers },
  ).then((r) => r.json());
  check("test notifications were removed", left.length === 0, `${left.length} left`);
}

(async () => {
  let before = null;
  try {
    before = await run();
  } catch (e) {
    failed++;
    console.error("\nHARNESS ERROR:", e.message);
  } finally {
    console.log("\n=== cleanup ===");
    await cleanup(before).catch((e) => {
      failed++;
      console.error("  CLEANUP FAILED:", e.message);
    });
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
