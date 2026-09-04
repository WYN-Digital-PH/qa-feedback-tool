import { describe, expect, it } from "vitest";
import { normalizePageUrl, samePageUrl } from "@/lib/pageUrl";

/**
 * These cover the failure that prompted the helper: a website canvas whose
 * pins were all invisible because the URL the proxy stored and the URL the app
 * compared against differed only cosmetically.
 */
describe("samePageUrl", () => {
  it("matches a bare origin against the trailing slash the URL constructor adds", () => {
    // Exactly the Delaurentiis Construction case: `canvases.website_url` was
    // typed without a trailing slash, while the proxy reported the page as
    // `new URL(target).toString()`, which appends one.
    const stored = new URL("https://delaurentiisconstruction.com").toString();
    const fromCanvasRecord = "https://delaurentiisconstruction.com";

    expect(stored).not.toBe(fromCanvasRecord); // the bug, still true
    expect(samePageUrl(stored, fromCanvasRecord)).toBe(true); // the fix
  });

  it("ignores the scheme, since sites redirect http to https", () => {
    expect(samePageUrl("http://example.com/about", "https://example.com/about")).toBe(true);
  });

  it("treats www as the apex domain", () => {
    expect(samePageUrl("https://www.example.com/about", "https://example.com/about")).toBe(true);
  });

  it("ignores a fragment, which is a position on a page and not another page", () => {
    expect(samePageUrl("https://example.com/about#team", "https://example.com/about")).toBe(true);
  });

  it("ignores case in the host but not in the path", () => {
    expect(samePageUrl("https://EXAMPLE.com/About", "https://example.com/About")).toBe(true);
    expect(samePageUrl("https://example.com/About", "https://example.com/about")).toBe(false);
  });

  it("keeps genuinely different pages apart", () => {
    expect(samePageUrl("https://example.com/about", "https://example.com/contact")).toBe(false);
    expect(samePageUrl("https://example.com/", "https://other.com/")).toBe(false);
  });

  it("keeps the query string, because ?page=2 is a different page", () => {
    expect(samePageUrl("https://example.com/blog?page=2", "https://example.com/blog")).toBe(false);
    expect(samePageUrl("https://example.com/blog?page=2", "https://example.com/blog?page=2")).toBe(true);
  });

  it("keeps a non-default port so two local staging servers stay distinct", () => {
    expect(samePageUrl("http://localhost:3000/", "http://localhost:8080/")).toBe(false);
    expect(samePageUrl("https://example.com:443/x", "https://example.com/x")).toBe(true);
  });

  it("treats blanks as equal so a pin with no recorded page survives", () => {
    expect(samePageUrl(null, undefined)).toBe(true);
    expect(samePageUrl("", null)).toBe(true);
    expect(samePageUrl("https://example.com/", null)).toBe(false);
  });

  it("degrades instead of throwing on something unparseable", () => {
    expect(() => normalizePageUrl("not a url at all")).not.toThrow();
    expect(samePageUrl("not a url", "not a url")).toBe(true);
  });

  it("handles a URL with no scheme", () => {
    expect(samePageUrl("example.com/about", "https://example.com/about")).toBe(true);
  });
});
