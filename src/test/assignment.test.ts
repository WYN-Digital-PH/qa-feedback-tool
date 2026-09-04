/**
 * Guards for assignment: who gets told, what the status becomes, and who can
 * see the permission matrix.
 *
 * Feedback is assigned from three different screens (the inbox, the review
 * sidebar and the internal canvas), so both rules live in database triggers.
 * These tests check the triggers exist and are shaped correctly, and that no
 * screen has quietly grown its own version of the rule.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ACTIVE_STATUSES, FEEDBACK_STATUSES } from "@/lib/feedbackMeta";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const MIGRATION = read("supabase/migrations/20260825180000_assignment_notifications.sql");
const PERMISSIONS_MIGRATION = read("supabase/migrations/20260825140000_customizable_role_permissions.sql");

describe("assigning moves an item off New", () => {
  it("is enforced by a trigger, not by one screen", () => {
    expect(MIGRATION).toMatch(/BEFORE UPDATE OF assigned_to ON public\.feedback_items/);
    expect(MIGRATION).toContain("NEW.status := 'assigned';");
  });

  it("only promotes from statuses that mean nobody has picked it up", () => {
    const guard = MIGRATION.match(/OLD\.status IN \(([^)]*)\)/)?.[1] ?? "";
    const from = [...guard.matchAll(/'(\w+)'/g)].map((m) => m[1]);

    expect(from.length).toBeGreaterThan(0);
    for (const status of from) expect(FEEDBACK_STATUSES).toContain(status);
    // Promoting out of in_progress or ready_for_qa would undo real work.
    expect(from).not.toContain("in_progress");
    expect(from).not.toContain("ready_for_qa");
    expect(from).not.toContain("resolved");
    expect(from).not.toContain("closed");
  });

  it("lets an explicit status in the same update win", () => {
    expect(MIGRATION).toMatch(/NEW\.status IS NOT DISTINCT FROM OLD\.status/);
  });

  it("targets a status the inbox still counts as active", () => {
    // Otherwise assigning something would hide it from the default view.
    expect(ACTIVE_STATUSES).toContain("assigned");
  });

  it("backfills items assigned before the trigger existed", () => {
    expect(MIGRATION).toMatch(/UPDATE public\.feedback_items\s+SET status = 'assigned'/);
  });

  it("runs before the permission trigger it shares a table with", () => {
    // Postgres fires same-timing triggers in name order, and the permission
    // check has to see the status this leaves behind.
    const mine = MIGRATION.match(/CREATE TRIGGER (\w+)\s+BEFORE UPDATE OF assigned_to/)?.[1];
    const theirs = PERMISSIONS_MIGRATION.match(/CREATE TRIGGER (feedback_items_\w+)/)?.[1];
    expect(mine).toBeTruthy();
    expect(theirs).toBeTruthy();
    expect(mine!.localeCompare(theirs!)).toBeLessThan(0);
  });
});

describe("notifications", () => {
  it("are readable only by the person they are addressed to", () => {
    expect(MIGRATION).toMatch(/FOR SELECT TO authenticated USING \(user_id = auth\.uid\(\)\)/);
  });

  it("cannot be forged, because nothing may insert one", () => {
    // The trigger is SECURITY DEFINER; granting INSERT to authenticated would
    // let anyone put words in someone else's bell.
    expect(MIGRATION).not.toMatch(/FOR INSERT TO authenticated/);
    // Supabase grants new public tables to anon and authenticated by default,
    // so the grant has to be taken back, not merely left to RLS.
    expect(MIGRATION).toMatch(/REVOKE ALL ON public\.notifications FROM anon, authenticated/);
    expect(MIGRATION).toMatch(/GRANT SELECT, UPDATE, DELETE ON public\.notifications TO authenticated/);
  });

  it("cannot be re-pointed at another user while being marked read", () => {
    expect(MIGRATION).toMatch(/FOR UPDATE TO authenticated[\s\S]*?WITH CHECK \(user_id = auth\.uid\(\)\)/);
  });

  it("skips the person doing the assigning", () => {
    expect(MIGRATION).toMatch(/IF actor IS NOT NULL AND NEW\.assigned_to = actor THEN/);
  });

  it("never reads OLD on an insert", () => {
    // The trigger is AFTER INSERT OR UPDATE; OLD is unassigned on INSERT.
    expect(MIGRATION).toMatch(/IF TG_OP = 'UPDATE' THEN\s+previous := OLD\.assigned_to;/);
  });

  it("are streamed, so the bell rings without a refresh", () => {
    expect(MIGRATION).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications");
    expect(MIGRATION).toContain("REPLICA IDENTITY FULL");
  });

  it("reach the bell filtered to the signed-in user", () => {
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toMatch(/table: "notifications", filter: `user_id=eq\.\$\{user\.id\}`/);
    expect(bell).toContain("playNotificationChime");
  });
});

describe("notification sound", () => {
  const sound = read("src/lib/notificationSound.ts");

  it("never throws out of a realtime handler", () => {
    // Autoplay policy rejects resume() until the page has seen a gesture.
    expect(sound).toMatch(/catch\s*{/);
    expect(sound).toMatch(/if \(ctx\.state === "suspended"\) await ctx\.resume\(\)/);
  });

  it("can be muted, and survives storage being unavailable", () => {
    expect(sound).toContain("export function setSoundEnabled");
    // localStorage throws outright in some privacy modes.
    expect(sound).toMatch(/localStorage\.getItem[\s\S]{0,80}catch/);
  });
});

describe("the permission matrix", () => {
  it("is shown only to owners and admins", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toMatch(/const canSeePermissions = isOwner \|\| roles\.includes\("admin"\)/);
    expect(settings).toMatch(/\{canSeePermissions && \(/);
    // And the panel must sit inside that guard, not merely after it.
    expect(settings.indexOf("canSeePermissions &&")).toBeLessThan(settings.indexOf("<RolePermissions />"));
  });
});

describe("the feedback inbox", () => {
  const page = read("src/pages/Feedback.tsx");

  it("shows an assignee column", () => {
    expect(page).toContain('<th className="text-left px-4 py-3">Assignee</th>');
  });

  it("can filter to the signed-in user's own items", () => {
    expect(page).toContain('<SelectItem value="mine">Assigned to me</SelectItem>');
    expect(page).toMatch(/assigneeFilter === "mine" && user\?\.id\) q = q\.eq\("assigned_to", user\.id\)/);
  });

  it("reloads when the assignee filter changes", () => {
    // The filter is applied server-side, so it has to be in the effect's deps.
    const deps = page.match(/\[statusFilter, projectFilter, ([^\]]*)\]/)?.[1] ?? "";
    expect(deps).toContain("assigneeFilter");
  });

  it("gates assigning on the permission the database checks", () => {
    expect(page).toContain('disabled={!can("feedback.assign")}');
    expect(PERMISSIONS_MIGRATION).toContain("'feedback.assign'");
  });
});
