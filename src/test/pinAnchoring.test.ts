/**
 * Website review pins are anchored to a DOM element (selector + offset inside
 * that element's box), so a comment stays on its component when the page
 * reflows at another viewport width or is reloaded.
 *
 * The behaviour lives in the overlay script that `proxy-website` injects into
 * the proxied page, so the test loads that script out of the edge function and
 * runs it against a jsdom page. jsdom has no layout engine, so element boxes
 * come from an explicit table that the test swaps to simulate a reflow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

const FN_PATH = path.resolve(__dirname, "../../supabase/functions/proxy-website/index.ts");

function overlayScript(): string {
  const src = readFileSync(FN_PATH, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("function injectOverlay");
  const end = src.indexOf("function rewriteUrls");
  if (start < 0 || end < 0) throw new Error("injectOverlay not found in proxy-website");
  const js = src
    .slice(start, end)
    .replace(
      /^function injectOverlay\([^)]*\)\s*:\s*string\s*\{/,
      "function injectOverlay(html, shareToken, baseHref, currentUrl, allowedHosts) {",
    );
  const injectOverlay = new Function(`${js}\nreturn injectOverlay;`)() as (
    ...args: unknown[]
  ) => string;
  const html = injectOverlay(
    "<html><head></head><body></body></html>",
    "tok",
    "https://x.test/",
    "https://x.test/p",
    ["x.test"],
  );
  const m = html.match(/<script id="phlash-review-overlay">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("overlay script not found in injected HTML");
  return m[1];
}

/** The pin payload the overlay posts to the parent when a comment is placed. */
interface PinPayload {
  x_percent: number;
  y_percent: number;
  anchor_selector: string;
  anchor_x_percent: number;
  anchor_y_percent: number;
  element_tag: string;
  element_id: string;
  element_classes: string;
  element_text: string;
}

interface OverlayMessage {
  source: string;
  type: string;
  payload: PinPayload;
}

const PAGE = `<!doctype html><html><body>
  <main>
    <section class="grid">
      <div class="card"><h3>Alpha</h3></div>
      <div class="card"><h3>Bravo</h3><button class="cta">Buy now</button></div>
      <div class="card"><h3>Charlie</h3></div>
    </section>
  </main>
</body></html>`;

type Box = { left: number; top: number; width: number; height: number };
// Three cards side by side; the CTA sits in the middle one.
const DESKTOP: Record<string, Box> = { cta: { left: 520, top: 400, width: 120, height: 40 } };
// Cards stacked: the same CTA is now wider and much further down the page.
const MOBILE: Record<string, Box> = { cta: { left: 40, top: 1180, width: 300, height: 44 } };

describe("website review pin anchoring", () => {
  let dom: JSDOM;
  let win: JSDOM["window"];
  let layout: Record<string, Box>;
  let doc: { w: number; h: number };
  const posted: OverlayMessage[] = [];

  const send = (msg: Record<string, unknown>) =>
    win.dispatchEvent(
      new win.MessageEvent("message", { data: { source: "phlash-review-parent", ...msg } }),
    );
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const marker = (id: string) => win.document.querySelector(`[data-pin-id="${id}"]`);
  const at = (id: string) => ({
    left: parseFloat(marker(id).style.left),
    top: parseFloat(marker(id).style.top),
  });

  let pinPayload: PinPayload;

  beforeAll(async () => {
    dom = new JSDOM(PAGE, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x.test/p" });
    win = dom.window;
    layout = DESKTOP;
    doc = { w: 1280, h: 2000 };

    // Element boxes come from `layout`, keyed by a data-lk attribute.
    win.Element.prototype.getBoundingClientRect = function () {
      const r = layout[this.getAttribute("data-lk") ?? ""] ?? { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON() {} };
    };
    for (const el of [win.document.documentElement, win.document.body]) {
      Object.defineProperty(el, "scrollWidth", { get: () => doc.w });
      Object.defineProperty(el, "scrollHeight", { get: () => doc.h });
    }
    win.document.querySelector(".cta").setAttribute("data-lk", "cta");

    // jsdom's window.parent is the window itself, so the overlay's messages to
    // the parent frame come back as ordinary message events.
    win.addEventListener("message", (ev: Event) => {
      const data = (ev as MessageEvent<OverlayMessage>).data;
      if (data?.source === "phlash-review") posted.push(data);
    });

    win.eval(overlayScript());

    // Place a pin by clicking the CTA in comment mode.
    send({ type: "set-mode", mode: "comment" });
    const click = new win.MouseEvent("click", { bubbles: true, clientX: 580, clientY: 420 });
    // jsdom doesn't derive pageX/pageY from clientX/clientY the way a browser does.
    Object.defineProperty(click, "pageX", { value: 580 });
    Object.defineProperty(click, "pageY", { value: 420 });
    win.document.querySelector(".cta").dispatchEvent(click);
    await settle();
    send({ type: "set-mode", mode: "browse" });
    pinPayload = posted.find((m) => m.type === "pin")?.payload;
  });

  it("records a selector for the clicked element and the offset inside it", () => {
    expect(pinPayload).toBeTruthy();
    expect(win.document.querySelector(pinPayload.anchor_selector)).toBe(win.document.querySelector(".cta"));
    // Clicked dead centre of a 120x40 box at (520,400).
    expect(pinPayload.anchor_x_percent).toBeCloseTo(50, 2);
    expect(pinPayload.anchor_y_percent).toBeCloseTo(50, 2);
    // Document-percent coordinates are still recorded as the fallback.
    expect(pinPayload.x_percent).toBeGreaterThan(0);
    expect(pinPayload.y_percent).toBeGreaterThan(0);
  });

  it("keeps the pin on its element across a responsive viewport change", async () => {
    const pin = {
      id: "pin-1",
      label: 1,
      comment: "Fix this button",
      status: "new",
      visibility: "public",
      x_percent: pinPayload.x_percent,
      y_percent: pinPayload.y_percent,
      anchor_selector: pinPayload.anchor_selector,
      anchor_x_percent: pinPayload.anchor_x_percent,
      anchor_y_percent: pinPayload.anchor_y_percent,
      element_tag: pinPayload.element_tag,
      element_id: pinPayload.element_id,
      element_classes: pinPayload.element_classes,
      element_text: pinPayload.element_text,
    };

    send({ type: "render-pins", pins: [pin] });
    await settle();
    // The pin layer is created lazily; give it a box now that it exists.
    win.document.getElementById("phlash-pin-layer").setAttribute("data-lk", "layer");
    layout.layer = { left: 0, top: 0, width: 0, height: 0 };
    send({ type: "render-pins", pins: [pin] });
    await settle();

    expect(at("pin-1")).toEqual({ left: 580, top: 420 });

    // Switch to the mobile viewport: the CTA moves, the pin must follow it.
    layout = { ...MOBILE, layer: { left: 0, top: 0, width: 0, height: 0 } };
    doc = { w: 390, h: 3400 };
    win.dispatchEvent(new win.Event("resize"));
    await settle(250);

    expect(at("pin-1")).toEqual({ left: 190, top: 1202 });
    expect(marker("pin-1").hasAttribute("data-pin-anchor-missing")).toBe(false);

    // Re-sending the same pin (the parent polls) must not move or duplicate it.
    send({ type: "render-pins", pins: [{ ...pin, status: "resolved" }] });
    await settle();
    expect(win.document.querySelectorAll('[data-pin-id="pin-1"]').length).toBe(1);
    expect(at("pin-1")).toEqual({ left: 190, top: 1202 });
    expect(marker("pin-1").className).toContain("phlash-pin-resolved");
  });

  it("falls back to document percentages for pins with no anchor", async () => {
    send({ type: "render-pins", pins: [{ id: "legacy", label: 7, x_percent: 50, y_percent: 25, comment: "old" }] });
    await settle();
    expect(at("legacy")).toEqual({ left: 195, top: 850 }); // 50% of 390, 25% of 3400
    expect(marker("legacy").hasAttribute("data-pin-anchor-missing")).toBe(true);
    expect(marker("pin-1")).toBeNull(); // pins no longer sent are removed
  });

  it("degrades gracefully when the anchored element is gone", async () => {
    const pin = {
      id: "pin-2",
      label: 2,
      x_percent: 50,
      y_percent: 25,
      anchor_selector: pinPayload.anchor_selector,
      anchor_x_percent: 50,
      anchor_y_percent: 50,
    };
    send({ type: "render-pins", pins: [pin] });
    await settle();
    win.document.querySelector(".cta").remove();
    win.dispatchEvent(new win.Event("resize"));
    await settle(250);

    expect(marker("pin-2")).toBeTruthy();
    expect(marker("pin-2").hasAttribute("data-pin-anchor-missing")).toBe(true);
    expect(at("pin-2")).toEqual({ left: 195, top: 850 });
  });
});
