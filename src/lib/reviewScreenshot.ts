import { readPinTheme } from "@/lib/reviewTheme";

type PendingPinForScreenshot = {
  x_percent?: number | null;
  y_percent?: number | null;
  viewport_width?: number | null;
  viewport_height?: number | null;
  scroll_x?: number | null;
  scroll_y?: number | null;
  page_url?: string | null;
};

type MarkerCleanup = () => void;

const SCREENSHOT_DEBUG_PREFIX = "[phlash screenshot]";

function debug(message: string, details?: Record<string, unknown>) {
  if (details) console.debug(SCREENSHOT_DEBUG_PREFIX, message, details);
  else console.debug(SCREENSHOT_DEBUG_PREFIX, message);
}

export function waitForScreenshotPaint(delayMs = 120): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.setTimeout(resolve, delayMs));
    });
  });
}

function markerStyle(visibility?: string | null) {
  const isInternal = visibility === "internal";
  const theme = readPinTheme();
  return [
    "position:absolute",
    "width:28px",
    "height:28px",
    "border-radius:999px 999px 999px 2px",
    `background:${isInternal ? theme.pinInternal : theme.pin}`,
    `color:${theme.pinForeground}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font-size:12px",
    "font-weight:700",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
    `border:2px solid ${theme.pinForeground}`,
    "pointer-events:none",
    "z-index:2147483640",
  ].join(";");
}

function addWebsitePendingMarker(
  iframe: HTMLIFrameElement,
  pin: PendingPinForScreenshot | null | undefined,
  label: string | number,
  visibility?: string | null,
): MarkerCleanup {
  if (pin?.x_percent == null || pin?.y_percent == null) return () => {};
  const doc = iframe.contentDocument;
  if (!doc?.body) return () => {};

  let layer = doc.getElementById("phlash-pin-layer");
  if (!layer) {
    layer = doc.createElement("div");
    layer.id = "phlash-pin-layer";
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147483500;";
    doc.body.appendChild(layer);
  }

  const marker = doc.createElement("div");
  marker.id = "phlash-pending-screenshot-pin";
  marker.setAttribute("data-screenshot-pending-pin", "true");
  marker.textContent = String(label);
  marker.style.cssText = `${markerStyle(visibility)};transform:translate(-2px,-26px);`;
  const scrollWidth = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth, 1);
  const scrollHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 1);
  marker.style.left = `${(Number(pin.x_percent) / 100) * scrollWidth}px`;
  marker.style.top = `${(Number(pin.y_percent) / 100) * scrollHeight}px`;
  layer.appendChild(marker);
  debug("Temporary iframe pin rendered", { x_percent: pin.x_percent, y_percent: pin.y_percent, label });
  return () => marker.remove();
}

function addElementPendingMarker(
  pin: PendingPinForScreenshot | null | undefined,
  label: string | number,
  visibility?: string | null,
): MarkerCleanup {
  if (pin?.x_percent == null || pin?.y_percent == null) return () => {};
  const content = document.querySelector<HTMLElement>("[data-review-content]");
  if (!content) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "Pending pin content target missing");
    return () => {};
  }
  const marker = document.createElement("div");
  marker.setAttribute("data-screenshot-pending-pin", "true");
  marker.textContent = String(label);
  marker.style.cssText = `${markerStyle(visibility)};left:${Number(pin.x_percent)}%;top:${Number(pin.y_percent)}%;transform:translate(-50%,-100%);`;
  content.appendChild(marker);
  debug("Temporary canvas pin rendered", { x_percent: pin.x_percent, y_percent: pin.y_percent, label });
  return () => marker.remove();
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    debug("Screenshot data URL created", { width: canvas.width, height: canvas.height, bytesApprox: dataUrl.length });
    return dataUrl;
  } catch (error) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "toDataURL failed", error);
    return null;
  }
}

function urlsMatch(a?: string | null, b?: string | null) {
  if (!a || !b) return true;
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "") && left.search === right.search;
  } catch {
    return a === b;
  }
}

function canvasContainsPinMarker(canvas: HTMLCanvasElement, x: number, y: number, visibility?: string | null) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const expected = visibility === "internal" ? [217, 119, 6] : [14, 138, 147];
  const left = Math.max(0, Math.floor(x - 18));
  const top = Math.max(0, Math.floor(y - 34));
  const width = Math.min(canvas.width - left, 44);
  const height = Math.min(canvas.height - top, 44);
  if (width <= 0 || height <= 0) return false;
  const data = ctx.getImageData(left, top, width, height).data;
  let hits = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i] - expected[0]) < 70 &&
      Math.abs(data[i + 1] - expected[1]) < 70 &&
      Math.abs(data[i + 2] - expected[2]) < 70 &&
      data[i + 3] > 180
    ) hits += 1;
    if (hits > 8) return true;
  }
  return false;
}

export async function captureWebsiteViewportScreenshot(options: {
  iframe: HTMLIFrameElement | null;
  pendingPin?: PendingPinForScreenshot | null;
  pinLabel: string | number;
  visibility?: string | null;
  flow: "public" | "internal";
  currentUrl?: string | null;
}): Promise<string | null> {
  debug("Screenshot capture started", { flow: options.flow, target: "website iframe viewport" });
  const iframe = options.iframe;
  const doc = iframe?.contentDocument;
  const win = iframe?.contentWindow;
  if (!iframe || !doc?.body || !win) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "Capture target missing", { flow: options.flow });
    return null;
  }

  const actualUrl = options.currentUrl || doc.documentElement.getAttribute("data-phlash-current-url") || doc.location?.href;
  if (!urlsMatch(options.pendingPin?.page_url, actualUrl)) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "Capture page mismatch, skipping screenshot", { flow: options.flow, expected: options.pendingPin?.page_url, actual: actualUrl });
    return null;
  }

  const viewportWidth = Math.max(1, Math.floor(Number(options.pendingPin?.viewport_width) || win.innerWidth || doc.documentElement.clientWidth || iframe.clientWidth));
  const viewportHeight = Math.max(1, Math.floor(Number(options.pendingPin?.viewport_height) || win.innerHeight || doc.documentElement.clientHeight || iframe.clientHeight));
  const scrollX = Math.max(0, Math.floor(Number(options.pendingPin?.scroll_x) || win.scrollX || doc.documentElement.scrollLeft || doc.body.scrollLeft || 0));
  const scrollY = Math.max(0, Math.floor(Number(options.pendingPin?.scroll_y) || win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop || 0));
  const fullWidth = Math.max(viewportWidth, doc.documentElement.scrollWidth, doc.body.scrollWidth);
  const fullHeight = Math.max(viewportHeight, doc.documentElement.scrollHeight, doc.body.scrollHeight);
  debug("Capture target found", { flow: options.flow, viewportWidth, viewportHeight, scrollX, scrollY, fullWidth, fullHeight, url: actualUrl, pin: options.pendingPin });

  const cleanup = addWebsitePendingMarker(iframe, options.pendingPin, options.pinLabel, options.visibility);
  try {
    if (Math.abs((win.scrollX || doc.documentElement.scrollLeft || doc.body.scrollLeft || 0) - scrollX) > 2 || Math.abs((win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop || 0) - scrollY) > 2) {
      win.scrollTo(scrollX, scrollY);
    }
    // Render pin then wait two frames + small delay so layout/scroll settle
    await waitForScreenshotPaint();
    await waitForScreenshotPaint(0);
    // Re-read scroll after paint, in case anything shifted
    const settledScrollX = Math.max(0, Math.floor(win.scrollX || doc.documentElement.scrollLeft || doc.body.scrollLeft || 0));
    const settledScrollY = Math.max(0, Math.floor(win.scrollY || doc.documentElement.scrollTop || doc.body.scrollTop || 0));
    debug("Settled scroll before capture", { flow: options.flow, settledScrollX, settledScrollY });
    if (Math.abs(settledScrollX - scrollX) > 4 || Math.abs(settledScrollY - scrollY) > 4) {
      console.warn(SCREENSHOT_DEBUG_PREFIX, "Capture scroll mismatch, skipping screenshot", { flow: options.flow, expected: { scrollX, scrollY }, actual: { settledScrollX, settledScrollY } });
      return null;
    }

    const html2canvas = (await import("html2canvas")).default;
    const screenshotCanvas = await html2canvas(doc.documentElement, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: 1,
      backgroundColor: "#ffffff",
      width: viewportWidth,
      height: viewportHeight,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
      x: scrollX,
      y: scrollY,
      scrollX,
      scrollY,
      ignoreElements: (el) => el.id === "phlash-review-overlay",
    });

    if (screenshotCanvas.width < 4 || screenshotCanvas.height < 4) {
      console.warn(SCREENSHOT_DEBUG_PREFIX, "Capture canvas invalid, skipping screenshot", { width: screenshotCanvas.width, height: screenshotCanvas.height });
      return null;
    }
    const pinX = ((Number(options.pendingPin?.x_percent) || 0) / 100) * fullWidth - scrollX;
    const pinY = ((Number(options.pendingPin?.y_percent) || 0) / 100) * fullHeight - scrollY;
    if (options.pendingPin?.x_percent != null && options.pendingPin?.y_percent != null && !canvasContainsPinMarker(screenshotCanvas, pinX, pinY, options.visibility)) {
      console.warn(SCREENSHOT_DEBUG_PREFIX, "Captured viewport does not contain rendered pin, skipping screenshot", { flow: options.flow, pinX, pinY, width: screenshotCanvas.width, height: screenshotCanvas.height });
      return null;
    }
    return canvasToJpegDataUrl(screenshotCanvas);
  } catch (error) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "capture failed", error);
    return null;
  } finally {
    cleanup();
  }
}

export async function captureReviewElementScreenshot(options: {
  pendingPin?: PendingPinForScreenshot | null;
  pinLabel: string | number;
  visibility?: string | null;
  flow: "public" | "internal";
}): Promise<string | null> {
  debug("Screenshot capture started", { flow: options.flow, target: "review canvas viewport" });
  const target = document.querySelector<HTMLElement>("[data-review-capture]");
  if (!target) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "Capture target missing", { flow: options.flow });
    return null;
  }
  const rect = target.getBoundingClientRect();
  debug("Capture target found", {
    flow: options.flow,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scrollLeft: target.scrollLeft,
    scrollTop: target.scrollTop,
  });

  const cleanup = addElementPendingMarker(options.pendingPin, options.pinLabel, options.visibility);
  try {
    await waitForScreenshotPaint();
    const html2canvas = (await import("html2canvas")).default;
    const screenshotCanvas = await html2canvas(target, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: 0.8,
      backgroundColor: "#ffffff",
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });
    return canvasToJpegDataUrl(screenshotCanvas);
  } catch (error) {
    console.warn(SCREENSHOT_DEBUG_PREFIX, "capture failed", error);
    return null;
  } finally {
    cleanup();
  }
}
