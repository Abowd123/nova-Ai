import { isIP } from "./ip";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const IPV4_BLOCKS: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inIpv4Block(ip: string, [base, bits]: [string, number]): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function expandIpv6(ip: string): number[] | null {
  let address = ip.toLowerCase().split("%")[0] ?? "";
  // Embedded IPv4 (::ffff:1.2.3.4)
  const v4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4?.[1]) {
    const n = ipv4ToInt(v4[1]);
    address = address.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head = "", tail] = address.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (tail === undefined && headParts.length !== 8) return null;
  const groups = [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isFinite(g)) ? groups : null;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return IPV4_BLOCKS.some((block) => inIpv4Block(ip, block));
  if (version === 6) {
    const g = expandIpv6(ip);
    if (!g) return true;
    const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return true; // ::1
    if (g.slice(0, 5).every((x) => x === 0) && g5 === 0xffff) {
      return isPrivateAddress(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`); // IPv4-mapped
    }
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g0 & 0xff00) === 0xff00) return true; // multicast
    if (g0 === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g0 === 0x0064 && g[1] === 0xff9b) return true; // NAT64 (can reach v4 private)
    return false;
  }
  return true; // not an IP: treat as unsafe
}

export interface TargetPolicy {
  allowPrivate: boolean;
  allowedHosts: string[];
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static URL checks (before DNS). */
export function checkTargetUrl(raw: string | null, policy: TargetPolicy): TargetCheck {
  if (!raw) return { ok: false, reason: "Missing target URL" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid target URL" };
  }
  if (url.username || url.password) return { ok: false, reason: "Credentials in URL are not allowed" };
  if (url.protocol !== "https:" && !(policy.allowPrivate && url.protocol === "http:")) {
    return { ok: false, reason: "Only https targets are allowed" };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.includes(host)) {
    return { ok: false, reason: "Target host is not in the allowlist" };
  }
  if (!policy.allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return { ok: false, reason: "Private targets are not allowed" };
    }
    if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "Private targets are not allowed" };
  }
  return { ok: true, url };
}

/** Resolves the host and rejects it if ANY address is private (DNS rebinding defense). */
export async function checkResolvedHost(
  hostname: string,
  policy: TargetPolicy,
  lookup: (host: string) => Promise<{ address: string }[]>,
): Promise<TargetCheck | { ok: true }> {
  if (policy.allowPrivate) return { ok: true };
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? { ok: false, reason: "Private targets are not allowed" } : { ok: true };
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, reason: "Target host could not be resolved" };
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    return { ok: false, reason: "Private targets are not allowed" };
  }
  return { ok: true };
}
