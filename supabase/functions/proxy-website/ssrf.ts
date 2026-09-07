/* --------------------------------------------------------------------------
   SSRF guard
   --------------------------------------------------------------------------
   This ran on the hostname as a string, against a handful of prefixes. Six
   ways past it were confirmed against the deployed function, all of which
   reached the domain allowlist instead of being refused here:

     http://[::1]                 WHATWG URL keeps the brackets, so the
     http://[::ffff:127.0.0.1]    "::1" entry never matched anything, and
     http://[fc00::1]             /^fc/ tested "[fc00::1]" which fails
     http://127.0.0.2             only 127.0.0.1 exactly was listed, not 127/8
     http://127.0.0.1.nip.io      a public name resolving to a private address
     http://localtest.me          was never resolved, only pattern-matched

   The prefix regexes also matched real public hostnames -- /^fc/ refused
   anything beginning "fc", such as fc-barcelona.com.

   Addresses are parsed and compared numerically now, names are resolved
   before use, and every redirect hop is re-checked (see fetchGuarded).
   -------------------------------------------------------------------------- */

/** Strips the brackets WHATWG URL keeps around an IPv6 literal. */
export function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(IPV4);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).some((o) => Number(o) > 255)) return false;
  if (a === 0) return true;                          // 0.0.0.0/8 "this network"
  if (a === 10) return true;                         // private
  if (a === 127) return true;                        // entire loopback /8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;           // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 0) return true;             // IETF protocol assignments
  if (a === 192 && b === 168) return true;           // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                         // multicast, reserved, broadcast
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const h = bareHost(ip);
  if (h === "::" || h === "::1") return true;        // unspecified, loopback

  // IPv4-mapped and -compatible, in either dotted or hex form.
  const mapped = h.match(/^::(?:ffff:)?(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (IPV4.test(rest)) return isPrivateIPv4(rest);
    const hex = rest.split(":");
    if (hex.length === 2 && hex.every((p) => /^[0-9a-f]{1,4}$/.test(p))) {
      const n = (parseInt(hex[0], 16) << 16) | parseInt(hex[1], 16);
      return isPrivateIPv4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
  }

  const first = parseInt(h.split(":")[0] || "0", 16);
  if (Number.isNaN(first)) return false;
  if ((first & 0xfe00) === 0xfc00) return true;      // fc00::/7  unique local
  if ((first & 0xffc0) === 0xfe80) return true;      // fe80::/10 link-local
  return false;
}

/** True for a literal address, or a name that can only mean "this machine". */
export function isPrivateHost(host: string): boolean {
  const h = bareHost(host);
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // Names that only ever resolve inside a network boundary.
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (IPV4.test(h)) return isPrivateIPv4(h);
  if (h.includes(":")) return isPrivateIPv6(h);
  return false;
}

/**
 * Whether a name resolves to an address we refuse to fetch.
 *
 * `127.0.0.1.nip.io` is an ordinary public hostname; only its answer is
 * private. A resolution failure is not treated as private — the fetch will
 * fail on its own, and refusing every name we cannot resolve would break the
 * proxy for anything behind split-horizon DNS.
 */
export async function resolvesToPrivate(host: string): Promise<boolean> {
  const h = bareHost(host);
  if (IPV4.test(h) || h.includes(":")) return false; // a literal, already checked

  // Reached through `globalThis` rather than the `Deno` global directly, so the
  // same module type-checks and unit-tests under the app's Node toolchain.
  const resolveDns = (globalThis as {
    Deno?: { resolveDns?: (h: string, t: string) => Promise<string[]> };
  }).Deno?.resolveDns;
  if (!resolveDns) return false;

  for (const type of ["A", "AAAA"]) {
    try {
      const answers = await resolveDns(h, type);
      if (answers.some((ip) => isPrivateHost(ip))) return true;
    } catch {
      /* NXDOMAIN, no record of this type, resolver error — let fetch decide */
    }
  }
  return false;
}

/** Refuses a URL that points anywhere inside the network. */
export async function blockedReason(target: URL): Promise<string | null> {
  if (!["http:", "https:"].includes(target.protocol)) return "Only http/https allowed";
  if (isPrivateHost(target.hostname)) return "Private addresses are not allowed";
  if (await resolvesToPrivate(target.hostname)) return "Private addresses are not allowed";
  return null;
}

/**
 * `fetch` with every redirect hop checked.
 *
 * `redirect: "follow"` validated only the first URL, so any site the proxy was
 * allowed to reach could bounce it to `169.254.169.254` and hand back the cloud
 * metadata. Hops are followed by hand so each `Location` goes through the same
 * guard as the original target.
 */
export async function fetchGuarded(target: URL, init: RequestInit, maxHops = 5): Promise<Response> {
  let current = target;
  for (let hop = 0; hop <= maxHops; hop++) {
    const res = await fetch(current.toString(), { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res;

    let next: URL;
    try { next = new URL(location, current); } catch { return res; }

    const reason = await blockedReason(next);
    if (reason) {
      // Cancel the body rather than leaving the connection hanging.
      await res.body?.cancel().catch(() => {});
      throw new Error(`blocked_redirect: ${reason}`);
    }
    await res.body?.cancel().catch(() => {});
    current = next;
  }
  throw new Error("too_many_redirects");
}
