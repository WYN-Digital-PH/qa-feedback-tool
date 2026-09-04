/**
 * Finishing a public review.
 *
 * The dialog shows the reviewer what they said before asking what it adds up
 * to, and starts on the option their own comments imply. Two things make that
 * fragile enough to guard: the comment list the page already holds is not the
 * right source, and the default has to stop moving once the reviewer picks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultReviewDecision } from "@/lib/reviewDecision";
import { UUID_RE, randomUuid, readOrCreateGuestToken } from "@/lib/guestToken";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const PAGE = read("src/pages/PublicReview.tsx");
const FN = read("supabase/functions/get-public-canvas-comments/index.ts");
const HISTORY = read("src/components/canvas/ApprovalHistory.tsx");
const CLOSE_MIGRATION = read("supabase/migrations/20260901120000_close_change_request_rounds.sql");

describe("the default decision", () => {
  it("is request changes when the reviewer raised anything", () => {
    expect(defaultReviewDecision(1)).toBe("changes_requested");
    expect(defaultReviewDecision(12)).toBe("changes_requested");
  });

  it("is approve when they raised nothing", () => {
    expect(defaultReviewDecision(0)).toBe("approved");
  });
});

describe("the finish dialog", () => {
  it("applies the default only until the reviewer picks for themselves", () => {
    // The comments load asynchronously; choosing Approve while they are still
    // arriving has to stick, so the flag is a ref rather than state — reading
    // state here would give the value captured when the handler was created.
    expect(PAGE).toContain("decisionTouchedRef");
    expect(PAGE).toMatch(/if \(!decisionTouchedRef\.current\) setDecision\(defaultReviewDecision\(/);
    expect(PAGE).toMatch(/function chooseDecision[\s\S]{0,120}decisionTouchedRef\.current = true/);
  });

  it("resets that flag each time the dialog opens", () => {
    expect(PAGE).toMatch(/setFinishOpen\(true\);\s*\n\s*decisionTouchedRef\.current = false;/);
  });

  it("never wires a decision button straight to setDecision", () => {
    // That would bypass the flag and let a later fetch overwrite the choice.
    expect(PAGE).not.toMatch(/onClick=\{\(\) => setDecision\(/);
  });

  it("fetches the reviewer's own comments rather than reusing the page list", () => {
    // `comments` is empty when the canvas hides other guests' feedback, and is
    // scoped to the current page; the overview needs the whole canvas.
    expect(PAGE).toMatch(/async function openFinish/);
    expect(PAGE).toMatch(/get-public-canvas-comments\?\$\{qs\.toString\(\)\}/);
    expect(PAGE).toMatch(/\.filter\(\(c\b[^)]*\) => c\.mine\)/);
  });

  it("still lets the review be finished if that fetch fails", () => {
    expect(PAGE).toMatch(/catch \{[\s\S]{0,200}setMyComments\(\[\]\)/);
  });

  it("warns when approving with comments outstanding", () => {
    expect(PAGE).toMatch(/myComments\.length > 0 && decision === "approved"/);
  });
});

describe("the guest token", () => {
  /**
   * The whole ownership model rests on this being a UUID. It used to fall back
   * to `${Date.now()}-${Math.random()}...`, which no endpoint would accept: the
   * token was stored as NULL and the reviewer lost sight of their own comments.
   */
  it("is a UUID even where crypto.randomUUID does not exist", () => {
    const real = globalThis.crypto;
    try {
      // A plain-http origin: getRandomValues survives, randomUUID does not.
      Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues: real.getRandomValues.bind(real) },
        configurable: true,
      });
      expect(globalThis.crypto.randomUUID).toBeUndefined();
      for (let i = 0; i < 50; i++) expect(randomUuid()).toMatch(UUID_RE);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });

  it("is a UUID with no crypto at all", () => {
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      for (let i = 0; i < 50; i++) expect(randomUuid()).toMatch(UUID_RE);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });

  it("mints one per canvas and then keeps it", () => {
    const first = readOrCreateGuestToken("share-abc");
    expect(first).toMatch(UUID_RE);
    expect(readOrCreateGuestToken("share-abc")).toBe(first);
    expect(readOrCreateGuestToken("share-xyz")).not.toBe(first);
  });

  it("replaces a stored token that is not a UUID", () => {
    // Left behind by the old fallback; keeping it would go on costing the
    // reviewer their pins on every future visit.
    localStorage.setItem("phlash_guest_token_share-legacy", "1756704000000-k3j4h5-9d8f7g");
    const t = readOrCreateGuestToken("share-legacy");
    expect(t).toMatch(UUID_RE);
    expect(localStorage.getItem("phlash_guest_token_share-legacy")).toBe(t);
  });
});

describe("closing a round of requested changes", () => {
  /**
   * `review_decisions` was append-only and the canvas card rendered every row,
   * so "changes requested" was permanent: resolving every comment the reviewer
   * raised left the warning exactly where it was, with nothing anywhere in the
   * product able to clear it.
   */
  it("gives a decision somewhere to record that it was dealt with", () => {
    expect(CLOSE_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS addressed_at TIMESTAMPTZ/);
    expect(CLOSE_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS addressed_by UUID/);
  });

  it("keeps what the reviewer said immutable", () => {
    // Acknowledging a round must not become a way to rewrite the client's
    // verdict, so the record itself is frozen against UPDATE by a trigger.
    expect(CLOSE_MIGRATION).toMatch(/NEW\.decision\s+IS DISTINCT FROM OLD\.decision/);
    expect(CLOSE_MIGRATION).toMatch(/NEW\.message\s+IS DISTINCT FROM OLD\.message/);
    expect(CLOSE_MIGRATION).toMatch(/RAISE EXCEPTION/);
    expect(CLOSE_MIGRATION).toMatch(/CREATE TRIGGER review_decisions_freeze_record/);
  });

  it("stamps who closed it and when on the server", () => {
    // Otherwise a client could backdate a round or credit somebody else.
    expect(CLOSE_MIGRATION).toMatch(/NEW\.addressed_at := now\(\)/);
    expect(CLOSE_MIGRATION).toMatch(/NEW\.addressed_by := COALESCE\(auth\.uid\(\)/);
  });

  it("lets only a role that can sign off a fix close a round", () => {
    expect(CLOSE_MIGRATION).toMatch(
      /CREATE POLICY "close change requests"[\s\S]{0,300}has_permission\(auth\.uid\(\), 'feedback\.resolve'\)/,
    );
  });

  it("reopening a round drops the attribution with it", () => {
    expect(CLOSE_MIGRATION).toMatch(/IF NEW\.addressed_at IS NULL THEN[\s\S]{0,160}addressed_by\s+:= NULL/);
  });

  it("will not let an already-closed round have its stamp moved", () => {
    // Otherwise re-sending a different timestamp would rewrite it, and the
    // server-side stamp would be worth no more than a client-supplied one.
    expect(CLOSE_MIGRATION).toMatch(/ELSE[\s\S]{0,220}NEW\.addressed_at := OLD\.addressed_at/);
  });
});

describe("the canvas approval summary", () => {
  it("treats only unaddressed change requests as outstanding", () => {
    expect(HISTORY).toMatch(/d\.decision === "changes_requested" && !d\.addressed_at/);
  });

  it("offers the close action only to a role allowed to sign off", () => {
    expect(HISTORY).toMatch(/can\("feedback\.resolve"\)/);
  });

  it("treats a blocked update as a refusal rather than a success", () => {
    // RLS reports one as zero rows, not an error, so checking `error` alone
    // would report closing a round the caller was never allowed to close.
    expect(HISTORY).toMatch(/if \(error \|\| !data\?\.length\)/);
  });

  it("still keeps the decision log reachable under the summary", () => {
    // The point is to stop the log doubling as a status, not to lose history.
    expect(HISTORY).toContain("Approval history");
  });

  it("starts with the log closed so cards keep a uniform height", () => {
    // A canvas on its sixth round would otherwise stand several times taller
    // than the ones either side of it.
    expect(HISTORY).toMatch(/const \[historyOpen, setHistoryOpen\] = useState\(false\)/);
    expect(HISTORY).toMatch(/hidden=\{!historyOpen\}/);
    expect(HISTORY).toMatch(/aria-expanded=\{historyOpen\}/);
  });

  it("bounds the log even once it is open", () => {
    expect(HISTORY).toMatch(/max-h-52 overflow-y-auto/);
  });
});

describe("the public comments endpoint", () => {
  it("returns a reviewer their own feedback even when other guests' is hidden", () => {
    expect(FN).toContain("const ownOnly = !canvas.allow_public_comment_view;");
    expect(FN).toMatch(/if \(ownOnly\) q = q\.eq\("guest_token", myToken\);/);
  });

  it("returns nothing when there is no token to scope it to", () => {
    // Otherwise turning the setting off would show every guest everything.
    expect(FN).toMatch(/if \(ownOnly && !myToken\) \{[\s\S]{0,200}comments: \[\]/);
  });

  it("only accepts a well-formed token", () => {
    expect(FN).toMatch(/const myToken = isUuid\(guestTokenParam\) \? guestTokenParam : null;/);
  });

  it("never sends the token back out", () => {
    // It is the only thing proving ownership of a pin.
    expect(FN).toMatch(/const \{ guest_token: _gt, \.\.\.rest \} = r;/);
    expect(FN).not.toMatch(/guest_token: r\.guest_token/);
  });
});
