// @vitest-environment node
/**
 * A share link for a canvas that is no longer active.
 *
 * Pausing, signing off or archiving a canvas used to leave the public link
 * fully functional apart from commenting: the reviewer got the site or the
 * artwork, the comment button, and a refusal only once they tried to use it.
 * The payload also still carried `website_url`/`staging_url`, so the staging
 * address stayed readable from any old link, and `proxy-website` — which
 * selected `status` but never read it — went on fetching and serving the site.
 *
 * Reads the wiring out of the source, in the manner of `ssrfGuard.test.ts`,
 * because the edge functions are Deno modules the suite cannot import.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REVIEW_CLOSED_COPY,
  REVIEW_UNAVAILABLE_COPY,
  reviewStateFor,
  type ReviewState,
} from "../lib/reviewState";

/** Every value of the `canvas_status` enum, as the migration declares it. */
const CANVAS_STATUSES = ["active", "paused", "completed", "archived"] as const;

describe("a share link reports the state its canvas is in", () => {
  it.each([
    ["active", "open"],
    ["paused", "paused"],
    ["completed", "completed"],
    ["archived", "archived"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(reviewStateFor(status)).toBe(expected);
  });

  /**
   * A status this build has not heard of must not close a live review; the
   * edge function stays the authority on what a guest may do.
   */
  it.each([[null], [undefined], [""], ["in_review"]])("leaves %s open", (status) => {
    expect(reviewStateFor(status as string | null)).toBe("open");
  });

  it("covers every status the enum can hold", () => {
    for (const status of CANVAS_STATUSES) {
      const state = reviewStateFor(status);
      if (state === "open") continue;
      expect(REVIEW_CLOSED_COPY[state]).toBeDefined();
    }
  });
});

describe("the closed page says which state it is in", () => {
  const closed = Object.entries(REVIEW_CLOSED_COPY) as [
    Exclude<ReviewState, "open">,
    (typeof REVIEW_CLOSED_COPY)[keyof typeof REVIEW_CLOSED_COPY],
  ][];

  it.each(closed)("%s has a title and a description", (_state, copy) => {
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.description.length).toBeGreaterThan(0);
  });

  /** "Unavailable" for all three would leave the reader unsure whether to wait. */
  it("gives each state its own wording", () => {
    const titles = closed.map(([, copy]) => copy.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("promises a return only for the one that comes back", () => {
    expect(REVIEW_CLOSED_COPY.paused.reopens).toBe(true);
    expect(REVIEW_CLOSED_COPY.completed.reopens).toBe(false);
    expect(REVIEW_CLOSED_COPY.archived.reopens).toBe(false);
  });

  /**
   * Deleting a canvas is a hard delete, so the token resolves to nothing and
   * there is no status to report — a separate message from the three above.
   */
  it("has separate wording for a link that resolves to nothing", () => {
    expect(REVIEW_UNAVAILABLE_COPY.title).not.toBe(REVIEW_CLOSED_COPY.completed.title);
    expect(REVIEW_UNAVAILABLE_COPY.description.length).toBeGreaterThan(0);
  });
});

describe("a closed review is closed on the server too", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("withholds the content fields once the review is not open", () => {
    const src = read("supabase/functions/get-public-canvas/index.ts");
    // The early return has to come before the payload that carries the URLs.
    const guard = src.indexOf('if (reviewState !== "open")');
    const payload = src.indexOf("website_url: canvas.website_url");
    expect(guard).toBeGreaterThan(-1);
    expect(payload).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(payload);

    const closedPayload = src.slice(guard, src.indexOf("}", src.indexOf("client_name", guard)));
    expect(closedPayload).not.toContain("website_url");
    expect(closedPayload).not.toContain("staging_url");
    expect(closedPayload).not.toContain("file_url");
  });

  it("tells the client which state the canvas is in", () => {
    expect(read("supabase/functions/get-public-canvas/index.ts")).toContain("review_state: reviewState");
  });

  it("stops the proxy serving a site whose review has closed", () => {
    const src = read("supabase/functions/proxy-website/index.ts");
    expect(src).toContain('if (canvas.status !== "active")');
    expect(src).toContain('error: "review_closed"');

    // The check has to land before the fetch, not merely somewhere in the file.
    expect(src.indexOf('canvas.status !== "active"')).toBeLessThan(src.indexOf("fetchGuarded(target"));
  });
});

describe("the public page stops before rendering a canvas", () => {
  const src = () => readFileSync("src/pages/PublicReview.tsx", "utf8");

  it("returns the closed page for anything that is not open", () => {
    expect(src()).toContain('if (reviewState !== "open")');
    expect(src()).toContain("REVIEW_CLOSED_COPY[reviewState]");
  });

  /** An older cached payload has no `review_state`; `status` still decides. */
  it("falls back to the status when the field is absent", () => {
    expect(src()).toContain("canvas.review_state ?? reviewStateFor(canvas.status)");
  });

  it("uses the shared wording for a link that resolves to nothing", () => {
    expect(src()).toContain("REVIEW_UNAVAILABLE_COPY.title");
  });
});
