/**
 * Theme bridge for the proxied-website review canvas.
 *
 * The overlay that draws pins runs inside the iframe, served by the
 * `proxy-website` edge function, so it can't read the app's CSS custom
 * properties. The parent resolves the pin tokens here and posts them in, which
 * keeps review pins on-brand after a rebrand instead of hardcoding a colour in
 * two codebases.
 */

/** Placeholder shown in the iframe until the proxied HTML arrives. */
export const IFRAME_PLACEHOLDER_HTML =
  "<!doctype html><html><body style=\"font:14px var(--font-sans, system-ui, sans-serif);color:#6b7280;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">Loading website…</body></html>";

export interface PinTheme {
  pin: string;
  pinForeground: string;
  pinInternal: string;
  pinResolved: string;
}

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = styles.getPropertyValue(name).trim();
  // Tokens are stored as bare HSL channels ("240 100% 23%").
  return raw ? `hsl(${raw})` : fallback;
}

/** Resolves the current pin palette from the document's CSS variables. */
export function readPinTheme(): PinTheme {
  if (typeof window === "undefined") {
    return { pin: "#000075", pinForeground: "#ffffff", pinInternal: "#d97706", pinResolved: "#6b7280" };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    pin: readToken(styles, "--pin", "#000075"),
    pinForeground: readToken(styles, "--pin-foreground", "#ffffff"),
    pinInternal: readToken(styles, "--pin-internal", "#d97706"),
    pinResolved: readToken(styles, "--pin-resolved", "#6b7280"),
  };
}

/** Sends the pin palette to the review overlay running inside `frame`. */
export function postPinTheme(frame: HTMLIFrameElement | null): void {
  try {
    frame?.contentWindow?.postMessage(
      { source: "phlash-review-parent", type: "set-theme", theme: readPinTheme() },
      "*",
    );
  } catch {
    /* iframe not ready yet — the overlay falls back to its default palette */
  }
}
