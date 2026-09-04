/**
 * Guards for the record lifecycle — archiving and deleting agencies, projects
 * and canvases — and for the account-recovery routes.
 *
 * Most of this is drift detection rather than behaviour: the schema, the
 * routes and the UI each hold one half of a rule, and the failure mode when
 * they disagree is silent. A `client_id` column added later without a cascade
 * doesn't break anything until someone deletes an agency in production and the
 * write fails with a foreign key error the UI can't explain.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const BASE_SCHEMA = read("supabase/migrations/20260502030429_5e3fb060-6e6c-4586-8169-028ac6ced277.sql");
const LIFECYCLE = read("supabase/migrations/20260825160000_record_lifecycle.sql");
const OWNER_SAFETY = read("supabase/migrations/20260825170000_owner_safety.sql");
const APP = read("src/App.tsx");

describe("deleting an agency", () => {
  /**
   * Tables carrying a `client_id` that points at `clients`, and whether the
   * original schema already declared the cascade inline.
   */
  function tablesReferencingClients(): { table: string; cascadesAlready: boolean }[] {
    const out: { table: string; cascadesAlready: boolean }[] = [];
    for (const m of BASE_SCHEMA.matchAll(/CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      const ref = m[2].match(/client_id UUID REFERENCES public\.clients\(id\)( ON DELETE CASCADE)?/);
      if (ref) out.push({ table: m[1], cascadesAlready: !!ref[1] });
    }
    return out;
  }

  it("cascades from every table that points at an agency", () => {
    const referencing = tablesReferencingClients();
    // If this is empty the regex has drifted and the test proves nothing.
    expect(referencing.length).toBeGreaterThan(0);
    // And if they all cascaded already, there was nothing here to fix.
    expect(referencing.some((r) => !r.cascadesAlready)).toBe(true);

    for (const { table, cascadesAlready } of referencing) {
      if (cascadesAlready) continue;
      const rule = new RegExp(
        `ALTER TABLE public\\.${table}\\s+ADD CONSTRAINT ${table}_client_id_fkey\\s+FOREIGN KEY \\(client_id\\) REFERENCES public\\.clients\\(id\\) ON DELETE CASCADE`,
      );
      expect(
        rule.test(LIFECYCLE),
        `${table}.client_id has no ON DELETE CASCADE, so deleting an agency can fail`,
      ).toBe(true);
    }
  });

  it("drops each constraint before re-adding it, so the migration can re-run", () => {
    for (const name of LIFECYCLE.matchAll(/ADD CONSTRAINT (\w+)/g)) {
      expect(LIFECYCLE).toContain(`DROP CONSTRAINT IF EXISTS ${name[1]}`);
    }
  });
});

describe("label assignments", () => {
  it("follow the feedback item and the label", () => {
    // feedback_labels was created with no foreign keys at all.
    expect(LIFECYCLE).toMatch(
      /feedback_labels_feedback_item_id_fkey[\s\S]*?REFERENCES public\.feedback_items\(id\) ON DELETE CASCADE/,
    );
    expect(LIFECYCLE).toMatch(
      /feedback_labels_label_id_fkey[\s\S]*?REFERENCES public\.labels\(id\) ON DELETE CASCADE/,
    );
  });

  it("clears existing orphans first, or the constraint can't be added", () => {
    expect(LIFECYCLE).toMatch(/DELETE FROM public\.feedback_labels/);
  });
});

describe("project status vocabulary", () => {
  const allowed = new Set(
    [...(LIFECYCLE.match(/CHECK \(status IN \(([^)]*)\)\)/)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]),
  );

  it("is constrained", () => {
    expect(allowed.size).toBeGreaterThan(0);
  });

  it("covers every value the app writes", () => {
    const pages = read("src/pages/Projects.tsx") + read("src/pages/ProjectDetail.tsx");
    const written = [...pages.matchAll(/status: archived \? "(\w+)" : "(\w+)"/g)].flatMap((m) => [m[1], m[2]]);
    expect(written.length).toBeGreaterThan(0);
    for (const value of written) expect(allowed, `projects.status="${value}" would be rejected`).toContain(value);
  });

  it("covers the value the dashboard counts", () => {
    expect(read("src/pages/Dashboard.tsx")).toContain('.eq("status", "active")');
    expect(allowed).toContain("active");
  });
});

describe("uploaded files", () => {
  const CALLERS = ["src/pages/Clients.tsx", "src/pages/Projects.tsx", "src/pages/ProjectDetail.tsx"];

  it("are purged only once the record is known to be gone", () => {
    let checked = 0;

    for (const file of CALLERS) {
      // One block per function, so ordering is compared within a single delete
      // path rather than across the whole file.
      for (const block of read(file).split(/\n {2}async function /)) {
        // The first block is everything above the first function — imports
        // name both helpers but delete nothing.
        if (!block.includes("removeStoredFiles") || !block.includes(".delete()")) continue;
        checked += 1;

        const collect = block.indexOf("collectCanvasFilePaths");
        const del = block.indexOf(".delete()");
        const purge = block.indexOf("removeStoredFiles");

        expect(collect, `${file}: paths must be read before the rows naming them go`).toBeGreaterThan(-1);
        expect(collect, `${file}: paths must be collected before the delete`).toBeLessThan(del);
        // Purging first destroys a client's uploads whenever RLS then refuses
        // the delete — the files go and the record stays.
        expect(purge, `${file}: files must only be removed after the delete succeeds`).toBeGreaterThan(del);
      }
    }

    // Agencies, projects (list), canvases and projects (detail).
    expect(checked).toBe(4);
  });
});

describe("owner safety", () => {
  it("refuses to remove the last owner in the database, not just the UI", () => {
    expect(OWNER_SAFETY).toMatch(/BEFORE UPDATE OR DELETE ON public\.user_roles/);
    expect(OWNER_SAFETY).toContain("A workspace must keep at least one owner");
    // 42501 is insufficient_privilege — what the rest of the app already maps.
    expect(OWNER_SAFETY).toMatch(/ERRCODE = '42501'/);
  });

  it("grants the new role before revoking the old one", () => {
    const members = read("src/components/settings/TeamMembers.tsx");
    // Losing the revoke leaves two roles; losing the grant leaves none, and
    // only an owner can put a role back.
    expect(members.indexOf(".upsert(")).toBeGreaterThan(-1);
    expect(members.indexOf(".upsert(")).toBeLessThan(members.indexOf("const { error: delErr }"));
  });
});

describe("account recovery routes", () => {
  it("are reachable without signing in", () => {
    expect(APP).toContain('path="/forgot-password"');
    expect(APP).toContain('path="/reset-password"');
    // Both must sit outside ProtectedRoute — someone locked out has no session.
    const protectedStart = APP.indexOf("<Route element={<ProtectedRoute>");
    expect(APP.indexOf('path="/forgot-password"')).toBeLessThan(protectedStart);
    expect(APP.indexOf('path="/reset-password"')).toBeLessThan(protectedStart);
  });

  it("are offered from the sign-in screen", () => {
    expect(read("src/pages/Login.tsx")).toContain('to="/forgot-password"');
  });
});

describe("ConfirmDeleteDialog", () => {
  it("keeps the button locked until the name is typed exactly", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete Acme?"
        description="Everything goes."
        confirmPhrase="Acme"
        onConfirm={onConfirm}
      />,
    );

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acm" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme" } });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("confirms straight away when no phrase is required", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={() => {}}
        title="Delete canvas?"
        description="It goes."
        confirmLabel="Delete canvas"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete canvas" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });
});
