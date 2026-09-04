/**
 * One account, one name, everywhere.
 *
 * The reported failure: `developer@wyndigital.io` on the dashboard, canvas
 * sidebar and board; `Team` in the feedback inbox; `Briggs Pedrera` on thread
 * replies and in the assignee picker — all the same person. Each surface had
 * its own fallback chain and they disagreed.
 *
 * The behavioural half is asserted against the resolver. The second half is
 * drift detection: no surface may grow its own chain again, because that is
 * exactly how this happened.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  commentAuthor,
  feedbackAuthor,
  makeNameResolver,
  personName,
  profileName,
} from "@/lib/displayName";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const DEV_ID = "4b6b3f1e-ca77-44da-b2e0-47d10afa0a9b";
const profiles = [{ id: DEV_ID, full_name: "Briggs Pedrera", email: "developer@wyndigital.io" }];
const resolve = makeNameResolver(profiles);

describe("the account that had three names", () => {
  /**
   * `submit-internal-feedback` stamps the author's email into `guest_name` at
   * write time, so every one of these rows carries the wrong label. The
   * account id is what makes them recoverable.
   */
  const teamFeedback = {
    created_by_type: "team",
    created_by_user_id: DEV_ID,
    guest_name: "developer@wyndigital.io",
  };

  it("reads as the person's name on a feedback item", () => {
    expect(feedbackAuthor(teamFeedback, resolve)).toBe("Briggs Pedrera");
  });

  it("reads as the person's name on a reply", () => {
    expect(commentAuthor({ user_id: DEV_ID, guest_name: null }, resolve)).toBe("Briggs Pedrera");
  });

  it("reads as the person's name in a picker", () => {
    expect(profileName(profiles[0])).toBe("Briggs Pedrera");
  });

  it("agrees across all of them", () => {
    const everywhere = new Set([
      feedbackAuthor(teamFeedback, resolve),
      commentAuthor({ user_id: DEV_ID }, resolve),
      commentAuthor({ user_id: null, profiles: profiles[0] }, resolve),
      profileName(profiles[0]),
      personName({ userId: DEV_ID }, resolve),
    ]);
    expect([...everywhere]).toEqual(["Briggs Pedrera"]);
  });

  it("prefers the current profile over the label frozen into the row", () => {
    // The point of resolving by id: renaming yourself in Settings takes effect
    // everywhere, rather than only on the surfaces that happened to join.
    const renamed = makeNameResolver([{ id: DEV_ID, full_name: "B. Pedrera", email: "developer@wyndigital.io" }]);
    expect(feedbackAuthor(teamFeedback, renamed)).toBe("B. Pedrera");
  });
});

describe("fallback order", () => {
  it("uses the email only when there is no full name", () => {
    expect(profileName({ id: "x", full_name: null, email: "a@b.test" })).toBe("a@b.test");
    expect(profileName({ id: "x", full_name: "  ", email: "a@b.test" })).toBe("a@b.test");
  });

  it("keeps a guest's own name", () => {
    expect(feedbackAuthor({ created_by_type: "guest", guest_name: "Briggs - CEO" }, resolve))
      .toBe("Briggs - CEO");
  });

  it("falls back to a guest's email when that is all they left", () => {
    expect(feedbackAuthor({ created_by_type: "guest", guest_email: "c@d.test" }, resolve))
      .toBe("c@d.test");
  });

  it("never calls an unresolvable teammate a guest", () => {
    // On a client-facing canvas the two are not interchangeable.
    expect(feedbackAuthor({ created_by_type: "team", created_by_user_id: "gone" }, resolve))
      .toBe("Team member");
    expect(feedbackAuthor({ created_by_type: "team" }, resolve)).toBe("Team member");
  });

  it("says Guest only when it really is one", () => {
    expect(feedbackAuthor({ created_by_type: "guest" }, resolve)).toBe("Guest");
    expect(feedbackAuthor(null, resolve)).toBe("Guest");
  });

  it("works with no resolver at all, as the public canvas has none", () => {
    expect(feedbackAuthor({ created_by_type: "guest", guest_name: "Ana" })).toBe("Ana");
  });
});

describe("no surface keeps its own fallback chain", () => {
  const surfaces = {
    "src/pages/Dashboard.tsx": "dashboard",
    "src/pages/Feedback.tsx": "feedback inbox",
    "src/pages/InternalCanvas.tsx": "canvas sidebar",
    "src/components/feedback/KanbanBoard.tsx": "board",
    "src/components/review/ReviewSidebar.tsx": "review sidebar",
    "src/components/settings/TeamMembers.tsx": "team settings",
  };

  for (const [file, label] of Object.entries(surfaces)) {
    it(`${label} does not hand-roll full_name || email`, () => {
      const src = read(file);
      expect(src, `${file} still composes its own display name`)
        .not.toMatch(/full_name\s*(\|\||\?\?)\s*\w*\.?email/);
    });
  }

  it("the inbox no longer labels a teammate simply Team", () => {
    expect(read("src/pages/Feedback.tsx")).not.toContain('"team" ? "Team"');
  });

  it("every surface that resolves a name imports the shared resolver", () => {
    // The board is presentational: it is handed an already-resolved name by
    // the page rather than reaching for profiles itself, which is why it is
    // the one file here that does not import the helper.
    const presentational = new Set(["src/components/feedback/KanbanBoard.tsx"]);
    for (const file of Object.keys(surfaces)) {
      if (presentational.has(file)) continue;
      expect(read(file), `${file} does not use src/lib/displayName`)
        .toContain('from "@/lib/displayName"');
    }
  });

  it("the board is given a resolved author rather than inventing one", () => {
    expect(read("src/components/feedback/KanbanBoard.tsx")).toContain("authorName");
    expect(read("src/pages/Feedback.tsx")).toContain("authorName={(it) => feedbackAuthor(it, resolveName)}");
  });
});
