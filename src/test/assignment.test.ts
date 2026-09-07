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

import { ACTIVE_STATUSES, FEEDBACK_STATUSES, assignmentLabel, isAssigned } from "@/lib/feedbackMeta";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const MIGRATION = read("supabase/migrations/20260825180000_assignment_notifications.sql");
const PERMISSIONS_MIGRATION = read("supabase/migrations/20260825140000_customizable_role_permissions.sql");
const FOUR_STATUSES = read("supabase/migrations/20260905090000_four_feedback_statuses.sql");

describe("assignment is a fact, not a status", () => {
  /**
   * `20260825180000` flipped an item to `assigned` whenever somebody was put on
   * it. That recorded one fact twice, and the copies could disagree: clearing
   * the assignee left the status still saying `assigned`. The status was
   * retired; `assigned_to` is the whole story now.
   */
  it("no longer has a trigger that rewrites the status", () => {
    expect(FOUR_STATUSES).toMatch(/DROP TRIGGER IF EXISTS feedback_items_advance_status/);
    expect(FOUR_STATUSES).toMatch(/DROP FUNCTION IF EXISTS public\.advance_status_on_assign/);
  });

  it("drops the trigger before remapping, so it cannot write the value back", () => {
    // Any UPDATE touching assigned_to would re-apply `assigned` to a row the
    // remap had just moved off it.
    expect(FOUR_STATUSES.indexOf("DROP TRIGGER IF EXISTS feedback_items_advance_status"))
      .toBeLessThan(FOUR_STATUSES.indexOf("SET status = 'new'"));
  });

  it("keeps assignment out of the status vocabulary entirely", () => {
    expect(FEEDBACK_STATUSES).not.toContain("assigned");
    expect(ACTIVE_STATUSES).not.toContain("assigned");
  });

  it("derives Assigned / Unassigned from assigned_to alone", () => {
    expect(assignmentLabel("some-user-id")).toBe("Assigned");
    expect(assignmentLabel(null)).toBe("Unassigned");
    expect(assignmentLabel(undefined)).toBe("Unassigned");
    expect(isAssigned("u")).toBe(true);
    expect(isAssigned(null)).toBe(false);
  });

  it("still notifies the assignee — only the status rewrite was removed", () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER feedback_items_notify_assignee/);
    expect(FOUR_STATUSES).not.toMatch(/DROP TRIGGER IF EXISTS feedback_items_notify_assignee/);
    expect(FOUR_STATUSES).not.toMatch(/DROP FUNCTION IF EXISTS public\.notify_feedback_assignee/);
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

describe("the permission panel", () => {
  const panel = read("src/components/settings/RolePermissions.tsx");

  it("is shown only to owners and admins", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toMatch(/const canSeePermissions = isOwner \|\| roles\.includes\("admin"\)/);
    expect(settings).toMatch(/\{canSeePermissions && \(/);
    // And the panel must sit inside that guard, not merely after it.
    expect(settings.indexOf("canSeePermissions &&")).toBeLessThan(settings.indexOf("<RolePermissions />"));
  });

  it("gives every role its own tab", () => {
    expect(panel).toMatch(/ROLES\.map\(\(role\) => \([\s\S]{0,200}<TabsTrigger/);
    expect(panel).toContain("setActiveRole");
  });

  it("uses a switch per permission, not a checkbox", () => {
    expect(panel).toContain("<Switch");
    expect(panel).not.toContain("<Checkbox");
    expect(panel).not.toContain('from "@/components/ui/checkbox"');
  });

  it("folds each category away and says how much of it is on", () => {
    expect(panel).toContain("<AccordionItem");
    expect(panel).toMatch(/items\.filter\(\(p\) => isAllowed\(role, p\.key\)\)\.length/);
    expect(panel).toContain("{on} of {items.length} on");
    // Categories start shut, so the count on a closed header is the only thing
    // saying what a role can do — it has to be there, and no category may be
    // opened by default.
    expect(panel).not.toContain("defaultValue=");
  });

  it("still refuses to edit what the database will not accept", () => {
    // The owner is all-permissions by definition and locked rows are fixed, so
    // neither may be switched however the layout changes.
    expect(panel).toContain('const editable = isOwner && role !== "owner" && !p.is_locked');
    expect(panel).toContain("disabled={!editable || saving === cell}");
  });
});

describe("the feedback inbox", () => {
  const page = read("src/pages/Feedback.tsx");

  it("shows who an item is assigned to", () => {
    // The column is dropped on a narrow viewport, where the assignee moves into
    // the row instead — so assert that it is shown, not how wide the window is.
    expect(page).toMatch(/<th[^>]*>Assignee<\/th>/);
    expect(page).toContain('assigneeName(it.assigned_to) : "Unassigned"');
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
