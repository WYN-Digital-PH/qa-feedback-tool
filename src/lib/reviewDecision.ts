export type ReviewDecision = "approved" | "changes_requested";

/**
 * Which option the finish-review dialog should start on.
 *
 * A reviewer who raised something is asking for a change, not signing off —
 * starting on Approve invited them to contradict their own comments with one
 * click. This only moves the starting point; either option stays one click
 * away, and once they choose, the default stops moving (see
 * `decisionTouchedRef` in PublicReview).
 */
export function defaultReviewDecision(ownCommentCount: number): ReviewDecision {
  return ownCommentCount > 0 ? "changes_requested" : "approved";
}
