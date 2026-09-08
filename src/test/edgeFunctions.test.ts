// @vitest-environment node
/**
 * Edge functions have to at least parse.
 *
 * Runs under node rather than the suite's default jsdom: esbuild's API checks
 * that `new TextEncoder().encode("")` is a real `Uint8Array`, and jsdom's is
 * not, so it refuses to start.
 *
 * Nothing in the toolchain looked at `supabase/functions/` — `tsc` is scoped to
 * `src`, eslint to `src`, and vitest never imported them. So a duplicate `const`
 * in `upload-canvas-file` shipped and stayed: the module could not be parsed,
 * the function never booted, and every request answered 503. Creating an image
 * or PDF canvas failed at the upload step, the client deleted the half-made
 * canvas, and the feature simply did not work.
 *
 * This is a parse check, not a type check — enough to catch the class of fault
 * that takes a whole function offline the moment it is deployed.
 */
import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const FUNCTIONS_DIR = resolve(process.cwd(), "supabase/functions");

/** Every .ts file under supabase/functions, as repo-relative paths. */
function edgeFunctionFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(FUNCTIONS_DIR)) {
    const dir = join(FUNCTIONS_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".ts")) out.push(`supabase/functions/${entry}/${file}`);
    }
  }
  return out.sort();
}

describe("every edge function parses", () => {
  const files = edgeFunctionFiles();

  it("finds the functions to check", () => {
    // A glob that silently matches nothing would make every case below vacuous.
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain("supabase/functions/upload-canvas-file/index.ts");
    expect(files).toContain("supabase/functions/proxy-website/index.ts");
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    // Throws on a syntax error or a duplicate binding, which is exactly the
    // fault that took upload-canvas-file offline.
    expect(() => transformSync(source, { loader: "ts", format: "esm" })).not.toThrow();
  });
});
