// @vitest-environment node
/**
 * pdf.js refuses to run if its API and its worker come from different copies.
 *
 * `PdfReviewCanvas` takes the API from react-pdf (`import { pdfjs } from
 * "react-pdf"`) but the worker from the `pdfjs-dist` package directly. Those
 * are the same module only while npm keeps a single copy of `pdfjs-dist`.
 *
 * react-pdf pins `pdfjs-dist` to an exact version, so a wider range in this
 * project's own dependencies installs a second copy nested under react-pdf.
 * That is what happened: the API resolved to 5.4.296 and the worker to
 * 5.7.284, and opening any PDF canvas failed with
 *
 *   The API version "5.4.296" does not match the Worker version "5.7.284".
 *
 * Nothing about that is caught by types, lint or a build — only by opening a
 * PDF — so it is asserted here instead.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const versionOf = (pkgJsonPath: string) =>
  JSON.parse(readFileSync(pkgJsonPath, "utf8")).version as string;

describe("pdf.js API and worker come from one copy", () => {
  /** Where react-pdf itself resolves `pdfjs-dist` — the API's version. */
  const fromReactPdf = require.resolve("pdfjs-dist/package.json", {
    paths: [require.resolve("react-pdf/package.json").replace(/package\.json$/, "")],
  });
  /** Where the worker import resolves — the top-level copy. */
  const fromApp = require.resolve("pdfjs-dist/package.json");

  it("resolves to the same installed package", () => {
    expect(fromReactPdf).toBe(fromApp);
  });

  it("reports the same version on both sides", () => {
    expect(versionOf(fromReactPdf)).toBe(versionOf(fromApp));
  });

  it("declares the exact version react-pdf pins", () => {
    // A range like ^5.7.284 satisfies itself but not react-pdf's exact pin, so
    // npm installs a second copy and the two drift apart again.
    const reactPdfPin = JSON.parse(
      readFileSync(require.resolve("react-pdf/package.json"), "utf8"),
    ).dependencies["pdfjs-dist"] as string;
    const declared = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ).dependencies["pdfjs-dist"] as string;

    expect(declared, "pin pdfjs-dist to the exact version react-pdf depends on").toBe(reactPdfPin);
  });
});
