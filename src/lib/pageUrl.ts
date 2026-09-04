/**
 * Deciding whether two URLs mean the same page.
 *
 * A website canvas keeps every pin against the page it was left on, and the
 * canvas only draws the pins belonging to the page currently in the iframe.
 * That comparison used to be `===` on the raw strings, which quietly loses
 * pins: the two sides of it are produced by different code and normalised
 * differently.
 *
 * The agency types `website_url` by hand, so it is stored exactly as typed —
 * usually with no trailing slash. The proxy reports the page back through
 * `new URL(target).toString()`, and the URL constructor *adds* a trailing
 * slash to a bare origin. So a canvas saved as
 *
 *     https://example.com          (canvases.website_url, what the app compares)
 *     https://example.com/         (feedback_items.original_page_url, what was stored)
 *
 * has every one of its pins filtered out, on a canvas that looks perfectly
 * healthy — the feedback is in the database and the sidebar count is right,
 * but nothing renders. The same failure follows from `http` vs `https`, a
 * `www.` the reviewer's browser resolved, or a `#section` on the end.
 *
 * None of those distinctions mean "a different page" for review purposes, so
 * compare on what does: host, path and query.
 */

/**
 * The comparable identity of a page URL.
 *
 * Deliberately dropped: the scheme (sites redirect http → https), a leading
 * `www.` (an alias of the apex in practice), a trailing slash, and the hash
 * (a fragment is a position on a page, not another page).
 *
 * Deliberately kept: the query string, since `?page=2` really is a different
 * page, and a non-default port, so two local staging servers stay distinct.
 *
 * Anything unparseable falls back to a trimmed, lowercased string so the
 * comparison degrades to the old behaviour instead of throwing.
 */
export function normalizePageUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    // A bare `example.com/path` has no scheme for the constructor to accept.
    try {
      u = new URL(`https://${s}`);
    } catch {
      return s.toLowerCase();
    }
  }

  // `host` rather than `hostname` so a non-default port survives; the URL
  // constructor has already dropped :80 and :443.
  const host = u.host.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${u.search}`;
}

/**
 * Whether two URLs refer to the same page.
 *
 * Two blanks are the same page — that keeps a pin whose `original_page_url`
 * was never recorded from disappearing when the canvas has no URL either.
 */
export function samePageUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizePageUrl(a) === normalizePageUrl(b);
}
