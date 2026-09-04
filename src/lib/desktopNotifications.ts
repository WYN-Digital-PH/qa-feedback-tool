import { brand } from "@/config/brand";

/**
 * Native desktop notifications — the Windows Action Center and the macOS
 * Notification Center.
 *
 * This uses the Notification API rather than Web Push. The distinction matters
 * and is worth stating plainly:
 *
 *   * **Notification API** (this file) shows a real OS notification whenever
 *     the app is open, including when its tab is in the background or the
 *     window is behind something else. It needs no service worker, no server
 *     and no VAPID keys, and it rides the realtime subscription the bell
 *     already holds.
 *
 *   * **Web Push** would additionally deliver with the browser closed, but
 *     needs a service worker, a VAPID key pair, a stored subscription per
 *     device and an edge function to send from. It is a bigger piece of work,
 *     and every notification this app sends is about something the recipient
 *     will act on inside the app anyway.
 *
 * Permission can only be requested from a user gesture in some browsers, so
 * `requestPermission` is wired to a button rather than called on load. Asking
 * unprompted is also the fastest way to get permanently denied.
 */

const STORAGE_KEY = "phlash_desktop_notifications";

export type DesktopPermission = "unsupported" | "default" | "granted" | "denied";

export function desktopSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Browser-level permission. Separate from the user's preference below. */
export function desktopPermission(): DesktopPermission {
  if (!desktopSupported()) return "unsupported";
  return Notification.permission as DesktopPermission;
}

/**
 * Whether the user wants them, independent of whether the browser allows it.
 * Someone can grant the browser permission and still switch these off here.
 */
export function desktopEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setDesktopEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Preference won't persist; the current session still honours it.
  }
}

/** Ask the browser. Returns the resulting permission. Call from a click. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  if (!desktopSupported()) return "unsupported";
  try {
    // Safari used to only support the callback form; the promise form is
    // standard now, but a rejected promise here must not break the caller.
    const result = await Notification.requestPermission();
    return result as DesktopPermission;
  } catch {
    return Notification.permission as DesktopPermission;
  }
}

export interface DesktopNotice {
  title: string;
  body?: string;
  /** Collapses repeats: a second notice with the same tag replaces the first. */
  tag?: string;
  /** Focused and navigated to when the notification is clicked. */
  href?: string;
}

/**
 * Show one, if the user has both allowed and asked for them. Never throws —
 * this is called from a realtime handler.
 */
export function showDesktopNotification({ title, body, tag, href }: DesktopNotice): void {
  if (!desktopSupported() || !desktopEnabled()) return;
  if (Notification.permission !== "granted") return;

  // Nothing to add when the person is already looking at the page.
  if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: brand.logoSrc,
      // The app plays its own chime, and Windows would otherwise stack a
      // second, louder system sound on top of it.
      silent: true,
    });

    notification.onclick = () => {
      try {
        window.focus();
        if (href) window.location.assign(href);
        notification.close();
      } catch {
        // Focusing can be refused; the notification is still dismissible.
      }
    };
  } catch {
    // Some platforms throw on construction (notably older Android Chrome,
    // which requires a service worker). Silence is the right outcome.
  }
}
