/**
 * The token that proves a guest owns the pins they left.
 *
 * A public review has no login, so ownership rests entirely on a UUID kept in
 * the reviewer's `localStorage` and sent with every write. Each guest-facing
 * edge function validates the shape and stores NULL for anything that is not a
 * UUID — so a token of the wrong shape does not fail loudly, it silently
 * unclaims the reviewer's work: their comments stop appearing in the finish
 * dialog, and they lose the right to edit or delete their own pins.
 */

/** The shape every guest-facing endpoint insists on before it will store a token. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A v4 UUID, with or without `crypto.randomUUID`.
 *
 * `randomUUID` exists only in a secure context, so a canvas opened over plain
 * http — a phone on the LAN pointed at a dev server, an http deployment — has
 * to fall back. The fallback still has to be a *UUID*, not merely unique.
 */
export function randomUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx

  const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The reviewer's token for one canvas, minted on first use.
 *
 * A stored value that is not a UUID is replaced rather than trusted: it can
 * only have come from the old non-UUID fallback, and keeping it would go on
 * costing the reviewer their pins.
 */
export function readOrCreateGuestToken(shareToken: string): string {
  if (!shareToken) return "";
  const key = `phlash_guest_token_${shareToken}`;
  let t: string | null = null;
  try { t = localStorage.getItem(key); } catch { /* storage can be blocked */ }
  if (t && UUID_RE.test(t)) return t;

  const fresh = randomUuid();
  try { localStorage.setItem(key, fresh); } catch { /* not fatal — lasts the session */ }
  return fresh;
}
