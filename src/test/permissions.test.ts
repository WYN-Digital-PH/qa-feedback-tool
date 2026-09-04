/**
 * The permission model is written down in three places: the migration that
 * seeds it, the typed keys the app gates on, and the documentation an owner
 * reads. They must agree — a doc that quietly disagrees with the database is
 * worse than no doc, because someone will grant access based on it.
 *
 * These tests parse all three and compare them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EDITABLE_ROLES, PERMISSION_KEYS, ROLES, ROLE_SUMMARY } from "@/lib/permissions";
import { SIGN_OFF_STATUSES } from "@/lib/feedbackMeta";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase/migrations/20260825140000_customizable_role_permissions.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const DOC = readFileSync(path.join(ROOT, "docs/ROLES_AND_PERMISSIONS.md"), "utf8").replace(/\r\n/g, "\n");

/** Permission keys seeded into the `permissions` catalogue table. */
function catalogueKeys(): string[] {
  const block = MIGRATION.slice(
    MIGRATION.indexOf("INSERT INTO public.permissions"),
    MIGRATION.indexOf("-- Per-role grants"),
  );
  return [...block.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)'/gm)].map((m) => m[1]);
}

/** The default grant matrix, as `role -> set of allowed keys`. */
function sqlDefaults(): Record<string, Set<string>> {
  const block = MIGRATION.slice(
    MIGRATION.indexOf("WITH grants(role, keys)"),
    MIGRATION.indexOf("CROSS JOIN public.permissions p"),
  );
  const out: Record<string, Set<string>> = {};
  for (const m of block.matchAll(/\('(\w+)'::public\.app_role,\s*ARRAY\[([^\]]*)\]/g)) {
    out[m[1]] = new Set([...m[2].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((k) => k[1]));
  }
  return out;
}

/** The matrix as published in Part 3 of the documentation. */
function docDefaults(): Record<string, Set<string>> {
  const table = DOC.slice(DOC.indexOf("## Part 3"), DOC.indexOf("### What changed"));
  const out: Record<string, Set<string>> = {};
  for (const role of ROLES) out[role] = new Set();
  // | `key` | ✅ | ✅ | — | ... — columns follow the ROLES order.
  for (const line of table.split("\n")) {
    const m = line.match(/^\|\s*`([a-z_]+\.[a-z_]+)`\s*\|(.+)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    ROLES.forEach((role, i) => {
      if (cells[i] === "✅") out[role].add(m[1]);
    });
  }
  return out;
}

describe("permission catalogue", () => {
  it("matches the keys the app gates on", () => {
    expect([...PERMISSION_KEYS].sort()).toEqual(catalogueKeys().sort());
  });

  it("documents every permission in Part 2", () => {
    const reference = DOC.slice(DOC.indexOf("## Part 2"), DOC.indexOf("## Part 3"));
    for (const key of PERMISSION_KEYS) {
      expect(reference, `${key} is missing from the permission reference`).toContain(`\`${key}\``);
    }
  });

  it("has a summary for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_SUMMARY[role]).toBeTruthy();
    }
    expect(EDITABLE_ROLES).not.toContain("owner");
  });
});

describe("default grant matrix", () => {
  const sql = sqlDefaults();
  const doc = docDefaults();

  it("covers every role", () => {
    expect(Object.keys(sql).sort()).toEqual([...ROLES].sort());
  });

  it.each([...ROLES])("documentation matches the migration for %s", (role) => {
    expect([...doc[role]].sort()).toEqual([...sql[role]].sort());
  });

  it("gives the owner every permission", () => {
    expect([...sql.owner].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("keeps viewer read-only", () => {
    for (const key of sql.viewer) {
      expect(key, `viewer should not be granted ${key}`).toMatch(/\.view$/);
    }
  });

  it("lets developers triage but not sign work off", () => {
    expect(sql.developer.has("feedback.triage")).toBe(true);
    expect(sql.developer.has("feedback.resolve")).toBe(false);
    expect(sql.qa.has("feedback.resolve")).toBe(true);
  });

  it("reserves destructive and team permissions for owner and admin", () => {
    for (const key of ["clients.delete", "projects.delete", "canvases.delete", "feedback.delete", "team.manage"]) {
      const holders = ROLES.filter((r) => sql[r].has(key));
      expect(holders.sort(), `${key} should only be held by owner and admin`).toEqual(["admin", "owner"]);
    }
  });
});

describe("enforcement", () => {
  it("guards every permission that is not enforced by a column-level trigger", () => {
    // feedback.assign / feedback.resolve compare OLD to NEW in a trigger, so
    // they legitimately do not appear in a policy expression.
    const triggerEnforced = new Set(["feedback.assign", "feedback.resolve"]);
    const referenced = new Set(
      [...MIGRATION.matchAll(/has_permission\(auth\.uid\(\),\s*'([^']+)'\)/g)].map((m) => m[1]),
    );
    for (const key of PERMISSION_KEYS) {
      if (triggerEnforced.has(key)) continue;
      expect(referenced.has(key), `${key} is never checked by a policy`).toBe(true);
    }
  });

  it("checks the sign-off statuses the UI disables", () => {
    for (const status of SIGN_OFF_STATUSES) {
      expect(MIGRATION).toContain(`'${status}'`);
    }
    expect(MIGRATION).toMatch(/NEW\.status IN \('resolved', 'closed'\)/);
  });

  it("keeps owner permissions immutable and owner-granting owner-only", () => {
    expect(MIGRATION).toContain("Owner permissions cannot be changed");
    expect(MIGRATION).toMatch(/has_permission\(auth\.uid\(\), 'team\.manage'\) AND role <> 'owner'/);
  });
});
