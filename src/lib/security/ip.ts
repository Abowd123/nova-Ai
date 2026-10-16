/**
 * Pure-JS IP checks (same results as node:net isIP). The client bundle and the Android app
 * must not import node:net, so shared code uses this instead.
 */
const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

export function isIPv4(input: string): boolean {
  return IPV4.test(input);
}

export function isIPv6(input: string): boolean {
  let s = input;
  const zone = s.indexOf("%");
  if (zone >= 0) {
    if (zone === s.length - 1) return false;
    s = s.slice(0, zone);
  }
  if (!s.includes(":")) return false;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) return false;
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));
  if (halves.length === 2) {
    const all = [...groups(halves[0] ?? ""), ...groups(halves[1] ?? "")];
    return all.length <= 7 && all.every((g) => HEX_GROUP.test(g));
  }
  const all = s.split(":");
  return all.length === 8 && all.every((g) => HEX_GROUP.test(g));
}

export function isIP(input: string): 0 | 4 | 6 {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
      }
