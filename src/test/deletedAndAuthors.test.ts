/**
 * Two failures that looked like nothing was wrong.
 *
 * Feedback is deleted by stamping `deleted_at`, never by removing the row, so
 * every read has to exclude it by hand. Miss one and a comment the client has
 * deleted goes on being counted somewhere — undone everywhere except the screen
 * that forgot.
 *
 * And an embedded author (`profiles(...)`) needs a foreign key between the two
 * tables for PostgREST to follow. Without one the request fails and the caller,
 * reading only `data`, renders an empty list. Both halves are asserted here:
 * the relationship exists, and no caller drops the error that would tell you it
 * doesn't.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const DASHBOARD = read("src/pages/Dashboard.tsx");
const BELL = read("src/components/NotificationBell.tsx");
const TIMELINE = read("src/components/feedback/ActivityTimeline.tsx");
const FEEDBACK = read("src/pages/Feedback.tsx");
const RELATIONSHIPS = read("supabase/migrations/20260905100000_author_profile_relationships.sql");
const BASE_SCHEMA = read("supabase/migrations/20260502030429_5e3fb060-6e6c-4586-8169-028ac6ced277.sql");

describe("deleted feedback stays deleted", () => {
  /**
   * Each `from("feedback_items")` read in a file, paired with the chain that
   * follows it, so a missing `.is("deleted_at", null)` is visible.
   */
  function reads(source: string): string[] {
    return source
      .split('.from("feedback_items")')
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf(",\n") === -1 ? 400 : Math.max(chunk.indexOf(";"), 400)));
  }

  it("is excluded from every dashboard count and list", () => {
    const found = reads(DASHBOARD);
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const chain of found) {
      expect(chain, `a dashboard read does not exclude deleted rows: ${chain.slice(0, 80)}`)
        .toContain('.is("deleted_at", null)');
    }
  });

  it("stops notifying from the bell once deleted", () => {
    const found = reads(BELL);
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const chain of found) expect(chain).toContain('.is("deleted_at", null)');
    // The bell's reply feed reads a second table with the same rule.
    expect(BELL.split('.from("feedback_comments")')[1]).toContain('.is("deleted_at", null)');
  });
});

describe("an embedded author can actually be resolved", () => {
  it("the base schema points the author columns at auth.users, which is the bug", () => {
    // Kept as a record of what the migration is correcting. PostgREST cannot
    // follow two separate arrows into auth.users as a relationship.
    expect(BASE_SCHEMA).toMatch(/user_id UUID REFERENCES auth\.users\(id\)/);
  });

  it("re-points both author columns at profiles", () => {
    for (const table of ["activity_logs", "feedback_comments"]) {
      expect(RELATIONSHIPS).toContain(`ALTER TABLE public.${table}`);
      expect(RELATIONSHIPS).toMatch(
        new RegExp(`ADD CONSTRAINT ${table}_user_id_fkey\\s+FOREIGN KEY \\(user_id\\) REFERENCES public\\.profiles\\(id\\)`),
      );
    }
  });

  it("backfills profiles before adding the keys, so the deploy cannot fail halfway", () => {
    expect(RELATIONSHIPS.indexOf("INSERT INTO public.profiles"))
      .toBeLessThan(RELATIONSHIPS.indexOf("ADD CONSTRAINT activity_logs_user_id_fkey"));
  });

  it("keeps history when an account goes away", () => {
    // The record of what happened outlives the account that did it.
    expect(RELATIONSHIPS).toMatch(/REFERENCES public\.profiles\(id\) ON DELETE SET NULL/);
  });
});

describe("a failed read is never rendered as an empty one", () => {
  it("the activity timeline surfaces its error", () => {
    expect(TIMELINE).toContain("const { data, error } = await q");
    expect(TIMELINE).toMatch(/if \(error\)/);
    // Distinguishable from the genuine empty state.
    expect(TIMELINE).toContain("No activity recorded yet.");
    expect(TIMELINE).toMatch(/Activity could not be loaded/);
  });

  it("the feedback thread surfaces its error", () => {
    expect(FEEDBACK).toContain("const { data, error } = await q");
    expect(FEEDBACK).toMatch(/Could not load this thread/);
  });
});
