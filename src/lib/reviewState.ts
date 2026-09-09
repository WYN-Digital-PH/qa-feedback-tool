/**
 * Whether a share link still opens onto a live review.
 *
 * A paused, signed-off or archived canvas used to serve the entire review
 * canvas with commenting quietly switched off. The reviewer got the site or
 * the artwork, a comment button that looked usable, and no indication that the
 * review was over — they found out by placing a pin and being refused. Worse,
 * the payload still carried `website_url`/`staging_url`, so a closed review
 * kept handing out the staging address to anyone holding an old link.
 *
 * Anything other than `active` now stops at a page that says which of those
 * happened, and `get-public-canvas` withholds the content fields for it.
 *
 * Deleting a canvas is a hard delete (`ProjectDetail.tsx` removes the row), so
 * a deleted review has no status to report — the share token simply stops
 * resolving and `REVIEW_UNAVAILABLE_COPY` covers it.
 */

/** The canvas statuses, as the `canvas_status` enum defines them. */
export type ReviewState = "open" | "paused" | "completed" | "archived";

/** Maps a `canvas_status` to what the share link should do. */
export function reviewStateFor(status: string | null | undefined): ReviewState {
  switch (status) {
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "archived":
      return "archived";
    // `active`, and anything a later migration adds, keeps the review open;
    // the edge function is the one that decides what guests may actually do.
    default:
      return "open";
  }
}

export interface ReviewClosedCopy {
  title: string;
  description: string;
  /** Whether the review is expected to reopen — paused is the only one that is. */
  reopens: boolean;
}

/**
 * What the reviewer reads. Each one names the actual state rather than a
 * generic "unavailable", so the reader knows whether to wait or to stop.
 */
export const REVIEW_CLOSED_COPY: Record<Exclude<ReviewState, "open">, ReviewClosedCopy> = {
  paused: {
    title: "This review is paused",
    description:
      "The team has paused feedback for now. Any comments you already left are saved, and this link will start working again when the review reopens.",
    reopens: true,
  },
  completed: {
    title: "This review is closed",
    description:
      "Feedback has been signed off, so this review is no longer open for comments. Thanks for taking the time to look through it.",
    reopens: false,
  },
  archived: {
    title: "This review has been archived",
    description:
      "This review has been filed away and is no longer open for comments. Everything that was left on it was saved with it.",
    reopens: false,
  },
};

/** Shown when the share token resolves to nothing — a deleted or mistyped link. */
export const REVIEW_UNAVAILABLE_COPY = {
  title: "This review link isn't available",
  description:
    "The review may have been deleted, or the link may be incomplete. Ask whoever shared it with you for a current link.",
};
