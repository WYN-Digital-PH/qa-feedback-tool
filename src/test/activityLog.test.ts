/**
 * The activity timeline reads as an account of what happened, not as a dump of
 * what was stored.
 *
 * The three cases at the top are the real rows that prompted this — copied from
 * a live timeline, UUID and all.
 */
import { describe, expect, it } from "vitest";
import { describeActivity } from "@/lib/activityLog";

const NAMES: Record<string, string> = {
  "4b6b3f1e-ca77-44da-b2e0-47d10afa0a9b": "Briggs Pedrera",
};
const resolve = (id: string) => NAMES[id] ?? null;

describe("the rows that were unreadable", () => {
  it("names the assignee instead of printing their id", () => {
    const { summary } = describeActivity(
      "assigned_to_changed",
      { assigned_to: "4b6b3f1e-ca77-44da-b2e0-47d10afa0a9b" },
      resolve,
    );
    expect(summary).toBe("assigned it to Briggs Pedrera");
    expect(summary).not.toContain("4b6b3f1e");
  });

  it("says what a guest reply was", () => {
    expect(describeActivity("guest_reply_added", null, resolve).summary).toBe("replied");
  });

  it("puts the page on its own line rather than in a JSON blob", () => {
    const out = describeActivity(
      "feedback_submitted",
      { category: "general", page_url: "https://wyndigital.io/", priority: "normal" },
      resolve,
    );
    expect(out.summary).toBe("left this feedback");
    expect(out.detail).toBe("https://wyndigital.io/");
    // `general` and `normal` are the defaults — noise, not information.
    expect(out.detail).not.toContain("General");
    expect(out.detail).not.toContain("Normal");
  });

  it("mentions category and priority only when they are worth mentioning", () => {
    const out = describeActivity(
      "feedback_submitted",
      { category: "bug", page_url: "https://x.test/a", priority: "urgent" },
      resolve,
    );
    expect(out.detail).toContain("Bug");
    expect(out.detail).toContain("Urgent");
  });
});

describe("nothing ever renders as JSON", () => {
  const rows: [string, unknown][] = [
    ["feedback_submitted", { page_url: "https://x.test/", category: "bug", priority: "high" }],
    ["guest_reply_added", null],
    ["public_reply_added", null],
    ["internal_note_added", null],
    ["feedback_edited_by_team", null],
    ["feedback_deleted_by_team", null],
    ["feedback_deleted_by_guest", null],
    ["review_decision", { decision: "approved", message: "Looks good" }],
    ["status_changed_by_guest", { value: "resolved" }],
    ["assigned_to_changed", { assigned_to: null }],
    ["status_changed", { status: "ready_for_qa" }],
    ["priority_changed", { priority: "urgent" }],
    ["category_changed", { category: "bug" }],
    ["something_nobody_has_written_yet", { a: 1 }],
  ];

  for (const [action, details] of rows) {
    it(`${action} reads as a sentence`, () => {
      const { summary, detail } = describeActivity(action, details, resolve);
      expect(summary).toBeTruthy();
      expect(summary).not.toMatch(/[{}]/);
      expect(summary).not.toMatch(/_/);
      if (detail) expect(detail).not.toMatch(/^\{/);
    });
  }
});

describe("specific wording", () => {
  it("uses the shared status vocabulary", () => {
    expect(describeActivity("status_changed", { status: "ready_for_qa" }, resolve).summary)
      .toBe("moved it to Ready for QA");
    expect(describeActivity("status_changed_by_guest", { value: "resolved" }, resolve).summary)
      .toBe("marked it Resolved");
  });

  it("distinguishes clearing an assignee from setting one", () => {
    expect(describeActivity("assigned_to_changed", { assigned_to: null }, resolve).summary)
      .toBe("cleared the assignee");
  });

  /**
   * The canvas review sidebar used to log every field under a generic `value`
   * key, so a status change rendered as "moved it to —" and an assignment
   * claimed the assignee had been *cleared*. The writer names the field now,
   * but rows in that shape are already stored and still have to read.
   */
  it("reads rows the canvas sidebar logged under a generic key", () => {
    expect(describeActivity("status_changed", { value: "in_progress" }, resolve).summary)
      .toBe("moved it to In progress");
    expect(describeActivity("assigned_to_changed", { value: "4b6b3f1e-ca77-44da-b2e0-47d10afa0a9b" }, resolve).summary)
      .toBe("assigned it to Briggs Pedrera");
    expect(describeActivity("assigned_to_changed", { value: null }, resolve).summary)
      .toBe("cleared the assignee");
  });

  it("still names the field-specific key when both could apply", () => {
    expect(describeActivity("status_changed", { status: "resolved", value: "new" }, resolve).summary)
      .toBe("moved it to Resolved");
  });

  it("flags a bulk update, which explains a burst of identical lines", () => {
    expect(describeActivity("status_changed", { status: "resolved", bulk: true }, resolve).summary)
      .toBe("moved it to Resolved (bulk update)");
  });

  it("separates approval from a change request, and carries the message", () => {
    expect(describeActivity("review_decision", { decision: "approved" }, resolve).summary)
      .toBe("approved the review");
    const changes = describeActivity(
      "review_decision",
      { decision: "changes_requested", message: "Fix the header" },
      resolve,
    );
    expect(changes.summary).toBe("requested changes");
    expect(changes.detail).toBe("Fix the header");
  });

  it("does not pretend to know a name it cannot resolve", () => {
    const { summary } = describeActivity("assigned_to_changed", { assigned_to: "unknown-id" }, resolve);
    expect(summary).toBe("assigned it to a former member");
    expect(summary).not.toContain("unknown-id");
  });

  it("handles an arbitrary field the sheet may start writing", () => {
    expect(describeActivity("visibility_changed", { visibility: "internal" }, resolve).summary)
      .toBe("changed Visibility to internal");
  });

  it("survives missing or malformed details", () => {
    expect(() => describeActivity("status_changed", undefined, resolve)).not.toThrow();
    expect(() => describeActivity("status_changed", "not an object", resolve)).not.toThrow();
    expect(() => describeActivity("assigned_to_changed", [1, 2], resolve)).not.toThrow();
  });
});
