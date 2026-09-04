/**
 * The guest review canvas.
 *
 * The finish-review flow — the dialog where a reviewer approved or requested
 * changes — was removed: it asked a client to summarise a judgement they had
 * already expressed comment by comment, and it complicated the one workflow
 * that has to stay simple. The tests for it went with it.
 *
 * What remains is what still carries the guest experience: the token that
 * proves ownership of a pin without a login, and the endpoint that decides
 * which comments a reviewer may see.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { UUID_RE, randomUuid, readOrCreateGuestToken } from "@/lib/guestToken";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const PAGE = read("src/pages/PublicReview.tsx");
const PROJECT = read("src/pages/ProjectDetail.tsx");
const FN = read("supabase/functions/get-public-canvas-comments/index.ts");

describe("the finish-review flow is gone", () => {
  it("leaves no button on the guest canvas", () => {
    expect(PAGE).not.toContain("Finish review");
    expect(PAGE).not.toContain("submit-review-decision");
  });

  it("leaves nothing of the dialog behind it", () => {
    // Dead state is how a removed feature comes back by accident.
    for (const symbol of ["finishOpen", "openFinish", "submitDecision", "decisionMsg", "myComments"]) {
      expect(PAGE, `${symbol} survived the removal`).not.toContain(symbol);
    }
  });

  it("takes the approval history off the project page with it", () => {
    expect(PROJECT).not.toContain("ApprovalHistory");
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
