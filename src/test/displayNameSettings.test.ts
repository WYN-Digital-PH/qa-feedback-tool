/**
 * The Settings field that lets someone change the name they appear under.
 *
 * Nothing here renders the component: it imports the Supabase client, which
 * needs build-time env vars the test run has no business carrying. These pin
 * the two decisions that are easy to get wrong and expensive to notice —
 * which column is written, and what happens for an account with no role yet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const component = read("src/components/settings/DisplayName.tsx");

describe("the display name field", () => {
  it("writes the column every surface actually reads", () => {
    // `displayName.ts` resolves a person through `profiles.full_name`; writing
    // anywhere else would leave the new name invisible.
    expect(component).toMatch(/\.from\("profiles"\)/);
    expect(component).toMatch(/\.update\(\{\s*full_name:/);
  });

  it("scopes the write to the signed-in user", () => {
    expect(component).toMatch(/\.eq\("id", user\.id\)/);
  });

  it("is reachable from the settings page", () => {
    const settings = read("src/pages/Settings.tsx");
    expect(settings).toContain('from "@/components/settings/DisplayName"');
    // Rendered, whatever props it is given.
    expect(settings).toMatch(/<DisplayName[\s/>]/);
  });

  /**
   * The bug this guards: SELECT on `profiles` is gated on `is_team_member()`,
   * which is false until someone grants a role, while UPDATE is `auth.uid() =
   * id`. Reading the row back after saving therefore returns zero rows for an
   * account still waiting for a role — turning a save that worked into a
   * "could not be updated" error.
   */
  it("does not read the row back to decide whether the save worked", () => {
    const save = component.slice(component.indexOf("async function save"));
    const update = save.slice(save.indexOf('.from("profiles")'));
    expect(update.slice(0, update.indexOf(";"))).not.toContain(".select(");
  });

  it("refuses an empty name rather than silently falling back to the email", () => {
    expect(component).toContain("if (!trimmed)");
  });

  it("confirms the save, like every other write in the app", () => {
    expect(component).toMatch(/toast\.success\(/);
  });
});

describe("a user can read their own profile", () => {
  it("has a migration widening the profiles select policy to the caller's row", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(resolve(process.cwd(), dir))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(`${dir}/${f}`))
      .join("\n");

    // The last policy definition wins, so assert on the most recent one.
    const policies = sql.match(/CREATE POLICY "team can read profiles"[\s\S]*?;/g) ?? [];
    expect(policies.length, "no profiles select policy found").toBeGreaterThan(0);
    expect(policies[policies.length - 1]).toContain("auth.uid() = id");
  });
});
