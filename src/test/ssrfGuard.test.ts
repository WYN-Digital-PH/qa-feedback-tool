// @vitest-environment node
/**
 * The website-preview proxy's SSRF guard.
 *
 * `proxy-website` fetches a URL supplied in the query string, from inside
 * Supabase's network, with no user session required (`verify_jwt = false`).
 * The guard is what stops it being used to read whatever that network can
 * reach — cloud metadata at 169.254.169.254 most of all.
 *
 * Every "must be blocked" case below except the last three was confirmed
 * reachable against the deployed function before the guard was rewritten:
 * they passed the host check and were stopped only by the per-canvas domain
 * allowlist, which a team member can widen by editing a canvas.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isPrivateHost } from "../../supabase/functions/proxy-website/ssrf";

/** What the proxy actually tests: the hostname WHATWG URL hands back. */
const hostOf = (u: string) => new URL(u).hostname;

describe("addresses inside the network are refused", () => {
  it.each([
    ["loopback by name", "http://localhost/"],
    ["loopback", "http://127.0.0.1/"],
    // Only 127.0.0.1 exactly used to be listed, so the rest of 127/8 was open.
    ["loopback, elsewhere in 127/8", "http://127.0.0.2/"],
    ["loopback, shorthand", "http://127.1/"],
    ["loopback, decimal", "http://2130706433/"],
    ["loopback, octal", "http://0177.0.0.1/"],
    ["unspecified", "http://0.0.0.0/"],
    ["unspecified, shorthand", "http://0/"],
    ["private 10/8", "http://10.0.0.1/"],
    ["private 172.16/12", "http://172.16.0.0/"],
    ["private 172.16/12 top", "http://172.31.255.255/"],
    ["private 192.168/16", "http://192.168.1.1/"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["carrier-grade NAT", "http://100.64.0.1/"],
    ["benchmarking", "http://198.18.0.1/"],
    ["multicast", "http://224.0.0.1/"],
    // WHATWG URL keeps the brackets, so a bare "::1" entry never matched.
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 unspecified", "http://[::]/"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped loopback, hex", "http://[::ffff:7f00:1]/"],
    ["IPv6 unique local", "http://[fc00::1]/"],
    ["IPv6 unique local", "http://[fd12:3456::1]/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
    ["localhost subdomain", "http://foo.localhost/"],
    ["mDNS name", "http://printer.local/"],
    ["internal suffix", "http://db.internal/"],
  ])("blocks %s", (_label, url) => {
    expect(isPrivateHost(hostOf(url))).toBe(true);
  });
});

describe("public addresses are still reachable", () => {
  it.each([
    ["an ordinary domain", "http://example.com/"],
    ["a public resolver", "http://8.8.8.8/"],
    // The old guard tested the hostname with /^fc/ and /^fd/, so it refused
    // every public name beginning "fc" or "fd".
    ["a domain starting fc", "http://fc-barcelona.com/"],
    ["a domain starting fd", "http://fdn.fr/"],
    ["just below 172.16/12", "http://172.15.0.1/"],
    ["just above 172.16/12", "http://172.32.0.1/"],
    ["just above 192.168/16", "http://192.169.0.1/"],
    ["just above 10/8", "http://11.0.0.1/"],
    ["public IPv6", "http://[2606:4700::1111]/"],
    ["just below CGNAT", "http://99.64.0.1/"],
  ])("allows %s", (_label, url) => {
    expect(isPrivateHost(hostOf(url))).toBe(false);
  });
});

describe("the guard is wired into every path that fetches", () => {
  const source = () => readFileSync("supabase/functions/proxy-website/index.ts", "utf8");

  it("checks the target before fetching it", () => {
    expect(source()).toContain("const blocked = await blockedReason(target)");
  });

  /**
   * `redirect: "follow"` checked only the first URL. Any site the proxy was
   * allowed to reach could answer 302 to an internal address and the proxy
   * would follow it and hand back the body.
   */
  it("re-checks every redirect hop", () => {
    const src = source();
    expect(src).toContain("fetchGuarded(target");
    expect(src).not.toContain('redirect: "follow"');
  });

  it("resolves names before trusting them", () => {
    // 127.0.0.1.nip.io is a public hostname; only its answer is private.
    const guard = readFileSync("supabase/functions/proxy-website/ssrf.ts", "utf8");
    expect(guard).toContain("resolveDns");
    expect(guard).toMatch(/resolvesToPrivate\(target\.hostname\)/);
  });
});
